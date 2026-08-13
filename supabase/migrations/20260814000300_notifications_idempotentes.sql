-- =====================================================================
-- Un courriel par événement, pas un par appel
--
-- order-notify vérifiait que la commande était bien dans l'état correspondant
-- à l'événement annoncé. C'est une bonne garde contre le mensonge, mais pas
-- contre la répétition : l'état reste vrai après l'envoi, donc rappeler
-- l'endpoint renvoie le même courriel, autant de fois qu'on veut. Un acheteur
-- agacé, un rechargement de page, un webhook rejoué, et le vendeur reçoit dix
-- fois « Vente validée ».
--
-- La table ci-dessous transforme la garde d'état en garde d'unicité : la
-- première réservation d'un couple (commande, événement) gagne, les suivantes
-- se voient refuser. C'est la même mécanique que stripe_events pour les
-- webhooks, à l'échelle des notifications.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.order_notifications (
  order_id  uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event     text NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  recipients int NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, event)
);

COMMENT ON TABLE public.order_notifications IS
  'Une ligne par courriel de commande réellement envoyé. La clé primaire porte '
  'l''idempotence : order-notify réserve le couple avant d''écrire à quiconque.';

ALTER TABLE public.order_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_notifications FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Réservation
--
-- Rend vrai si l'appelant vient de réserver l'envoi, faux si quelqu'un l'a
-- déjà fait. ON CONFLICT DO NOTHING règle la course entre deux appels
-- simultanés sans verrou explicite : un seul INSERT rend une ligne.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_notification_claim(
  p_order_id uuid,
  p_event    text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_pris boolean;
BEGIN
  INSERT INTO public.order_notifications (order_id, event)
  VALUES (p_order_id, p_event)
  ON CONFLICT (order_id, event) DO NOTHING
  RETURNING true INTO v_pris;

  RETURN COALESCE(v_pris, false);
END $$;

REVOKE EXECUTE ON FUNCTION public.order_notification_claim(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.order_notification_claim(uuid, text) TO service_role, postgres;

-- ---------------------------------------------------------------------
-- Libération
--
-- Si l'envoi échoue après la réservation, la garder équivaudrait à perdre la
-- notification pour de bon. On rend la place, et le prochain appel réessaiera.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_notification_release(
  p_order_id uuid,
  p_event    text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.order_notifications
   WHERE order_id = p_order_id AND event = p_event;
$$;

REVOKE EXECUTE ON FUNCTION public.order_notification_release(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.order_notification_release(uuid, text) TO service_role, postgres;
