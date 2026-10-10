-- =====================================================================
-- Acheter chez un vendeur dont le compte de paiement n'est pas prêt
--
-- LA DÉCISION (Augustin, 10 octobre 2026)
--
-- Jusqu'ici, create-checkout refusait tout achat tant que le vendeur n'avait
-- pas terminé son inscription Stripe (SELLER_NOT_ONBOARDED). Au 10 octobre,
-- aucun des dix-sept profils n'est prêt : la boutique rouverte ne pouvait
-- donc rien vendre.
--
-- Le paiement est encaissé par la plateforme, puis versé au vendeur par un
-- transfert, au plus tôt 48 h après la confirmation de réception. Le compte
-- du vendeur n'est donc nécessaire qu'au moment de ce transfert. L'achat est
-- désormais accepté, et l'argent reste sur le compte Stripe de la plateforme
-- comme pour toute vente. En contrepartie :
--
--   1. à l'encaissement, si le vendeur n'est pas prêt, la commande reçoit une
--      échéance : 7 jours après le paiement (seller_ready_deadline_at) ;
--   2. sur ces ventes, le vendeur ne peut pas déclarer l'expédition tant que
--      son compte n'est pas prêt, ni après l'échéance (garde dans
--      order_mark_shipped). Sans cette garde, il pourrait expédier une pièce
--      qu'une annulation automatique rembourserait ensuite à l'acheteur :
--      l'acheteur garderait la pièce ET l'argent. Symétriquement,
--      l'annulation automatique ne touche jamais une commande déclarée
--      expédiée (file et décision) ;
--   3. dès que le vendeur devient prêt avant l'échéance, la commande reprend
--      son cours (seller_ready_at), quel que soit le chemin qui le constate :
--      webhook Connect, retour d'inscription ou surveillance. Tous trois
--      écrivent profiles.stripe_onboarded ; un déclencheur sur profiles suffit
--      donc à les couvrir sans toucher à leur code. Le délai d'expédition
--      repart alors de zéro (5 jours ouvrés) ;
--   4. à l'échéance, si le vendeur n'est toujours pas prêt, la commande est
--      annulée et l'acheteur remboursé intégralement (prix, port et
--      Protection acheteurs). Le remboursement est un appel Stripe : il est
--      fait par la fonction payout-release, déjà appelée toutes les heures
--      par la tâche pg_cron « payout-release ». Aucune tâche nouvelle.
--      La base, elle, porte la décision et l'idempotence :
--        - order_seller_not_ready_cancel_claim décide, sous verrou, et pose
--          seller_ready_cancel_at une seule fois ;
--        - order_seller_not_ready_cancel_complete enregistre le remboursement
--          en réutilisant order_apply_refund (même statut, même remise en
--          vente de l'annonce que pour tout remboursement intégral) ;
--   5. les relances (2 et 5 jours après le paiement), l'annonce de
--      l'annulation et celle de la reprise passent par order_notifications :
--      un couple (commande, événement) ne part qu'une fois.
--
-- L'échéance est stricte : un vendeur qui devient prêt après elle ne sauve
-- pas la commande, même si le remboursement n'est pas encore parti. C'est ce
-- qui a été annoncé à l'acheteur. Pour qu'un retard de synchronisation ne
-- pénalise pas un vendeur réellement prêt, payout-release relit son compte
-- chez Stripe dans l'heure qui précède l'échéance.
--
-- Cette migration n'est PAS appliquée automatiquement : elle se colle dans
-- l'éditeur SQL du tableau de bord Supabase. Elle est rejouable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Réglages
-- ---------------------------------------------------------------------

-- Ces trois valeurs sont aussi écrites dans les textes (page de paiement,
-- courriels, CGV) via REGLAGES_VENDEUR_PAS_PRET de _shared/payments.ts. Les
-- changer ici sans changer là-bas ferait annoncer une date fausse :
-- tests/db-vendeur-pas-pret.test.ts compare les deux.
INSERT INTO public.platform_settings (key, value) VALUES
  -- Délai laissé au vendeur pour finaliser son inscription, en jours
  -- calendaires après le paiement.
  ('seller_ready_days', 7),
  -- Relances, en jours après le paiement. La première vente prévient déjà
  -- le vendeur le jour même (courriel de nouvelle vente).
  ('seller_ready_reminder_1_days', 2),
  ('seller_ready_reminder_2_days', 5)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Colonnes
-- ---------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS seller_ready_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_ready_at          timestamptz,
  ADD COLUMN IF NOT EXISTS seller_ready_cancel_at   timestamptz,
  ADD COLUMN IF NOT EXISTS seller_ready_refund_id   text,
  ADD COLUMN IF NOT EXISTS seller_ready_refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_ready_last_error  text,
  ADD COLUMN IF NOT EXISTS seller_ready_refund_attempts int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.seller_ready_deadline_at IS
  'Posée au paiement si le compte Stripe du vendeur n''était pas prêt : au-delà, la commande est annulée et remboursée. NULL si le vendeur était prêt.';
COMMENT ON COLUMN public.orders.seller_ready_at IS
  'Moment où le vendeur est devenu prêt avant l''échéance : la commande reprend son cours normal.';
COMMENT ON COLUMN public.orders.seller_ready_cancel_at IS
  'Décision d''annulation prise à l''échéance (une seule fois). Le remboursement suit, retenté à chaque passage horaire jusqu''à aboutir.';
COMMENT ON COLUMN public.orders.seller_ready_refund_id IS
  'Remboursement Stripe créé par l''annulation automatique (NULL si le remboursement a été constaté par le webhook seul).';
COMMENT ON COLUMN public.orders.seller_ready_refunded_at IS
  'Annulation automatique terminée : remboursement enregistré en base.';
COMMENT ON COLUMN public.orders.seller_ready_last_error IS
  'Code neutre de la dernière erreur du remboursement automatique (refund_failed, refund_not_succeeded, no_payment). Le détail Stripe n''est jamais écrit ici : l''acheteur et le vendeur lisent leur commande entière (select *) ; il va dans le journal et au courriel de l''exploitant.';
COMMENT ON COLUMN public.orders.seller_ready_refund_attempts IS
  'Tentatives de remboursement automatique en échec. Entre dans la clé d''idempotence Stripe : sans cela, Stripe rejouerait 24 h durant le même refus au lieu de retenter.';

CREATE INDEX IF NOT EXISTS orders_seller_ready_idx
  ON public.orders (seller_ready_deadline_at)
  WHERE seller_ready_deadline_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. « Le vendeur peut-il recevoir l'argent ? »
--
-- La même règle qu'orders_ready_for_payout : un identifiant de compte ET le
-- drapeau stripe_onboarded, que seuls le service et l'administration peuvent
-- écrire (profiles_prevent_self_unblock). Écrite une fois, lue partout ici.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seller_payout_ready(p_seller_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.stripe_account_id IS NOT NULL AND COALESCE(p.stripe_onboarded, false)
      FROM public.profiles p
     WHERE p.id = p_seller_id
  ), false);
$$;

-- ---------------------------------------------------------------------
-- 4. Échéance posée à l'encaissement
--
-- Même mécanique que orders_set_ship_deadline : un déclencheur sur le passage
-- à « payée ». C'est order_settle_payment qui fait ce passage, appelé par le
-- webhook, la page de confirmation et la surveillance ; le déclencheur les
-- couvre tous sans redéfinir cette fonction. L'état du vendeur est lu au
-- moment du paiement, pas à l'ouverture de la session.
-- ---------------------------------------------------------------------

-- SECURITY DEFINER : seller_payout_ready n'est pas exécutable par les rôles
-- du site, et le déclencheur doit pouvoir la lire quel que soit le chemin
-- qui fait passer la commande à « payée ». Il ne lit que NEW et profiles.
CREATE OR REPLACE FUNCTION public.orders_set_seller_ready_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_days int;
BEGIN
  IF NEW.status = 'paid'
     AND OLD.status IS DISTINCT FROM 'paid'
     AND NEW.seller_ready_deadline_at IS NULL
     AND NEW.seller_ready_at IS NULL
     AND NEW.seller_id IS NOT NULL
     AND NOT public.seller_payout_ready(NEW.seller_id) THEN
    SELECT value::int INTO v_days FROM public.platform_settings WHERE key = 'seller_ready_days';
    NEW.seller_ready_deadline_at := COALESCE(NEW.paid_at, now()) + make_interval(days => COALESCE(v_days, 7));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_seller_ready_deadline ON public.orders;
CREATE TRIGGER orders_seller_ready_deadline
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_set_seller_ready_deadline();

-- ---------------------------------------------------------------------
-- 5. Reprise dès que le vendeur devient prêt
--
-- Le webhook account.updated, le retour d'inscription (connect-onboard) et la
-- surveillance passent tous par synchroniserProfilConnect, qui écrit
-- profiles.stripe_onboarded. Un déclencheur ici les couvre tous les trois.
--
-- SECURITY DEFINER : l'administration peut aussi écrire ce drapeau avec son
-- propre jeton (rôle authenticated), et ce rôle n'a aucun droit d'écriture
-- sur orders. En SECURITY INVOKER, la reprise serait alors silencieusement
-- ignorée.
--
-- Seules les commandes dont l'échéance n'est pas passée reprennent : passé
-- l'échéance, l'annulation annoncée à l'acheteur s'applique.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.profiles_reprendre_commandes_vendeur()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ship_days int;
BEGIN
  IF NEW.stripe_account_id IS NOT NULL
     AND COALESCE(NEW.stripe_onboarded, false)
     AND (NOT COALESCE(OLD.stripe_onboarded, false)
          OR OLD.stripe_account_id IS DISTINCT FROM NEW.stripe_account_id) THEN
    SELECT value::int INTO v_ship_days
      FROM public.platform_settings WHERE key = 'shipping_deadline_business_days';

    UPDATE public.orders o
       SET seller_ready_at = now(),
           -- Le délai d'expédition court à partir du moment où le vendeur
           -- peut expédier, pas du paiement : il ne pouvait rien faire avant.
           ship_deadline_at = GREATEST(COALESCE(o.ship_deadline_at, now()),
                                       public.add_business_days(now(), COALESCE(v_ship_days, 5)))
     WHERE o.seller_id = NEW.id
       AND o.seller_ready_deadline_at IS NOT NULL
       AND o.seller_ready_at IS NULL
       AND o.seller_ready_cancel_at IS NULL
       AND o.seller_ready_deadline_at >= now()
       AND o.status IN ('paid', 'disputed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_reprise_commandes ON public.profiles;
CREATE TRIGGER profiles_reprise_commandes
  AFTER UPDATE OF stripe_onboarded, stripe_account_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_reprendre_commandes_vendeur();

-- ---------------------------------------------------------------------
-- 6. Déclaration d'expédition : garde sur le compte du vendeur
--
-- Reprise de la version de 20260813000200_buyer_protection_pricing.sql, avec
-- une garde de plus. Le message est écrit pour le vendeur ; le code stable
-- part dans HINT, que supabase-js expose (error.hint) pour que le site
-- affiche son propre texte traduit.
--
-- La garde ne vise que les ventes conclues chez un vendeur pas prêt (celles
-- qui ont une échéance). Un vendeur prêt au paiement dont le compte cesse de
-- l'être ensuite (justificatif demandé par Stripe) garde le comportement
-- d'avant : il peut expédier, et le versement attend son compte
-- (orders_ready_for_payout exige déjà stripe_onboarded). Sa commande n'a pas
-- d'échéance, donc aucune annulation automatique ne peut la rembourser après
-- coup : rien à protéger, et le bloquer la ferait tomber en revue manuelle.
--
-- Pour une vente avec échéance, l'invariant est : jamais d'expédition sur une
-- commande que l'annulation automatique peut encore rembourser. D'où trois
-- refus, et seller_ready_at posé au passage quand le vendeur est prêt sans
-- que la reprise l'ait constaté (course entre le paiement et le webhook
-- Connect) : une commande expédiée n'est ainsi jamais « en attente du
-- vendeur ».
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_mark_shipped(
  p_order_id uuid,
  p_tracking_number text,
  p_tracking_carrier text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order   public.orders;
  v_uid     uuid := auth.uid();
  v_reprise boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.seller_id IS NULL OR v_order.seller_id <> v_uid THEN
    RAISE EXCEPTION 'Non autorisé : vous n''êtes pas le vendeur de cette commande';
  END IF;
  IF v_order.status NOT IN ('paid') THEN
    RAISE EXCEPTION 'Commande déjà expédiée ou clôturée (statut : %)', v_order.status;
  END IF;

  -- L'annulation est décidée : le remboursement est en cours, l'article ne
  -- doit plus partir.
  IF v_order.seller_ready_cancel_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cette commande est annulée : votre inscription au paiement n''était pas finalisée à l''échéance, et l''acheteur est remboursé. N''expédiez pas l''article.'
      USING ERRCODE = 'P0001', HINT = 'ORDER_CANCELED_SELLER_NOT_READY';
  END IF;

  IF v_order.seller_ready_deadline_at IS NOT NULL AND v_order.seller_ready_at IS NULL THEN
    -- Échéance passée sans reprise : l'annulation sera décidée au prochain
    -- passage horaire de payout-release, même si le vendeur est devenu prêt
    -- entre-temps (c'est ce qui a été annoncé à l'acheteur). Laisser partir
    -- l'article maintenant, c'est risquer que l'acheteur garde la pièce ET
    -- soit remboursé.
    IF v_order.seller_ready_deadline_at < now() THEN
      RAISE EXCEPTION 'Cette commande va être annulée : votre inscription au paiement n''était pas finalisée à l''échéance, et l''acheteur sera intégralement remboursé. N''expédiez pas l''article.'
        USING ERRCODE = 'P0001', HINT = 'ORDER_CANCELED_SELLER_NOT_READY';
    END IF;

    -- Sans compte prêt, l'argent ne pourrait pas être versé, et la commande
    -- serait annulée à l'échéance : expédier maintenant ferait perdre la pièce.
    IF NOT public.seller_payout_ready(v_order.seller_id) THEN
      RAISE EXCEPTION 'Finalisez d''abord votre inscription au paiement (Stripe) dans Mon compte, rubrique Paramètres. Tant qu''elle n''est pas terminée, vous ne pouvez pas déclarer l''expédition : l''argent de cette vente ne pourrait pas vous être versé.'
        USING ERRCODE = 'P0001', HINT = 'SELLER_STRIPE_NOT_READY';
    END IF;

    -- Prêt avant l'échéance, mais la reprise n'a pas été constatée : on la
    -- constate ici, sous le même verrou que l'expédition.
    v_reprise := true;
  END IF;

  IF p_tracking_number IS NULL OR length(trim(p_tracking_number)) = 0 THEN
    RAISE EXCEPTION 'Numéro de suivi requis';
  END IF;

  UPDATE public.orders
  SET status = 'shipped',
      tracking_number = trim(p_tracking_number),
      tracking_carrier = NULLIF(trim(coalesce(p_tracking_carrier, '')), ''),
      shipped_at = now(),
      seller_ready_at = CASE WHEN v_reprise THEN COALESCE(seller_ready_at, now()) ELSE seller_ready_at END
  WHERE id = p_order_id
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.order_mark_shipped(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.order_mark_shipped(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Revue manuelle : ne pas signaler un retard que le vendeur ne peut pas
--    résorber
--
-- Reprise de 20260813000200_buyer_protection_pricing.sql. Une seule ligne
-- change, dans la règle (b) : une commande qui attend le compte du vendeur
-- n'est pas « en retard d'expédition », puisque l'expédition lui est
-- interdite. Sans cette exclusion, needs_review serait posé avant la reprise
-- et ne se lèverait jamais (rien ne l'efface après une expédition tardive) :
-- le versement resterait bloqué après la réception confirmée.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_flag_manual_review()
RETURNS TABLE (order_id uuid, motif text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_silence_days int;
  v_ship_days    int;
BEGIN
  SELECT value::int INTO v_silence_days FROM public.platform_settings WHERE key = 'buyer_silence_days';
  SELECT value::int INTO v_ship_days    FROM public.platform_settings WHERE key = 'shipping_deadline_business_days';
  v_silence_days := COALESCE(v_silence_days, 14);
  v_ship_days    := COALESCE(v_ship_days, 5);

  RETURN QUERY
  WITH silence AS (
    UPDATE public.orders o
       SET payout_state = 'manual_review',
           needs_review = true,
           review_reason = COALESCE(o.review_reason,
             format('Acheteur sans réponse %s jours après expédition déclarée le %s',
                    v_silence_days, to_char(o.shipped_at, 'DD/MM/YYYY')))
     WHERE o.payout_state = 'pending'
       AND o.status = 'shipped'
       AND o.confirmed_at IS NULL
       AND o.shipped_at IS NOT NULL
       AND o.shipped_at < now() - make_interval(days => v_silence_days)
    RETURNING o.id, 'acheteur sans réponse'::text
  )
  SELECT * FROM silence;

  RETURN QUERY
  WITH late AS (
    UPDATE public.orders o
       SET needs_review = true,
           review_reason = COALESCE(o.review_reason,
             format('Expédition non déclarée dans le délai de %s jours ouvrés', v_ship_days))
     WHERE o.status = 'paid'
       AND o.payout_state = 'pending'
       AND o.ship_deadline_at IS NOT NULL
       AND o.ship_deadline_at < now()
       AND NOT o.needs_review
       -- Commande en attente du compte du vendeur : son sort se joue à
       -- l'échéance (reprise ou annulation), pas en revue manuelle.
       AND NOT (o.seller_ready_deadline_at IS NOT NULL AND o.seller_ready_at IS NULL)
    RETURNING o.id, 'expédition en retard'::text
  )
  SELECT * FROM late;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.orders_flag_manual_review() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.orders_flag_manual_review() TO service_role, postgres;

-- ---------------------------------------------------------------------
-- 8. File de travail de payout-release
--
-- Une ligne par commande qui demande quelque chose, avec la phase :
--   annulation : annulation décidée, remboursement à faire ou à refaire ;
--   echeance   : échéance passée, vendeur pas prêt, annulation à décider ;
--   attente    : avant l'échéance, une relance est due, ou l'échéance tombe
--                dans l'heure (le compte est alors relu chez Stripe), ou le
--                vendeur est déjà prêt en base sans que la reprise ait été
--                constatée (course entre le paiement et le webhook Connect :
--                la décision la constate alors sans appel à Stripe) ;
--   annulee    : remboursée, un courriel d'annulation n'est pas encore parti ;
--   reprise    : vendeur devenu prêt, un courriel de reprise n'est pas parti
--                et l'article n'est pas encore expédié (après l'expédition,
--                l'acheteur a le courriel d'expédition, et « vous pouvez
--                expédier » n'aurait plus de sens).
--
-- La relance due est calculée ici, et une seule à la fois : si la tâche a
-- manqué la première, on n'envoie que la plus récente, jamais deux d'un coup.
-- order_notification_claim reste le juge de paix contre les doublons.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_seller_ready_queue(p_limit int DEFAULT 50)
RETURNS TABLE (
  order_id                 uuid,
  phase                    text,
  relance                  text,
  echeance_proche          boolean,
  seller_id                uuid,
  buyer_id                 uuid,
  customer_email           text,
  product_id               bigint,
  product_title            text,
  status                   text,
  paid_at                  timestamptz,
  seller_ready_deadline_at timestamptz,
  seller_ready_at          timestamptz,
  ship_deadline_at         timestamptz,
  amount_total_cents       int,
  product_amount_cents     int,
  shipping_amount_cents    int,
  protection_fee_cents     int,
  seller_amount_cents      int,
  amount_refunded_cents    int,
  stripe_payment_intent_id text,
  stripe_charge_id         text,
  seller_account_id        text,
  seller_onboarded         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH reglages AS (
    SELECT
      COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'seller_ready_days'), 7)            AS jours,
      COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'seller_ready_reminder_1_days'), 2) AS r1,
      COALESCE((SELECT value::int FROM public.platform_settings WHERE key = 'seller_ready_reminder_2_days'), 5) AS r2
  ),
  envoyes AS (
    SELECT n.order_id, array_agg(n.event) AS evenements
      FROM public.order_notifications n
      JOIN public.orders o ON o.id = n.order_id
     WHERE o.seller_ready_deadline_at IS NOT NULL
     GROUP BY n.order_id
  ),
  base AS (
    SELECT o.*,
           COALESCE(e.evenements, ARRAY[]::text[]) AS evenements,
           pf.stripe_account_id AS compte_vendeur,
           COALESCE(pf.stripe_onboarded, false) AS vendeur_onboarded,
           (pf.stripe_account_id IS NOT NULL AND COALESCE(pf.stripe_onboarded, false)) AS vendeur_pret_en_base,
           COALESCE(o.paid_at, o.seller_ready_deadline_at - make_interval(days => r.jours)) AS paye_le,
           r.r1, r.r2,
           CASE
             WHEN o.seller_ready_cancel_at IS NOT NULL AND o.seller_ready_refunded_at IS NULL THEN 'annulation'
             WHEN o.seller_ready_refunded_at IS NOT NULL THEN 'annulee'
             WHEN o.seller_ready_at IS NOT NULL THEN 'reprise'
             WHEN o.seller_ready_deadline_at < now() THEN 'echeance'
             ELSE 'attente'
           END AS ph
      FROM public.orders o
      CROSS JOIN reglages r
      LEFT JOIN envoyes e ON e.order_id = o.id
      LEFT JOIN public.profiles pf ON pf.id = o.seller_id
     WHERE o.seller_ready_deadline_at IS NOT NULL
  ),
  calcul AS (
    SELECT b.*,
           CASE
             WHEN b.ph <> 'attente' THEN NULL
             WHEN now() >= b.paye_le + make_interval(days => b.r2)
                  AND NOT ('vendeur_pas_pret_relance_2' = ANY (b.evenements)) THEN 'relance_2'
             WHEN now() >= b.paye_le + make_interval(days => b.r1)
                  AND now() <  b.paye_le + make_interval(days => b.r2)
                  AND NOT ('vendeur_pas_pret_relance_1' = ANY (b.evenements)) THEN 'relance_1'
           END AS rel,
           (b.seller_ready_deadline_at < now() + interval '70 minutes') AS proche,
           -- Les conditions sans lesquelles on ne rembourse pas
           -- automatiquement : déjà remboursée (même en partie), litige
           -- bancaire ouvert (Stripe refuse alors le remboursement), argent
           -- déjà versé au vendeur, article déjà déclaré expédié (l'acheteur
           -- garderait la pièce ET l'argent ; une commande expédiée puis
           -- passée « disputed » par un signalement de l'acheteur relève de
           -- la médiation, pas de l'annulation automatique).
           (b.status IN ('paid', 'disputed')
            AND b.amount_refunded_cents = 0
            AND b.chargeback_status IS NULL
            AND b.payout_state <> 'released'
            AND b.shipped_at IS NULL
            AND b.tracking_number IS NULL) AS remboursable
      FROM base b
  )
  SELECT c.id, c.ph, c.rel, c.proche,
         c.seller_id, c.buyer_id, c.customer_email, c.product_id, pr.title, c.status,
         c.paye_le, c.seller_ready_deadline_at, c.seller_ready_at, c.ship_deadline_at,
         c.amount_total_cents, c.product_amount_cents, c.shipping_amount_cents,
         c.protection_fee_cents, c.seller_amount_cents, c.amount_refunded_cents,
         c.stripe_payment_intent_id, c.stripe_charge_id,
         c.compte_vendeur, c.vendeur_onboarded
    FROM calcul c
    LEFT JOIN public.products pr ON pr.id = c.product_id
   WHERE (c.ph = 'annulation')
      OR (c.ph = 'echeance' AND c.remboursable)
      OR (c.ph = 'attente'  AND c.remboursable AND (c.rel IS NOT NULL OR c.proche OR c.vendeur_pret_en_base))
      OR (c.ph = 'annulee'
          AND c.seller_ready_refunded_at > now() - interval '7 days'
          AND (NOT ('vendeur_pas_pret_annulation_acheteur' = ANY (c.evenements))
               OR NOT ('vendeur_pas_pret_annulation_vendeur' = ANY (c.evenements))))
      OR (c.ph = 'reprise'
          AND c.seller_ready_at > now() - interval '7 days'
          AND c.status IN ('paid', 'disputed')
          AND c.shipped_at IS NULL
          AND (NOT ('vendeur_pret_reprise_acheteur' = ANY (c.evenements))
               OR NOT ('vendeur_pret_reprise_vendeur' = ANY (c.evenements))))
   ORDER BY CASE c.ph
              WHEN 'annulation' THEN 0
              WHEN 'echeance'   THEN 1
              WHEN 'annulee'    THEN 2
              WHEN 'reprise'    THEN 3
              ELSE 4
            END,
            c.seller_ready_deadline_at
   LIMIT GREATEST(1, COALESCE(p_limit, 50));
$$;

-- ---------------------------------------------------------------------
-- 9. Décider l'annulation, une seule fois
--
-- Renvoie { decision, order } :
--   annuler        l'annulation est décidée (maintenant ou lors d'un passage
--                  précédent dont le remboursement n'a pas abouti) : il faut
--                  rembourser ;
--   deja_rembourse rien à faire ;
--   pret           le vendeur est prêt avant l'échéance : la commande
--                  reprend (filet si le déclencheur de profiles n'a pas joué) ;
--   pas_encore     échéance non atteinte, vendeur pas prêt ;
--   hors_champ     commande non concernée, ou non remboursable sans humain
--                  (motif renvoyé).
--
-- Le verrou de ligne sérialise avec le déclencheur de reprise : si le
-- vendeur devient prêt pendant ce temps, l'un des deux gagne, jamais les
-- deux. C'est l'heure de la base qui décide de l'échéance, pas celle de la
-- fonction edge.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_seller_not_ready_cancel_claim(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order     public.orders;
  v_ship_days int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('decision', 'hors_champ', 'motif', 'commande introuvable');
  END IF;

  IF v_order.seller_ready_refunded_at IS NOT NULL THEN
    RETURN jsonb_build_object('decision', 'deja_rembourse', 'order', to_jsonb(v_order));
  END IF;

  IF v_order.seller_ready_cancel_at IS NOT NULL THEN
    RETURN jsonb_build_object('decision', 'annuler', 'order', to_jsonb(v_order));
  END IF;

  IF v_order.seller_ready_deadline_at IS NULL OR v_order.seller_ready_at IS NOT NULL THEN
    RETURN jsonb_build_object('decision', 'hors_champ', 'motif', 'commande non concernée',
                              'order', to_jsonb(v_order));
  END IF;

  -- Déjà déclarée expédiée : l'annulation automatique rembourserait un
  -- acheteur qui a (ou aura) la pièce. Ce cas ne doit pas exister
  -- (order_mark_shipped le refuse) ; s'il existe, c'est à un humain de voir.
  IF v_order.shipped_at IS NOT NULL OR v_order.tracking_number IS NOT NULL THEN
    RETURN jsonb_build_object('decision', 'hors_champ', 'motif', 'déjà déclarée expédiée',
                              'order', to_jsonb(v_order));
  END IF;

  IF v_order.status NOT IN ('paid', 'disputed')
     OR v_order.amount_refunded_cents <> 0
     OR v_order.chargeback_status IS NOT NULL
     OR v_order.payout_state = 'released' THEN
    RETURN jsonb_build_object('decision', 'hors_champ',
      'motif', format('statut %s, remboursé %s c, litige bancaire %s, versement %s',
                      v_order.status, v_order.amount_refunded_cents,
                      COALESCE(v_order.chargeback_status, 'aucun'), v_order.payout_state),
      'order', to_jsonb(v_order));
  END IF;

  IF v_order.seller_ready_deadline_at >= now() THEN
    IF public.seller_payout_ready(v_order.seller_id) THEN
      SELECT value::int INTO v_ship_days
        FROM public.platform_settings WHERE key = 'shipping_deadline_business_days';
      UPDATE public.orders
         SET seller_ready_at = now(),
             ship_deadline_at = GREATEST(COALESCE(ship_deadline_at, now()),
                                         public.add_business_days(now(), COALESCE(v_ship_days, 5)))
       WHERE id = v_order.id
      RETURNING * INTO v_order;
      RETURN jsonb_build_object('decision', 'pret', 'order', to_jsonb(v_order));
    END IF;
    RETURN jsonb_build_object('decision', 'pas_encore', 'order', to_jsonb(v_order));
  END IF;

  -- Échéance passée : l'annulation est décidée, même si le vendeur est prêt
  -- depuis quelques minutes. C'est ce qui a été annoncé à l'acheteur.
  UPDATE public.orders
     SET seller_ready_cancel_at = now(),
         seller_ready_last_error = NULL
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('decision', 'annuler', 'order', to_jsonb(v_order));
END;
$$;

-- ---------------------------------------------------------------------
-- 10. Enregistrer le remboursement de l'annulation
--
-- Passe par order_apply_refund, comme le webhook charge.refunded : même
-- statut 'refunded', même remise en vente de l'annonce. Si le webhook est
-- arrivé le premier, order_apply_refund ne refait rien (même montant, même
-- statut) et l'annonce ne remonte qu'une fois.
--
-- Le montant enregistré est le CUMUL remboursé, comme celui que le webhook
-- lit dans charge.amount_refunded, et non le montant de ce seul
-- remboursement. Un remboursement sans montant solde la charge : le cumul
-- vaut donc le total encaissé. Si un remboursement partiel avait été fait à
-- la main entre la décision et ce remboursement, enregistrer le seul reste
-- ferait voir au webhook suivant un montant différent : il rappellerait
-- order_apply_refund, et l'annonce gagnerait un second exemplaire.
--
-- Le versement passe à 'not_applicable' : il n'y aura jamais rien à verser.
-- Laissé à 'blocked' (ce que pose orders_guard_payout sur tout
-- remboursement), il remonterait comme « versement suspendu » à chaque
-- passage de la surveillance.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_seller_not_ready_cancel_complete(
  p_order_id       uuid,
  p_refund_id      text,
  p_refunded_cents int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.seller_ready_cancel_at IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCEL_CLAIMED' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.seller_ready_refunded_at IS NOT NULL THEN
    RETURN jsonb_build_object('changed', false, 'order', to_jsonb(v_order));
  END IF;

  -- Le webhook charge.refunded a pu arriver le premier et tout enregistrer.
  -- Rappeler order_apply_refund avec un autre montant le ferait repasser par
  -- la remise en vente, et l'annonce gagnerait un exemplaire de trop.
  IF v_order.status <> 'refunded' THEN
    PERFORM public.order_apply_refund(
      v_order.stripe_payment_intent_id,
      v_order.stripe_charge_id,
      COALESCE(v_order.stripe_amount_total_cents, v_order.amount_total_cents, NULLIF(p_refunded_cents, 0), 0),
      true
    );
  END IF;

  UPDATE public.orders
     SET seller_ready_refund_id   = COALESCE(p_refund_id, seller_ready_refund_id),
         seller_ready_refunded_at = now(),
         seller_ready_last_error  = NULL,
         payout_state      = CASE WHEN payout_state IN ('pending', 'blocked') THEN 'not_applicable' ELSE payout_state END,
         payout_last_error = 'Commande annulée et remboursée : compte de paiement du vendeur non finalisé à l''échéance',
         closed_at         = COALESCE(closed_at, now())
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('changed', true, 'order', to_jsonb(v_order));
END;
$$;

-- Échec du remboursement : la décision d'annuler est acquise, on garde la
-- trace et la tâche retentera au passage horaire suivant.
--
-- p_code est un code neutre (refund_failed, refund_not_succeeded,
-- no_payment) : la colonne est lisible par l'acheteur et le vendeur, le
-- détail Stripe reste dans le journal et le courriel à l'exploitant.
--
-- Le compteur de tentatives entre dans la clé d'idempotence du remboursement.
-- Stripe garde 24 h la réponse d'une clé, refus compris : sans compteur, les
-- passages suivants rejoueraient le même refus sans rien retenter. Changer de
-- clé est sans danger ici : un remboursement sans montant ne peut aboutir
-- qu'une fois par charge (ensuite Stripe répond charge_already_refunded).
-- Renvoie le nombre de tentatives en échec, qui sert aussi à espacer les
-- alertes à l'exploitant.
DROP FUNCTION IF EXISTS public.order_seller_not_ready_cancel_failed(uuid, text);
CREATE OR REPLACE FUNCTION public.order_seller_not_ready_cancel_failed(p_order_id uuid, p_code text)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
     SET seller_ready_last_error = left(COALESCE(p_code, 'refund_failed'), 40),
         seller_ready_refund_attempts = seller_ready_refund_attempts + 1
   WHERE id = p_order_id AND seller_ready_cancel_at IS NOT NULL AND seller_ready_refunded_at IS NULL
  RETURNING seller_ready_refund_attempts;
$$;

-- ---------------------------------------------------------------------
-- 11. Droits
--
-- Tout ce qui précède est réservé au service (fonctions edge) et à
-- l'éditeur SQL. seller_payout_ready ne sert qu'à l'intérieur des fonctions
-- SECURITY DEFINER ci-dessus : le site n'en a pas besoin.
-- ---------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.seller_payout_ready(uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orders_seller_ready_queue(int)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_seller_not_ready_cancel_claim(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_seller_not_ready_cancel_complete(uuid, text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_seller_not_ready_cancel_failed(uuid, text)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profiles_reprendre_commandes_vendeur()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orders_set_seller_ready_deadline()                  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.seller_payout_ready(uuid)                            TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.orders_seller_ready_queue(int)                       TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_seller_not_ready_cancel_claim(uuid)            TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_seller_not_ready_cancel_complete(uuid, text, int) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_seller_not_ready_cancel_failed(uuid, text)     TO service_role, postgres;
