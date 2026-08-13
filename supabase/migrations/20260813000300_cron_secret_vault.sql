-- =====================================================================
-- Secret des tâches planifiées de paiement, via Supabase Vault
--
-- Les deux tâches (versement et surveillance) appellent des fonctions edge
-- protégées par un en-tête partagé. Ce secret ne doit apparaître ni dans la
-- définition SQL de la tâche, ni dans les journaux, ni dans ce dépôt.
--
-- Première approche essayée, et pourquoi elle a échoué : un réglage de base
-- (ALTER DATABASE ... SET app.payments_cron_secret) serait lisible par toute
-- session, et de toute façon Supabase refuse ce droit au rôle postgres.
--
-- Vault chiffre la valeur au repos et n'expose sa forme claire qu'à travers
-- vault.decrypted_secrets, réservé aux rôles privilégiés. La tâche lit le
-- secret au moment de s'exécuter ; sa définition, elle, ne contient qu'un nom.
--
-- La VALEUR n'est pas dans ce fichier. Elle est déposée séparément par
-- l'opérateur, et doit être identique au secret PAYMENTS_CRON_SECRET des
-- fonctions edge :
--
--   SELECT vault.create_secret('<valeur>', 'payments_cron_secret',
--                              'En-tête x-cron-secret des tâches de paiement');
--
-- Sans ce dépôt, les tâches partent quand même mais les fonctions répondent
-- 401 : aucun versement n'a lieu, aucune surveillance ne tourne. C'est le
-- bon sens de l'échec — un secret manquant ne doit jamais ouvrir une porte.
-- =====================================================================

-- L'extension n'existe que chez Supabase. Ailleurs (Postgres de test, copie
-- restaurée sur un poste), son absence ne doit pas faire échouer la migration :
-- la fonction ci-dessous rendra simplement NULL, et les tâches se verront
-- refuser l'accès. Une migration qui ne s'applique que sur un seul serveur
-- n'est plus vérifiable.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'supabase_vault indisponible : le secret des tâches sera NULL ici';
END $$;

-- Lecture du secret par son nom. Encapsulée dans une fonction pour que la
-- définition des tâches reste lisible, et pour n'accorder l'accès qu'ici.
--
-- Le corps passe par EXECUTE : en SQL direct, la référence à
-- vault.decrypted_secrets est résolue dès la création, ce qui rendrait la
-- migration inapplicable là où Vault manque. En plpgsql, elle l'est à
-- l'exécution, et l'absence se traduit par NULL plutôt que par un échec.
CREATE OR REPLACE FUNCTION public.payments_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE v_secret text;
BEGIN
  EXECUTE $q$ SELECT decrypted_secret FROM vault.decrypted_secrets
               WHERE name = 'payments_cron_secret' LIMIT 1 $q$ INTO v_secret;
  RETURN v_secret;
EXCEPTION WHEN undefined_table OR undefined_object OR insufficient_privilege THEN
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.payments_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.payments_cron_secret() TO postgres;

-- ---------------------------------------------------------------------
-- Replanification des deux tâches avec lecture du secret dans Vault
-- ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('payout-release');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'payout-release',
  '7 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/payout-release',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.payments_cron_secret()
    ),
    body := '{}'::jsonb
  );
  $job$
);

DO $$
BEGIN
  PERFORM cron.unschedule('payments-monitor');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'payments-monitor',
  '23 */6 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/payments-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.payments_cron_secret()
    ),
    body := '{}'::jsonb
  );
  $job$
);
