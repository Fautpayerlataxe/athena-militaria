-- Ajoute le mode de livraison choisi et l'adresse collectée au checkout
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_method text
    CHECK (shipping_method IS NULL OR shipping_method IN ('pickup','relay','post')),
  ADD COLUMN IF NOT EXISTS shipping_address jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_shipping_method ON orders (shipping_method);
