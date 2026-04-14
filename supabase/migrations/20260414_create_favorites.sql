-- Table des favoris
CREATE TABLE IF NOT EXISTS favorites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id bigint REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, product_id)
);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- Chaque utilisateur voit/gère ses propres favoris
CREATE POLICY "Users manage own favorites" ON favorites
  FOR ALL USING (auth.uid() = user_id);
