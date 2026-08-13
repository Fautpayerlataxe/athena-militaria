/**
 * Rejoue l'historique complet du schéma sur une base neuve.
 *
 * L'ordre reproduit celui de la production : scripts d'installation d'abord
 * (ils ont été exécutés à la main dans le SQL Editor), puis les migrations par
 * ordre chronologique de nom de fichier, exactement comme `supabase db push`.
 *
 * Aucune migration n'est modifiée ni allégée. Deux instructions seulement sont
 * neutralisées, et uniquement parce que l'extension correspondante n'existe
 * pas hors de l'infrastructure Supabase : CREATE EXTENSION pg_cron et pg_net.
 * Les appels cron.schedule() et net.http_get(), eux, s'exécutent réellement
 * contre les doublures du bootstrap, ce qui permet de vérifier que la tâche
 * est bien planifiée avec la bonne expression.
 */

import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, createDatabase } from "./postgres.mjs";

/** Exécutés à la main dans le SQL Editor de Supabase, dans cet ordre. */
const SETUP_SCRIPTS = [
  "supabase_setup.sql",
  "USERS_SETUP.sql",
  "ADMIN_SETUP.sql",
  // ADD_ADMIN.sql passe APRÈS ADMIN_SETUP.sql : il remplace les politiques
  // écrites avec l'ancienne adresse (augustinrendu@gmail.com) par la liste
  // réelle des deux administrateurs. L'oublier dans le harnais donnerait un
  // schéma de test différent de la production, donc des tests qui mentent.
  "ADD_ADMIN.sql",
  "MULTI_IMAGES_SETUP.sql",
  "HISTORICALLY_SENSITIVE_SETUP.sql",
];

/** Seules lignes retirées, et pourquoi. Toute autre divergence serait une
 *  tricherie : le test ne vaudrait plus rien. */
const UNAVAILABLE_EXTENSIONS = /^\s*CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+(pg_cron|pg_net)\s*;\s*$/gim;

export function migrationFiles() {
  const dir = join(REPO_ROOT, "supabase", "migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

function prepare(sql) {
  return sql.replace(UNAVAILABLE_EXTENSIONS, "-- [harnais local] extension indisponible hors Supabase\n");
}

/**
 * Crée une base, y applique le bootstrap Supabase puis tout l'historique.
 * @param {string} name nom de la base
 * @param {{stopBefore?: string}} options stopBefore permet de tester l'état
 *        d'avant une migration donnée, pour prouver qu'elle corrige bien
 *        quelque chose de cassé.
 */
export async function migrateFresh(name, options = {}) {
  const config = await createDatabase(name);
  const client = new pg.Client(config);
  await client.connect();

  const applied = [];
  const run = async (label, sql) => {
    try {
      await client.query(prepare(sql));
      applied.push(label);
    } catch (err) {
      throw new Error(`Échec sur ${label} : ${err.message}`);
    }
  };

  await run("bootstrap supabase", readFileSync(join(REPO_ROOT, "tests", "helpers", "supabase-bootstrap.sql"), "utf8"));

  for (const script of SETUP_SCRIPTS) {
    let sql;
    try {
      sql = readFileSync(join(REPO_ROOT, script), "utf8");
    } catch {
      continue; // script absent du dépôt : on ne l'invente pas
    }
    await run(script, sql);
  }

  for (const file of migrationFiles()) {
    if (options.stopBefore && file >= options.stopBefore) break;
    await run(file, readFileSync(join(REPO_ROOT, "supabase", "migrations", file), "utf8"));
  }

  await client.end();
  return { config, applied };
}

/**
 * Client d'administration, tel que l'utilisent les fonctions edge.
 *
 * Les revendications de service_role sont posées explicitement : plusieurs
 * triggers du projet testent auth.role(), qui vaut NULL sans elles. Un client
 * superutilisateur sans contexte JWT verrait donc ses écritures sur profiles
 * silencieusement annulées, et les tests observeraient un état qui n'existe
 * dans aucun environnement réel.
 */
export async function connectService(config) {
  const client = new pg.Client(config);
  await client.connect();
  await client.query(
    "SELECT set_config('request.jwt.claims', $1, false)",
    [JSON.stringify({ role: "service_role" })],
  );
  return client;
}

/** Client connecté avec un rôle et des revendications JWT donnés : c'est ainsi
 *  que PostgREST exécute chaque requête, et donc la seule façon d'observer
 *  réellement les politiques RLS. */
export async function connectAs(config, role, claims = null) {
  const client = new pg.Client(config);
  await client.connect();
  if (claims) {
    await client.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  }
  await client.query(`SET ROLE ${role}`);
  return client;
}
