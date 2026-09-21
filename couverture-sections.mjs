/* Quelle section de la feuille sert à quelle page.
   La carte vient de carte-css.cjs, exacte à l'octet près. Règle qui rend le
   découpage sûr : une section touchée par une seule page publique, ne
   serait-ce que d'un octet, reste dans la feuille publique. */
import { chromium } from "playwright";
import fs from "node:fs";

const sections = JSON.parse(fs.readFileSync("/tmp/carte-sections.json", "utf8"))
  .filter((s) => s.taille > 0)
  .map((s) => ({ ...s, pages: new Set() }));

const PUBLIQUES = ["/", "/militaria", "/militaria/premiere-guerre-mondiale",
  "/militaria/premiere-guerre-mondiale/uniformes", "/ventes", "/guides",
  "/guides/croix-de-guerre-1914-1918", "/guides/identifier-casque-allemand-ww2",
  "/annonce/casque-a-pointe-22", "/about", "/community", "/sell", "/legal",
  "/cette-page-nexiste-pas", "/?lang=en", "/guides?lang=en", "/militaria?lang=en"];
const PRIVEES = ["/account", "/admin", "/messages", "/order"];

const nav = await chromium.launch();
async function couvrir(chemin, etiquette) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.coverage.startCSSCoverage();
  try {
    await page.goto("https://www.athenamilitaria.fr" + chemin, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1200);
    /* On ouvre aussi ce qui ne s'affiche qu'au clic : menu mobile et modale
       de connexion. Sans cela, leur style passerait pour inutilisé. */
    for (const sel of ["#burger-btn", ".burger", "[data-modal]", "#loginBtn"]) {
      const el = await page.$(sel);
      if (el) { await el.click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(400); }
    }
  } catch {}
  const cov = await page.coverage.stopCSSCoverage();
  for (const e of cov) {
    if (!e.url.includes("style.min.css")) continue;
    for (const r of e.ranges) {
      for (const s of sections) if (r.start < s.fin && r.end > s.debut) s.pages.add(etiquette);
    }
  }
  await ctx.close();
}
for (const c of PUBLIQUES) await couvrir(c, "publique");
for (const c of PRIVEES) await couvrir(c, "privee");
await nav.close();

const ko = (l) => Math.round(l.reduce((n, s) => n + s.taille, 0) / 1024);
const pub = sections.filter((s) => s.pages.has("publique"));
const priv = sections.filter((s) => s.pages.has("privee") && !s.pages.has("publique"));
const rien = sections.filter((s) => s.pages.size === 0);

console.log(`publiques : ${pub.length} sections, ${ko(pub)} Ko`);
console.log(`privées seules : ${priv.length} sections, ${ko(priv)} Ko`);
console.log(`jamais vues : ${rien.length} sections, ${ko(rien)} Ko\n`);
console.log("--- privées seules ---");
for (const s of priv.sort((a, b) => b.taille - a.taille)) console.log(`${String(Math.round(s.taille/1024)).padStart(3)} Ko  ${s.titre.slice(0,68)}`);
console.log("\n--- jamais vues, plus de 1 Ko ---");
for (const s of rien.filter(s=>s.taille>1024).sort((a, b) => b.taille - a.taille)) console.log(`${String(Math.round(s.taille/1024)).padStart(3)} Ko  ${s.titre.slice(0,68)}`);

fs.writeFileSync("/tmp/classement.json", JSON.stringify(
  sections.map((s) => ({ titre: s.titre, ligne: s.ligne, finLigne: s.finLigne, taille: s.taille, pages: [...s.pages] })), null, 1));
