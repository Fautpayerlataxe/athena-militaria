-- =====================================================================
-- RETOUR ARRIÈRE de 20260813000000_stripe_hardening.sql
--
-- À n'exécuter que si la nouvelle logique de paiement pose un problème en
-- production ET que redéployer les anciennes fonctions edge ne suffit pas.
--
-- Dans l'immense majorité des cas, le retour arrière correct est plus simple :
--   redéployer la version précédente des fonctions edge, sans toucher à la base.
-- Le nouveau schéma est compatible avec l'ancien code (test de non-régression
-- « le nouveau schéma reste compatible avec l'ancien code des fonctions edge »).
-- C'est plus rapide, réversible en un clic, et sans perte.
--
-- CE QUE CE SCRIPT FAIT
--   - supprime les fonctions de réservation, d'encaissement et de webhook
--   - supprime la tâche planifiée de libération des réservations
--   - supprime les garde-fous ajoutés sur les commandes
--   - restaure les trois RPC de cycle de vie dans leur version d'avril
--
-- CE QUE CE SCRIPT NE FAIT PAS, VOLONTAIREMENT
--   - il ne supprime AUCUNE colonne : stripe_payment_intent_id,
--     stripe_charge_id, amount_total_cents, amount_refunded_cents et les
--     autres portent la traçabilité financière. Les perdre rendrait
--     impossible de rapprocher un remboursement ou un litige passé.
--   - il ne supprime pas la table stripe_events : c'est le journal des
--     événements déjà traités. La vider ferait rejouer d'anciens webhooks.
--   - il ne remet PAS la contrainte CHECK (quantity >= 1). Cette contrainte
--     était le défaut d'origine : elle empêchait de marquer un article vendu,
--     et le rétablir casserait l'ancien code comme le nouveau.
--   - il ne remet pas en vente les articles vendus ni ne modifie les statuts.
--
-- Un retour arrière sur un système de paiement ne doit jamais détruire de
-- preuve financière. Il annule un comportement, pas une histoire.
-- =====================================================================

BEGIN;

-- 1. Tâche planifiée
DO $$
BEGIN
  PERFORM cron.unschedule('checkout-expire-stale');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Fonctions de la nouvelle logique
DROP FUNCTION IF EXISTS public.checkout_reserve(bigint, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.checkout_attach_session(uuid, text);
DROP FUNCTION IF EXISTS public.checkout_release(uuid, text);
DROP FUNCTION IF EXISTS public.checkout_expire_stale(bigint);
DROP FUNCTION IF EXISTS public.order_settle_payment(jsonb);
DROP FUNCTION IF EXISTS public.order_mark_payment_failed(text, text, text);
DROP FUNCTION IF EXISTS public.order_apply_refund(text, text, int, boolean);
DROP FUNCTION IF EXISTS public.order_mark_chargeback(text, text, text, text);
DROP FUNCTION IF EXISTS public.stripe_event_claim(text, text, boolean, text, int);
DROP FUNCTION IF EXISTS public.stripe_event_finish(text, text, text);
DROP FUNCTION IF EXISTS public.orders_needing_attention();

-- 3. Garde-fou sur reserved_qty
DROP TRIGGER IF EXISTS products_guard_reserved_qty ON public.products;
DROP FUNCTION IF EXISTS public.products_protect_reserved_qty();

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
DROP FUNCTION IF EXISTS public.orders_touch_updated_at();

-- 4. RPC de cycle de vie : version d'avril restaurée.
--    Les gardes durcies contre l'appel anonyme sont CONSERVÉES : elles
--    corrigent une faille indépendante de la logique de paiement, et la
--    version d'avril laissait un appelant anonyme agir sur les commandes
--    invité. Revenir dessus rouvrirait le trou.
CREATE OR REPLACE FUNCTION public.order_report_dispute(
  p_order_id uuid,
  p_reason text
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_uid   uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.buyer_id IS NULL OR v_order.buyer_id <> v_uid THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;
  IF v_order.status IN ('completed', 'refunded', 'disputed') THEN
    RAISE EXCEPTION 'Litige déjà ouvert ou commande clôturée';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Merci de décrire le problème (au moins 10 caractères)';
  END IF;

  UPDATE public.orders
     SET status = 'disputed', dispute_reason = trim(p_reason), disputed_at = now()
   WHERE id = p_order_id
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

-- 5. Statuts : on conserve l'ensemble élargi. Le restreindre ferait échouer
--    la contrainte sur les commandes déjà écrites avec 'pending' ou 'expired'.

COMMIT;

-- ---------------------------------------------------------------------
-- APRÈS EXÉCUTION
--   Redéployer impérativement la version précédente des fonctions edge
--   create-checkout et stripe-webhook : la nouvelle version appelle des
--   fonctions SQL qui viennent d'être supprimées et échouerait à chaque appel.
--   Retirer aussi la fonction checkout-status, devenue sans objet.
-- ---------------------------------------------------------------------
