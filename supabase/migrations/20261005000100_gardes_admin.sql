-- =====================================================================
-- Des gardes d'administration qui gardent vraiment
--
-- Constaté le 5 octobre 2026 en rejouant les migrations sur la base de test,
-- puis confirmé en production le même jour : pg_proc donne prosecdef = true
-- pour les quatre fonctions ci-dessous, avec la garde décrite.
--
-- LE DÉFAUT
--
--   Dans une fonction SECURITY DEFINER, current_user vaut toujours le
--   propriétaire de la fonction, c'est-à-dire postgres. Une garde qui teste
--   « current_user IN ('postgres', ...) » y est donc toujours vraie.
--
--   - admin_bannir_compte et admin_moderer_signalement (20260814000600) :
--     tout membre connecté passait la garde. N'importe quel compte pouvait
--     en bannir un autre, administrateurs compris, et retirer ses annonces ;
--     clore un signalement, et supprimer ou retirer l'article signalé.
--     Reproduit sur la base de test : un membre ordinaire obtenait
--     {"banni": true}.
--
--   - reviews_freeze_target (20260814000000) et
--     profiles_refuse_suppression_si_banni (20260814000600) : deux
--     déclencheurs SECURITY DEFINER dont la garde ne s'appliquait jamais.
--     Un auteur pouvait déplacer son avis vers une autre annonce ; le profil
--     d'un compte banni pouvait être supprimé, ce qui levait la suspension.
--
--   Aucune trace d'abus en production au 5 octobre : aucun profil banni,
--   aucun signalement résolu, aucune annonce retirée, aucun avis.
--
-- LA CORRECTION
--
--   1. Les deux fonctions d'administration restent SECURITY DEFINER (elles
--      écrivent sur profiles, products et reports), mais ne regardent plus
--      current_user. Elles reconnaissent :
--        - un administrateur, à l'adresse de son jeton ;
--        - le service (fonctions edge), au rôle de son jeton ;
--        - l'éditeur SQL du tableau de bord et pg_cron : aucun jeton, et une
--          session ouverte par postgres ou supabase_admin. session_user ne
--          change pas à l'entrée d'une fonction SECURITY DEFINER ; par l'API,
--          il vaut authenticator, et le jeton porte toujours un rôle.
--      Tout le reste est refusé, y compris un jeton sans adresse : la garde
--      ne vaut jamais NULL, car « IF NOT NULL » ne lève rien.
--
--   2. Les deux déclencheurs ne lisent que OLD et NEW : ils n'ont besoin
--      d'aucun droit particulier. Ils passent en SECURITY INVOKER, et
--      current_user redevient celui de la requête, comme pour
--      products_garde_authenticite (20261005000000).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Bannir un compte
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_bannir_compte(
  p_user_id uuid,
  p_motif   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin   boolean;
  v_retires int;
BEGIN
  v_admin := coalesce(
       (auth.jwt() ->> 'email') = ANY (ARRAY['sayrox.ar@gmail.com', 'renduambroise@gmail.com'])
    OR (auth.jwt() ->> 'role') = 'service_role'
    OR (coalesce(auth.jwt() ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin')),
    false);
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Non autorisé' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.profiles
     SET blocked = true,
         blocked_at = now(),
         blocked_by = auth.uid(),
         block_reason = COALESCE(NULLIF(trim(p_motif), ''), 'Compte banni par l''administration')
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compte introuvable';
  END IF;

  -- Les annonces sortent du catalogue sans être détruites : une commande peut
  -- les référencer, et l'acheteur doit continuer de voir ce qu'il a acheté.
  UPDATE public.products
     SET status = 'removed'
   WHERE user_id = p_user_id AND status <> 'sold';
  GET DIAGNOSTICS v_retires = ROW_COUNT;

  RETURN jsonb_build_object('banni', true, 'annonces_retirees', v_retires);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_bannir_compte(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_bannir_compte(uuid, text) TO authenticated, service_role, postgres;

-- ---------------------------------------------------------------------
-- 2. Modérer un article signalé
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_moderer_signalement(
  p_report_id bigint,
  p_decision  text,
  p_note      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin    boolean;
  v_report   public.reports;
  v_supprime boolean := false;
BEGIN
  v_admin := coalesce(
       (auth.jwt() ->> 'email') = ANY (ARRAY['sayrox.ar@gmail.com', 'renduambroise@gmail.com'])
    OR (auth.jwt() ->> 'role') = 'service_role'
    OR (coalesce(auth.jwt() ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin')),
    false);
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Non autorisé' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_decision NOT IN ('retirer', 'conserver') THEN
    RAISE EXCEPTION 'Décision inconnue : %', p_decision;
  END IF;

  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signalement introuvable'; END IF;

  -- La trace d'abord.
  UPDATE public.reports
     SET status = 'resolved',
         resolved_at = now(),
         resolved_by = auth.uid()
   WHERE id = p_report_id;

  IF p_decision = 'retirer' AND v_report.product_id IS NOT NULL THEN
    -- On tente la suppression, et on se replie sur le retrait si l'article est
    -- référencé par une commande. Aucune des deux issues ne laisse l'article
    -- en vente.
    BEGIN
      DELETE FROM public.products WHERE id = v_report.product_id;
      v_supprime := true;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE public.products SET status = 'removed' WHERE id = v_report.product_id;
      v_supprime := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'decision', p_decision,
    'article_supprime', v_supprime,
    'article_retire', (p_decision = 'retirer' AND NOT v_supprime));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_moderer_signalement(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_moderer_signalement(bigint, text, text) TO authenticated, service_role, postgres;

-- ---------------------------------------------------------------------
-- 3. Les deux déclencheurs s'exécutent avec les droits de la requête
-- ---------------------------------------------------------------------

ALTER FUNCTION public.reviews_freeze_target() SECURITY INVOKER;
ALTER FUNCTION public.profiles_refuse_suppression_si_banni() SECURITY INVOKER;

-- ---------------------------------------------------------------------
-- 4. Vérification : plus aucune fonction SECURITY DEFINER ne teste
--    current_user. Si une autre en restait une, la migration échoue et la
--    transaction est annulée.
-- ---------------------------------------------------------------------

DO $$
DECLARE v_noms text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_noms
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND p.prosrc ~* '\mcurrent_user\M';

  IF v_noms IS NOT NULL THEN
    RAISE EXCEPTION 'Fonctions SECURITY DEFINER dont la garde teste current_user : %', v_noms;
  END IF;
END $$;
