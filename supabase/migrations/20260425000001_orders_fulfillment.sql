-- =====================================================================
-- Étape A : gestion expédition / réception entre acheteur et vendeur
-- =====================================================================

-- 1. Poids du produit (en grammes), facultatif. Servira plus tard pour
--    le calcul automatique des frais de port (Sendcloud).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS weight_grams int
    CHECK (weight_grams IS NULL OR (weight_grams > 0 AND weight_grams <= 50000));

-- 2. Enrichir la table orders pour suivre le cycle de vie complet
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buyer_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS tracking_carrier text,
  ADD COLUMN IF NOT EXISTS shipped_at  timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

-- 3. Backfill : associer le vendeur à toutes les commandes existantes
UPDATE public.orders o
SET seller_id = p.user_id
FROM public.products p
WHERE o.product_id = p.id AND o.seller_id IS NULL;

-- 4. Mise à jour du statut autorisé
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('paid', 'shipped', 'delivered', 'completed', 'disputed', 'refunded'));

-- 5. Index pour requêtes "Mes ventes" / "Mes achats"
CREATE INDEX IF NOT EXISTS idx_orders_seller ON public.orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer  ON public.orders (buyer_id,  created_at DESC);

-- 6. RLS : lecture par vendeur ou acheteur de leurs propres commandes
DROP POLICY IF EXISTS "Service role full access" ON public.orders;
CREATE POLICY "Service role full access" ON public.orders
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Seller reads own sales" ON public.orders;
CREATE POLICY "Seller reads own sales"
  ON public.orders FOR SELECT
  TO authenticated
  USING (auth.uid() = seller_id);

DROP POLICY IF EXISTS "Buyer reads own purchases" ON public.orders;
CREATE POLICY "Buyer reads own purchases"
  ON public.orders FOR SELECT
  TO authenticated
  USING (auth.uid() = buyer_id);

-- 7. RPCs pour transitions de statut (sécurisées : auth.uid() vérifié)

-- Vendeur : marquer comme expédié + saisir le numéro de suivi
DROP FUNCTION IF EXISTS public.order_mark_shipped(uuid, text, text);
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
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.seller_id IS DISTINCT FROM auth.uid() THEN
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

-- Acheteur : confirmer la réception
DROP FUNCTION IF EXISTS public.order_confirm_receipt(uuid);
CREATE OR REPLACE FUNCTION public.order_confirm_receipt(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.buyer_id IS DISTINCT FROM auth.uid() THEN
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

-- Acheteur : signaler un problème (dispute)
DROP FUNCTION IF EXISTS public.order_report_dispute(uuid, text);
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
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.buyer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;
  IF v_order.status IN ('completed', 'refunded', 'disputed') THEN
    RAISE EXCEPTION 'Litige déjà ouvert ou commande clôturée';
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

GRANT EXECUTE ON FUNCTION public.order_mark_shipped(uuid, text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_confirm_receipt(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_report_dispute(uuid, text)       TO authenticated;
