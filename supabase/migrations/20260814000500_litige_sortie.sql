-- =====================================================================
-- La fenêtre de 48 heures, et la sortie du litige
--
-- TROIS IMPASSES, constatées ensemble parce qu'elles sont le même défaut :
-- une machine à états où l'on peut entrer sans pouvoir sortir.
--
-- 1. LA FENÊTRE DE 48 HEURES N'EXISTAIT PAS.
--    order_confirm_receipt pose status = 'completed' et ouvre une fenêtre de
--    signalement de 48 h. order_report_dispute refusait précisément le statut
--    'completed'. L'acheteur qui confirmait sa réception perdait donc à
--    l'instant même le droit de signaler un problème, alors que le site lui
--    promet 48 heures. La promesse était sincère et le code la contredisait.
--
-- 2. 'disputed' ÉTAIT UN ÉTAT TERMINAL.
--    Aucune fonction ne permettait d'en sortir. Un acheteur pouvait y envoyer
--    n'importe quelle commande, définitivement : le vendeur n'était plus jamais
--    payé, même après accord entre les deux parties.
--
-- 3. payout_state = 'blocked' AUSSI.
--    Posé par la surveillance dès qu'un litige bancaire est constaté, il ne se
--    levait jamais. Un blocage de précaution devenait une perte sèche pour le
--    vendeur.
--
-- CE QUE CETTE MIGRATION ÉTABLIT :
--
--     payée ──expédition──▶ expédiée ──réception──▶ terminée
--                              │                       │
--                              │                       └── 48 h pour signaler
--                              │                             │
--                              └──────── signalement ────────┘
--                                            │
--                                         litige
--                                            │
--                            ┌───────────────┼───────────────┐
--                        retiré         vendeur payé     remboursement
--                            │               │            (Stripe tranche)
--                            └───── versement rendu ──────┘
--
-- Le versement reste interdit tant que le litige est ouvert : c'est le
-- comportement voulu, et il n'est pas touché ici.
-- =====================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispute_resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_resolution   text,
  ADD COLUMN IF NOT EXISTS dispute_resolved_by  uuid;

COMMENT ON COLUMN public.orders.dispute_resolution IS
  'Issue du litige : retire, vendeur_paye, acheteur_rembourse. NULL tant qu''il est ouvert.';

-- ---------------------------------------------------------------------
-- 1. Signaler un problème pendant la fenêtre promise
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_report_dispute(p_order_id uuid, p_reason text)
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

  -- Un litige ne se conçoit qu'après encaissement. Sur 'payment_pending', il
  -- court-circuitait order_settle_payment : ni paid_at, ni décrément de stock.
  IF v_order.status IN ('refunded', 'partially_refunded', 'disputed',
                        'pending', 'payment_pending', 'expired', 'canceled', 'payment_failed') THEN
    RAISE EXCEPTION 'Litige impossible sur cette commande (statut: %)', v_order.status;
  END IF;

  -- Le cas qui manquait. Après confirmation de réception, la commande est
  -- 'completed' et l'acheteur dispose du délai affiché sur le site pour
  -- revenir. Passé ce délai, la transaction est close et il faut passer par
  -- l'assistance : c'est aussi ce qui rend le versement au vendeur possible.
  IF v_order.status = 'completed' THEN
    IF v_order.report_window_ends_at IS NULL OR v_order.report_window_ends_at <= now() THEN
      RAISE EXCEPTION 'Le délai de signalement est écoulé pour cette commande';
    END IF;
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Merci de décrire le problème (au moins 10 caractères)';
  END IF;

  UPDATE public.orders
     SET status = 'disputed',
         dispute_reason = trim(p_reason),
         disputed_at = now(),
         -- Un litige rouvert efface une éventuelle résolution antérieure.
         dispute_resolved_at = NULL,
         dispute_resolution = NULL,
         dispute_resolved_by = NULL
   WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN v_order;
END $$;

-- ---------------------------------------------------------------------
-- 2. Sortir du litige
--
-- Réservée à l'exploitant. Une décision qui remet de l'argent en mouvement ne
-- peut pas être prise par l'une des deux parties.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_resolve_dispute(
  p_order_id  uuid,
  p_decision  text,
  p_note      text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order public.orders;
BEGIN
  IF p_decision NOT IN ('retire', 'vendeur_paye', 'acheteur_rembourse') THEN
    RAISE EXCEPTION 'Décision inconnue : %', p_decision;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.status <> 'disputed' THEN
    RAISE EXCEPTION 'Cette commande n''est pas en litige (statut: %)', v_order.status;
  END IF;

  IF p_decision = 'acheteur_rembourse' THEN
    -- Le remboursement se fait chez Stripe, et c'est son événement qui posera
    -- 'refunded'. Ici on acte la décision et on maintient le versement bloqué :
    -- rendre l'argent au vendeur avant d'avoir remboursé l'acheteur reviendrait
    -- à payer deux fois.
    UPDATE public.orders
       SET payout_state = 'blocked',
           payout_last_error = 'Litige tranché en faveur de l''acheteur, remboursement à effectuer',
           dispute_resolved_at = now(),
           dispute_resolution = p_decision,
           dispute_resolved_by = auth.uid(),
           needs_review = true
     WHERE id = p_order_id
    RETURNING * INTO v_order;
  ELSE
    -- Litige retiré ou tranché en faveur du vendeur : la commande reprend son
    -- cours normal, la fenêtre de signalement est close, et le versement
    -- redevient éligible au prochain passage de la tâche.
    UPDATE public.orders
       SET status = 'completed',
           confirmed_at = COALESCE(confirmed_at, now()),
           report_window_ends_at = now(),
           payout_state = CASE WHEN payout_state IN ('pending', 'blocked') THEN 'pending' ELSE payout_state END,
           payout_last_error = NULL,
           needs_review = false,
           dispute_resolved_at = now(),
           dispute_resolution = p_decision,
           dispute_resolved_by = auth.uid()
     WHERE id = p_order_id
    RETURNING * INTO v_order;
  END IF;

  RAISE NOTICE 'Litige % : %', p_order_id, p_decision;
  RETURN v_order;
END $$;

-- ---------------------------------------------------------------------
-- 3. Lever un blocage de versement
--
-- Le pendant de order_block_payout, qui n'avait pas de contraire.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_unblock_payout(p_order_id uuid, p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.orders
     SET payout_state = 'pending',
         payout_last_error = NULL,
         needs_review = false
   WHERE id = p_order_id
     AND payout_state IN ('blocked', 'failed')
     -- Un litige encore ouvert prime : on ne débloque pas par mégarde une
     -- commande dont le fond n'est pas tranché.
     AND status <> 'disputed'
  RETURNING true INTO v_ok;

  RETURN COALESCE(v_ok, false);
END $$;

-- ---------------------------------------------------------------------
-- 4. Sortir d'une revue manuelle
--
-- manual_review était posé par le silence de l'acheteur, sans rien pour le
-- lever : le vendeur restait suspendu indéfiniment pour n'avoir rien fait de
-- mal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_clear_manual_review(p_order_id uuid, p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.orders
     SET payout_state = 'pending',
         needs_review = false,
         payout_last_error = NULL,
         confirmed_at = COALESCE(confirmed_at, now()),
         report_window_ends_at = LEAST(COALESCE(report_window_ends_at, now()), now())
   WHERE id = p_order_id
     AND (payout_state = 'manual_review' OR needs_review = true)
     AND status NOT IN ('disputed', 'refunded', 'canceled')
  RETURNING true INTO v_ok;

  RETURN COALESCE(v_ok, false);
END $$;

-- ---------------------------------------------------------------------
-- Droits : l'acheteur signale, l'exploitant tranche.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.order_resolve_dispute(uuid, text, text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_unblock_payout(uuid, text)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_clear_manual_review(uuid, text)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.order_resolve_dispute(uuid, text, text)  TO service_role, postgres;
GRANT  EXECUTE ON FUNCTION public.order_unblock_payout(uuid, text)         TO service_role, postgres;
GRANT  EXECUTE ON FUNCTION public.order_clear_manual_review(uuid, text)    TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.order_report_dispute(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.order_report_dispute(uuid, text) TO authenticated, service_role, postgres;
