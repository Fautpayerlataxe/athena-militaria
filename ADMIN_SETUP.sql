-- =========================================================================
-- ATHENA MILITARIA — Setup Admin + Signalements
-- À exécuter dans SQL Editor de Supabase : copie tout, colle, RUN
-- =========================================================================

-- 1. Table des signalements
CREATE TABLE IF NOT EXISTS public.reports (
  id bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_email text,
  reason text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',  -- pending | resolved | dismissed
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports(status);
CREATE INDEX IF NOT EXISTS reports_product_idx ON public.reports(product_id);

-- 2. Activer RLS sur la table reports
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- 3. Politiques d'accès reports
-- N'importe qui (connecté ou non) peut créer un signalement
DROP POLICY IF EXISTS "Anyone can report" ON public.reports;
CREATE POLICY "Anyone can report"
  ON public.reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Seul l'admin peut voir/modifier les signalements
DROP POLICY IF EXISTS "Admin can view all reports" ON public.reports;
CREATE POLICY "Admin can view all reports"
  ON public.reports FOR SELECT
  TO authenticated
  USING (auth.jwt()->>'email' = 'augustinrendu@gmail.com');

DROP POLICY IF EXISTS "Admin can update reports" ON public.reports;
CREATE POLICY "Admin can update reports"
  ON public.reports FOR UPDATE
  TO authenticated
  USING (auth.jwt()->>'email' = 'augustinrendu@gmail.com');

-- 4. Donner à l'admin le pouvoir de supprimer/modifier n'importe quel produit
DROP POLICY IF EXISTS "Admin can delete any product" ON public.products;
CREATE POLICY "Admin can delete any product"
  ON public.products FOR DELETE
  TO authenticated
  USING (auth.jwt()->>'email' = 'augustinrendu@gmail.com');

DROP POLICY IF EXISTS "Admin can update any product" ON public.products;
CREATE POLICY "Admin can update any product"
  ON public.products FOR UPDATE
  TO authenticated
  USING (auth.jwt()->>'email' = 'augustinrendu@gmail.com');

-- =========================================================================
-- NOTE : si tu veux ajouter d'autres admins, remplace la ligne
--        auth.jwt()->>'email' = 'augustinrendu@gmail.com'
--        par
--        auth.jwt()->>'email' IN ('augustinrendu@gmail.com', 'autre@email.com')
-- =========================================================================
