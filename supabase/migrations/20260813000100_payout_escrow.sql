-- =====================================================================
-- Versement du vendeur : du transfert immédiat au versement après réception
--
-- POURQUOI CETTE MIGRATION EXISTE
--
-- Le code déployé en production promet ceci à l'acheteur, par email, après
-- chaque paiement :
--     « Athena conserve votre paiement en sécurité jusqu'à confirmation de
--       réception »
-- et ceci au vendeur :
--     « Le paiement sera libéré après confirmation de réception par l'acheteur »
--
-- Or le code du dépôt utilisait des paiements indirects Stripe Connect
-- (transfer_data.destination), qui transfèrent les fonds au vendeur DÈS
-- l'encaissement, avant même l'expédition. Les deux se contredisent, et c'est
-- la promesse faite à l'acheteur qui est la bonne : sur une place de marché
-- entre particuliers, remettre l'argent avant la livraison expose l'acheteur
-- au vendeur qui n'expédie jamais, et la plateforme aux litiges bancaires
-- dont elle est seule débitée.
--
-- Cette migration introduit le mode « versement à la réception », construit
-- avec le mécanisme Stripe prévu pour cela : paiements séparés et transferts
-- (separate charges and transfers). Le paiement est encaissé sur le compte de
-- la plateforme ; le transfert vers le compte connecté du vendeur est créé
-- plus tard, rattaché à la charge d'origine.
--
-- CE QUE CE N'EST PAS
-- Ce n'est pas un séquestre au sens juridique. Les fonds transitent par le
-- solde Stripe de la plateforme et lui appartiennent comptablement jusqu'au
-- transfert. Il ne faut donc jamais l'appeler « séquestre » ni « compte
-- bloqué » auprès des clients : « versement au vendeur après réception » est
-- exact, « séquestre » ne l'est pas.
--
-- LE MODE EST UN RÉGLAGE, PAS UNE RÉÉCRITURE
-- platform_settings.payout_mode vaut 'on_delivery' (recommandé, par défaut) ou
-- 'on_payment' (comportement des paiements indirects). Changer d'avis est une
-- ligne de SQL, pas un redéploiement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Réglages
-- ---------------------------------------------------------------------

INSERT INTO public.platform_settings (key, value) VALUES
  -- 1 = versement après réception, 0 = transfert immédiat à l'encaissement.
  -- Un entier plutôt qu'un texte : platform_settings.value est numeric.
  ('payout_on_delivery', 1),
  -- Sans confirmation de l'acheteur, le versement part quand même au bout de
  -- ce délai après l'expédition. Sinon un acheteur silencieux bloquerait
  -- indéfiniment le vendeur, ce qui serait injuste et ferait fuir les vendeurs.
  ('payout_auto_release_days', 14),
  -- Délai minimal après le paiement avant tout versement, même sur une
  -- commande confirmée très vite : laisse le temps de détecter une fraude.
  ('payout_min_hold_hours', 24)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Suivi du versement sur la commande
-- ---------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payout_state text NOT NULL DEFAULT 'pending'
    CHECK (payout_state IN (
      'pending',        -- encaissé, pas encore versé au vendeur
      'released',       -- transfert créé vers le compte connecté
      'reversed',       -- transfert annulé (remboursement ou litige)
      'not_applicable', -- transfert immédiat, ou commande jamais payée
      'blocked'         -- litige ou revue en cours : versement suspendu
    )),
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text,
  ADD COLUMN IF NOT EXISTS transfer_amount_cents int,
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_last_error text;

-- Un transfert Stripe ne peut correspondre qu'à une seule commande. C'est la
-- garantie qui rend un double versement impossible même si deux exécutions du
-- travail de versement se croisaient.
CREATE UNIQUE INDEX IF NOT EXISTS orders_transfer_uniq
  ON public.orders (stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_payout_queue_idx
  ON public.orders (payout_state, payout_eligible_at)
  WHERE payout_state = 'pending';

-- Les commandes antérieures ont été encaissées sans Connect : rien à verser
-- automatiquement, le versement a été ou sera fait à la main.
UPDATE public.orders
   SET payout_state = 'not_applicable'
 WHERE payout_state = 'pending'
   AND (stripe_payment_intent_id IS NULL OR created_at < now() - interval '1 day');

-- ---------------------------------------------------------------------
-- 3. Éligibilité au versement
--
-- Une commande devient versable quand TOUTES ces conditions sont réunies :
--   - elle est payée et non remboursée
--   - aucun litige bancaire n'est ouvert, aucune revue en attente
--   - le délai de garde minimal après paiement est écoulé
--   - ET l'acheteur a confirmé la réception, OU le délai de libération
--     automatique après expédition est dépassé
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_ready_for_payout(p_limit int DEFAULT 50)
RETURNS TABLE (
  order_id uuid,
  seller_id uuid,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  transfer_amount_cents int,
  currency text,
  seller_account_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto_days int;
  v_hold_hours int;
BEGIN
  SELECT value::int INTO v_auto_days  FROM public.platform_settings WHERE key = 'payout_auto_release_days';
  SELECT value::int INTO v_hold_hours FROM public.platform_settings WHERE key = 'payout_min_hold_hours';
  v_auto_days  := COALESCE(v_auto_days, 14);
  v_hold_hours := COALESCE(v_hold_hours, 24);

  RETURN QUERY
  SELECT o.id,
         o.seller_id,
         o.stripe_charge_id,
         o.stripe_payment_intent_id,
         -- Le vendeur reçoit le total encaissé moins la commission de la
         -- plateforme. Le port lui revient : c'est lui qui l'avance.
         GREATEST(0, COALESCE(o.amount_total_cents, 0) - COALESCE(o.application_fee_cents, 0))::int,
         o.currency,
         p.stripe_account_id
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.seller_id
   WHERE o.payout_state = 'pending'
     AND o.status IN ('completed', 'delivered', 'shipped')
     AND o.paid_at IS NOT NULL
     AND o.amount_refunded_cents = 0
     AND o.chargeback_status IS NULL
     AND NOT o.needs_review
     AND o.stripe_charge_id IS NOT NULL
     AND p.stripe_account_id IS NOT NULL
     AND p.stripe_onboarded
     AND o.paid_at < now() - make_interval(hours => v_hold_hours)
     AND (
           o.confirmed_at IS NOT NULL
           OR (o.shipped_at IS NOT NULL AND o.shipped_at < now() - make_interval(days => v_auto_days))
         )
   ORDER BY o.paid_at
   LIMIT p_limit;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Enregistrement du versement
--
-- Idempotent : appelée deux fois avec le même transfert, elle ne compte
-- qu'une fois. Et elle refuse d'enregistrer un second transfert sur une
-- commande déjà versée, ce qui est la protection la plus importante de tout
-- ce fichier : un double versement est une perte sèche pour la plateforme.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_mark_payout_released(
  p_order_id    uuid,
  p_transfer_id text,
  p_amount_cents int
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
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_order.payout_state = 'released' THEN
    RETURN jsonb_build_object(
      'found', true, 'changed', false,
      'already_transfer_id', v_order.stripe_transfer_id,
      'order', to_jsonb(v_order));
  END IF;

  IF v_order.payout_state <> 'pending' THEN
    RAISE EXCEPTION 'PAYOUT_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
     SET payout_state          = 'released',
         stripe_transfer_id    = p_transfer_id,
         transfer_amount_cents = p_amount_cents,
         transferred_at        = now(),
         payout_last_error     = NULL
   WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('found', true, 'changed', true, 'order', to_jsonb(v_order));
END;
$$;

CREATE OR REPLACE FUNCTION public.order_mark_payout_failed(
  p_order_id uuid,
  p_error    text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.orders
     SET payout_last_error = left(p_error, 1000)
   WHERE id = p_order_id AND payout_state = 'pending';
$$;

-- Suspend le versement d'une commande : litige, remboursement, revue.
CREATE OR REPLACE FUNCTION public.order_block_payout(p_order_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_state text;
BEGIN
  SELECT payout_state INTO v_state FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_state <> 'pending' THEN
    RETURN false;
  END IF;
  UPDATE public.orders
     SET payout_state = 'blocked', payout_last_error = left(p_reason, 1000)
   WHERE id = p_order_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.order_mark_payout_reversed(
  p_order_id uuid,
  p_reason   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
     SET payout_state = 'reversed', payout_last_error = left(p_reason, 1000)
   WHERE id = p_order_id AND payout_state IN ('released', 'blocked', 'pending');
  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Un remboursement ou un litige suspend immédiatement le versement
--
-- Sans cela, une commande confirmée puis contestée pourrait être versée au
-- vendeur entre la contestation et son traitement.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_guard_payout()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payout_state = 'pending'
     AND (NEW.chargeback_status IS NOT NULL
          OR NEW.amount_refunded_cents > 0
          OR NEW.status IN ('disputed', 'refunded', 'partially_refunded')) THEN
    NEW.payout_state := 'blocked';
    NEW.payout_last_error := COALESCE(NEW.payout_last_error,
      'Versement suspendu : litige ou remboursement en cours');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_block_payout_on_trouble ON public.orders;
CREATE TRIGGER orders_block_payout_on_trouble
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard_payout();

-- ---------------------------------------------------------------------
-- 6. Droits
-- ---------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.orders_ready_for_payout(int)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_mark_payout_released(uuid, text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_mark_payout_failed(uuid, text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_block_payout(uuid, text)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_mark_payout_reversed(uuid, text)    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.orders_ready_for_payout(int)               TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_mark_payout_released(uuid, text, int) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_mark_payout_failed(uuid, text)       TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_block_payout(uuid, text)             TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_mark_payout_reversed(uuid, text)     TO service_role, postgres;

-- ---------------------------------------------------------------------
-- 7. Le vendeur voit où en est son versement
-- ---------------------------------------------------------------------

COMMENT ON COLUMN public.orders.payout_state IS
  'pending : encaissé, versement au vendeur pas encore effectué. released : transfert Stripe créé. blocked : suspendu (litige/remboursement). reversed : transfert annulé. not_applicable : hors du mécanisme de versement différé.';

-- ---------------------------------------------------------------------
-- 8. Travail de versement planifié
--
-- Toutes les heures : une commande devenue versable part chez le vendeur au
-- plus tard dans l'heure. Un rythme plus serré n'apporterait rien (l'éligibilité
-- se joue en heures et en jours), un rythme plus lâche ferait attendre le vendeur.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('payout-release');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'payout-release',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/payout-release',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- 9. Surveillance et réconciliation planifiées
--
-- Toutes les six heures : assez fréquent pour qu'une divergence ne dorme pas
-- une journée entière, assez espacé pour ne pas noyer la boîte de réception.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('payments-monitor');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'payments-monitor',
  '23 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/payments-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
