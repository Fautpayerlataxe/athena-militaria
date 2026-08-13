/**
 * Le navigateur affiche un total, le serveur en débite un autre : c'est le
 * genre d'écart qu'on ne découvre qu'après la première réclamation.
 *
 * product.js recalcule la Protection acheteurs côté navigateur, avec
 * Math.round ; la base la calcule avec ROUND() de PostgreSQL. Les deux
 * arrondis ne sont pas définis de la même façon dans les documentations. On
 * ne raisonne donc pas : on compare, centime par centime, sur toute la plage
 * de prix qu'une annonce peut porter.
 *
 * On vérifie aussi que les frais de port codés en dur dans product.js sont
 * ceux de la table shipping_rates. Un écart là serait un total faux affiché
 * avant même le paiement.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connecter } from "./connexion.mjs";

import { REPO_ROOT } from "./postgres.mjs";

const source = readFileSync(join(REPO_ROOT, "product.js"), "utf8");

/* La formule est lue dans le fichier livré, pas recopiée ici : si quelqu'un
 * la modifie sans toucher ce contrôle, la comparaison le rattrape. */
const formula = source.match(/const protectionCents = ([^;]+);/)?.[1];
if (!formula) throw new Error("formule de protection introuvable dans product.js");
console.log(`  formule lue dans product.js : ${formula.trim()}`);

const jsFee = new Function("productCents", `return ${formula};`);

const shipMatch = source.match(/const SHIPPING_CENTS = \{([^}]+)\}/)?.[1];
if (!shipMatch) throw new Error("barème de livraison introuvable dans product.js");
const jsShipping = Object.fromEntries(
  shipMatch.split(",").map((p) => {
    const [k, v] = p.split(":").map((s) => s.trim());
    return [k, Number(v)];
  }).filter(([k]) => k));
console.log(`  frais de port lus dans product.js : ${JSON.stringify(jsShipping)}`);

const password = execFileSync("/usr/bin/security",
  ["find-generic-password", "-a", process.env.USER ?? "", "-s", "athena-supabase-db", "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const c = await connecter();

/* --- 1. Chaque centime de 0 à 500 €, puis des prix élevés ------------- */
const prices = [];
for (let p = 0; p <= 50_000; p++) prices.push(p);
for (const p of [99_999, 100_000, 123_456, 250_000, 999_999]) prices.push(p);

const rows = (await c.query(
  "SELECT p AS cents, public.buyer_protection_fee_cents(p) AS fee FROM unnest($1::int[]) AS p",
  [prices])).rows;

let divergences = 0, exemples = [];
for (const row of rows) {
  const js = jsFee(row.cents);
  if (js !== row.fee) {
    divergences++;
    if (exemples.length < 5) exemples.push(`${row.cents} c → navigateur ${js} c, base ${row.fee} c`);
  }
}
console.log(`\n  ${divergences === 0 ? "ok " : "ÉCHEC"} ${rows.length} prix comparés, ${divergences} divergence(s)`);
exemples.forEach((e) => console.log("        " + e));

/* --- 2. Frais de port ------------------------------------------------- */
const rates = (await c.query("SELECT method, amount_cents FROM public.shipping_rates ORDER BY method")).rows;
console.log(`\n  barème en base : ${rates.map((r) => `${r.method}=${r.amount_cents}`).join(", ")}`);

let ecarts = 0;
for (const r of rates) {
  const js = jsShipping[r.method];
  if (js === undefined) { console.log(`  ÉCHEC ${r.method} absent de product.js`); ecarts++; continue; }
  if (js !== r.amount_cents) { console.log(`  ÉCHEC ${r.method} : navigateur ${js} c, base ${r.amount_cents} c`); ecarts++; }
}
for (const k of Object.keys(jsShipping)) {
  if (!rates.some((r) => r.method === k)) { console.log(`  ÉCHEC ${k} affiché au navigateur mais absent de la base`); ecarts++; }
}
if (ecarts === 0) console.log("  ok  les frais de port affichés sont ceux de la base");

/* --- 3. Le total affiché est bien celui que le serveur exigera -------- */
const article = 25_000;
for (const r of rates) {
  const fe = jsFee(article) ;
  const total = article + r.amount_cents + fe;
  const check = (await c.query(
    `SELECT $1::int + $2::int + public.buyer_protection_fee_cents($1) AS total,
            $1::int + $2::int AS vendeur`, [article, r.amount_cents])).rows[0];
  const ok = total === check.total;
  if (!ok) ecarts++;
  console.log(`  ${ok ? "ok " : "ÉCHEC"} 250,00 € en ${r.method} : acheteur ${(total / 100).toFixed(2)} €, ` +
              `vendeur ${(check.vendeur / 100).toFixed(2)} €, plateforme ${(fe / 100).toFixed(2)} €`);
}

await c.end();
const fail = divergences > 0 || ecarts > 0;
console.log(`\n  ${fail ? "⚠ DIVERGENCE NAVIGATEUR / SERVEUR" : "NAVIGATEUR ET SERVEUR CALCULENT LE MÊME MONTANT"}`);
if (fail) process.exitCode = 1;
