-- Table des commandes (remplie par le webhook Stripe)
CREATE TABLE IF NOT EXISTS orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES products(id),
  stripe_session_id text UNIQUE NOT NULL,
  customer_email text,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'paid',
  created_at timestamptz DEFAULT now()
);

-- RLS : seul le service role peut insérer (via webhook)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Politique de lecture pour les admins (optionnel, à adapter)
CREATE POLICY "Service role full access" ON orders
  FOR ALL USING (auth.role() = 'service_role');
