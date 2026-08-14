/**
 * Ce que le visiteur reçoit correspond-il au dépôt ?
 *
 * OVH limite les connexions FTP rapprochées : une rafale de dépôts laissait des
 * fichiers en arrière sans que rien ne le signale, ce qui est pire qu'un dépôt
 * refusé. Le script de dépôt réessaie désormais ; ce contrôle constate.
 *
 * DEUX FAUSSES PISTES ÉCARTÉES EN CHEMIN, et c'est utile de le savoir :
 *
 *   - interroger chaque fichier à sa propre adresse donnait vingt-quatre
 *     écarts, tous faux : les pages de catégories, les guides anglais et
 *     404.html ne sont jamais servis là, ce sont des cibles de règles de
 *     réécriture. Ils sont donc contrôlés par l'adresse qui les sert vraiment ;
 *   - lire les tailles dans le listing FTP échoue quand le serveur limite les
 *     connexions, c'est-à-dire précisément quand on en a besoin.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const SITE = "https://www.athenamilitaria.fr";

/* Fichiers servis à leur propre adresse. */
const liste = readFileSync("deploy-ovh.sh", "utf8");
const directs = [...new Set([...liste.matchAll(/^\s*"([^"]+)"$/gm)].map((m) => m[1]))]
  .filter((f) => existsSync(f) && statSync(f).isFile())
  .filter((f) => !f.startsWith(".") && !f.endsWith(".php") && f !== "404.html");

/* Fichiers atteints par réécriture : seuls les guides sont adressables de
   façon générique. Les copies enrichies de catégories dépendent de règles qui
   combinent la période ET la sous-catégorie dans la requête ; les viser à
   l'aveugle renvoie la page générique, ce qui produit seize faux écarts. Elles
   sont donc hors de portée de ce contrôle, et c'est dit plutôt que masqué. */
const parReecriture = [];
if (existsSync("guides")) {
  for (const f of readdirSync("guides").filter((x) => x.endsWith(".html"))) {
    parReecriture.push([`guides/${f}`, f === "index.html" ? "/guides/" : `/guides/${f.replace(/\.html$/, "")}`]);
  }
}

const horsPortee = existsSync("categories")
  ? readdirSync("categories").filter((x) => x.endsWith(".html")).length : 0;

let ok = 0, ignores = 0;
const ecarts = [];

async function comparer(fichier, url) {
  const local = statSync(fichier).size;
  try {
    const r = await fetch(SITE + url, { redirect: "follow" });
    if (r.status !== 200) { ignores++; return; }   // servi autrement, hors de portée de ce contrôle
    const distant = (await r.arrayBuffer()).byteLength;
    if (distant === local) ok++;
    else ecarts.push(`${fichier} : servi ${distant} o · dépôt ${local} o`);
  } catch (e) {
    ecarts.push(`${fichier} : injoignable (${String(e.message).slice(0, 40)})`);
  }
}

await Promise.all([
  ...directs.map((f) => comparer(f, "/" + f)),
  ...parReecriture.map(([f, url]) => comparer(f, url)),
]);

/* La page d'erreur se vérifie en demandant une adresse inexistante. */
try {
  const r = await fetch(`${SITE}/cette-page-nexiste-pas-${Date.now()}`);
  const taille = (await r.arrayBuffer()).byteLength;
  const local = statSync("404.html").size;
  if (r.status === 404 && taille === local) ok++;
  else ecarts.push(`404.html : servi ${taille} o en HTTP ${r.status} · dépôt ${local} o`);
} catch { ecarts.push("404.html : injoignable"); }

const total = directs.length + parReecriture.length + 1;
console.log(`  ${total} fichier(s) · ${ok} identiques · ${ignores} servis autrement · ${ecarts.length} en écart`);
if (horsPortee) console.log(`  ${horsPortee} page(s) de catégorie hors de portée de ce contrôle (réécriture par requête)`);
ecarts.slice(0, 15).forEach((e) => console.log("    " + e));
console.log(`\n  ${ecarts.length === 0 ? "CE QUI EST SERVI EST CE QUI EST DANS LE DÉPÔT" : "⚠ ÉCART, relancer ./deploy-ovh.sh"}`);
if (ecarts.length) process.exitCode = 1;
