-- =====================================================================
-- Modèle tarifaire : Protection acheteurs, vendeur à zéro frais
--
-- CE QUI CHANGE, ET POURQUOI C'EST UNE INVERSION
--
-- Jusqu'ici le code prélevait 8 % SUR LE VENDEUR (application_fee_amount).
-- Le modèle décidé fait l'inverse : le vendeur ne supporte plus rien, et
-- c'est l'acheteur qui paie des frais de Protection acheteurs.
--
--   L'acheteur paie   : prix article + frais de livraison + Protection
--   La Protection     : 5 % du prix de l'article + 0,70 €
--   Le vendeur reçoit : 100 % du prix + 100 % du port, sans aucune retenue
--   La plateforme     : garde la Protection, et supporte sur cette recette
--                       ses frais Stripe, Connect, remboursements et litiges
--
-- Le port est versé au vendeur parce que c'est lui qui paie et organise
-- l'expédition. Une future livraison intégrée changera cela : ce sera une
-- évolution métier distincte, pas préparée ici.
--
-- « Zéro » doit signifier zéro partout : dans le calcul, dans l'interface,
-- dans les emails et en base. application_fee_cents est donc forcé à 0, et
-- seller_amount_cents est une colonne à part entière, contrainte par le
-- schéma plutôt que recalculée à la volée.
--
-- LES TROIS INVARIANTS, GARANTIS PAR CONTRAINTE ET NON PAR CONVENTION
--   total_acheteur   = prix_article + frais_livraison + protection
--   montant_vendeur  = prix_article + frais_livraison
--   recette_brute    = protection
--
-- LIVRAISON : AUCUNE PREUVE TRANSPORTEUR N'EXISTE
-- Le numéro de suivi est saisi à la main par le vendeur. C'est une
-- information, jamais une preuve. Aucune action du vendeur ne peut donc
-- rendre un versement admissible. Voir la section 4.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Barème, versionné
-- ---------------------------------------------------------------------

INSERT INTO public.platform_settings (key, value) VALUES
  -- Version du barème. Figée sur chaque commande : une commande passée sous
  -- la version 1 doit rester lisible et vérifiable même après un changement
  -- de tarif. Sans cela, un recalcul rétroactif fausserait la comptabilité.
  ('pricing_version', 1),
  ('protection_rate_bps', 500),    -- 5,00 % du prix de l'article
  ('protection_fixed_cents', 70),  -- + 0,70 € par transaction
  -- Délai laissé au vendeur pour déclarer l'expédition, en jours ouvrés.
  ('shipping_deadline_business_days', 5),
  -- Fenêtre de signalement ouverte après la confirmation de l'acheteur.
  ('report_window_hours', 48),
  -- Sans réponse de l'acheteur passé ce délai après l'expédition déclarée,
  -- la commande part en revue manuelle. Jamais en versement automatique.
  ('buyer_silence_days', 14)
ON CONFLICT (key) DO NOTHING;

-- L'ancienne commission vendeur n'a plus cours. On garde la ligne pour
-- l'historique, mise à zéro : elle ne doit plus jamais retirer un centime.
UPDATE public.platform_settings SET value = 0 WHERE key = 'platform_fee_rate';

-- ---------------------------------------------------------------------
-- 2. Décomposition financière figée sur la commande
-- ---------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS protection_fee_cents int,
  ADD COLUMN IF NOT EXISTS seller_amount_cents int,
  ADD COLUMN IF NOT EXISTS pricing_version int;

COMMENT ON COLUMN public.orders.protection_fee_cents IS
  'Frais de Protection acheteurs, payés par l''acheteur, conservés par la plateforme. Jamais inclus dans le montant vendeur.';
COMMENT ON COLUMN public.orders.seller_amount_cents IS
  'Montant versé au vendeur : prix de l''article + frais de livraison. Aucune commission ni retenue.';
COMMENT ON COLUMN public.orders.pricing_version IS
  'Version du barème appliquée. Fige la règle de calcul au moment de la commande.';

-- Commandes antérieures : elles n'ont pas de Protection acheteurs et leur
-- montant vendeur n'a jamais été calculé. On les renseigne de façon
-- cohérente plutôt que de les laisser à NULL, sinon les contraintes
-- ci-dessous ne pourraient jamais être validées.
UPDATE public.orders
   SET protection_fee_cents = COALESCE(protection_fee_cents, 0),
       seller_amount_cents  = COALESCE(seller_amount_cents,
                                       COALESCE(product_amount_cents, 0) + COALESCE(shipping_amount_cents, 0)),
       pricing_version      = COALESCE(pricing_version, 0)
 WHERE protection_fee_cents IS NULL
    OR seller_amount_cents IS NULL
    OR pricing_version IS NULL;

-- ---------------------------------------------------------------------
-- 3. Les invariants, en contraintes
--
-- Ils ne s'appliquent qu'aux commandes dont la décomposition est connue
-- (pricing_version >= 1). Les commandes héritées, sans décomposition, ne
-- sont pas réécrites : on ne réinvente pas une histoire financière.
-- ---------------------------------------------------------------------

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_amount_decomposition_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_amount_decomposition_check CHECK (
  pricing_version IS NULL OR pricing_version < 1
  OR (
        product_amount_cents  IS NOT NULL AND product_amount_cents  >= 0
    AND shipping_amount_cents IS NOT NULL AND shipping_amount_cents >= 0
    AND protection_fee_cents  IS NOT NULL AND protection_fee_cents  >= 0
    AND amount_total_cents    IS NOT NULL
    AND amount_total_cents = product_amount_cents + shipping_amount_cents + protection_fee_cents
  )
);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_seller_amount_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_seller_amount_check CHECK (
  pricing_version IS NULL OR pricing_version < 1
  OR (
        seller_amount_cents IS NOT NULL
    AND seller_amount_cents = product_amount_cents + shipping_amount_cents
  )
);

-- Le vendeur ne peut jamais recevoir la Protection acheteurs. Écrit comme
-- contrainte parce qu'une règle métier tenue par le seul code applicatif
-- finit toujours par être contournée par un correctif pressé.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_protection_never_to_seller_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_protection_never_to_seller_check CHECK (
  pricing_version IS NULL OR pricing_version < 1
  OR seller_amount_cents = amount_total_cents - protection_fee_cents
);

-- Aucune commission vendeur, jamais. Zéro signifie zéro.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_no_seller_commission_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_no_seller_commission_check CHECK (
  pricing_version IS NULL OR pricing_version < 1
  OR COALESCE(application_fee_cents, 0) = 0
);

-- Le montant réellement transféré ne peut pas dépasser ce qui est dû.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_transfer_not_over_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_transfer_not_over_check CHECK (
  transfer_amount_cents IS NULL
  OR seller_amount_cents IS NULL
  OR transfer_amount_cents <= seller_amount_cents
);

-- ---------------------------------------------------------------------
-- 4. Calcul de la Protection acheteurs
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buyer_protection_fee_cents(p_product_cents int)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_rate  int;
  v_fixed int;
BEGIN
  -- Volontairement non paramétré par lecture de table : IMMUTABLE permet de
  -- s'en servir dans une contrainte ou un index. Les valeurs proviennent du
  -- barème et sont répétées ici ; un test vérifie qu'elles n'ont pas divergé.
  v_rate  := 500;  -- 5,00 %
  v_fixed := 70;   -- 0,70 €
  IF p_product_cents IS NULL OR p_product_cents < 0 THEN
    RETURN NULL;
  END IF;
  -- Arrondi au centime le plus proche sur la part variable, puis part fixe.
  RETURN ROUND((p_product_cents * v_rate)::numeric / 10000)::int + v_fixed;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Jours ouvrés
--
-- Samedi et dimanche exclus. Les jours fériés français ne le sont pas :
-- les intégrer demanderait une table maintenue chaque année, et l'écart
-- joue en faveur du vendeur (délai réel légèrement plus court). À revoir si
-- le délai devient contentieux.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_business_days(p_from timestamptz, p_days int)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_at  timestamptz := p_from;
  v_left int := GREATEST(0, p_days);
BEGIN
  WHILE v_left > 0 LOOP
    v_at := v_at + interval '1 day';
    IF EXTRACT(ISODOW FROM v_at) < 6 THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_at;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. Réservation : nouveau calcul
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.checkout_reserve(
  p_product_id      bigint,
  p_buyer_id        uuid,
  p_shipping_method text,
  p_relay_postal    text DEFAULT NULL,
  p_buyer_email     text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product   public.products;
  v_rate      public.shipping_rates;
  v_order     public.orders;
  v_existing  public.orders;
  v_min_cents int;
  v_minutes   int;
  v_max_pending int;
  v_pending   int;
  v_version   int;
  v_flag      boolean;
  v_product_cents    int;
  v_ship_cents       int;
  v_protection_cents int;
  v_total_cents      int;
  v_seller_cents     int;
  v_postal    text;
BEGIN
  IF p_buyer_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rate FROM public.shipping_rates WHERE method = p_shipping_method;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPPING_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF p_shipping_method = 'relay' THEN
    v_postal := NULLIF(trim(COALESCE(p_relay_postal, '')), '');
    IF v_postal IS NULL OR v_postal !~ '^[0-9]{5}$' THEN
      RAISE EXCEPTION 'RELAY_POSTAL_INVALID' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_postal := NULL;
  END IF;

  PERFORM public.checkout_expire_stale(p_product_id);

  SELECT value INTO v_min_cents   FROM public.platform_settings WHERE key = 'min_charge_cents';
  SELECT value INTO v_minutes     FROM public.platform_settings WHERE key = 'reservation_minutes';
  SELECT value INTO v_max_pending FROM public.platform_settings WHERE key = 'max_pending_per_buyer';
  SELECT value INTO v_version     FROM public.platform_settings WHERE key = 'pricing_version';
  v_min_cents   := COALESCE(v_min_cents, 50);
  v_minutes     := COALESCE(v_minutes, 40);
  v_max_pending := COALESCE(v_max_pending, 5);
  v_version     := COALESCE(v_version, 1);

  SELECT count(*) INTO v_pending
    FROM public.orders
   WHERE buyer_id = p_buyer_id AND status = 'pending'
     AND expires_at > now() AND product_id <> p_product_id;
  IF v_pending >= v_max_pending THEN
    RAISE EXCEPTION 'TOO_MANY_RESERVATIONS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_product.status <> 'published' THEN
    RAISE EXCEPTION 'PRODUCT_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF v_product.user_id = p_buyer_id THEN
    RAISE EXCEPTION 'SELF_PURCHASE' USING ERRCODE = 'P0001';
  END IF;

  v_flag := CASE p_shipping_method
              WHEN 'pickup' THEN v_product.ship_pickup
              WHEN 'relay'  THEN v_product.ship_relay
              WHEN 'post'   THEN v_product.ship_post
            END;
  IF NOT COALESCE(v_flag, false) THEN
    RAISE EXCEPTION 'SHIPPING_NOT_OFFERED' USING ERRCODE = 'P0001';
  END IF;

  -- Le calcul, en centimes entiers, à partir du prix en base et du tarif de
  -- livraison en base. Rien de tout cela ne vient du navigateur.
  v_product_cents    := ROUND(v_product.price * 100)::int;
  v_ship_cents       := v_rate.amount_cents;
  v_protection_cents := public.buyer_protection_fee_cents(v_product_cents);
  v_total_cents      := v_product_cents + v_ship_cents + v_protection_cents;
  v_seller_cents     := v_product_cents + v_ship_cents;

  IF v_total_cents < v_min_cents THEN
    RAISE EXCEPTION 'AMOUNT_TOO_LOW' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
    FROM public.orders
   WHERE product_id = p_product_id AND buyer_id = p_buyer_id
     AND status = 'pending' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_existing.shipping_method IS NOT DISTINCT FROM p_shipping_method
       AND COALESCE(v_existing.relay_postal, '') = COALESCE(v_postal, '')
       AND v_existing.amount_total_cents = v_total_cents THEN
      RETURN v_existing;
    END IF;

    UPDATE public.orders SET status = 'canceled', closed_at = now() WHERE id = v_existing.id;
    UPDATE public.products SET reserved_qty = GREATEST(0, reserved_qty - 1) WHERE id = p_product_id;
    SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  END IF;

  IF v_product.quantity - v_product.reserved_qty < 1 THEN
    RAISE EXCEPTION 'PRODUCT_RESERVED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.products SET reserved_qty = reserved_qty + 1 WHERE id = p_product_id;

  INSERT INTO public.orders (
    product_id, buyer_id, seller_id, customer_email,
    status, currency,
    product_amount_cents, shipping_amount_cents, protection_fee_cents,
    amount_total_cents, seller_amount_cents, application_fee_cents, pricing_version,
    amount, shipping_method, relay_postal, expires_at
  ) VALUES (
    p_product_id, p_buyer_id, v_product.user_id, p_buyer_email,
    'pending', 'eur',
    v_product_cents, v_ship_cents, v_protection_cents,
    v_total_cents, v_seller_cents, 0, v_version,
    v_total_cents / 100.0, p_shipping_method, v_postal,
    now() + make_interval(mins => v_minutes)
  )
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Admissibilité au versement : la déclaration du vendeur ne suffit jamais
-- ---------------------------------------------------------------------

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payout_state_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payout_state_check CHECK (
  payout_state IN ('pending', 'released', 'reversed', 'not_applicable', 'blocked', 'manual_review')
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ship_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_window_ends_at timestamptz;

COMMENT ON COLUMN public.orders.ship_deadline_at IS
  'Date limite de déclaration d''expédition par le vendeur (5 jours ouvrés après paiement).';
COMMENT ON COLUMN public.orders.report_window_ends_at IS
  'Fin de la fenêtre de signalement de 48 h ouverte par la confirmation de réception de l''ACHETEUR.';

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
  v_hold_hours int;
BEGIN
  SELECT value::int INTO v_hold_hours FROM public.platform_settings WHERE key = 'payout_min_hold_hours';
  v_hold_hours := COALESCE(v_hold_hours, 24);

  RETURN QUERY
  SELECT o.id,
         o.seller_id,
         o.stripe_charge_id,
         o.stripe_payment_intent_id,
         -- Exactement ce qui a été figé à la commande : prix + port. Pas de
         -- recalcul, pas de soustraction, aucune commission.
         o.seller_amount_cents,
         o.currency,
         p.stripe_account_id
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.seller_id
   WHERE o.payout_state = 'pending'
     AND o.status IN ('completed', 'delivered')
     AND o.paid_at IS NOT NULL
     AND o.amount_refunded_cents = 0
     AND o.chargeback_status IS NULL
     AND NOT o.needs_review
     AND o.stripe_charge_id IS NOT NULL
     AND o.seller_amount_cents IS NOT NULL AND o.seller_amount_cents > 0
     AND p.stripe_account_id IS NOT NULL
     AND p.stripe_onboarded
     -- Garde minimale après encaissement.
     AND o.paid_at < now() - make_interval(hours => v_hold_hours)
     -- SEULE VOIE D'ADMISSIBILITÉ : l'acheteur a confirmé la réception, et la
     -- fenêtre de signalement de 48 h qui s'est ouverte à ce moment est close.
     --
     -- Aucune condition portant sur shipped_at ou tracking_number n'apparaît
     -- ici, et c'est délibéré : ces champs sont renseignés par le vendeur, et
     -- lui permettre de déclencher son propre versement rendrait la Protection
     -- acheteurs illusoire.
     AND o.confirmed_at IS NOT NULL
     AND o.report_window_ends_at IS NOT NULL
     AND o.report_window_ends_at < now()
   ORDER BY o.paid_at
   LIMIT p_limit;
END;
$$;

-- Confirmation de réception : ouvre la fenêtre de signalement.
CREATE OR REPLACE FUNCTION public.order_confirm_receipt(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_uid   uuid := auth.uid();
  v_hours int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT value::int INTO v_hours FROM public.platform_settings WHERE key = 'report_window_hours';
  v_hours := COALESCE(v_hours, 48);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.buyer_id IS NULL OR v_order.buyer_id <> v_uid THEN
    RAISE EXCEPTION 'Non autorisé : vous n''êtes pas l''acheteur de cette commande';
  END IF;
  IF v_order.status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'Cette commande ne peut pas être confirmée (statut: %)', v_order.status;
  END IF;

  UPDATE public.orders
  SET status = 'completed',
      delivered_at = COALESCE(delivered_at, now()),
      confirmed_at = now(),
      -- Le versement ne deviendra admissible qu'après cette date.
      report_window_ends_at = now() + make_interval(hours => v_hours)
  WHERE id = p_order_id
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

-- Expédition déclarée : information, jamais preuve. On pose seulement la
-- date de déclaration ; aucune horloge de versement ne démarre.
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
  v_order public.orders;
  v_uid   uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.seller_id IS NULL OR v_order.seller_id <> v_uid THEN
    RAISE EXCEPTION 'Non autorisé : vous n''êtes pas le vendeur de cette commande';
  END IF;
  IF v_order.status NOT IN ('paid') THEN
    RAISE EXCEPTION 'Commande déjà expédiée ou clôturée (statut: %)', v_order.status;
  END IF;
  IF p_tracking_number IS NULL OR length(trim(p_tracking_number)) = 0 THEN
    RAISE EXCEPTION 'Numéro de suivi requis';
  END IF;

  UPDATE public.orders
  SET status = 'shipped',
      tracking_number = trim(p_tracking_number),
      tracking_carrier = NULLIF(trim(coalesce(p_tracking_carrier, '')), ''),
      shipped_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. Revue manuelle
--
-- Deux situations la déclenchent, et aucune ne peut être levée par le vendeur.
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

  -- a) L'acheteur n'a pas répondu dans les N jours suivant l'expédition
  --    déclarée. Surtout pas de versement automatique : la déclaration du
  --    vendeur n'a jamais été vérifiée par personne.
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

  -- b) Le vendeur n'a pas déclaré l'expédition dans le délai imparti. La
  --    commande demande une décision : relance, annulation ou remboursement.
  --    Aucun remboursement n'est déclenché ici — un mouvement d'argent ne se
  --    décide pas dans un travail de fond.
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
    RETURNING o.id, 'expédition en retard'::text
  )
  SELECT * FROM late;
END;
$$;

-- Le vendeur ne peut pas sortir seul d'une revue manuelle : seul le
-- service_role (donc l'administration) peut lever l'état.
CREATE OR REPLACE FUNCTION public.orders_guard_manual_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.payout_state = 'manual_review'
     AND NEW.payout_state <> 'manual_review'
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    NEW.payout_state := OLD.payout_state;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_keep_manual_review ON public.orders;
CREATE TRIGGER orders_keep_manual_review
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard_manual_review();

-- ---------------------------------------------------------------------
-- 9. Encaissement : pose la date limite d'expédition
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_set_ship_deadline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_days int;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.ship_deadline_at IS NULL THEN
    SELECT value::int INTO v_days FROM public.platform_settings WHERE key = 'shipping_deadline_business_days';
    NEW.ship_deadline_at := public.add_business_days(now(), COALESCE(v_days, 5));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_ship_deadline ON public.orders;
CREATE TRIGGER orders_ship_deadline
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_set_ship_deadline();

-- ---------------------------------------------------------------------
-- 10. Droits
-- ---------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.orders_flag_manual_review()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.buyer_protection_fee_cents(int)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.orders_flag_manual_review()            TO service_role, postgres;
-- Le calcul des frais est public en lecture : l'acheteur a le droit de
-- vérifier lui-même ce qu'on lui facture avant de payer.
GRANT  EXECUTE ON FUNCTION public.buyer_protection_fee_cents(int)        TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.checkout_reserve(bigint, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.checkout_reserve(bigint, uuid, text, text, text) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.orders_ready_for_payout(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.orders_ready_for_payout(int) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.add_business_days(timestamptz, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.add_business_days(timestamptz, int) TO anon, authenticated, service_role, postgres;

-- Le cycle de vie reste réservé aux utilisateurs connectés.
REVOKE EXECUTE ON FUNCTION public.order_mark_shipped(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.order_confirm_receipt(uuid)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.order_mark_shipped(uuid, text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.order_confirm_receipt(uuid)          TO authenticated;

-- ---------------------------------------------------------------------
-- 11. Réparation d'intégrité constatée sur la production
--
-- Un message référence un produit supprimé alors que
-- messages_product_id_fkey est marquée validée. pg_restore refuse de recréer
-- la contrainte : la base n'était pas restaurable. On remet la ligne dans
-- l'état que la clé étrangère aurait produit d'elle-même (ON DELETE SET NULL).
-- Aucun message n'est supprimé.
-- ---------------------------------------------------------------------

UPDATE public.messages m
   SET product_id = NULL
 WHERE m.product_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = m.product_id);

-- ---------------------------------------------------------------------
-- 12. Revue manuelle planifiée
-- ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('orders-manual-review');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'orders-manual-review',
  '31 * * * *',
  $$ SELECT public.orders_flag_manual_review(); $$
);

-- ---------------------------------------------------------------------
-- 13. Le montant Stripe ne réécrit plus la décomposition
--
-- Problème révélé par les contraintes ci-dessus : order_settle_payment
-- écrasait amount_total_cents avec le montant renvoyé par Stripe. Si les deux
-- divergeaient, l'écriture violait désormais la décomposition et le paiement
-- devenait impossible à enregistrer — c'est-à-dire le pire résultat possible :
-- de l'argent encaissé chez Stripe et aucune trace en base.
--
-- On sépare donc les deux notions :
--   amount_total_cents        ce que la plateforme a calculé et engagé
--   stripe_amount_total_cents ce que Stripe rapporte avoir encaissé
--
-- En temps normal ils sont égaux. S'ils divergent, on enregistre les deux et
-- la commande part en revue : un écart se constate, il ne se corrige pas tout
-- seul.
-- ---------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_amount_total_cents int;

COMMENT ON COLUMN public.orders.stripe_amount_total_cents IS
  'Montant réellement encaissé d''après Stripe. Doit égaler amount_total_cents ; tout écart déclenche une revue.';

CREATE OR REPLACE FUNCTION public.order_settle_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      public.orders;
  v_product    public.products;
  v_order_id   uuid;
  v_found_id   uuid;
  v_session    text;
  v_intent     text;
  v_total      int;
  v_new_status text;
  v_first      boolean := false;
  v_review     text := NULL;
  v_versioned  boolean;
BEGIN
  v_session := NULLIF(p_payload->>'session_id', '');
  v_intent  := NULLIF(p_payload->>'payment_intent_id', '');
  v_total   := NULLIF(p_payload->>'amount_total_cents', '')::int;

  BEGIN
    v_order_id := NULLIF(p_payload->>'order_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_order_id := NULL;
  END;

  IF v_order_id IS NOT NULL THEN
    SELECT id INTO v_found_id FROM public.orders WHERE id = v_order_id;
  END IF;
  IF v_found_id IS NULL AND v_session IS NOT NULL THEN
    SELECT id INTO v_found_id FROM public.orders WHERE stripe_session_id = v_session;
  END IF;
  IF v_found_id IS NULL AND v_intent IS NOT NULL THEN
    SELECT id INTO v_found_id FROM public.orders WHERE stripe_payment_intent_id = v_intent;
  END IF;

  IF v_found_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_found_id FOR UPDATE;
  END IF;

  -- Paiement sans commande : on la crée pour ne pas perdre la trace de
  -- l'argent. pricing_version = 0 : aucune décomposition connue, les
  -- contraintes de cohérence ne s'appliquent donc pas à cette ligne.
  IF v_found_id IS NULL THEN
    INSERT INTO public.orders (
      product_id, buyer_id, seller_id, customer_email,
      status, currency, stripe_session_id, stripe_payment_intent_id,
      amount_total_cents, stripe_amount_total_cents, amount,
      shipping_method, relay_postal, pricing_version,
      needs_review, review_reason
    ) VALUES (
      NULLIF(p_payload->>'product_id','')::bigint,
      NULLIF(p_payload->>'buyer_id','')::uuid,
      NULLIF(p_payload->>'seller_id','')::uuid,
      NULLIF(p_payload->>'customer_email',''),
      'pending',
      COALESCE(NULLIF(p_payload->>'currency',''), 'eur'),
      v_session, v_intent,
      v_total, v_total, COALESCE(v_total, 0) / 100.0,
      NULLIF(p_payload->>'shipping_method',''),
      NULLIF(p_payload->>'relay_postal',''),
      0,
      true,
      'Commande absente en base au moment du paiement : recréée depuis Stripe'
    )
    RETURNING * INTO v_order;
  END IF;

  v_versioned := COALESCE(v_order.pricing_version, 0) >= 1;

  v_new_status := CASE
    WHEN COALESCE(p_payload->>'payment_status','') IN ('paid','no_payment_required') THEN 'paid'
    ELSE 'payment_pending'
  END;

  IF v_order.status IN ('paid','shipped','delivered','completed','disputed',
                        'refunded','partially_refunded') THEN
    UPDATE public.orders
       SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, v_intent),
           stripe_charge_id         = COALESCE(stripe_charge_id, NULLIF(p_payload->>'charge_id','')),
           stripe_session_id        = COALESCE(stripe_session_id, v_session)
     WHERE id = v_order.id
    RETURNING * INTO v_order;

    RETURN jsonb_build_object('order', to_jsonb(v_order), 'first_time', false);
  END IF;

  IF v_total IS NOT NULL AND v_order.amount_total_cents IS NOT NULL
     AND v_total <> v_order.amount_total_cents THEN
    v_review := format('Montant Stripe %s c ≠ montant engagé %s c',
                       v_total, v_order.amount_total_cents);
  END IF;

  IF v_order.status = 'expired' THEN
    v_review := COALESCE(v_review || ' | ', '')
              || 'Paiement reçu après expiration de la réservation';
  END IF;

  UPDATE public.orders
     SET status                   = v_new_status,
         payment_status           = NULLIF(p_payload->>'payment_status',''),
         stripe_session_id        = COALESCE(v_session, stripe_session_id),
         stripe_payment_intent_id = COALESCE(v_intent, stripe_payment_intent_id),
         stripe_charge_id         = COALESCE(NULLIF(p_payload->>'charge_id',''), stripe_charge_id),
         customer_email           = COALESCE(NULLIF(p_payload->>'customer_email',''), customer_email),
         buyer_id                 = COALESCE(buyer_id, NULLIF(p_payload->>'buyer_id','')::uuid),
         -- Ce que Stripe dit avoir encaissé, toujours enregistré tel quel.
         stripe_amount_total_cents = COALESCE(v_total, stripe_amount_total_cents),
         -- La décomposition engagée n'est PAS réécrite quand elle existe :
         -- c'est elle qui fait foi, et la modifier casserait les invariants.
         amount_total_cents       = CASE WHEN v_versioned
                                         THEN amount_total_cents
                                         ELSE COALESCE(v_total, amount_total_cents) END,
         amount                   = CASE WHEN v_versioned
                                         THEN amount
                                         ELSE COALESCE(v_total, amount_total_cents, 0) / 100.0 END,
         currency                 = COALESCE(NULLIF(p_payload->>'currency',''), currency),
         shipping_address         = COALESCE(p_payload->'shipping_address', shipping_address),
         paid_at                  = CASE WHEN v_new_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
         needs_review             = needs_review OR (v_review IS NOT NULL),
         review_reason            = COALESCE(v_review, review_reason)
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  IF v_new_status = 'paid' THEN
    v_first := true;

    SELECT * INTO v_product FROM public.products WHERE id = v_order.product_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.products
         SET quantity     = GREATEST(0, quantity - 1),
             reserved_qty = GREATEST(0, reserved_qty - 1),
             status       = CASE WHEN GREATEST(0, quantity - 1) = 0 THEN 'sold' ELSE status END,
             sold_at      = CASE WHEN GREATEST(0, quantity - 1) = 0 THEN COALESCE(sold_at, now()) ELSE sold_at END
       WHERE id = v_order.product_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('order', to_jsonb(v_order), 'first_time', v_first);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.order_settle_payment(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.order_settle_payment(jsonb) TO service_role, postgres;
