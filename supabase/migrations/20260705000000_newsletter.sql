-- =====================================================================
-- Newsletter hebdomadaire
-- 1. Opt-out par profil (lien de désinscription dans chaque e-mail)
-- 2. Tâche planifiée : chaque dimanche 17:00 UTC (18h/19h Paris),
--    appelle l'edge function weekly-newsletter avec le secret.
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS newsletter_opt_out boolean NOT NULL DEFAULT false;

-- Extensions nécessaires au planificateur
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- (Ré)installe la tâche proprement si elle existe déjà
DO $$
BEGIN
  PERFORM cron.unschedule('weekly-newsletter');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'weekly-newsletter',
  '0 17 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/weekly-newsletter',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"secret": "b23795b6d0eda9fb83aa0233d765214d5a410605ef0c7b32"}'::jsonb
  );
  $$
);
