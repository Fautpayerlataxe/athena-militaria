-- =====================================================================
-- Économie du modèle, mois par mois
--
-- La décision de lancement est de garder 5 % + 0,70 € même si les petites
-- ventes sont légèrement déficitaires. Une décision de ce genre n'est tenable
-- que si l'on sait combien elle coûte : sans mesure, « légèrement » devient
-- une opinion, et l'on découvre l'ampleur au relevé bancaire.
--
-- Cette table garde une ligne par mois : ce que la Protection acheteurs a
-- rapporté, ce que Stripe a réellement prélevé, et l'écart. Les frais ne sont
-- pas estimés à partir d'un barème recopié — ils sont lus dans les
-- transactions de solde Stripe par payments-monitor, donc exacts, y compris
-- les cartes hors zone euro, les litiges et les frais de compte connecté.
--
-- Le seuil d'alerte est un réglage, pas une constante : il se change sans
-- redéployer quoi que ce soit.
-- =====================================================================

INSERT INTO public.platform_settings (key, value) VALUES
  ('connect_loss_alert_cents', 10000)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_monthly_economics (
  month             date PRIMARY KEY,
  protection_cents  bigint NOT NULL DEFAULT 0,
  stripe_fees_cents bigint NOT NULL DEFAULT 0,
  net_cents         bigint NOT NULL DEFAULT 0,
  orders_count      int    NOT NULL DEFAULT 0,
  connected_accounts int   NOT NULL DEFAULT 0,
  alerted_at        timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_monthly_economics IS
  'Recette de la Protection acheteurs contre frais Stripe réels, par mois. '
  'net_cents négatif = le mois a coûté de l''argent à la plateforme.';

ALTER TABLE public.platform_monthly_economics ENABLE ROW LEVEL SECURITY;

-- Aucune politique : personne ne lit cette table depuis le navigateur. Elle
-- ne sert qu'au travail de surveillance et à l'exploitant.
REVOKE ALL ON public.platform_monthly_economics FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Enregistrement d'un mois
--
-- alerted_at n'est posé qu'une fois par mois franchi : sans cela, un travail
-- qui tourne toutes les six heures enverrait quatre courriels par jour pour
-- la même perte, et l'alerte finirait en filtre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_monthly_economics(
  p_month              date,
  p_protection_cents   bigint,
  p_stripe_fees_cents  bigint,
  p_orders_count       int,
  p_connected_accounts int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net       bigint := p_protection_cents - p_stripe_fees_cents;
  v_seuil     bigint;
  v_deja      timestamptz;
  v_alerter   boolean := false;
BEGIN
  SELECT value INTO v_seuil FROM public.platform_settings WHERE key = 'connect_loss_alert_cents';
  v_seuil := COALESCE(v_seuil, 10000);

  SELECT alerted_at INTO v_deja FROM public.platform_monthly_economics
   WHERE month = date_trunc('month', p_month)::date;

  -- Perte au-delà du seuil, et pas encore signalée pour ce mois.
  IF v_net < -v_seuil AND v_deja IS NULL THEN
    v_alerter := true;
  END IF;

  INSERT INTO public.platform_monthly_economics AS m
    (month, protection_cents, stripe_fees_cents, net_cents, orders_count,
     connected_accounts, alerted_at, updated_at)
  VALUES (date_trunc('month', p_month)::date, p_protection_cents, p_stripe_fees_cents,
          v_net, p_orders_count, p_connected_accounts,
          CASE WHEN v_alerter THEN now() ELSE NULL END, now())
  ON CONFLICT (month) DO UPDATE SET
    protection_cents   = EXCLUDED.protection_cents,
    stripe_fees_cents  = EXCLUDED.stripe_fees_cents,
    net_cents          = EXCLUDED.net_cents,
    orders_count       = EXCLUDED.orders_count,
    connected_accounts = EXCLUDED.connected_accounts,
    alerted_at         = COALESCE(m.alerted_at, CASE WHEN v_alerter THEN now() ELSE NULL END),
    updated_at         = now();

  RETURN jsonb_build_object(
    'month', date_trunc('month', p_month)::date,
    'net_cents', v_net,
    'seuil_cents', v_seuil,
    'alerter', v_alerter);
END $$;

REVOKE EXECUTE ON FUNCTION public.record_monthly_economics(date, bigint, bigint, int, int)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Ce que la plateforme a facturé sur un mois, d'après ses propres livres.
--
-- Seules les commandes réellement encaissées comptent : une commande annulée
-- avant paiement n'a rien rapporté. Les remboursements viennent en déduction,
-- au prorata de ce qui a été rendu.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.monthly_protection_revenue(p_month date)
RETURNS TABLE (protection_cents bigint, orders_count int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(
      GREATEST(0, o.protection_fee_cents
                  - CASE WHEN o.amount_refunded_cents >= o.amount_total_cents
                         THEN o.protection_fee_cents ELSE 0 END)
    ), 0)::bigint,
    COUNT(*)::int
  FROM public.orders o
  WHERE o.paid_at >= date_trunc('month', p_month)
    AND o.paid_at <  date_trunc('month', p_month) + interval '1 month'
    AND o.protection_fee_cents IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.monthly_protection_revenue(date)
  FROM PUBLIC, anon, authenticated;
