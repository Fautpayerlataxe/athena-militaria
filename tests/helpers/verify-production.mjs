/* Vérification d'après-déploiement, en lecture seule sur la production. */

import { execFileSync } from "node:child_process";
import { connecter } from "./connexion.mjs";

const password = execFileSync("/usr/bin/security",
  ["find-generic-password", "-a", process.env.USER ?? "", "-s", "athena-supabase-db", "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const c = await connecter();

const show = async (title, sql, params = []) => {
  const r = await c.query(sql, params);
  console.log(`\n=== ${title} ===`);
  for (const row of r.rows) console.log("  " + Object.values(row).map((v) => String(v)).join("  ·  "));
  if (!r.rows.length) console.log("  (aucune)");
};

await show("Fonctions financières : sécurité et search_path", `
  SELECT p.proname,
         CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'invoker' END,
         COALESCE(array_to_string(p.proconfig, ','), 'aucun search_path')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname = ANY($1::text[]) ORDER BY 1`,
  [["checkout_reserve", "checkout_release", "checkout_attach_session", "checkout_expire_stale",
    "order_settle_payment", "order_mark_payment_failed", "order_apply_refund", "order_mark_chargeback",
    "stripe_event_claim", "stripe_event_finish", "orders_ready_for_payout",
    "order_mark_payout_released", "order_block_payout", "order_mark_payout_reversed",
    "orders_flag_manual_review", "rate_limit_hit", "buyer_protection_fee_cents",
    "order_mark_shipped", "order_confirm_receipt", "order_report_dispute"]]);

await show("Droits d'exécution : ce que le navigateur peut appeler", `
  SELECT p.proname,
         CASE
           WHEN p.proacl IS NULL THEN 'PUBLIC (défaut)'
           WHEN array_to_string(p.proacl,',') LIKE '%anon=X%' THEN 'anon + authenticated'
           WHEN array_to_string(p.proacl,',') LIKE '%authenticated=X%' THEN 'authenticated'
           ELSE 'backend seulement'
         END
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname = ANY($1::text[]) ORDER BY 2, 1`,
  [["checkout_reserve", "order_settle_payment", "order_apply_refund", "orders_ready_for_payout",
    "order_mark_payout_released", "rate_limit_hit", "buyer_protection_fee_cents",
    "order_mark_shipped", "order_confirm_receipt", "order_report_dispute", "orders_flag_manual_review"]]);

await show("Invariants financiers, en contraintes", `
  SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid='public.orders'::regclass AND contype='c'
     AND conname IN ('orders_amount_decomposition_check','orders_seller_amount_check',
                     'orders_protection_never_to_seller_check','orders_no_seller_commission_check',
                     'orders_transfer_not_over_check')
   ORDER BY 1`);

await show("Unicité : un paiement, une commande · un transfert, une commande", `
  SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname='public' AND tablename='orders' AND indexdef ILIKE '%UNIQUE%' ORDER BY 1`);

await show("Barème appliqué", `
  SELECT key, value FROM public.platform_settings
   WHERE key IN ('pricing_version','protection_rate_bps','protection_fixed_cents',
                 'report_window_hours','buyer_silence_days','shipping_deadline_business_days',
                 'payout_min_hold_hours','platform_fee_rate') ORDER BY key`);

await show("Contrôle du calcul, au centime", `
  SELECT p.prix || ' c' AS article,
         public.buyer_protection_fee_cents(p.prix) || ' c' AS protection,
         (p.prix + 890 + public.buyer_protection_fee_cents(p.prix)) || ' c' AS total_acheteur,
         (p.prix + 890) || ' c' AS vendeur
    FROM (VALUES (100),(1000),(4500),(10000),(50000)) AS p(prix)`);

await show("Tables sensibles : RLS active", `
  SELECT relname, CASE WHEN relrowsecurity THEN 'RLS active' ELSE 'RLS INACTIVE' END
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public'
     AND relname IN ('orders','products','profiles','stripe_events','platform_settings',
                     'shipping_rates','rate_limits')
   ORDER BY 1`);

await show("Registre des migrations", `
  SELECT version, name FROM supabase_migrations.schema_migrations
   WHERE version >= '20260813' ORDER BY version`);

await c.end();
console.log("\nLecture seule : aucune écriture effectuée.");
