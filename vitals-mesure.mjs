/* Mesure LCP et CLS sur mobile, réseau et processeur bridés comme un
   téléphone milieu de gamme en 4G lente. Les chiffres servent à décider,
   pas à rassurer : on mesure avant et après chaque changement. */
import { chromium } from "playwright";

const PAGES = process.argv.slice(2);
const nav = await chromium.launch();

for (const chemin of PAGES) {
  const ctx = await nav.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8),
    uploadThroughput: Math.round((750 * 1024) / 8),
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  let octets = 0;
  page.on("response", async (r) => {
    try { const b = await r.body(); octets += b.length; } catch {}
  });

  await page.goto("https://www.athenamilitaria.fr" + chemin, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(4000);

  const m = await page.evaluate(() => new Promise((res) => {
    let lcp = 0, cls = 0, el = "";
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        lcp = e.startTime;
        el = e.element ? (e.element.tagName + (e.element.className ? "." + String(e.element.className).split(" ")[0] : "")) : e.url || "?";
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    setTimeout(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      res({ lcp: Math.round(lcp), cls: +cls.toFixed(3), element: el, ttfb: Math.round(nav.responseStart || 0),
            fcp: Math.round((performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0) });
    }, 1200);
  }));

  console.log(chemin.padEnd(40),
    "LCP", String(m.lcp).padStart(5) + " ms",
    "| FCP", String(m.fcp).padStart(5),
    "| TTFB", String(m.ttfb).padStart(4),
    "| CLS", String(m.cls).padStart(5),
    "| poids", Math.round(octets / 1024) + " Ko",
    "| LCP =", m.element);
  await ctx.close();
}
await nav.close();
