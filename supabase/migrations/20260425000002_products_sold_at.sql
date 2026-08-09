-- =====================================================================
-- Auto-masquage des articles vendus après 7 jours
-- Garde le produit en base, garde l'historique des commandes intact,
-- mais le retire des listings publics au bout d'une semaine.
-- =====================================================================

-- 1. Date de mise en vendu
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sold_at timestamptz;

-- 2. Pour les produits déjà 'sold' avant cette migration : on leur donne
--    7 jours de visibilité à partir de maintenant
UPDATE public.products
SET sold_at = NOW()
WHERE status = 'sold' AND sold_at IS NULL;

-- 3. Trigger : sold_at est mis à jour automatiquement quand le statut
--    passe à 'sold' (filet de sécurité au cas où le webhook oublie)
CREATE OR REPLACE FUNCTION public.products_track_sold_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'sold' AND (OLD.status IS DISTINCT FROM 'sold') THEN
    NEW.sold_at := COALESCE(NEW.sold_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_set_sold_at ON public.products;
CREATE TRIGGER products_set_sold_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_track_sold_at();

-- 4. RLS : remplacer la policy publique pour autoriser
--    - Tous les articles 'published'
--    - Les articles 'sold' depuis moins de 7 jours
DROP POLICY IF EXISTS "Lecture publique des annonces publiées" ON public.products;
DROP POLICY IF EXISTS "Lecture publique des annonces visibles" ON public.products;
CREATE POLICY "Lecture publique des annonces visibles"
  ON public.products FOR SELECT
  USING (
    status = 'published'
    OR (status = 'sold' AND sold_at IS NOT NULL AND sold_at > now() - interval '7 days')
  );

-- 5. RLS supplémentaire : un acheteur ou vendeur peut toujours lire un produit
--    lié à une de ses commandes (même au-delà de 7 jours après vente).
--    Évite que la page "Mes achats" perde l'image/titre du produit.
DROP POLICY IF EXISTS "Order parties can read product" ON public.products;
CREATE POLICY "Order parties can read product"
  ON public.products FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.product_id = products.id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
    )
  );
