-- =====================================================================
-- Durcissement du parcours de paiement Stripe
--
-- Ce que cette migration répare, dans l'ordre de gravité :
--
--   1. products.quantity portait CHECK (quantity >= 1). Le webhook écrivait
--      quantity = 0 après une vente : l'UPDATE échouait, l'erreur n'était
--      jamais lue, et l'article restait « published » donc encore achetable.
--      Un même objet unique pouvait donc être vendu plusieurs fois.
--
--   2. Rien ne réservait le stock entre l'ouverture de Stripe Checkout et le
--      paiement. Deux acheteurs pouvaient payer le même objet unique en même
--      temps. On introduit une réservation atomique (reserved_qty) avec une
--      durée de vie, libérée à l'expiration ou à l'annulation.
--
--   3. La déduplication des webhooks reposait sur un SELECT suivi d'un INSERT,
--      donc inopérante sous concurrence. On ajoute stripe_events, avec un bail
--      qui laisse un événement planté redevenir traitable.
--
--   4. Une commande n'était liée à aucun PaymentIntent ni Charge : impossible
--      de rapprocher un remboursement ou un litige. On ajoute la traçabilité.
--
--   5. La commande n'existait qu'après le paiement. Elle naît maintenant avant
--      la session Checkout, ce qui donne un identifiant stable à corréler.
--
-- Toutes les écritures financières passent par des fonctions SECURITY DEFINER
-- qui s'exécutent dans une transaction : aucune mise à jour partielle possible.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PRODUITS : stock à zéro autorisé + compteur de réservations
-- ---------------------------------------------------------------------

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_quantity_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_quantity_check CHECK (quantity >= 0);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS reserved_qty int NOT NULL DEFAULT 0
    CHECK (reserved_qty >= 0);

-- Le vendeur peut modifier son annonce (prix, quantité, statut). Il ne doit
-- pas pouvoir remettre reserved_qty à zéro pendant qu'un acheteur est sur
-- Stripe : cela libérerait un stock déjà promis et permettrait la double vente.
-- On teste current_user et non auth.role() : les fonctions SECURITY DEFINER
-- et la tâche cron n'ont pas de JWT, et auth.role() y vaut NULL. C'est
-- exactement le piège qui avait rendu Stripe Connect inopérant en avril
-- (voir 20260426000001_profiles_trigger_fix.sql) : le garde-fou bloquait le
-- backend lui-même.
CREATE OR REPLACE FUNCTION public.products_protect_reserved_qty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    NEW.reserved_qty := OLD.reserved_qty;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_guard_reserved_qty ON public.products;
CREATE TRIGGER products_guard_reserved_qty
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_protect_reserved_qty();

-- ---------------------------------------------------------------------
-- 2. COMMANDES : cycle de vie complet et traçabilité Stripe
-- ---------------------------------------------------------------------

-- La commande naît maintenant avant la session Checkout : l'identifiant de
-- session n'existe pas encore au moment de l'insertion.
ALTER TABLE public.orders ALTER COLUMN stripe_session_id DROP NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS product_amount_cents int,
  ADD COLUMN IF NOT EXISTS shipping_amount_cents int,
  ADD COLUMN IF NOT EXISTS amount_total_cents int,
  ADD COLUMN IF NOT EXISTS application_fee_cents int,
  ADD COLUMN IF NOT EXISTS amount_refunded_cents int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relay_postal text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS chargeback_status text,
  ADD COLUMN IF NOT EXISTS chargeback_reason text,
  ADD COLUMN IF NOT EXISTS chargeback_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- La base de production porte trois colonnes que cet historique de migrations
-- n'a jamais créées : product_price, buyer_protection_fee et shipping_fee.
-- Elles ont été ajoutées à la main, et le webhook déployé les remplit.
--
-- Elles ne gênent pas, mais si l'une d'elles est NOT NULL sans valeur par
-- défaut, la nouvelle réservation échouerait à chaque insertion : elle ne les
-- renseigne pas. On les rend explicitement facultatives, sans y toucher
-- autrement, pour que l'ancien code comme le nouveau puissent écrire.
--
-- Le bloc ne fait rien là où ces colonnes n'existent pas.
DO $$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['product_price', 'buyer_protection_fee', 'shipping_fee'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = v_col
    ) THEN
      EXECUTE format('ALTER TABLE public.orders ALTER COLUMN %I DROP NOT NULL', v_col);
      EXECUTE format('ALTER TABLE public.orders ALTER COLUMN %I SET DEFAULT 0', v_col);
      RAISE NOTICE 'Colonne héritée orders.% rendue facultative', v_col;
    END IF;
  END LOOP;
END $$;

-- Un PaymentIntent ne peut financer qu'une seule commande. C'est la garantie
-- la plus forte contre l'enregistrement en double d'un même paiement : elle
-- tient même si deux webhooks concurrents passent tous les deux les gardes
-- applicatives.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_intent_uniq
  ON public.orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_charge_idx  ON public.orders (stripe_charge_id);
CREATE INDEX IF NOT EXISTS orders_status_idx  ON public.orders (status);
CREATE INDEX IF NOT EXISTS orders_pending_idx ON public.orders (expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS orders_review_idx  ON public.orders (needs_review)
  WHERE needs_review;

-- Statuts : on distingue désormais ce qui est réservé, ce qui est en attente
-- d'encaissement et ce qui est réellement payé. « paid » ne doit jamais être
-- posé sur la foi du navigateur.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending',          -- stock réservé, session Checkout ouverte, rien d'encaissé
    'payment_pending',  -- Checkout complété mais paiement encore non confirmé
    'payment_failed',   -- paiement refusé ou abandonné définitivement
    'expired',          -- réservation expirée sans paiement
    'canceled',         -- annulée avant paiement
    'paid',
    'shipped',
    'delivered',
    'completed',
    'disputed',         -- litige ouvert par l'acheteur sur le site
    'refunded',
    'partially_refunded'
  ));

CREATE OR REPLACE FUNCTION public.orders_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_touch_updated_at();

-- Les commandes déjà en base ont été payées : on les remet en cohérence.
UPDATE public.orders
   SET paid_at = COALESCE(paid_at, created_at),
       amount_total_cents = COALESCE(amount_total_cents, ROUND(amount * 100)::int),
       payment_status = COALESCE(payment_status, 'paid')
 WHERE status IN ('paid','shipped','delivered','completed','disputed');

-- ---------------------------------------------------------------------
-- 3. TARIFS DE LIVRAISON : une seule source de vérité, côté serveur
--
-- Ces montants étaient dupliqués dans product.js et dans l'edge function.
-- Deux copies d'un prix finissent toujours par diverger. Le montant facturé
-- est désormais lu ici, et nulle part ailleurs.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.shipping_rates (
  method        text PRIMARY KEY CHECK (method IN ('pickup','relay','post')),
  amount_cents  int  NOT NULL CHECK (amount_cents >= 0),
  label_fr      text NOT NULL,
  min_days      int  NOT NULL CHECK (min_days >= 0),
  max_days      int  NOT NULL CHECK (max_days >= 0),
  product_flag  text NOT NULL
);

INSERT INTO public.shipping_rates (method, amount_cents, label_fr, min_days, max_days, product_flag) VALUES
  -- 0/0 sur la remise en main propre : pas de délai à annoncer, il se convient
  -- entre acheteur et vendeur.
  ('pickup',   0, 'Remise en main propre',           0,  0, 'ship_pickup'),
  ('relay',  490, 'Point relais (Mondial Relay)',    3,  5, 'ship_relay'),
  ('post',   890, 'Envoi postal (Colissimo suivi)',  2,  3, 'ship_post')
ON CONFLICT (method) DO UPDATE SET
  amount_cents = EXCLUDED.amount_cents,
  label_fr     = EXCLUDED.label_fr,
  min_days     = EXCLUDED.min_days,
  max_days     = EXCLUDED.max_days,
  product_flag = EXCLUDED.product_flag;

ALTER TABLE public.shipping_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shipping rates are public" ON public.shipping_rates;
CREATE POLICY "Shipping rates are public"
  ON public.shipping_rates FOR SELECT TO anon, authenticated USING (true);

-- Commission plateforme, prélevée sur le prix de l'article uniquement.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key   text PRIMARY KEY,
  value numeric NOT NULL
);
INSERT INTO public.platform_settings (key, value) VALUES
  ('platform_fee_rate', 0.08),
  ('min_charge_cents',  50),          -- plancher Stripe pour l'euro
  ('reservation_minutes', 40),        -- doit dépasser l'expiration de la session Stripe (30 min mini chez Stripe, + marge)
  ('max_pending_per_buyer', 5)        -- garde-fou contre la réservation en masse
ON CONFLICT (key) DO NOTHING;
UPDATE public.platform_settings SET value = 40 WHERE key = 'reservation_minutes' AND value < 40;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul le service_role (edge functions) y accède.

-- ---------------------------------------------------------------------
-- 4. JOURNAL DES ÉVÉNEMENTS STRIPE : déduplication avec bail
--
-- Stripe redélivre le même événement en cas de timeout, et ne garantit aucun
-- ordre de livraison. On enregistre chaque event.id avant traitement. Le bail
-- (locked_at) évite qu'un événement interrompu par un crash reste bloqué en
-- « processing » pour toujours : passé le délai, une nouvelle tentative
-- Stripe pourra le reprendre.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id            text PRIMARY KEY,
  type          text NOT NULL,
  livemode      boolean,
  api_version   text,
  status        text NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing','done','failed','ignored')),
  attempts      int  NOT NULL DEFAULT 1,
  locked_at     timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_events_status_idx ON public.stripe_events (status, created_at DESC);
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
-- Aucune policy : réservé au service_role.

-- Renvoie 'claimed' (à traiter), 'settled' (déjà traité, ignorer) ou 'busy'
-- (une autre exécution le tient encore).
--
-- Les trois cas doivent être distingués. Une version binaire répondait 200 à
-- Stripe dans le cas « busy », c'est-à-dire acquittait un événement encore non
-- traité : si la première exécution avait été tuée en cours de route, la
-- deuxième livraison était perdue et Stripe cessait de réessayer.
-- CREATE OR REPLACE refuse de changer le type de retour d'une fonction
-- existante. Si une version antérieure traîne, on la retire d'abord, sinon la
-- migration s'arrête ici.
DROP FUNCTION IF EXISTS public.stripe_event_claim(text, text, boolean, text, int);

CREATE OR REPLACE FUNCTION public.stripe_event_claim(
  p_id            text,
  p_type          text,
  p_livemode      boolean DEFAULT NULL,
  p_api_version   text    DEFAULT NULL,
  p_lease_seconds int     DEFAULT 180
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean;
  v_status  text;
BEGIN
  INSERT INTO public.stripe_events AS se (id, type, livemode, api_version)
  VALUES (p_id, p_type, p_livemode, p_api_version)
  ON CONFLICT (id) DO UPDATE
    SET attempts  = se.attempts + 1,
        locked_at = now(),
        status    = 'processing'
    WHERE se.status NOT IN ('done', 'ignored')
      AND se.locked_at < now() - make_interval(secs => p_lease_seconds)
  RETURNING true INTO v_claimed;

  IF COALESCE(v_claimed, false) THEN
    RETURN 'claimed';
  END IF;

  SELECT status INTO v_status FROM public.stripe_events WHERE id = p_id;
  IF v_status IN ('done', 'ignored') THEN
    RETURN 'settled';
  END IF;

  -- Encore sous bail : ni traité, ni acquittable. Stripe doit repasser.
  RETURN 'busy';
END;
$$;

CREATE OR REPLACE FUNCTION public.stripe_event_finish(
  p_id     text,
  p_status text,
  p_error  text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stripe_events
     SET status       = p_status,
         processed_at = now(),
         last_error   = left(p_error, 2000)
   WHERE id = p_id;
$$;

-- ---------------------------------------------------------------------
-- 5. RÉSERVATION DE STOCK
-- ---------------------------------------------------------------------

-- Libère les réservations arrivées à échéance. Appelée par le cron toutes les
-- cinq minutes, et systématiquement au début de chaque nouvelle réservation :
-- même si le cron tombe, une réservation morte ne bloque jamais durablement.
CREATE OR REPLACE FUNCTION public.checkout_expire_stale(p_product_id bigint DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH expired AS (
    UPDATE public.orders o
       SET status = 'expired', closed_at = now()
     WHERE o.status = 'pending'
       AND o.expires_at IS NOT NULL
       AND o.expires_at < now()
       AND (p_product_id IS NULL OR o.product_id = p_product_id)
    RETURNING o.product_id
  ), grouped AS (
    SELECT product_id, count(*)::int AS n FROM expired GROUP BY product_id
  ), released AS (
    UPDATE public.products p
       SET reserved_qty = GREATEST(0, p.reserved_qty - g.n)
      FROM grouped g
     WHERE p.id = g.product_id
    RETURNING g.n
  )
  SELECT COALESCE(SUM(n), 0)::int INTO v_count FROM released;

  RETURN v_count;
END;
$$;

-- Réserve une unité et crée la commande « pending ». Tout est calculé ici :
-- le prix vient de la table products, les frais de port de shipping_rates, la
-- commission de platform_settings. Le navigateur n'envoie qu'un identifiant
-- d'article et un mode de livraison, jamais un montant.
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
  v_fee_rate  numeric;
  v_min_cents int;
  v_minutes   int;
  v_max_pending int;
  v_pending   int;
  v_flag      boolean;
  v_product_cents int;
  v_ship_cents    int;
  v_total_cents   int;
  v_fee_cents     int;
  v_postal    text;
BEGIN
  IF p_buyer_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rate FROM public.shipping_rates WHERE method = p_shipping_method;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPPING_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- Code postal du point relais : cinq chiffres, rien d'autre.
  IF p_shipping_method = 'relay' THEN
    v_postal := NULLIF(trim(COALESCE(p_relay_postal, '')), '');
    IF v_postal IS NULL OR v_postal !~ '^[0-9]{5}$' THEN
      RAISE EXCEPTION 'RELAY_POSTAL_INVALID' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_postal := NULL;
  END IF;

  PERFORM public.checkout_expire_stale(p_product_id);

  SELECT value INTO v_fee_rate  FROM public.platform_settings WHERE key = 'platform_fee_rate';
  SELECT value INTO v_min_cents FROM public.platform_settings WHERE key = 'min_charge_cents';
  SELECT value INTO v_minutes   FROM public.platform_settings WHERE key = 'reservation_minutes';
  SELECT value INTO v_max_pending FROM public.platform_settings WHERE key = 'max_pending_per_buyer';
  v_fee_rate    := COALESCE(v_fee_rate, 0.08);
  v_min_cents   := COALESCE(v_min_cents, 50);
  v_minutes     := COALESCE(v_minutes, 40);
  v_max_pending := COALESCE(v_max_pending, 5);

  -- Réserver, c'est retirer du stock à tout le monde. Sans plafond, un seul
  -- compte pourrait geler le catalogue entier en boucle.
  SELECT count(*) INTO v_pending
    FROM public.orders
   WHERE buyer_id = p_buyer_id
     AND status = 'pending'
     AND expires_at > now()
     AND product_id <> p_product_id;
  IF v_pending >= v_max_pending THEN
    RAISE EXCEPTION 'TOO_MANY_RESERVATIONS' USING ERRCODE = 'P0001';
  END IF;

  -- Verrou sur la ligne produit : deux acheteurs simultanés sur le dernier
  -- exemplaire sont sérialisés ici, le second verra le stock déjà pris.
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

  -- Le vendeur doit avoir activé ce mode de livraison sur son annonce.
  v_flag := CASE p_shipping_method
              WHEN 'pickup' THEN v_product.ship_pickup
              WHEN 'relay'  THEN v_product.ship_relay
              WHEN 'post'   THEN v_product.ship_post
            END;
  IF NOT COALESCE(v_flag, false) THEN
    RAISE EXCEPTION 'SHIPPING_NOT_OFFERED' USING ERRCODE = 'P0001';
  END IF;

  v_product_cents := ROUND(v_product.price * 100)::int;
  v_ship_cents    := v_rate.amount_cents;
  v_total_cents   := v_product_cents + v_ship_cents;

  IF v_total_cents < v_min_cents THEN
    RAISE EXCEPTION 'AMOUNT_TOO_LOW' USING ERRCODE = 'P0001';
  END IF;

  -- La commission ne porte que sur le prix de l'article, jamais sur le port,
  -- et ne peut pas dépasser le montant encaissé.
  v_fee_cents := LEAST(ROUND(v_product_cents * v_fee_rate)::int, v_total_cents);

  -- Une seule réservation vivante par couple (acheteur, article). Si l'acheteur
  -- revient avec les mêmes paramètres, on lui rend la même commande : le
  -- rafraîchissement, le retour arrière et le double-clic ne créent donc pas de
  -- seconde réservation ni de seconde session Stripe.
  SELECT * INTO v_existing
    FROM public.orders
   WHERE product_id = p_product_id
     AND buyer_id   = p_buyer_id
     AND status     = 'pending'
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    IF v_existing.shipping_method IS NOT DISTINCT FROM p_shipping_method
       AND COALESCE(v_existing.relay_postal, '') = COALESCE(v_postal, '')
       AND v_existing.amount_total_cents = v_total_cents THEN
      RETURN v_existing;
    END IF;

    -- Paramètres différents : on libère l'ancienne réservation avant d'en
    -- reprendre une, sinon le même acheteur consommerait deux fois le stock.
    UPDATE public.orders SET status = 'canceled', closed_at = now()
     WHERE id = v_existing.id;
    UPDATE public.products SET reserved_qty = GREATEST(0, reserved_qty - 1)
     WHERE id = p_product_id;
    SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  END IF;

  IF v_product.quantity - v_product.reserved_qty < 1 THEN
    RAISE EXCEPTION 'PRODUCT_RESERVED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.products
     SET reserved_qty = reserved_qty + 1
   WHERE id = p_product_id;

  INSERT INTO public.orders (
    product_id, buyer_id, seller_id, customer_email,
    status, currency,
    product_amount_cents, shipping_amount_cents, amount_total_cents,
    application_fee_cents, amount,
    shipping_method, relay_postal, expires_at
  ) VALUES (
    p_product_id, p_buyer_id, v_product.user_id, p_buyer_email,
    'pending', 'eur',
    v_product_cents, v_ship_cents, v_total_cents,
    v_fee_cents, v_total_cents / 100.0,
    p_shipping_method, v_postal, now() + make_interval(mins => v_minutes)
  )
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- Enregistre l'identifiant de session Stripe sur la commande réservée.
CREATE OR REPLACE FUNCTION public.checkout_attach_session(
  p_order_id   uuid,
  p_session_id text
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  UPDATE public.orders
     SET stripe_session_id = p_session_id
   WHERE id = p_order_id
     AND status = 'pending'
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_RESERVABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_order;
END;
$$;

-- Libère une réservation (session expirée, abandon, échec de création Stripe).
-- Ne touche jamais une commande déjà payée : si le paiement est passé entre
-- temps, l'annulation est simplement ignorée.
CREATE OR REPLACE FUNCTION public.checkout_release(
  p_order_id uuid,
  p_status   text DEFAULT 'canceled'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id bigint;
BEGIN
  IF p_status NOT IN ('canceled','expired','payment_failed') THEN
    RAISE EXCEPTION 'INVALID_RELEASE_STATUS' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
     SET status = p_status, closed_at = now()
   WHERE id = p_order_id
     AND status = 'pending'
  RETURNING product_id INTO v_product_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.products
     SET reserved_qty = GREATEST(0, reserved_qty - 1)
   WHERE id = v_product_id;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. ENCAISSEMENT
--
-- Point d'entrée unique du webhook et de la page de confirmation. Idempotent :
-- appelé dix fois pour le même paiement, il ne consomme le stock et ne signale
-- « premier passage » qu'une seule fois. Renvoie { order, first_time }.
-- ---------------------------------------------------------------------

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
BEGIN
  v_session := NULLIF(p_payload->>'session_id', '');
  v_intent  := NULLIF(p_payload->>'payment_intent_id', '');
  v_total   := NULLIF(p_payload->>'amount_total_cents', '')::int;

  BEGIN
    v_order_id := NULLIF(p_payload->>'order_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_order_id := NULL;
  END;

  -- Retrouver la commande : par identifiant (client_reference_id), sinon par
  -- session, sinon par PaymentIntent. Trois chemins parce qu'un seul suffit
  -- rarement quand une écriture a échoué en cours de route.
  --
  -- On repère d'abord l'identifiant dans une variable scalaire, puis on charge
  -- la ligne une seule fois avec FOR UPDATE. Enchaîner trois SELECT INTO sur
  -- une variable composite obligerait à tester v_order.id sur un enregistrement
  -- jamais affecté, ce dont le comportement se discute selon les versions.
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
    -- Le verrou est pris ici, et il tient jusqu'à la fin de la transaction :
    -- deux webhooks concurrents sur la même commande sont sérialisés.
    SELECT * INTO v_order FROM public.orders WHERE id = v_found_id FOR UPDATE;
  END IF;

  -- Aucune commande : le paiement existe pourtant chez Stripe. On la crée
  -- plutôt que de perdre la trace de l'argent, et on la marque à vérifier.
  IF v_found_id IS NULL THEN
    -- Le PaymentIntent est posé dès l'insertion : c'est lui qui porte l'index
    -- unique. Deux webhooks concurrents ne trouvant aucune commande tenteraient
    -- sinon deux insertions, et créeraient deux commandes pour un seul paiement.
    -- Ici, la seconde échoue sur la contrainte, la transaction est annulée,
    -- Stripe rejoue, et la commande existante est retrouvée.
    INSERT INTO public.orders (
      product_id, buyer_id, seller_id, customer_email,
      status, currency, stripe_session_id, stripe_payment_intent_id,
      amount_total_cents, amount, shipping_method, relay_postal,
      needs_review, review_reason
    ) VALUES (
      NULLIF(p_payload->>'product_id','')::bigint,
      NULLIF(p_payload->>'buyer_id','')::uuid,
      NULLIF(p_payload->>'seller_id','')::uuid,
      NULLIF(p_payload->>'customer_email',''),
      'pending',
      COALESCE(NULLIF(p_payload->>'currency',''), 'eur'),
      v_session,
      v_intent,
      v_total,
      COALESCE(v_total, 0) / 100.0,
      NULLIF(p_payload->>'shipping_method',''),
      NULLIF(p_payload->>'relay_postal',''),
      true,
      'Commande absente en base au moment du paiement : recréée depuis Stripe'
    )
    RETURNING * INTO v_order;
  END IF;

  v_new_status := CASE
    WHEN COALESCE(p_payload->>'payment_status','') IN ('paid','no_payment_required') THEN 'paid'
    ELSE 'payment_pending'
  END;

  -- Déjà encaissée, ou déjà plus loin dans le cycle : on ne refait rien. C'est
  -- ce test qui rend le webhook rejouable sans risque.
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

  -- Le montant encaissé doit correspondre à ce qui a été réservé. Un écart
  -- signale une manipulation ou un bug : on encaisse quand même (l'argent est
  -- chez Stripe) mais la commande part en revue manuelle.
  IF v_total IS NOT NULL AND v_order.amount_total_cents IS NOT NULL
     AND v_total <> v_order.amount_total_cents THEN
    v_review := format('Montant Stripe %s c ≠ montant réservé %s c',
                       v_total, v_order.amount_total_cents);
  END IF;

  -- Réservation expirée avant l'arrivée du paiement : l'argent prime, mais le
  -- stock a pu être promis à quelqu'un d'autre entre temps.
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
         amount_total_cents       = COALESCE(v_total, amount_total_cents),
         amount                   = COALESCE(v_total, amount_total_cents, 0) / 100.0,
         currency                 = COALESCE(NULLIF(p_payload->>'currency',''), currency),
         shipping_address         = COALESCE(p_payload->'shipping_address', shipping_address),
         paid_at                  = CASE WHEN v_new_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
         needs_review             = needs_review OR (v_review IS NOT NULL),
         review_reason            = COALESCE(v_review, review_reason)
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  -- Le stock n'est consommé qu'à l'encaissement réel, et une seule fois.
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

-- Paiement asynchrone refusé, ou PaymentIntent définitivement échoué.
CREATE OR REPLACE FUNCTION public.order_mark_payment_failed(
  p_session_id text,
  p_intent_id  text,
  p_code       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders
   WHERE (p_session_id IS NOT NULL AND stripe_session_id = p_session_id)
      OR (p_intent_id  IS NOT NULL AND stripe_payment_intent_id = p_intent_id)
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Une commande déjà payée ne redevient jamais « échouée » : un événement
  -- retardé ou hors séquence ne doit pas détruire un état plus avancé.
  IF v_order.status NOT IN ('pending','payment_pending') THEN
    RETURN jsonb_build_object('found', true, 'changed', false, 'order', to_jsonb(v_order));
  END IF;

  IF v_order.status = 'pending' THEN
    PERFORM public.checkout_release(v_order.id, 'payment_failed');
  ELSE
    UPDATE public.orders SET status = 'payment_failed', closed_at = now()
     WHERE id = v_order.id;
    UPDATE public.products SET reserved_qty = GREATEST(0, reserved_qty - 1)
     WHERE id = v_order.product_id;
  END IF;

  UPDATE public.orders SET failure_code = p_code WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('found', true, 'changed', true, 'order', to_jsonb(v_order));
END;
$$;

-- Remboursement, total ou partiel, y compris déclenché depuis le Dashboard.
CREATE OR REPLACE FUNCTION public.order_apply_refund(
  p_intent_id       text,
  p_charge_id       text,
  p_refunded_cents  int,
  p_fully_refunded  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  public.orders;
  v_status text;
BEGIN
  SELECT * INTO v_order FROM public.orders
   WHERE (p_intent_id IS NOT NULL AND stripe_payment_intent_id = p_intent_id)
      OR (p_charge_id IS NOT NULL AND stripe_charge_id = p_charge_id)
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_status := CASE WHEN p_fully_refunded THEN 'refunded' ELSE 'partially_refunded' END;

  -- Rejouable : si le montant remboursé et le statut sont déjà à jour, rien
  -- ne bouge et aucun email supplémentaire ne part.
  IF v_order.amount_refunded_cents = COALESCE(p_refunded_cents, 0)
     AND v_order.status = v_status THEN
    RETURN jsonb_build_object('found', true, 'changed', false, 'order', to_jsonb(v_order));
  END IF;

  UPDATE public.orders
     SET amount_refunded_cents = COALESCE(p_refunded_cents, amount_refunded_cents),
         status                = v_status,
         refunded_at           = COALESCE(refunded_at, now()),
         stripe_charge_id      = COALESCE(stripe_charge_id, p_charge_id)
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  -- Remboursement intégral : l'article repart en vente s'il n'a pas été
  -- réattribué entre temps.
  IF p_fully_refunded THEN
    UPDATE public.products
       SET quantity = quantity + 1,
           status   = CASE WHEN status = 'sold' THEN 'published' ELSE status END,
           sold_at  = CASE WHEN status = 'sold' THEN NULL ELSE sold_at END
     WHERE id = v_order.product_id;
  END IF;

  RETURN jsonb_build_object('found', true, 'changed', true, 'order', to_jsonb(v_order));
END;
$$;

-- Litige bancaire signalé par Stripe. On n'écrase pas le statut métier (qui
-- peut être « shipped » ou « completed ») : le litige vit dans ses propres
-- colonnes, et la commande part en revue.
CREATE OR REPLACE FUNCTION public.order_mark_chargeback(
  p_intent_id text,
  p_charge_id text,
  p_status    text,
  p_reason    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders
   WHERE (p_intent_id IS NOT NULL AND stripe_payment_intent_id = p_intent_id)
      OR (p_charge_id IS NOT NULL AND stripe_charge_id = p_charge_id)
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_order.chargeback_status IS NOT DISTINCT FROM p_status THEN
    RETURN jsonb_build_object('found', true, 'changed', false, 'order', to_jsonb(v_order));
  END IF;

  UPDATE public.orders
     SET chargeback_status = p_status,
         chargeback_reason = COALESCE(p_reason, chargeback_reason),
         chargeback_at     = COALESCE(chargeback_at, now()),
         needs_review      = p_status NOT IN ('won','warning_closed'),
         review_reason     = CASE
                               WHEN p_status NOT IN ('won','warning_closed')
                               THEN format('Litige bancaire Stripe : %s', p_status)
                               ELSE review_reason
                             END
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('found', true, 'changed', true, 'order', to_jsonb(v_order));
END;
$$;

-- ---------------------------------------------------------------------
-- 7. RÉCONCILIATION
--
-- Liste ce qui ne colle pas, pour l'écran d'administration et pour l'alerte.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_needing_attention()
RETURNS TABLE (
  id uuid, status text, amount_total_cents int, created_at timestamptz,
  stripe_payment_intent_id text, reason text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.status, o.amount_total_cents, o.created_at,
         o.stripe_payment_intent_id,
         COALESCE(o.review_reason,
           CASE
             WHEN o.chargeback_status IS NOT NULL THEN 'Litige bancaire : ' || o.chargeback_status
             WHEN o.status = 'payment_pending' AND o.created_at < now() - interval '3 days'
               THEN 'Paiement jamais confirmé depuis plus de 3 jours'
             WHEN o.status = 'paid' AND o.stripe_payment_intent_id IS NULL
               THEN 'Commande payée sans PaymentIntent associé'
             ELSE 'À vérifier'
           END) AS reason
    FROM public.orders o
   WHERE o.needs_review
      OR o.chargeback_status IS NOT NULL
      OR (o.status = 'payment_pending' AND o.created_at < now() - interval '3 days')
      OR (o.status = 'paid' AND o.stripe_payment_intent_id IS NULL)
   ORDER BY o.created_at DESC;
$$;

-- ---------------------------------------------------------------------
-- 8. DROITS
-- ---------------------------------------------------------------------

-- Toutes les fonctions ci-dessus écrivent de l'argent : elles ne sont
-- appelables que par le service_role, donc uniquement depuis les edge
-- functions. Aucune n'est exposée au navigateur.
REVOKE EXECUTE ON FUNCTION public.checkout_reserve(bigint, uuid, text, text, text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.checkout_attach_session(uuid, text)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.checkout_release(uuid, text)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.checkout_expire_stale(bigint)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_settle_payment(jsonb)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_mark_payment_failed(text, text, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_apply_refund(text, text, int, boolean)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_mark_chargeback(text, text, text, text)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stripe_event_claim(text, text, boolean, text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stripe_event_finish(text, text, text)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orders_needing_attention()                        FROM PUBLIC, anon, authenticated;

-- Le REVOKE ci-dessus retire aussi le droit hérité de PUBLIC : on le rend
-- explicitement au backend, sinon les edge functions et le cron ne peuvent
-- plus rien appeler.
GRANT EXECUTE ON FUNCTION public.checkout_reserve(bigint, uuid, text, text, text)   TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.checkout_attach_session(uuid, text)                TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.checkout_release(uuid, text)                       TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.checkout_expire_stale(bigint)                      TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_settle_payment(jsonb)                        TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_mark_payment_failed(text, text, text)        TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_apply_refund(text, text, int, boolean)       TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_mark_chargeback(text, text, text, text)      TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.stripe_event_claim(text, text, boolean, text, int) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.stripe_event_finish(text, text, text)              TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.orders_needing_attention()                         TO service_role, postgres;

-- L'administrateur doit pouvoir lire les commandes : sans cette policy, le
-- tableau de bord affichait zéro commande et zéro chiffre d'affaires.
--
-- La liste des deux administrateurs est celle de ADD_ADMIN.sql et de admin.js.
-- Une première version ne citait que la première adresse : le second
-- administrateur aurait vu un tableau de bord vide sans comprendre pourquoi.
DROP POLICY IF EXISTS "Admin reads all orders" ON public.orders;
CREATE POLICY "Admin reads all orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

-- ---------------------------------------------------------------------
-- 8 bis. CYCLE DE VIE DE COMMANDE : GARDES D'AUTORISATION
--
-- Faille constatée en exécutant réellement le schéma, et reproduite :
-- un appelant ANONYME pouvait confirmer la réception et ouvrir un litige sur
-- n'importe quelle commande passée en invité.
--
-- Deux causes cumulées :
--   1. Les trois RPC de 20260425000001 ont reçu GRANT EXECUTE TO authenticated
--      mais n'ont jamais été révoquées de PUBLIC. Elles restaient donc
--      appelables par anon, avec les droits du propriétaire (SECURITY DEFINER).
--   2. La garde s'écrivait `IF v_order.buyer_id IS DISTINCT FROM auth.uid()`.
--      Or NULL IS DISTINCT FROM NULL vaut FALSE. Pour une commande invité
--      (buyer_id NULL) appelée par anon (auth.uid() NULL), la garde passait.
--
-- Les commandes invité existent bel et bien : l'ancien create-checkout écrivait
-- `buyer_id: buyerId || null`. L'achat exige désormais un compte, mais les
-- commandes déjà en base gardent leur buyer_id vide.
--
-- Correction : identité exigée explicitement, propriétaire exigé non nul,
-- comparaison stricte, et révocation de PUBLIC et anon.
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
  v_order public.orders;
  v_uid   uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;

  -- Comparaison stricte : une commande sans vendeur n'appartient à personne,
  -- donc personne ne peut agir dessus.
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

CREATE OR REPLACE FUNCTION public.order_confirm_receipt(p_order_id uuid)
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
  IF v_order.buyer_id IS NULL OR v_order.buyer_id <> v_uid THEN
    RAISE EXCEPTION 'Non autorisé : vous n''êtes pas l''acheteur de cette commande';
  END IF;
  IF v_order.status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'Cette commande ne peut pas être confirmée (statut: %)', v_order.status;
  END IF;

  UPDATE public.orders
  SET status = 'completed',
      delivered_at = COALESCE(delivered_at, now()),
      confirmed_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.order_report_dispute(
  p_order_id uuid,
  p_reason text
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
  IF v_order.buyer_id IS NULL OR v_order.buyer_id <> v_uid THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;
  IF v_order.status IN ('completed', 'refunded', 'partially_refunded', 'disputed',
                        'pending', 'expired', 'canceled', 'payment_failed') THEN
    RAISE EXCEPTION 'Litige impossible sur cette commande (statut: %)', v_order.status;
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Merci de décrire le problème (au moins 10 caractères)';
  END IF;

  UPDATE public.orders
  SET status = 'disputed',
      dispute_reason = trim(p_reason),
      disputed_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

-- Le GRANT d'origine n'avait jamais retiré le droit hérité de PUBLIC.
REVOKE EXECUTE ON FUNCTION public.order_mark_shipped(uuid, text, text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.order_confirm_receipt(uuid)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.order_report_dispute(uuid, text)      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.order_mark_shipped(uuid, text, text)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.order_confirm_receipt(uuid)           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.order_report_dispute(uuid, text)      TO authenticated;

-- Les commandes invité restent orphelines : leur acheteur n'a pas de compte,
-- personne ne peut donc légitimement confirmer à sa place. On les signale pour
-- traitement manuel plutôt que de les laisser dans un angle mort.
UPDATE public.orders
   SET needs_review = true,
       review_reason = COALESCE(review_reason,
         'Commande passée en invité : aucun acheteur rattaché, cycle de vie non actionnable')
 WHERE buyer_id IS NULL
   AND status IN ('paid', 'shipped', 'delivered');

-- ---------------------------------------------------------------------
-- 8 ter. GARDE-FOU DES PROFILS : MÊME PIÈGE, MÊME CORRECTION
--
-- profiles_prevent_self_unblock teste auth.role() = 'service_role'. C'est
-- juste pour les fonctions edge, qui passent par PostgREST avec un jeton
-- service_role. Mais auth.role() vaut NULL pour la tâche cron et pour toute
-- fonction SECURITY DEFINER sans contexte JWT : dans ces cas, le garde-fou
-- annule silencieusement l'écriture, exactement comme en avril où il rendait
-- Stripe Connect inopérant.
--
-- On ajoute current_user aux conditions autorisées, sans rien retirer.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.profiles_prevent_self_unblock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR (auth.jwt()->>'email') IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com') THEN
    RETURN NEW;
  END IF;

  NEW.blocked := OLD.blocked;
  NEW.blocked_at := OLD.blocked_at;
  NEW.blocked_by := OLD.blocked_by;
  NEW.block_reason := OLD.block_reason;
  NEW.email := OLD.email;
  NEW.created_at := OLD.created_at;
  NEW.stripe_account_id := OLD.stripe_account_id;
  NEW.stripe_onboarded := OLD.stripe_onboarded;
  NEW.stripe_onboarded_at := OLD.stripe_onboarded_at;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 8 quater. LIMITATION D'ABUS
--
-- Les endpoints de paiement sont authentifiés : on compte donc par
-- UTILISATEUR, pas par adresse IP. Compter par IP punirait les clients d'un
-- même opérateur mobile ou d'un même réseau d'entreprise, qui partagent une
-- sortie, tout en laissant passer un attaquant disposant de plusieurs IP.
--
-- Le compteur vit en base parce que c'est le seul état partagé entre les
-- instances de fonctions edge : un compteur en mémoire ne compterait que les
-- appels tombés sur la même instance, ce qui ne limite rien.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         int         NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- Aucune policy : réservé au service_role.

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits (window_start);

-- Renvoie true si l'appel est autorisé. L'incrément et le test sont dans la
-- même instruction : deux appels simultanés ne peuvent pas lire le même
-- compteur puis le dépasser tous les deux.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_bucket         text,
  p_limit          int,
  p_window_seconds int DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_hits   int;
BEGIN
  -- Fenêtre glissante par tranches : to_timestamp(floor(epoch / taille)).
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.rate_limits AS rl (bucket, window_start, hits)
  VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rl.hits + 1
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_limit;
END;
$$;

-- Purge : sans elle la table gonflerait indéfiniment.
CREATE OR REPLACE FUNCTION public.rate_limits_purge()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 hours';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rate_limits_purge()            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rate_limit_hit(text, int, int) TO service_role, postgres;
GRANT  EXECUTE ON FUNCTION public.rate_limits_purge()            TO service_role, postgres;

-- ---------------------------------------------------------------------
-- 9. BALAYAGE PLANIFIÉ DES RÉSERVATIONS
-- ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('checkout-expire-stale');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'checkout-expire-stale',
  '*/5 * * * *',
  $$ SELECT public.checkout_expire_stale(); SELECT public.rate_limits_purge(); $$
);

-- ---------------------------------------------------------------------
-- 10. REMISE EN COHÉRENCE DES DONNÉES EXISTANTES
-- ---------------------------------------------------------------------

-- Articles payés que l'ancien webhook n'avait pas pu marquer vendus, faute de
-- pouvoir écrire quantity = 0.
UPDATE public.products p
   SET quantity = 0,
       status   = 'sold',
       sold_at  = COALESCE(p.sold_at, o.created_at)
  FROM public.orders o
 WHERE o.product_id = p.id
   AND o.status IN ('paid','shipped','delivered','completed')
   AND p.status = 'published'
   AND p.quantity <= 1;

-- Recalcul de reserved_qty à partir des réservations réellement vivantes.
--
-- Une première version écrivait `SET reserved_qty = 0`. C'était juste à la
-- toute première exécution, et destructeur à la seconde : rejouer la migration
-- pendant qu'un acheteur est sur Stripe libérait son stock, et un autre
-- acheteur pouvait alors réserver le même exemplaire. Un test de
-- ré-exécution l'a mis en évidence.
--
-- Recalculer plutôt que remettre à zéro rend l'instruction idempotente, et
-- réparatrice : si un compteur avait dérivé, il revient à la vérité portée
-- par la table des commandes.
WITH live AS (
  SELECT product_id, count(*)::int AS n
    FROM public.orders
   WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at > now()
   GROUP BY product_id
)
UPDATE public.products p
   SET reserved_qty = COALESCE(l.n, 0)
  FROM public.products p2
  LEFT JOIN live l ON l.product_id = p2.id
 WHERE p.id = p2.id
   AND p.reserved_qty IS DISTINCT FROM COALESCE(l.n, 0);
