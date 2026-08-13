-- =====================================================================
-- Une suspension qui suspend réellement
--
-- CE QUI ÉTAIT POSSIBLE, CONSTATÉ SUR LA PRODUCTION dans une transaction
-- annulée : un compte marqué blocked = true publiait une annonce sans le
-- moindre obstacle.
--
-- POURQUOI. Deux politiques d'INSERT coexistaient sur products :
--
--   « Block insert if user blocked »   permissive, avec le contrôle
--   « Création par utilisateur connecté » permissive, sans le contrôle
--
-- Les politiques permissives se combinent en OU. Ajouter un garde-fou à côté
-- d'une politique plus large ne restreint donc rien : il suffit que la plus
-- permissive accepte. Le garde-fou avait été ajouté sans retirer l'ancienne,
-- et il n'a jamais rien bloqué.
--
-- LE CORRECTIF, en deux temps :
--
--   1. Retirer la politique redondante, pour que le contrôle compte.
--   2. Poser des politiques RESTRICTIVES. Une politique restrictive se combine
--      en ET : quelle que soit la politique permissive ajoutée demain, un
--      compte suspendu restera bloqué. C'est la différence entre une règle
--      qu'on espère et une règle qu'on garantit.
--
-- La suspension couvre aussi la modification d'annonce et l'envoi de messages :
-- suspendre quelqu'un qui continue d'écrire à ses acheteurs n'aurait pas de
-- sens.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.compte_suspendu()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND blocked = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.compte_suspendu() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compte_suspendu() TO anon, authenticated, service_role, postgres;

COMMENT ON FUNCTION public.compte_suspendu() IS
  'Vrai si le compte appelant est suspendu. SECURITY DEFINER : la politique doit '
  'pouvoir lire profiles même quand l''appelant n''y a pas accès.';

-- ---------------------------------------------------------------------
-- Annonces
-- ---------------------------------------------------------------------

-- La politique large qui annulait le garde-fou.
DROP POLICY IF EXISTS "Création par utilisateur connecté" ON public.products;
DROP POLICY IF EXISTS "Création d'annonce par utilisateur connecté" ON public.products;

DROP POLICY IF EXISTS "Un compte suspendu ne publie pas" ON public.products;
CREATE POLICY "Un compte suspendu ne publie pas"
  ON public.products AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.compte_suspendu());

DROP POLICY IF EXISTS "Un compte suspendu ne modifie pas ses annonces" ON public.products;
CREATE POLICY "Un compte suspendu ne modifie pas ses annonces"
  ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.compte_suspendu());

-- ---------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Un compte suspendu n'écrit pas" ON public.messages;
CREATE POLICY "Un compte suspendu n'écrit pas"
  ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.compte_suspendu());

-- ---------------------------------------------------------------------
-- Avis
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Un compte suspendu ne note pas" ON public.reviews;
CREATE POLICY "Un compte suspendu ne note pas"
  ON public.reviews AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.compte_suspendu());

-- ---------------------------------------------------------------------
-- Contrôle : plus aucune politique permissive d'INSERT sur products ne doit
-- ignorer la suspension. On échoue la migration plutôt que de laisser croire.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_restrictives int;
BEGIN
  SELECT count(*) INTO v_restrictives
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'products'
     AND cmd = 'INSERT' AND permissive = 'RESTRICTIVE';

  IF v_restrictives = 0 THEN
    RAISE EXCEPTION 'Aucune politique restrictive sur products : la suspension resterait contournable';
  END IF;
END $$;
