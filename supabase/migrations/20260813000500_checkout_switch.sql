-- =====================================================================
-- Interrupteur d'ouverture des achats
--
-- Jusqu'ici, la maintenance tenait au fait qu'une ANCIENNE version de
-- create-checkout était déployée, celle qui répond 503. Cela marche, mais
-- c'est le pire des dispositifs : le code en ligne n'est plus celui du dépôt,
-- personne ne peut le relire, et rouvrir exige un déploiement, donc une
-- fenêtre pendant laquelle une erreur de manipulation ouvre tout.
--
-- C'est exactement l'écart dépôt/production qui a déjà coûté l'écrasement de
-- huit fonctions edge sur ce projet.
--
-- Désormais le code déployé est celui du dépôt, et c'est cette ligne qui
-- décide. Rouvrir :
--
--   UPDATE public.platform_settings SET value = 1 WHERE key = 'checkout_enabled';
--
-- Refermer : remettre 0. Effet immédiat, sans redéploiement.
--
-- Valeur initiale 0 : la réouverture est une décision, pas un effet de bord
-- d'une migration.
-- =====================================================================

INSERT INTO public.platform_settings (key, value) VALUES
  ('checkout_enabled', 0)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.platform_settings IS
  'Réglages de la plateforme. checkout_enabled vaut 1 quand les achats sont '
  'ouverts, 0 sinon : create-checkout refuse toute vente tant qu''il ne lit '
  'pas 1, et refuse aussi s''il ne parvient pas à lire ce réglage.';
