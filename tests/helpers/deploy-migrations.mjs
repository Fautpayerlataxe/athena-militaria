/**
 * Application des migrations sur la base de production.
 *
 * Chaque migration est appliquée dans UNE transaction : si une seule
 * instruction échoue, rien de ce fichier ne subsiste. Une migration à moitié
 * appliquée sur un système de paiement est pire qu'une migration refusée.
 *
 * lock_timeout borne l'attente d'un verrou : ALTER TABLE prend un verrou
 * exclusif, et sans borne une requête en cours pourrait figer le site le
 * temps que la migration attende. On préfère échouer vite et réessayer.
 *
 * Le registre supabase_migrations.schema_migrations est mis à jour à la fin,
 * pour que la CLI cesse de croire ces migrations non appliquées.
 *
 * Aucun mot de passe n'apparaît en argument de ligne de commande : les
 * arguments de processus sont lisibles par tout utilisateur de la machine.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";

import { REPO_ROOT } from "./postgres.mjs";

const CLIENT_BIN = process.env.PG_CLIENT_BIN
  ?? "/private/tmp/claude-501/-Users-augustinrendu-Desktop-Documents-Administratifs-Business-Militaria-Website--AM2/adab6c48-31aa-4bbb-99f4-f45b62b6d4c0/scratchpad/pgclient/edb/pgsql/bin";

const MIGRATIONS = [
  "20260813000000_stripe_hardening.sql",
  "20260813000100_payout_escrow.sql",
  "20260813000200_buyer_protection_pricing.sql",
  "20260813000300_cron_secret_vault.sql",
];

const DRY_RUN = process.argv.includes("--dry-run");

function keychainSecret(service) {
  return execFileSync("/usr/bin/security",
    ["find-generic-password", "-a", process.env.USER ?? "", "-s", service, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

const password = keychainSecret("athena-supabase-db");
const conn = {
  host: "db.uctaxgfqdoxtcidllyjv.supabase.co", port: 5432, user: "postgres",
  database: "postgres", password, ssl: { rejectUnauthorized: false },
};

const work = mkdtempSync(join(tmpdir(), "am2-deploy-"));
chmodSync(work, 0o700);

function psqlFile(sqlPath, label) {
  return execFileSync(join(CLIENT_BIN, "psql"), [
    "--host", conn.host, "--port", String(conn.port), "--username", conn.user,
    "--dbname", conn.database,
    // Une seule erreur arrête tout et annule la transaction.
    "--set", "ON_ERROR_STOP=1",
    "--single-transaction",
    "--quiet", "--no-psqlrc",
    "--file", sqlPath,
  ], {
    env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

console.log(`MIGRATIONS DE PRODUCTION${DRY_RUN ? "  (simulation)" : ""}\n`);

try {
  /* --- Contrôles préalables ------------------------------------------- */
  const client = new pg.Client(conn);
  await client.connect();

  const before = await client.query(`
    SELECT (SELECT count(*)::int FROM public.orders) AS commandes,
           (SELECT count(*)::int FROM public.products) AS produits,
           (SELECT count(*)::int FROM public.profiles) AS profils,
           (SELECT count(*)::int FROM information_schema.columns
             WHERE table_schema='public' AND table_name='orders') AS colonnes_orders,
           current_setting('server_version') AS version`);
  const b = before.rows[0];
  console.log(`Avant : PostgreSQL ${b.version} · ${b.commandes} commande(s) · ` +
    `${b.produits} produit(s) · ${b.profils} profil(s) · ${b.colonnes_orders} colonnes sur orders`);

  if (b.commandes > 0) {
    console.log("\n⚠ Des commandes existent : vérifier qu'aucun paiement n'est en cours avant de continuer.");
  }

  const applied = (await client.query(
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")).rows.map((r) => r.version);
  console.log(`Registre : ${applied.length} migration(s) enregistrée(s), dernière ${applied.at(-1)}`);

  const toApply = MIGRATIONS.filter((m) => !applied.includes(m.split("_")[0]));
  console.log(`À appliquer : ${toApply.length ? toApply.join(", ") : "aucune"}\n`);

  if (DRY_RUN) {
    console.log("Simulation : rien n'est écrit.");
    await client.end();
    process.exit(0);
  }
  await client.end();

  /* --- Application ----------------------------------------------------- */
  for (const name of toApply) {
    const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", name), "utf8");
    // lock_timeout en tête de transaction : on n'attend jamais un verrou plus
    // de dix secondes. statement_timeout borne les UPDATE de reprise.
    const wrapped = `SET lock_timeout = '10s';\nSET statement_timeout = '120s';\n\n${sql}\n`;
    const file = join(work, name);
    writeFileSync(file, wrapped, { mode: 0o600 });

    process.stdout.write(`  ${name} … `);
    try {
      const out = psqlFile(file, name);
      const notices = out.split("\n").filter((l) => /NOTICE|WARNING/i.test(l));
      console.log("appliquée" + (notices.length ? ` (${notices.length} avis)` : ""));
      notices.slice(0, 4).forEach((n) => console.log("      " + n.trim()));
    } catch (err) {
      console.log("ÉCHEC");
      const out = String(err.stdout ?? "") + String(err.stderr ?? "");
      out.split("\n").filter((l) => l.trim()).slice(-8).forEach((l) => console.log("      " + l));
      throw new Error(`${name} n'a pas été appliquée. La transaction a été annulée : la base est intacte.`);
    }
  }

  /* --- Registre -------------------------------------------------------- */
  const after = new pg.Client(conn);
  await after.connect();

  for (const name of toApply) {
    const version = name.split("_")[0];
    await after.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ($1, $2, NULL) ON CONFLICT (version) DO NOTHING`,
      [version, name.replace(/^\d+_/, "").replace(/\.sql$/, "")]);
  }

  /* --- Vérification ---------------------------------------------------- */
  const checks = await after.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orders'
          AND column_name IN ('stripe_payment_intent_id','protection_fee_cents',
                              'seller_amount_cents','pricing_version','payout_state')) AS colonnes_cles,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosecdef
          AND p.proname IN ('checkout_reserve','order_settle_payment','stripe_event_claim',
                            'orders_ready_for_payout','order_mark_payout_released',
                            'rate_limit_hit')) AS fonctions,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public' AND c.conname LIKE 'orders_%check') AS contraintes,
      (SELECT count(*)::int FROM cron.job) AS crons,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='orders') AS policies,
      (SELECT count(*)::int FROM public.orders) AS commandes,
      (SELECT count(*)::int FROM public.products) AS produits,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='products_quantity_check') AS stock_check,
      (SELECT count(*)::int FROM public.messages m
        WHERE m.product_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=m.product_id)) AS orphelins`);
  const c = checks.rows[0];

  console.log("\n=== VÉRIFICATION APRÈS MIGRATION ===");
  console.log(`  colonnes financières clés : ${c.colonnes_cles}/5`);
  console.log(`  fonctions SECURITY DEFINER : ${c.fonctions}/6`);
  console.log(`  contraintes sur orders     : ${c.contraintes}`);
  console.log(`  politiques RLS sur orders  : ${c.policies}`);
  console.log(`  tâches planifiées          : ${c.crons}`);
  console.log(`  contrainte de stock        : ${c.stock_check}`);
  console.log(`  messages orphelins         : ${c.orphelins}`);
  console.log(`  commandes / produits       : ${c.commandes} / ${c.produits}`);

  const jobs = await after.query("SELECT jobname, schedule, active FROM cron.job ORDER BY jobname");
  console.log("\n  tâches :");
  jobs.rows.forEach((j) => console.log(`    ${j.active ? "●" : "○"} ${j.jobname.padEnd(24)} ${j.schedule}`));

  const fee = await after.query("SELECT buyer_protection_fee_cents(4500) AS f");
  console.log(`\n  Protection acheteurs sur 45,00 € : ${(fee.rows[0].f / 100).toFixed(2).replace(".", ",")} €`);

  await after.end();

  const ok = c.colonnes_cles === 5 && c.fonctions === 6 && c.orphelins === 0
    && /quantity >= 0/.test(c.stock_check) && fee.rows[0].f === 295;
  console.log(`\n  ${ok ? "MIGRATIONS APPLIQUÉES ET VÉRIFIÉES" : "⚠ VÉRIFICATION INCOMPLÈTE"}`);
  if (!ok) process.exitCode = 1;
} catch (err) {
  console.error("\nÉCHEC : " + err.message);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
