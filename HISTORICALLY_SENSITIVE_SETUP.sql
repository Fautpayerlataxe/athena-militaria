-- =========================================================================
-- ATHENA MILITARIA — Champ « objet historiquement sensible »
-- À exécuter dans SQL Editor de Supabase : copie tout, colle, RUN
--
-- Ajoute une colonne boolean qui indique qu'un article porte un insigne,
-- symbole ou marquage d'une organisation historique dissoute (Waffen-SS,
-- NSDAP, IIIᵉ Reich, etc.). Les visiteurs non connectés verront les photos
-- floutées sur les annonces concernées.
-- =========================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS historically_sensitive boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS products_sensitive_idx
  ON public.products (historically_sensitive)
  WHERE historically_sensitive = true;
