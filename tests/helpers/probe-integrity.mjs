/* Contrôle d'intégrité référentielle sur la production. LECTURE SEULE.
 *
 * Déclenché par un échec de restauration : pg_restore refuse de recréer
 * messages_product_id_fkey parce qu'une ligne pointe vers un produit absent.
 * Une clé étrangère violée dans une base vivante signifie qu'elle n'a jamais
 * été vérifiée, ou qu'elle a été posée après coup sans validation.
 */

import { execFileSync } from "node:child_process";
import pg from "pg";

const password = execFileSync("/usr/bin/security",
  ["find-generic-password", "-a", process.env.USER ?? "", "-s", "athena-supabase-db", "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const c = new pg.Client({
  host: "db.uctaxgfqdoxtcidllyjv.supabase.co", port: 5432, user: "postgres",
  database: "postgres", password, ssl: { rejectUnauthorized: false },
});
await c.connect();

const show = async (title, sql) => {
  const r = await c.query(sql);
  console.log(`\n=== ${title} ===`);
  for (const row of r.rows) console.log("  " + JSON.stringify(row));
  if (!r.rows.length) console.log("  (aucune ligne)");
};

await show("Clés étrangères NON VALIDÉES (convalidated = false)", `
  SELECT conrelid::regclass::text AS "table", conname, convalidated
    FROM pg_constraint
   WHERE contype = 'f' AND connamespace = 'public'::regnamespace
     AND NOT convalidated`);

await show("Toutes les clés étrangères de public et leur action ON DELETE", `
  SELECT conrelid::regclass::text AS "table", conname,
         CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
              WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
              WHEN 'd' THEN 'SET DEFAULT' END AS on_delete,
         convalidated
    FROM pg_constraint
   WHERE contype = 'f' AND connamespace = 'public'::regnamespace
   ORDER BY 1, 2`);

await show("Messages orphelins (product_id inexistant)", `
  SELECT count(*)::int AS orphelins,
         array_agg(DISTINCT m.product_id) AS produits_absents
    FROM public.messages m
   WHERE m.product_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = m.product_id)`);

await show("Autres orphelins possibles", `
  SELECT 'orders.product_id' AS lien, count(*)::int AS orphelins FROM public.orders o
   WHERE o.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = o.product_id)
  UNION ALL
  SELECT 'favorites.product_id', count(*)::int FROM public.favorites f
   WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = f.product_id)
  UNION ALL
  SELECT 'reviews.product_id', count(*)::int FROM public.reviews r
   WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = r.product_id)
  UNION ALL
  SELECT 'reports.product_id', count(*)::int FROM public.reports r
   WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = r.product_id)`);

await show("Volumétrie réelle des tables du parcours d'achat", `
  SELECT 'products' AS t, count(*)::int FROM public.products
  UNION ALL SELECT 'orders', count(*)::int FROM public.orders
  UNION ALL SELECT 'messages', count(*)::int FROM public.messages
  UNION ALL SELECT 'profiles', count(*)::int FROM public.profiles
  UNION ALL SELECT 'profiles avec compte Stripe',
    count(*)::int FROM public.profiles WHERE stripe_account_id IS NOT NULL
  UNION ALL SELECT 'profiles Stripe finalisés',
    count(*)::int FROM public.profiles WHERE stripe_onboarded`);

await show("Tâches planifiées réellement actives", `
  SELECT jobname, schedule, active FROM cron.job ORDER BY jobname`);

await show("Extensions installées", `
  SELECT extname, extversion FROM pg_extension ORDER BY 1`);

await c.end();
console.log("\nAucune écriture effectuée.");
