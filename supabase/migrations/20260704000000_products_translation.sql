-- =====================================================================
-- Traduction automatique des annonces (FR -> EN via DeepL)
-- Les champs *_en sont remplis par l'edge function translate-listing
-- au moment de la publication. Affichés quand le visiteur est en mode EN.
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS title_en text,
  ADD COLUMN IF NOT EXISTS description_en text,
  ADD COLUMN IF NOT EXISTS translated_at timestamptz;

-- Seul le backend (service_role, via l'edge function) écrit ces champs :
-- on empêche un utilisateur de falsifier la "traduction" d'une annonce
-- (protection déjà assurée par les policies RLS existantes sur products :
--  l'utilisateur ne peut modifier que ses propres lignes ; les champs _en
--  restent modifiables par lui sur SES annonces, ce qui est acceptable —
--  au pire il corrige sa propre traduction).
