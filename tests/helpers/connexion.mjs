/**
 * Une connexion à la base de production qui survit au réseau.
 *
 * L'hôte direct db.<ref>.supabase.co ne publie qu'une adresse IPv6. Le jour où
 * le poste perd sa connectivité IPv6, tous les outils expirent au bout d'une
 * minute sans rien expliquer. Le connecteur de Supabase, lui, répond en IPv4.
 *
 * On essaie donc le direct, puis les connecteurs régionaux, et on retient
 * celui qui a répondu pour les appels suivants du même programme.
 */

import { execFileSync } from "node:child_process";
import dns from "node:dns";
import pg from "pg";

dns.setDefaultResultOrder("ipv4first");

export const PROJET = "uctaxgfqdoxtcidllyjv";

export function motDePasse() {
  return execFileSync("/usr/bin/security",
    ["find-generic-password", "-a", process.env.USER ?? "", "-s", "athena-supabase-db", "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/* Le projet est en eu-west-2, et son connecteur porte le préfixe aws-1 : les
 * projets plus anciens utilisent aws-0, et interroger la mauvaise famille
 * répond « tenant not found », ce qui ressemble à une erreur d'identifiant.
 * Le port 5432 est le mode session, nécessaire pour SET LOCAL ROLE et les
 * transactions longues des migrations ; 6543 ne les supporterait pas. */
const CANDIDATS = [
  { host: `db.${PROJET}.supabase.co`, user: "postgres", nom: "direct (IPv6)" },
  { host: "aws-1-eu-west-2.pooler.supabase.com", user: `postgres.${PROJET}`, nom: "connecteur eu-west-2" },
];

let retenu = null;

/** Ouvre une connexion, en essayant les chemins dans l'ordre. */
export async function connecter({ silencieux = false } = {}) {
  const password = motDePasse();
  const essais = retenu ? [retenu, ...CANDIDATS.filter((c) => c !== retenu)] : CANDIDATS;

  let derniere;
  for (const c of essais) {
    const client = new pg.Client({
      host: c.host, port: 5432, user: c.user, database: "postgres", password,
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      if (!retenu && !silencieux && c !== CANDIDATS[0]) {
        console.log(`  (connexion via le ${c.nom} : l'hôte direct est injoignable depuis ce poste)`);
      }
      retenu = c;
      return client;
    } catch (err) {
      derniere = err;
      try { await client.end(); } catch { /* déjà fermée */ }
    }
  }
  throw new Error(`Aucun chemin vers la base n'a abouti. Dernière erreur : ${derniere?.message}`);
}
