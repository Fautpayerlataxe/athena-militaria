-- =========================================================================
-- ATHENA MILITARIA — Support multi-images par annonce
-- À exécuter dans SQL Editor de Supabase : copie tout, colle, RUN
-- =========================================================================

-- 1. Ajouter la colonne image_urls (tableau de texte)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_urls text[] DEFAULT ARRAY[]::text[];

-- 2. Backfill : pour les annonces existantes qui ont une image_url,
--    la copier dans image_urls (un seul élément)
UPDATE public.products
SET image_urls = ARRAY[image_url]
WHERE image_url IS NOT NULL
  AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);

-- =========================================================================
-- NOTE :
-- - image_url (text)     → image principale (= première du tableau). Conservée
--                          pour la compatibilité du code existant.
-- - image_urls (text[])  → toutes les photos de l'annonce (max 6).
-- =========================================================================
