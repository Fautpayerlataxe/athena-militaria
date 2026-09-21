/* Combien de la feuille servie chaque page utilise-t-elle réellement ?
   La feuille bloque le rendu : tout ce qui n'est pas utilisé sur la page
   demandée est du temps d'attente offert à personne. */
import { chromium } from "playwright";
const nav = await chromium.launch();
for (const chemin of process.argv.slice(2)) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.coverage.startCSSCoverage();
  await page.goto("https://www.athenamilitaria.fr" + chemin, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  const cov = await page.coverage.stopCSSCoverage();
  for (const e of cov) {
    if (!e.url.includes("style.min.css")) continue;
    const utilise = e.ranges.reduce((n, r) => n + r.end - r.start, 0);
    console.log(chemin.padEnd(38), Math.round(e.text.length / 1024) + " Ko servis,",
      Math.round(utilise / 1024) + " Ko utilisés,",
      Math.round((utilise / e.text.length) * 100) + " %");
  }
  await ctx.close();
}
await nav.close();
