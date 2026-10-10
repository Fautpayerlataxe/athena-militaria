/**
 * La FAQ des guides : ce que le moteur lit est ce que le lecteur voit.
 *
 * Chaque question est écrite une fois (faq, faq_en dans guides-contenu.cjs)
 * et build-guides.cjs en tire deux choses : les intertitres « Questions
 * fréquentes » de la page et le bloc FAQPage des données structurées. Google
 * écarte un balisage FAQPage dont les questions ou les réponses ne figurent
 * pas sur la page ; une page générée avant une modification, ou un gabarit
 * qui changerait l'un sans l'autre, le ferait sans bruit.
 *
 * Les questions reprises mot pour mot des « Autres questions » de Google
 * (plan SEO, K3, oct. 2026) sont aussi vérifiées : une reformulation, même
 * heureuse, perdrait la correspondance avec la requête qui les a fait écrire.
 *
 * Les pages contrôlées sont les fichiers de guides/ tels qu'ils seront
 * déployés : lancer node build-guides.cjs avant ce test après toute
 * modification de guides-contenu.cjs.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GUIDES } = require("../guides-contenu.cjs");
const racine = new URL("../guides/", import.meta.url);

/** Pages de guides générées, toutes langues, hors pages d'accueil. */
const pages = ["", "en/", "de/"].flatMap((dossier) =>
  readdirSync(new URL(dossier, racine))
    .filter((f) => f.endsWith(".html") && f !== "index.html")
    .map((f) => dossier + f),
);

/** Texte comparable : sans balises, entités décodées, et l'espace insécable
 *  que la typographie française pose sur la page (avant « ? », dans les
 *  guillemets) ramenée à une espace, puisque le JSON-LD n'y passe pas. */
const texte = (s: string) => s
  .replace(/<[^>]+>/g, "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/&nbsp;| | /g, " ")
  .replace(/\s+/g, " ")
  .trim();

function faqBalisee(html: string) {
  const noeuds = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((m) => { const d = JSON.parse(m[1]); return d["@graph"] || [d]; });
  const faq = noeuds.find((n: any) => n["@type"] === "FAQPage");
  return faq ? faq.mainEntity.map((q: any) => ({ q: texte(q.name), r: texte(q.acceptedAnswer.text) })) : null;
}

/** Questions et réponses affichées : du titre « faq » au titre suivant ou à
 *  la fin de l'article, chaque <h3> suivi de son <p>. */
function faqAffichee(html: string) {
  const debut = html.indexOf('<h2 id="faq">');
  if (debut === -1) return null;
  const reste = html.slice(debut + 1);
  const fin = Math.min(...[reste.indexOf("<h2"), reste.indexOf("</article>")].filter((i) => i !== -1));
  const section = reste.slice(0, fin);
  return [...section.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({ q: texte(m[1]), r: texte(m[2]) }));
}

describe("FAQ des guides", () => {
  test("toutes les pages de guides sont lues", () => {
    // 29 guides en français, autant en anglais, un en allemand au 10 oct. 2026 :
    // le seuil bas attrape un dossier vide ou mal lu sans figer le compte.
    assert.ok(pages.length >= 50, `${pages.length} pages seulement`);
  });

  for (const page of pages) {
    test(`${page} : FAQPage identique à la FAQ affichée`, () => {
      const html = readFileSync(new URL(page, racine), "utf8");
      const balisee = faqBalisee(html);
      const affichee = faqAffichee(html);
      assert.ok(balisee && balisee.length, "FAQPage absent");
      assert.ok(affichee && affichee.length, "section « faq » absente");
      assert.deepEqual(balisee, affichee);
      const questions = affichee!.map((f) => f.q);
      assert.equal(new Set(questions).size, questions.length, "question posée deux fois");
    });
  }

  test("les questions reprises de Google sont présentes mot pour mot, en français et en anglais", () => {
    const attendues: Record<string, { fr: string[]; en: string[] }> = {
      "dater-uniforme-militaire-francais": {
        fr: ["Quelle était la couleur du pantalon des troupes françaises en 1914 ?"],
        en: ["What colour were French soldiers' trousers in 1914?"],
      },
      "militaria-definition": {
        fr: ["Pourquoi collectionne-t-on le militaria ?", "Quels objets entrent dans le militaria ?"],
        en: ["Why do people collect militaria?", "What types of items are militaria?"],
      },
      // Suggestions de Google relevées le 10 oct. 2026 (guide du sabre, C7).
      "sabre-militaire-francais": {
        fr: ["Comment identifier un sabre ?", "Qu'est-ce qu'un sabre briquet ?", "Peut-on avoir un sabre chez soi ?", "Comment nettoyer un sabre ancien ?"],
        en: ["How to identify an antique sword?", "Is it legal to own a sword in France?", "Can you carry a sword in France?", "What sword did French cuirassiers use?"],
      },
    };
    for (const [slug, { fr, en }] of Object.entries(attendues)) {
      const g = GUIDES.find((x: any) => x.slug === slug);
      assert.ok(g, `guide ${slug} absent`);
      for (const q of fr) assert.ok(g.faq.some((f: any) => f.q === q), `${slug} : « ${q} » absente de faq`);
      for (const q of en) assert.ok(g.faq_en.some((f: any) => f.q === q), `${slug} : « ${q} » absente de faq_en`);
      const pageFr = faqAffichee(readFileSync(new URL(`${slug}.html`, racine), "utf8"))!.map((f) => f.q);
      const pageEn = faqAffichee(readFileSync(new URL(`en/${slug}.html`, racine), "utf8"))!.map((f) => f.q);
      for (const q of fr) assert.ok(pageFr.includes(q), `${slug} : « ${q} » absente de la page générée`);
      for (const q of en) assert.ok(pageEn.includes(q), `en/${slug} : « ${q} » absente de la page générée`);
    }
  });
});
