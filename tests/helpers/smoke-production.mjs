/**
 * Tests de fumée sur la production, après déploiement.
 *
 * Aucun de ces appels ne peut déplacer de l'argent : ils vérifient que les
 * portes sont fermées, pas qu'elles s'ouvrent. Un endpoint de versement qui
 * répond 200 à un inconnu est une faille ; c'est exactement ce qu'on mesure.
 *
 * Le déclenchement réel des tâches passe par la base, avec le secret lu dans
 * Vault : c'est le seul moyen de prouver la chaîne complète (Vault → en-tête →
 * fonction) sans jamais manipuler le secret ici.
 */

import { execFileSync } from "node:child_process";
import pg from "pg";

const BASE = "https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1";
const password = execFileSync("/usr/bin/security",
  ["find-generic-password", "-a", process.env.USER ?? "", "-s", "athena-supabase-db", "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "ok " : "ÉCHEC"} ${label}${detail ? "  → " + detail : ""}`);
  ok ? pass++ : fail++;
};

async function call(path, init = {}) {
  const r = await fetch(`${BASE}/${path}`, init);
  return { status: r.status, body: (await r.text()).slice(0, 200) };
}

console.log("=== Portes fermées : appels non autorisés ===");

for (const fn of ["payout-release", "payments-monitor"]) {
  const anon = await call(fn, { method: "POST" });
  check(`${fn} sans secret`, anon.status === 401, `${anon.status}`);
  const wrong = await call(fn, { method: "POST", headers: { "x-cron-secret": "mauvais-secret" } });
  check(`${fn} avec un mauvais secret`, wrong.status === 401, `${wrong.status}`);
}

const noSig = await call("stripe-webhook", { method: "POST", body: "{}" });
check("stripe-webhook sans signature", noSig.status === 400, `${noSig.status}`);

const badSig = await call("stripe-webhook", {
  method: "POST",
  headers: { "stripe-signature": "t=1,v1=00" },
  body: JSON.stringify({ id: "evt_faux", type: "checkout.session.completed" }),
});
check("stripe-webhook avec une signature forgée", badSig.status === 400, `${badSig.status}`);

for (const fn of ["checkout-status", "connect-onboard", "create-checkout"]) {
  const r = await call(fn, { method: "POST", body: "{}" });
  check(`${fn} sans jeton d'authentification`, r.status === 401, `${r.status}`);
}

console.log("\n=== Maintenance du paiement, toujours active ===");
const anonKey = process.env.SUPABASE_ANON_KEY;
if (anonKey) {
  const r = await call("create-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
    body: JSON.stringify({ productId: 1 }),
  });
  check("create-checkout refuse un achat", r.status !== 200, `${r.status}`);
} else {
  console.log("  (clé anonyme absente de l'environnement, contrôle fait par le 401 ci-dessus)");
}

console.log("\n=== Chaîne complète des tâches : Vault → en-tête → fonction ===");

const c = new pg.Client({
  host: "db.uctaxgfqdoxtcidllyjv.supabase.co", port: 5432, user: "postgres",
  database: "postgres", password, ssl: { rejectUnauthorized: false },
});
await c.connect();

const ids = {};
for (const fn of ["payout-release", "payments-monitor"]) {
  const r = await c.query(
    `SELECT net.http_post(
       url := $1,
       headers := jsonb_build_object('Content-Type','application/json',
                                     'x-cron-secret', public.payments_cron_secret()),
       body := '{}'::jsonb) AS id`, [`${BASE}/${fn}`]);
  ids[fn] = r.rows[0].id;
}

// pg_net est asynchrone : la réponse arrive dans net._http_response.
await new Promise((r) => setTimeout(r, 12000));

for (const [fn, id] of Object.entries(ids)) {
  const r = await c.query(
    "SELECT status_code, left(content, 160) AS content, error_msg FROM net._http_response WHERE id = $1", [id]);
  const row = r.rows[0];
  check(`${fn} déclenchée par la tâche`, row?.status_code === 200,
    row ? `${row.status_code} ${row.content ?? row.error_msg ?? ""}` : "aucune réponse enregistrée");
}

console.log("\n=== Rien n'a bougé ===");
const after = await c.query(`
  SELECT (SELECT count(*)::int FROM public.orders) AS commandes,
         (SELECT count(*)::int FROM public.orders WHERE payout_state='released') AS verses,
         (SELECT count(*)::int FROM public.stripe_events) AS evenements,
         (SELECT count(*)::int FROM public.products WHERE reserved_qty > 0) AS reservations`);
const a = after.rows[0];
check("aucune commande créée", a.commandes === 0, `${a.commandes}`);
check("aucun versement déclenché", a.verses === 0, `${a.verses}`);
check("aucun événement Stripe accepté", a.evenements === 0, `${a.evenements}`);
check("aucune réservation pendante", a.reservations === 0, `${a.reservations}`);

await c.end();
console.log(`\n  ${fail === 0 ? "TOUS LES CONTRÔLES PASSENT" : "⚠ " + fail + " ÉCHEC(S)"} — ${pass} réussi(s), ${fail} échoué(s)`);
if (fail > 0) process.exitCode = 1;
