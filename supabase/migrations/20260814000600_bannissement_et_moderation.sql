-- =====================================================================
-- Un bannissement qui bannit, et une modération qui peut agir
--
-- DEUX DÉFAUTS, constatés sur le code de l'administration.
--
-- 1. « SUPPRIMER » UN COMPTE SUSPENDU LE LIBÉRAIT.
--
--    L'action effaçait la ligne profiles. Or c'est cette ligne qui porte
--    blocked = true, et c'est elle que consulte compte_suspendu(). Sans ligne,
--    plus de suspension : le compte auth survivait, intact, et son titulaire
--    pouvait de nouveau publier. L'administrateur croyait bannir, il libérait.
--
--    Le bouton le plus sévère du panneau était donc le plus clément.
--
-- 2. UN ARTICLE SIGNALÉ NE POUVAIT PLUS ÊTRE RETIRÉ.
--
--    La seule action de modération était la suppression. Dès qu'une commande
--    ou une réservation avait existé sur l'article, la clé étrangère la
--    refusait, et il n'y avait aucun repli : l'article signalé restait en
--    vente, indéfiniment.
--
-- CE QUE CETTE MIGRATION POSE :
--
--   - un statut 'removed' pour retirer de la vente sans rien détruire ;
--   - le refus, en base, de supprimer le profil d'un compte suspendu ;
--   - une fonction de bannissement qui conserve la ligne et l'historique.
--
-- On ne supprime pas les comptes : les commandes les référencent, et
-- l'historique financier doit survivre à la modération.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Retirer de la vente sans détruire
-- ---------------------------------------------------------------------

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE public.products ADD CONSTRAINT products_status_check
  CHECK (status = ANY (ARRAY['published', 'draft', 'sold', 'removed']));

COMMENT ON COLUMN public.products.status IS
  'published : en vente · draft : brouillon · sold : vendu · removed : retiré '
  'par la modération. « removed » existe parce qu''un article ayant fait l''objet '
  'd''une commande ne peut pas être supprimé sans rompre l''historique.';

-- Un article retiré ne doit plus apparaître au catalogue. Les politiques de
-- lecture publique filtrent déjà sur 'published', donc rien à changer ; on
-- vérifie seulement que c'est bien le cas.
DO $$
DECLARE v_ouvertes int;
BEGIN
  SELECT count(*) INTO v_ouvertes
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'products' AND cmd = 'SELECT'
     AND qual IS NOT NULL
     AND qual NOT ILIKE '%status%' AND qual NOT ILIKE '%auth.uid()%';

  IF v_ouvertes > 0 THEN
    RAISE WARNING 'Une politique de lecture sur products ne filtre ni par statut ni par propriétaire : un article retiré pourrait rester visible';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. On ne supprime pas le profil d'un compte suspendu
--
-- La garde est en base et non dans la page : c'est la seule qui tienne si
-- quelqu'un appelle l'API directement, et c'est aussi celle qui rattrape
-- l'administrateur qui clique sur le mauvais bouton.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.profiles_refuse_suppression_si_banni()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.blocked IS TRUE AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION
      'Ce compte est suspendu : supprimer son profil lèverait la suspension. Utilisez le bannissement.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS profiles_garde_suppression ON public.profiles;
CREATE TRIGGER profiles_garde_suppression
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_refuse_suppression_si_banni();

-- ---------------------------------------------------------------------
-- 3. Bannir : retirer les annonces, garder la trace
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
  v_admin := (auth.jwt() ->> 'email') = ANY (ARRAY['sayrox.ar@gmail.com', 'renduambroise@gmail.com'])
             OR current_user IN ('postgres', 'service_role');
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
-- 4. Modérer un article signalé
--
-- Écrit la résolution AVANT de toucher à l'article : supprimer l'article
-- effaçait le signalement par cascade, et l'écriture de traçabilité qui
-- suivait ne touchait plus aucune ligne. La trace de la décision disparaissait
-- avec ce sur quoi elle portait.
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
  v_admin := (auth.jwt() ->> 'email') = ANY (ARRAY['sayrox.ar@gmail.com', 'renduambroise@gmail.com'])
             OR current_user IN ('postgres', 'service_role');
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
    -- en vente, ce qui était le vrai problème.
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
