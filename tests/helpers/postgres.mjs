/**
 * Démarrage d'un vrai serveur PostgreSQL pour les tests.
 *
 * Pourquoi un vrai serveur et non un émulateur : la couche financière repose
 * sur des mécanismes que seul Postgres implémente réellement — SELECT ... FOR
 * UPDATE, isolation transactionnelle, contraintes CHECK et UNIQUE différées,
 * triggers BEFORE, SECURITY DEFINER, row level security, plpgsql. Un émulateur
 * les approximerait, et c'est précisément l'approximation qui a masqué le bug
 * de la contrainte quantity >= 1 pendant des mois.
 *
 * embedded-postgres télécharge les binaires officiels et lance un vrai
 * postmaster : les connexions sont réellement concurrentes, ce qui permet de
 * tester deux acheteurs simultanés sans les simuler.
 */

import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import pg from "pg";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Port dédié : évite toute collision avec un Postgres du poste. */
const PORT = Number(process.env.TEST_PG_PORT || 55432);

let instance = null;
let dataDir = null;

export async function startPostgres() {
  if (instance) return instance;

  dataDir = mkdtempSync(join(tmpdir(), "am2-pgdata-"));
  instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });

  await instance.initialise();
  await instance.start();
  return instance;
}

export async function stopPostgres() {
  if (!instance) return;
  try {
    await instance.stop();
  } finally {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    instance = null;
    dataDir = null;
  }
}

export function connectionConfig(database = "postgres") {
  return { host: "localhost", port: PORT, user: "postgres", password: "postgres", database };
}

/** Une base neuve par suite de tests : aucun état ne fuit d'un fichier à l'autre. */
export async function createDatabase(name) {
  const admin = new pg.Client(connectionConfig());
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  return connectionConfig(name);
}

export function sqlFile(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}
