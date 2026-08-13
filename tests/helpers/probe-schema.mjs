/* Inspection du schéma réellement produit par les migrations. */

import pg from "pg";
import { startPostgres, stopPostgres } from "./postgres.mjs";
import { migrateFresh } from "./migrate.mjs";

await startPostgres();
const { config } = await migrateFresh("am2_schema");
const c = new pg.Client(config);
await c.connect();

const show = async (title, sql, params = []) => {
  const r = await c.query(sql, params);
  console.log(`\n===== ${title} (${r.rows.length}) =====`);
  for (const row of r.rows) console.log(JSON.stringify(row));
};

await show("contraintes CHECK sur products et orders", `
  SELECT rel.relname AS tbl, con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE n.nspname='public' AND rel.relname IN ('products','orders') AND con.contype='c'
   ORDER BY 1,2`);

await show("index uniques sur orders", `
  SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname='public' AND tablename='orders' AND indexdef ILIKE '%UNIQUE%' ORDER BY 1`);

await show("triggers sur products et orders", `
  SELECT c.relname AS tbl, t.tgname, p.proname, t.tgenabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('products','orders')
   ORDER BY 1,2`);

await show("fonctions SECURITY DEFINER (public)", `
  SELECT p.proname, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef ORDER BY 1`);

await show("droits EXECUTE sur les fonctions financières", `
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
         COALESCE(array_to_string(p.proacl,' | '),'(défaut: PUBLIC)') AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname = ANY($1::text[]) ORDER BY 1`,
  [["checkout_reserve","checkout_release","checkout_attach_session","checkout_expire_stale",
    "order_settle_payment","order_mark_payment_failed","order_apply_refund","order_mark_chargeback",
    "stripe_event_claim","stripe_event_finish","orders_needing_attention",
    "order_mark_shipped","order_confirm_receipt","order_report_dispute"]]);

await show("politiques RLS sur orders / products / profiles", `
  SELECT tablename, policyname, cmd, roles::text, qual, with_check
    FROM pg_policies WHERE schemaname='public' AND tablename IN ('orders','products','profiles')
   ORDER BY tablename, policyname`);

await show("RLS activée ?", `
  SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND relname IN ('orders','products','profiles','stripe_events','platform_settings','shipping_rates')
   ORDER BY 1`);

await show("tâches cron planifiées", "SELECT jobname, schedule FROM cron.job ORDER BY 1");

await show("réglages plateforme", "SELECT key, value FROM public.platform_settings ORDER BY 1");
await show("tarifs de livraison", "SELECT * FROM public.shipping_rates ORDER BY method");

await c.end();
await stopPostgres();
