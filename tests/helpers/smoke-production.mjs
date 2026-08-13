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
import { readFileSync } from "node:fs";
import { connecter } from "./connexion.mjs";

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

console.log("\n=== Ouverture des achats : l'interrupteur en base ===");

/* La clé publiable du site sert ici de laissez-passer pour la passerelle
 * Supabase, qui rejette tout appel sans jeton avant même que la fonction ne
 * démarre. Elle est publique par conception : elle est servie à chaque
 * visiteur dans supabaseClient.js. Elle n'authentifie personne, ce qui est
 * exactement le point : la fermeture doit être constatable sans compte. */
const anonKey = process.env.SUPABASE_ANON_KEY
  ?? (readFileSync(new URL("../../supabaseClient.js", import.meta.url), "utf8")
        .match(/eyJ[A-Za-z0-9_.-]{40,}/)?.[0] ?? "");

if (anonKey) {
  const r = await call("create-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      Origin: "https://www.athenamilitaria.fr",
    },
    body: JSON.stringify({ productId: 9, shippingMethod: "post" }),
  });
  const ferme = r.status === 503 && r.body.includes("CHECKOUT_DISABLED");
  check("les achats sont fermés, et la fermeture est constatable", ferme, `${r.status}`);
  if (!ferme && r.status === 401) {
    console.log("        ATTENTION : la boutique est OUVERTE (checkout_enabled = 1).");
  }
} else {
  console.log("  (clé publiable introuvable, contrôle fait par le 401 ci-dessus)");
}

console.log("\n=== Chaîne complète des tâches : Vault → en-tête → fonction ===");

const c = await connecter();

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
         (SELECT count(*)::int FROM public.stripe_events
           WHERE status='processing' AND created_at < now() - interval '15 minutes') AS evenements_bloques,
         (SELECT count(*)::int FROM public.stripe_events
           WHERE status='failed' AND type IN ('checkout.session.completed',
                 'checkout.session.async_payment_succeeded','charge.refunded',
                 'charge.dispute.created')) AS evenements_critiques,
         (SELECT count(*)::int FROM public.products WHERE reserved_qty > 0) AS reservations`);
const a = after.rows[0];
check("aucune commande créée", a.commandes === 0, `${a.commandes}`);
check("aucun versement déclenché", a.verses === 0, `${a.verses}`);
// Le journal des événements n'est plus vide depuis que le webhook reçoit
// réellement : ce qui compte n'est plus leur nombre mais qu'aucun ne reste
// bloqué en cours de traitement, ni en échec sur un type qui porte de l'argent.
check("aucun événement bloqué en cours de traitement",
  Number(a.evenements_bloques) === 0, `${a.evenements_bloques} bloqué(s)`);
check("aucun échec sur un événement qui porte de l'argent",
  Number(a.evenements_critiques) === 0, `${a.evenements_critiques} en échec`);
check("aucune réservation pendante", a.reservations === 0, `${a.reservations}`);

const drapeau = await c.query(
  "SELECT value FROM public.platform_settings WHERE key = 'checkout_enabled'");
check("l'interrupteur d'achat est bien refermé", Number(drapeau.rows[0]?.value) === 0,
  `checkout_enabled=${drapeau.rows[0]?.value ?? "absent"}`);

await c.end();
console.log(`\n  ${fail === 0 ? "TOUS LES CONTRÔLES PASSENT" : "⚠ " + fail + " ÉCHEC(S)"} — ${pass} réussi(s), ${fail} échoué(s)`);
if (fail > 0) process.exitCode = 1;
