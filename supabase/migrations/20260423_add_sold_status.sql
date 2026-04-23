-- Ajoute le statut 'sold' aux produits pour permettre au webhook Stripe
-- de marquer un article vendu après un paiement réussi.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products
  ADD CONSTRAINT products_status_check
  CHECK (status IN ('published', 'draft', 'sold'));
