/**
 * Sauvegarde logique complète d'une base, restauration isolée, et comparaison.
 *
 * Trois étapes, dans cet ordre, parce qu'aucune des deux premières ne prouve
 * quoi que ce soit sans la troisième :
 *
 *   1. pg_dump   — schéma ET données, tous les schémas utiles
 *   2. pg_restore — dans une base locale vierge, jamais celle d'origine
 *   3. comparaison automatique — objets du schéma et nombre de lignes
 *
 * Un fichier de sauvegarde qu'on n'a jamais relu n'est pas une sauvegarde,
 * c'est une intention. La comparaison est donc obligatoire et échoue bruyamment.
 *
 * Le mot de passe ne transite jamais par la ligne de commande : les arguments
 * de processus sont lisibles par tout utilisateur de la machine. Il est passé
 * par la variable PGPASSWORD du sous-processus uniquement.
 *
 * Usage :
 *   node tests/helpers/backup-db.mjs --source=<local|production>
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

import { REPO_ROOT, startPostgres, stopPostgres, connectionConfig } from "./postgres.mjs";

/* ------------------------------------------------------------------ *
 *  Binaires clients
 * ------------------------------------------------------------------ */

const CLIENT_BIN = process.env.PG_CLIENT_BIN
  ?? "/private/tmp/claude-501/-Users-augustinrendu-Desktop-Documents-Administratifs-Business-Militaria-Website--AM2/adab6c48-31aa-4bbb-99f4-f45b62b6d4c0/scratchpad/pgclient/edb/pgsql/bin";

function client(tool, args, env = {}) {
  const bin = join(CLIENT_BIN, tool);
  if (!existsSync(bin)) {
    throw new Error(
      `${tool} introuvable dans ${CLIENT_BIN}. Définir PG_CLIENT_BIN vers un dossier bin de PostgreSQL 17.`);
  }
  return execFileSync(bin, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

/* ------------------------------------------------------------------ *
 *  Schémas sauvegardés, et pourquoi
 * ------------------------------------------------------------------ */

const SCHEMAS = [
  // Toute la logique métier : tables, fonctions financières, RLS, triggers.
  "public",
  // Les comptes. auth.users porte les identifiants référencés par orders et
  // products : restaurer public sans auth donnerait des commandes orphelines.
  "auth",
  // Métadonnées des fichiers (buckets, objets). Les fichiers eux-mêmes vivent
  // dans le stockage objet et ne sont pas dans la base : ils sont inventoriés
  // à part.
  "storage",
];

/* ------------------------------------------------------------------ *
 *  Connexions
 * ------------------------------------------------------------------ */

/** Mot de passe lu dans le trousseau macOS, jamais affiché ni journalisé. */
function keychainSecret(service) {
  try {
    return execFileSync("/usr/bin/security",
      ["find-generic-password", "-a", process.env.USER ?? "", "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function sourceConnection(source) {
  if (source === "local") {
    const c = connectionConfig("am2_backup_rehearsal");
    return { ...c, label: "PostgreSQL local (répétition)", password: "postgres" };
  }

  const password = keychainSecret("athena-supabase-db");
  if (!password) {
    throw new Error(
      "Mot de passe de la base de production absent du trousseau.\n" +
      "  Le déposer une fois avec :\n" +
      "    security add-generic-password -a \"$USER\" -s athena-supabase-db -w\n" +
      "  (la saisie est masquée, rien n'est écrit sur disque ni dans l'historique)");
  }

  const ref = "uctaxgfqdoxtcidllyjv";
  // Deux chemins possibles. La connexion directe est en IPv6 chez Supabase ;
  // le pooler en mode session accepte l'IPv4 et convient à pg_dump.
  return {
    candidates: [
      { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", label: "connexion directe" },
      { host: "aws-0-eu-west-2.pooler.supabase.com", port: 5432, user: `postgres.${ref}`, label: "pooler session" },
    ],
    database: "postgres",
    password,
  };
}

/* ------------------------------------------------------------------ *
 *  Inventaire : ce qu'on comparera après restauration
 * ------------------------------------------------------------------ */

const INVENTORY_SQL = `
WITH tables AS (
  SELECT table_schema AS schema, table_name AS name, 'table' AS kind
    FROM information_schema.tables
   WHERE table_schema = ANY($1::text[]) AND table_type = 'BASE TABLE'
), routines AS (
  -- Les fonctions appartenant à une extension sont exclues : pg_dump ne les
  -- exporte pas, et c'est le comportement correct. Elles sont recréées par
  -- CREATE EXTENSION, pas par la restauration du schéma. Les compter ferait
  -- apparaître des dizaines de faux écarts et noierait les vrais.
  SELECT n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'function'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = ANY($1::text[])
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
), constraints AS (
  SELECT n.nspname, c.conname || ' ' || pg_get_constraintdef(c.oid), 'constraint'
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE n.nspname = ANY($1::text[])
), indexes AS (
  SELECT schemaname, indexname || ' ' || indexdef, 'index' FROM pg_indexes
   WHERE schemaname = ANY($1::text[])
), policies AS (
  SELECT schemaname, tablename || ' :: ' || policyname, 'policy' FROM pg_policies
   WHERE schemaname = ANY($1::text[])
), triggers AS (
  SELECT n.nspname, c.relname || ' :: ' || t.tgname, 'trigger'
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname = ANY($1::text[])
)
SELECT * FROM tables
UNION ALL SELECT * FROM routines
UNION ALL SELECT * FROM constraints
UNION ALL SELECT * FROM indexes
UNION ALL SELECT * FROM policies
UNION ALL SELECT * FROM triggers
ORDER BY 3, 1, 2;
`;

async function inventory(config) {
  const c = new pg.Client(config);
  await c.connect();

  const objects = (await c.query(INVENTORY_SQL, [SCHEMAS])).rows
    .map((r) => `${r.kind}\t${r.schema}.${r.name}`);

  // Comptage réel des lignes, pas l'estimation du planificateur : c'est ce
  // chiffre qui doit correspondre après restauration.
  const tables = (await c.query(
    `SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema = ANY($1::text[]) AND table_type='BASE TABLE'
      ORDER BY 1,2`, [SCHEMAS])).rows;

  const counts = {};
  for (const t of tables) {
    const q = `SELECT count(*)::int AS n FROM "${t.table_schema}"."${t.table_name}"`;
    try {
      counts[`${t.table_schema}.${t.table_name}`] = (await c.query(q)).rows[0].n;
    } catch (err) {
      counts[`${t.table_schema}.${t.table_name}`] = `illisible : ${err.code}`;
    }
  }

  const extensions = (await c.query(
    "SELECT extname, extversion FROM pg_extension ORDER BY 1")).rows;

  let crons = [];
  try {
    crons = (await c.query("SELECT jobname, schedule FROM cron.job ORDER BY 1")).rows;
  } catch { /* pg_cron absent en local */ }

  await c.end();
  return { objects, counts, extensions, crons };
}

/* ------------------------------------------------------------------ *
 *  Programme
 * ------------------------------------------------------------------ */

const source = (process.argv.find((a) => a.startsWith("--source=")) ?? "--source=local").split("=")[1];
const stamp = new Date().toISOString().slice(0, 10);
const outDir = join(REPO_ROOT, "backups", "db", `${source}-${stamp}`);
mkdirSync(outDir, { recursive: true });

console.log(`SAUVEGARDE LOGIQUE — source : ${source}`);
console.log(`Destination : backups/db/${source}-${stamp}/  (ignoré par Git : contient des données personnelles)\n`);

let started = false;
try {
  /* --- Connexion à la source ---------------------------------------- */
  const spec = sourceConnection(source);
  let src;

  if (source === "local") {
    await startPostgres();
    started = true;
    // Base de répétition : on rejoue l'historique complet des migrations.
    const { migrateFresh, connectService } = await import("./migrate.mjs");
    const { config } = await migrateFresh("am2_backup_rehearsal");
    const seed = await connectService(config);
    await seed.query("INSERT INTO auth.users (email) VALUES ('repetition@test.local')");
    await seed.end();
    src = { ...config, label: spec.label };
  } else {
    for (const candidate of spec.candidates) {
      const attempt = { ...candidate, database: spec.database, password: spec.password, ssl: { rejectUnauthorized: false } };
      const probe = new pg.Client(attempt);
      try {
        await probe.connect();
        await probe.query("SELECT 1");
        await probe.end();
        src = attempt;
        console.log(`Connexion établie via : ${candidate.label}`);
        break;
      } catch (err) {
        console.log(`  ${candidate.label} : indisponible (${err.code ?? err.message.split("\n")[0]})`);
        try { await probe.end(); } catch { /* déjà fermée */ }
      }
    }
    if (!src) throw new Error("Aucun chemin de connexion à la base de production n'a abouti.");
  }

  /* --- 1. Inventaire d'origine -------------------------------------- */
  const before = await inventory(src);
  console.log(`Inventaire source : ${before.objects.length} objets, ` +
    `${Object.keys(before.counts).length} tables, ${before.extensions.length} extensions.`);

  /* --- 2. pg_dump ---------------------------------------------------- */
  const schemaArgs = SCHEMAS.flatMap((s) => ["--schema", s]);
  const conn = ["--host", src.host, "--port", String(src.port), "--username", src.user, "--dbname", src.database];
  const env = { PGPASSWORD: src.password };

  const schemaFile = join(outDir, "schema.sql");
  client("pg_dump", [...conn, ...schemaArgs, "--schema-only", "--no-owner", "--file", schemaFile], env);
  console.log(`  schema.sql : ${(statSync(schemaFile).size / 1024).toFixed(0)} Ko`);

  const dumpFile = join(outDir, "full.dump");
  client("pg_dump", [...conn, ...schemaArgs, "--format", "custom", "--no-owner", "--file", dumpFile], env);
  console.log(`  full.dump  : ${(statSync(dumpFile).size / 1024).toFixed(0)} Ko`);

  writeFileSync(join(outDir, "inventory-source.json"), JSON.stringify(before, null, 2));

  /* --- 3. Restauration isolée ---------------------------------------- */
  if (!started) { await startPostgres(); started = true; }

  const admin = new pg.Client(connectionConfig());
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS am2_restore_check");
  await admin.query("CREATE DATABASE am2_restore_check");
  await admin.end();

  const target = connectionConfig("am2_restore_check");
  // Les rôles Supabase n'existent pas dans une base neuve : sans --no-owner
  // ni --no-privileges, pg_restore échouerait sur chaque GRANT.
  try {
    client("pg_restore", [
      "--host", "localhost", "--port", String(target.port), "--username", "postgres",
      "--dbname", "am2_restore_check", "--no-owner", "--no-privileges", "--clean", "--if-exists",
      dumpFile,
    ], { PGPASSWORD: "postgres" });
  } catch (err) {
    // pg_restore signale en erreur des objets déjà présents ou des rôles
    // absents : ce sont des avertissements attendus hors de Supabase.
    const out = String(err.stdout ?? "") + String(err.stderr ?? "");
    const fatal = out.split("\n").filter((l) =>
      /error:/i.test(l) && !/does not exist|already exists|must be owner|no privileges|role "/i.test(l));
    if (fatal.length) {
      console.log("\nErreurs de restauration non attendues :");
      fatal.slice(0, 10).forEach((l) => console.log("  " + l));
      throw new Error(`${fatal.length} erreur(s) de restauration`);
    }
    console.log(`  (${out.split("\n").filter((l) => /error:/i.test(l)).length} avertissements attendus : rôles Supabase absents en local)`);
  }

  /* --- 4. Comparaison ------------------------------------------------ */
  const after = await inventory(target);
  writeFileSync(join(outDir, "inventory-restored.json"), JSON.stringify(after, null, 2));

  const missing = before.objects.filter((o) => !after.objects.includes(o));
  const extra = after.objects.filter((o) => !before.objects.includes(o));

  const rowDiffs = [];
  for (const [table, n] of Object.entries(before.counts)) {
    const m = after.counts[table];
    if (m !== n) rowDiffs.push({ table, source: n, restauré: m ?? "absente" });
  }

  console.log("\n=== COMPARAISON ===");
  console.log(`  objets source     : ${before.objects.length}`);
  console.log(`  objets restaurés  : ${after.objects.length}`);
  console.log(`  objets manquants  : ${missing.length}`);
  console.log(`  objets en trop    : ${extra.length}`);
  console.log(`  tables comparées  : ${Object.keys(before.counts).length}`);
  console.log(`  écarts de lignes  : ${rowDiffs.length}`);

  if (missing.length) {
    console.log("\n  MANQUANTS :");
    missing.slice(0, 25).forEach((o) => console.log("    - " + o));
    if (missing.length > 25) console.log(`    … et ${missing.length - 25} autres`);
  }
  if (rowDiffs.length) {
    console.log("\n  ÉCARTS DE LIGNES :");
    rowDiffs.forEach((d) => console.log(`    ${d.table} : source ${d.source} → restauré ${d.restauré}`));
  }

  const report = {
    source, date: new Date().toISOString(),
    objets: { source: before.objects.length, restaurés: after.objects.length, manquants: missing, en_trop: extra },
    lignes: { tables: Object.keys(before.counts).length, écarts: rowDiffs },
    extensions: before.extensions, crons: before.crons,
    verdict: missing.length === 0 && rowDiffs.length === 0 ? "RESTAURATION CONFORME" : "ÉCARTS DÉTECTÉS",
  };
  writeFileSync(join(outDir, "verification.json"), JSON.stringify(report, null, 2));

  console.log(`\n  VERDICT : ${report.verdict}`);
  if (report.verdict !== "RESTAURATION CONFORME") process.exitCode = 1;
} catch (err) {
  console.error("\nÉCHEC : " + err.message);
  process.exitCode = 1;
} finally {
  if (started) await stopPostgres();
}
