/* Applique une migration nommée sur la production, dans UNE transaction.
   Remplace le passage par psql, dont le binaire n'est plus sur ce poste. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const nom = process.argv[2];
if (!nom) { console.error("usage : node tests/helpers/appliquer-migration.mjs <fichier.sql>"); process.exit(1); }

const password = execFileSync("/usr/bin/security", ["find-generic-password","-a",process.env.USER??"","-s","athena-supabase-db","-w"],
  { encoding:"utf8", stdio:["ignore","pipe","ignore"] }).trim();
const c = new pg.Client({ host:"db.uctaxgfqdoxtcidllyjv.supabase.co", port:5432, user:"postgres",
  database:"postgres", password, ssl:{rejectUnauthorized:false} });
await c.connect();

const sql = readFileSync(new URL(`../../supabase/migrations/${nom}`, import.meta.url), "utf8");
try {
  await c.query("BEGIN");
  await c.query("SET LOCAL lock_timeout = '10s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  await c.query(sql);
  await c.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ($1, $2, NULL) ON CONFLICT (version) DO NOTHING`,
    [nom.split("_")[0], nom.replace(/^\d+_/, "").replace(/\.sql$/, "")]);
  await c.query("COMMIT");
  console.log(`  ${nom} appliquée`);
} catch (err) {
  await c.query("ROLLBACK");
  console.error(`  ÉCHEC : ${err.message.split("\n")[0]}`);
  console.error("  La transaction a été annulée : la base est intacte.");
  process.exitCode = 1;
} finally {
  await c.end();
}
