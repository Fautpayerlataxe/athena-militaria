-- =====================================================================
-- Veille du site : une tâche toutes les dix minutes, un courriel à
-- l'exploitant au deuxième échec de suite, puis au retour.
--
-- Pourquoi : pendant la coupure de l'hébergement OVH, le site est resté
-- injoignable plusieurs jours sans que personne en soit prévenu.
-- La fonction veille-site fait les contrôles et écrit ; cette migration
-- crée l'état (une ligne) et la tâche, sur le modèle de payout-release
-- (même secret du coffre, payments_cron_secret()).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.veille_site (
  id                 integer PRIMARY KEY CHECK (id = 1),
  echecs_consecutifs integer NOT NULL DEFAULT 0,
  en_panne           boolean NOT NULL DEFAULT false,
  panne_depuis       timestamptz,
  dernier_controle   timestamptz,
  dernier_detail     text
);

-- RLS sans aucune politique : seule la clé de service (la fonction) lit et
-- écrit. Ni les visiteurs ni les membres n'ont à voir cet état.
ALTER TABLE public.veille_site ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.veille_site FROM anon, authenticated;

INSERT INTO public.veille_site (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM cron.unschedule('veille-site');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'veille-site',
  '*/10 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/veille-site',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.payments_cron_secret()
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
