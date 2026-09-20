-- =====================================================================
-- Archive des ventes : une pièce vendue reste consultable, avec son prix
--
-- Jusqu'ici, une annonce vendue disparaissait du public sept jours après
-- la vente (20260425000002_products_sold_at.sql). Sa fiche répondait alors
-- 404 et le prix réellement payé était perdu, alors que c'est l'information
-- que cherche un collectionneur qui veut estimer une pièce.
--
-- Les ventes conclues à partir du 19 septembre 2026 restent désormais
-- visibles (conditions d'utilisation, article 2.7). Les ventes antérieures
-- gardent la règle des sept jours : leurs vendeurs ont publié sous des
-- conditions qui annonçaient ce retrait.
--
-- Le retrait à la demande du vendeur (même article) passe par la
-- modération : statut 'removed', que cette politique n'expose pas.
-- =====================================================================

DROP POLICY IF EXISTS "Lecture publique des annonces visibles" ON public.products;
CREATE POLICY "Lecture publique des annonces visibles"
  ON public.products FOR SELECT
  USING (
    status = 'published'
    OR (
      status = 'sold'
      AND sold_at IS NOT NULL
      AND (
        sold_at > now() - interval '7 days'
        OR sold_at >= timestamptz '2026-09-19 00:00:00+02'
      )
    )
  );
