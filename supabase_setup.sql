-- ============================================================
-- TABLE PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  period      TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  condition   TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  quantity    INT NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  location    TEXT NOT NULL DEFAULT '',
  image_url   TEXT,
  ship_pickup BOOLEAN NOT NULL DEFAULT TRUE,
  ship_post   BOOLEAN NOT NULL DEFAULT FALSE,
  ship_relay  BOOLEAN NOT NULL DEFAULT FALSE,
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEX pour les requêtes fréquentes
-- ============================================================
CREATE INDEX idx_products_status     ON products (status);
CREATE INDEX idx_products_period     ON products (period);
CREATE INDEX idx_products_created_at ON products (created_at DESC);
CREATE INDEX idx_products_user_id    ON products (user_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut LIRE les annonces publiées
CREATE POLICY "Lecture publique des annonces publiées"
  ON products FOR SELECT
  USING (status = 'published');

-- Un utilisateur connecté peut lire ses propres brouillons
CREATE POLICY "Lecture de ses propres brouillons"
  ON products FOR SELECT
  USING (auth.uid() = user_id AND status = 'draft');

-- Un utilisateur connecté peut créer une annonce
CREATE POLICY "Création d'annonce par utilisateur connecté"
  ON products FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Un utilisateur peut modifier ses propres annonces
CREATE POLICY "Modification de ses propres annonces"
  ON products FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Un utilisateur peut supprimer ses propres annonces
CREATE POLICY "Suppression de ses propres annonces"
  ON products FOR DELETE
  USING (auth.uid() = user_id);
