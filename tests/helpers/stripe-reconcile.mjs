/**
 * Rapprochement Stripe ↔ base, en LECTURE SEULE STRICTE.
 *
 * L'absence de commandes en base ne prouve pas l'absence de paiements : le
 * webhook déployé répond 200 même quand l'écriture échoue. Si de l'argent a
 * été encaissé sans laisser de trace, c'est ici qu'on le découvre.
 *
 * Ce programme n'appelle que des opérations de liste et de lecture. Il ne crée,
 * ne modifie et ne supprime rien, ni chez Stripe ni en base. Aucun montant
 * n'est déplacé, aucun remboursement n'est déclenché.
 *
 * Sécurité :
 *   - la clé est lue dans le trousseau, jamais affichée ni journalisée ;
 *   - une clé live est refusée sauf --allow-live explicite ;
 *   - les identifiants sont partiellement masqués dans la sortie ;
 *   - aucune donnée personnelle n'est imprimée : les emails sont réduits à
 *     leur domaine, les adresses ne sont jamais lues.
 *
 * Usage :
 *   node tests/helpers/stripe-reconcile.mjs                 # clé de test
 *   node tests/helpers/stripe-reconcile.mjs --allow-live    # clé live, lecture seule
 */

import { execFileSync } from "node:child_process";
import Stripe from "stripe";

const ALLOW_LIVE = process.argv.includes("--allow-live");
const SINCE_DAYS = Number((process.argv.find((a) => a.startsWith("--days=")) ?? "--days=365").split("=")[1]);

/* ------------------------------------------------------------------ *
 *  Clé
 * ------------------------------------------------------------------ */

function keychainSecret(service) {
  try {
    return execFileSync("/usr/bin/security",
      ["find-generic-password", "-a", process.env.USER ?? "", "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const key = process.env.STRIPE_TEST_SECRET_KEY
  ?? keychainSecret("athena-stripe-test")
  ?? keychainSecret("athena-stripe-live");

if (!key) {
  console.error(
    "Aucune clé Stripe disponible.\n" +
    "  Déposer la clé une fois avec :\n" +
    "    security add-generic-password -a \"$USER\" -s athena-stripe-test -w\n" +
    "  (saisie masquée ; pour un rapprochement de production, utiliser\n" +
    "   athena-stripe-live et lancer avec --allow-live)");
  process.exit(1);
}

const isLive = key.startsWith("sk_live_") || key.startsWith("rk_live_");
const isTest = key.startsWith("sk_test_") || key.startsWith("rk_test_");

if (!isLive && !isTest) {
  console.error("La clé fournie n'a ni le préfixe test ni le préfixe live : refus par précaution.");
  process.exit(1);
}
if (isLive && !ALLOW_LIVE) {
  console.error(
    "Clé LIVE détectée et --allow-live absent : arrêt.\n" +
    "  Ce programme est en lecture seule, mais lire la production reste une\n" +
    "  décision qui vous appartient. Relancer avec --allow-live pour l'autoriser.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2023-10-16", maxNetworkRetries: 2 });
const mode = isLive ? "PRODUCTION (live)" : "test";
const since = Math.floor(Date.now() / 1000) - SINCE_DAYS * 86400;

/* ------------------------------------------------------------------ *
 *  Masquage
 * ------------------------------------------------------------------ */

const mask = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 11)}…${id.slice(-4)}` : id ?? "—");
const euro = (c, cur = "eur") => `${((c ?? 0) / 100).toFixed(2).replace(".", ",")} ${String(cur).toUpperCase()}`;
/** Un email n'est jamais imprimé : seul son domaine l'est. */
const domain = (email) => (typeof email === "string" && email.includes("@") ? "…@" + email.split("@")[1] : "—");

async function collect(listFn, label) {
  const out = [];
  try {
    for await (const item of listFn()) out.push(item);
  } catch (err) {
    console.log(`  ${label} : lecture impossible (${err.code ?? err.type ?? "erreur"})`);
    return null;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Programme
 * ------------------------------------------------------------------ */

console.log(`RAPPROCHEMENT STRIPE — mode ${mode}, ${SINCE_DAYS} derniers jours`);
console.log("Lecture seule : aucune création, modification ni suppression.\n");

const balance = await stripe.balance.retrieve().catch(() => null);
if (balance) {
  const line = (a) => a.map((b) => euro(b.amount, b.currency)).join(", ") || "—";
  console.log(`Solde plateforme  : disponible ${line(balance.available)} · en attente ${line(balance.pending)}`);
}

const sessions = await collect(() => stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 }), "sessions");
const intents = await collect(() => stripe.paymentIntents.list({ created: { gte: since }, limit: 100 }), "paymentIntents");
const charges = await collect(() => stripe.charges.list({ created: { gte: since }, limit: 100 }), "charges");
const refunds = await collect(() => stripe.refunds.list({ created: { gte: since }, limit: 100 }), "refunds");
const disputes = await collect(() => stripe.disputes.list({ created: { gte: since }, limit: 100 }), "disputes");
const transfers = await collect(() => stripe.transfers.list({ created: { gte: since }, limit: 100 }), "transfers");
const accounts = await collect(() => stripe.accounts.list({ limit: 100 }), "comptes connectés");
const events = await collect(() => stripe.events.list({ created: { gte: since }, limit: 100 }), "événements");

console.log("\n=== VOLUMÉTRIE ===");
const rows = [
  ["Checkout Sessions", sessions], ["PaymentIntents", intents], ["Charges", charges],
  ["Remboursements", refunds], ["Litiges", disputes], ["Transferts", transfers],
  ["Comptes connectés", accounts], ["Événements", events],
];
for (const [label, list] of rows) {
  console.log(`  ${label.padEnd(20)} ${list === null ? "illisible" : String(list.length).padStart(4)}`);
}

/* --- Ce qui compte : de l'argent encaissé ---------------------------- */
const succeeded = (charges ?? []).filter((c) => c.paid && c.status === "succeeded");
console.log(`\n=== PAIEMENTS RÉELLEMENT ENCAISSÉS : ${succeeded.length} ===`);

if (succeeded.length === 0) {
  console.log("  Aucun. Rien à rapprocher : aucune commande n'a pu être perdue.");
} else {
  console.log("\n  charge              date        montant      remboursé  contesté  commande (metadata)");
  for (const c of succeeded) {
    const orderId = c.metadata?.order_id ?? c.metadata?.product_id ?? "ABSENTE";
    console.log(
      `  ${mask(c.id).padEnd(19)} ${new Date(c.created * 1000).toISOString().slice(0, 10)}` +
      ` ${euro(c.amount, c.currency).padStart(12)} ${euro(c.amount_refunded, c.currency).padStart(12)}` +
      ` ${String(c.disputed).padStart(8)}  ${orderId}`);
  }

  console.log("\n  Acheteurs (domaines seuls) :",
    [...new Set(succeeded.map((c) => domain(c.billing_details?.email)))].join(", "));

  const total = succeeded.reduce((s, c) => s + c.amount, 0);
  const refunded = succeeded.reduce((s, c) => s + c.amount_refunded, 0);
  console.log(`\n  Total encaissé : ${euro(total)} · remboursé : ${euro(refunded)} · net : ${euro(total - refunded)}`);

  console.log("\n  ⚠ CHAQUE LIGNE CI-DESSUS DOIT CORRESPONDRE À UNE COMMANDE EN BASE.");
  console.log("    Un paiement sans commande est un P0 : il doit être rapproché avant toute suite.");
  console.log("    Vérification en base :");
  console.log("      SELECT id, status, amount_total_cents, stripe_charge_id FROM orders");
  console.log("       WHERE stripe_charge_id IN (…identifiants ci-dessus…);");
}

/* --- Comptes connectés, sous forme agrégée --------------------------- */
if (accounts && accounts.length) {
  console.log(`\n=== COMPTES CONNECTÉS : ${accounts.length} ===`);
  const ready = accounts.filter((a) => a.charges_enabled && a.payouts_enabled && a.details_submitted);
  const withTransfers = accounts.filter((a) => a.capabilities?.transfers === "active");
  console.log(`  prêts à encaisser        : ${ready.length}`);
  console.log(`  capacité transfers active: ${withTransfers.length}`);
  console.log(`  onboarding incomplet     : ${accounts.filter((a) => !a.details_submitted).length}`);
}

/* --- Événements webhook ---------------------------------------------- */
if (events && events.length) {
  const byType = {};
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
  console.log("\n=== ÉVÉNEMENTS PAR TYPE ===");
  for (const [type, n] of Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(4)}  ${type}`);
  }
}

/* --- Configuration des endpoints webhook ----------------------------- */
const endpoints = await collect(() => stripe.webhookEndpoints.list({ limit: 20 }), "endpoints webhook");
if (endpoints) {
  console.log(`\n=== ENDPOINTS WEBHOOK : ${endpoints.length} ===`);
  for (const e of endpoints) {
    console.log(`  ${e.status.padEnd(8)} ${e.url}`);
    console.log(`    version API : ${e.api_version ?? "compte"} · ${e.enabled_events.length} événement(s)`);
    console.log(`    ${e.enabled_events.join(", ")}`);
  }
}

console.log("\nAucune écriture n'a été effectuée.");
