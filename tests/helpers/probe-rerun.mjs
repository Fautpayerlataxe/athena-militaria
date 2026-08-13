/* Que change exactement une seconde exécution de la migration ? */

import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startPostgres, stopPostgres, REPO_ROOT } from "./postgres.mjs";
import { migrateFresh } from "./migrate.mjs";

await startPostgres();
const { config } = await migrateFresh("am2_rerun_probe");
const db = new pg.Client(config);
await db.connect();

const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "20260813000000_stripe_hardening.sql"), "utf8");

const snapshot = async () => {
  const fns = await db.query(
    `SELECT proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2`);
  const cols = await db.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' ORDER BY 1,2`);
  const cons = await db.query(
    `SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
      JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY 1`);
  const jobs = await db.query("SELECT jobname, schedule FROM cron.job ORDER BY 1");
  return {
    fns: fns.rows.map((r) => `${r.proname}(${r.args})`),
    cols: cols.rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}`),
    cons: cons.rows.map((r) => `${r.conname} ${r.def}`),
    jobs: jobs.rows.map((r) => `${r.jobname} ${r.schedule}`),
  };
};

const before = await snapshot();
await db.query(sql);
const after = await snapshot();

for (const key of Object.keys(before)) {
  const a = new Set(before[key]);
  const b = new Set(after[key]);
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  if (added.length || removed.length) {
    console.log(`\n### ${key}`);
    removed.forEach((x) => console.log("  - " + x));
    added.forEach((x) => console.log("  + " + x));
  }
}
console.log("\n(aucune section affichée = seconde exécution parfaitement neutre)");

await db.end();
await stopPostgres();
