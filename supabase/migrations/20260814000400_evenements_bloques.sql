-- =====================================================================
-- Les événements Stripe qui restent en travers
--
-- CONSTATÉ EN PRODUCTION, à la première circulation réelle du webhook : sur
-- 141 événements reçus, 61 sont restés en statut « processing ». Zéro en
-- échec. Cause identifiée : neuf redéploiements successifs des fonctions
-- pendant que Stripe livrait, chaque déploiement coupant les traitements en
-- vol après la réservation et avant la clôture.
--
-- Le problème n'est pas le déploiement, qui arrivera toujours. Le problème est
-- que PERSONNE NE LE VOYAIT : payments-monitor ne regarde que le statut
-- « failed ». Un événement bloqué en « processing » ne déclenche aucune
-- alerte, n'est jamais repris, et disparaît des radars.
--
-- Si cela arrivait à un checkout.session.completed, un acheteur aurait payé,
-- la commande serait restée en attente, et le premier signal aurait été sa
-- réclamation.
--
-- Les deux fonctions ci-dessous donnent au moniteur de quoi voir et de quoi
-- reprendre. Le bail existant (180 s) rend déjà l'événement techniquement
-- reprenable ; encore faut-il que quelqu'un vienne le reprendre.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.stripe_events_stuck(p_older_seconds int DEFAULT 900)
RETURNS TABLE (id text, type text, created_at timestamptz, attempts int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.type, e.created_at, e.attempts
    FROM public.stripe_events e
   WHERE e.status = 'processing'
     AND e.created_at < now() - make_interval(secs => p_older_seconds)
   ORDER BY e.created_at
   LIMIT 100;
$$;

COMMENT ON FUNCTION public.stripe_events_stuck(int) IS
  'Événements réservés puis jamais clôturés : un traitement interrompu, un '
  'déploiement au mauvais moment, une fonction tuée. Invisibles jusqu''ici, '
  'car le statut « failed » était le seul surveillé.';

-- ---------------------------------------------------------------------
-- Rendre la place
--
-- Repasse l'événement en attente pour qu'une nouvelle tentative, de Stripe ou
-- du moniteur, puisse le réclamer sans attendre l'expiration naturelle du bail.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stripe_event_unstick(p_id text, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.stripe_events
     SET status = 'failed',
         last_error = COALESCE(p_reason, 'traitement interrompu, repris par la surveillance')
   WHERE id = p_id AND status = 'processing'
  RETURNING true INTO v_ok;

  RETURN COALESCE(v_ok, false);
END $$;

REVOKE EXECUTE ON FUNCTION public.stripe_events_stuck(int)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stripe_event_unstick(text, text)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stripe_events_stuck(int)          TO service_role, postgres;
GRANT  EXECUTE ON FUNCTION public.stripe_event_unstick(text, text)  TO service_role, postgres;

-- ---------------------------------------------------------------------
-- Les 61 événements déjà bloqués
--
-- Ils viennent tous de sessions de test expirées, sans commande associée. On
-- les marque comme échoués plutôt que de les laisser en « processing » : le
-- statut doit dire la vérité, et la surveillance les reprendra si Stripe les
-- relivre.
-- ---------------------------------------------------------------------
UPDATE public.stripe_events
   SET status = 'failed',
       last_error = 'traitement interrompu par un déploiement, constaté le 2026-08-14'
 WHERE status = 'processing'
   AND created_at < now() - interval '15 minutes';
