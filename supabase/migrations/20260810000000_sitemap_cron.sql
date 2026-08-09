-- =====================================================================
-- Régénération planifiée du sitemap des annonces
--
-- La fonction edge « sitemap » lit la base et renvoie le XML des catégories
-- et des fiches produits. Elle est servie aux moteurs par sitemap.php (OVH),
-- qui met le résultat en cache six heures.
--
-- La tâche appelle l'URL du SITE, pas celle de la fonction. Deux raisons :
--
--   1. C'est le cache d'OVH que Google lit. Appeler la fonction directement
--      n'aurait rafraîchi que le côté Supabase, en laissant vieillir la copie
--      réellement servie aux robots.
--   2. Le paramètre ?refresh= porte un jeton reconnu par sitemap.php, qui
--      passe outre son cache et va rechercher les données. Sans lui, la tâche
--      tomberait sur un cache encore valide et repartirait sans rien faire.
--
-- 3h20 UTC : heure creuse, et le cache part frais pour la journée. Un échec
-- reste visible dans cron.job_run_details, alors qu'une génération uniquement
-- déclenchée par les visites échouerait en silence et le sitemap se figerait
-- sans que personne ne le remarque.
--
-- Aucun secret n'est transmis : tout ce qui est lu est déjà public, et rien
-- n'est écrit en base.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- (Ré)installe la tâche proprement si elle existe déjà
DO $$
BEGIN
  PERFORM cron.unschedule('sitemap-refresh');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sitemap-refresh',
  '20 3 * * *',
  $$
  SELECT net.http_get(
    url := 'https://www.athenamilitaria.fr/sitemap-annonces.xml?refresh=af9e943f873ff6307dde5ee8e854327d'
  );
  $$
);
