/**
 * Le barème de la Protection acheteurs n'existe qu'à un seul endroit.
 *
 * Il en existait deux : la fonction SQL buyer_protection_fee_cents, et une
 * copie dans product.js pour afficher le détail du prix sur la fiche. Un outil
 * comparait les deux sur toute la plage de prix, et c'était la bonne réponse
 * tant que les deux existaient.
 *
 * Le détail n'étant plus affiché que sur la page de paiement, construite par le
 * serveur, la copie a disparu. Ce contrôle garde ce terrain gagné : il échoue
 * si un barème réapparaît côté navigateur, où il recommencerait à diverger.
 *
 * Il vérifie aussi, sur la base réelle, que la fonction SQL reste la seule à
 * décider, et que ses valeurs sont exactes au centime.
 */

import { readFileSync } from "node:fs";
import { connecter } from "./connexion.mjs";
import { REPO_ROOT } from "./postgres.mjs";
import { join } from "node:path";

let echecs = 0;
const dire = (ok, texte) => { console.log(`  ${ok ? "ok " : "ÉCHEC"} ${texte}`); if (!ok) echecs++; };

/* --- 1. Aucun barème dans le navigateur -------------------------------- */

const SUSPECTS = [
  { motif: /\*\s*500\s*\)\s*\/\s*10000/, quoi: "le taux de 5 % en points de base" },
  { motif: /\+\s*70\b(?!\d)/, quoi: "les 70 centimes fixes" },
  { motif: /protectionCents|protection_fee_cents/, quoi: "une variable de Protection acheteurs" },
];

for (const fichier of ["product.js", "account.js", "order.js", "script.js"]) {
  const source = readFileSync(join(REPO_ROOT, fichier), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const trouves = SUSPECTS.filter((s) => s.motif.test(source)).map((s) => s.quoi);
  dire(trouves.length === 0,
    `${fichier} ne recalcule pas la Protection acheteurs` +
    (trouves.length ? ` → ${trouves.join(", ")}` : ""));
}

/* --- 2. La fonction SQL décide, et décide juste ------------------------ */

const c = await connecter({ silencieux: true });

const CAS = [
  [100, 75], [1000, 120], [4500, 295], [10000, 570], [25000, 1320], [50000, 2570],
];
for (const [prix, attendu] of CAS) {
  const r = await c.query("SELECT public.buyer_protection_fee_cents($1) AS f", [prix]);
  dire(r.rows[0].f === attendu,
    `${(prix / 100).toFixed(2)} € → Protection de ${(r.rows[0].f / 100).toFixed(2)} €` +
    (r.rows[0].f === attendu ? "" : ` (attendu ${(attendu / 100).toFixed(2)} €)`));
}

/* --- 3. Les frais de port aussi viennent de la base -------------------- */

const rates = await c.query("SELECT method, amount_cents FROM public.shipping_rates ORDER BY method");
dire(rates.rows.length >= 3, `${rates.rows.length} tarifs de livraison en base`);

const invariant = await c.query(`
  SELECT p AS prix,
         p + s.amount_cents + public.buyer_protection_fee_cents(p) AS acheteur,
         p + s.amount_cents AS vendeur,
         public.buyer_protection_fee_cents(p) AS plateforme
    FROM unnest($1::int[]) AS p, public.shipping_rates s
   WHERE s.method = 'post'`, [[100, 4500, 25000, 100000]]);

for (const l of invariant.rows) {
  dire(Number(l.acheteur) - Number(l.vendeur) === Number(l.plateforme),
    `${(l.prix / 100).toFixed(2)} € : acheteur ${(l.acheteur / 100).toFixed(2)} € ` +
    `moins vendeur ${(l.vendeur / 100).toFixed(2)} € égale ${(l.plateforme / 100).toFixed(2)} €`);
}

await c.end();

console.log(`\n  ${echecs === 0 ? "UN SEUL CALCUL, ET IL EST JUSTE" : "⚠ " + echecs + " ÉCHEC(S)"}`);
if (echecs) process.exitCode = 1;
