-- =====================================================================
-- Statut d'une annonce : « vendu » et « retiré » ne s'écrivent pas depuis
-- un compte de vendeur
--
-- Constaté par l'audit du site du 10 octobre 2026 (CODE-09 et CODE-10) :
--
--   1. La fenêtre « Modifier l'annonce » de Mon compte proposait le statut
--      « Vendu ». Un vendeur pouvait le choisir sans aucune vente :
--      products_track_sold_at (20260425000002) posait alors sold_at, et
--      l'annonce entrait dans l'archive publique des ventes (/ventes,
--      politique « Lecture publique des annonces visibles », 20260918000000)
--      comme une vente réelle, avec un prix que personne n'a payé. Retirer
--      l'option de la fenêtre ne suffit pas : la politique « Users can
--      update own products » ouvre au vendeur toute sa ligne, et une requête
--      directe à l'API faisait la même chose. Même trou à la création : une
--      annonce insérée d'emblée en 'sold'.
--
--   2. Une annonce retirée par la modération (statut 'removed', posé par
--      admin_moderer_signalement ou admin_bannir_compte, 20261005000100)
--      pouvait être remise en ligne par son vendeur d'une simple requête.
--
-- LA GARDE
--
--   Un déclencheur BEFORE INSERT OR UPDATE OF status refuse, à un compte
--   ordinaire :
--     - l'entrée en 'sold', à la création comme à la modification ;
--     - la sortie de 'removed'.
--   Le reste ne change pas : publier, passer en brouillon, modifier une
--   annonce vendue ou retirée sans toucher à son statut (la fenêtre de
--   modification renvoie le statut inchangé, ce qui n'est pas un passage).
--
-- QUI PASSE
--
--   - Le paiement. 'sold' n'est posé que par order_settle_payment, quand le
--     stock tombe à zéro (20260813000200), et la remise en cohérence de
--     20260813000000. Les fonctions edge n'écrivent jamais products.status
--     elles-mêmes : stripe-webhook appelle order_settle_payment avec la clé
--     de service. La fonction est SECURITY DEFINER : à l'intérieur,
--     current_user vaut son propriétaire (postgres), et ce déclencheur, qui
--     s'exécute avec les droits de la requête, le voit. Même chose pour
--     order_apply_refund (sortie de 'sold' après remboursement, qui n'est
--     pas visée) et pour les deux fonctions de modération.
--   - Le service appelé directement par l'API (current_user service_role),
--     l'éditeur SQL du tableau de bord et pg_cron (postgres, supabase_admin).
--   - Les deux administrateurs, reconnus à l'adresse de leur jeton,
--     exactement comme products_garde_authenticite (20261005000000) : la
--     politique « Admin can update any product » (ADD_ADMIN.sql) leur ouvre
--     la ligne, et la modération peut ainsi remettre en ligne une annonce
--     qu'elle avait retirée.
--
-- Pas de SECURITY DEFINER : current_user doit rester celui de la requête.
-- Dans une fonction SECURITY DEFINER, il vaut toujours le propriétaire, et
-- une garde qui le teste laisse alors tout passer (20261005000100). Même
-- choix que products_protect_reserved_qty et products_garde_authenticite.
--
-- Rejouable : CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.products_garde_statut()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
BEGIN
  v_admin := current_user IN ('postgres', 'service_role', 'supabase_admin')
          OR coalesce(auth.jwt() ->> 'email', '') = ANY (ARRAY['sayrox.ar@gmail.com', 'renduambroise@gmail.com']);

  IF v_admin THEN
    RETURN NEW;
  END IF;

  -- Vendu : seulement par un paiement reçu sur le site.
  IF NEW.status = 'sold'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'sold') THEN
    RAISE EXCEPTION 'Le statut « vendu » est posé par le site après un paiement : une annonce vendue ailleurs se retire de la vente (brouillon).'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Choisissez « Retirée de la vente » dans la fenêtre de modification.';
  END IF;

  -- Retirée par la modération : seule la modération la remet en ligne.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'removed'
     AND NEW.status IS DISTINCT FROM 'removed' THEN
    RAISE EXCEPTION 'Cette annonce a été retirée par la modération : seule la modération peut la remettre en ligne.'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Écrivez à contact@athenamilitaria.fr.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.products_garde_statut() IS
  'Refuse à un compte ordinaire l''entrée d''une annonce en « sold » (posé par '
  'order_settle_payment après paiement) et sa sortie de « removed » (retrait '
  'par la modération). Laisse passer postgres, service_role, supabase_admin '
  'et les deux administrateurs. SECURITY INVOKER : current_user est celui de '
  'la requête.';

DROP TRIGGER IF EXISTS products_garde_statut ON public.products;
CREATE TRIGGER products_garde_statut
  BEFORE INSERT OR UPDATE OF status ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_garde_statut();
