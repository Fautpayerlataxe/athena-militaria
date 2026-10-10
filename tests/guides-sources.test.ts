/**
 * Les sources des guides : une liste, trois usages, aucune divergence.
 *
 * Chaque source est décrite une fois (catalogue SOURCES de guides-contenu.cjs)
 * et sert trois fois dans la page générée : la liste « Sources » en fin
 * d'article, la propriété citation de l'Article (JSON-LD) et le lien posé sur
 * sa première mention dans le texte. Ce qui pourrait mal tourner sans bruit :
 * une clé mal orthographiée, une mention que le build ne trouve plus après
 * une réécriture du paragraphe (il se contente d'avertir), une page générée
 * avant l'ajout d'une source, ou une adresse de Wikipédia citée comme source.
 *
 * Les pages contrôlées sont les fichiers de guides/ tels qu'ils seront
 * déployés : lancer node build-guides.cjs avant ce test après toute
 * modification de guides-contenu.cjs.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GUIDES, SOURCES } = require("../guides-contenu.cjs");
const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), "utf8");

type Reference = { cle: string; mention?: string; mention_en?: string };
type Source = { libelle: string; libelle_en: string; libelle_de?: string; url: string; url_en?: string; langue?: string; consulte: string };
const avecSources = GUIDES.filter((g: any) => g.sources && g.sources.length);

/** Décode les quelques entités que build-guides.cjs écrit dans le HTML. */
const decoder = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Vrai si le texte apparaît dans un <p> ou un <li>, hors lien existant :
 *  c'est la règle que suit lierSources() dans build-guides.cjs. */
function dansUnParagraphe(corps: string, texte: string): boolean {
  for (const bloc of corps.matchAll(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/g)) {
    let dansLien = 0;
    for (const seg of bloc[0].split(/(<[^>]+>)/)) {
      if (seg.startsWith("<")) {
        if (/^<a\b/i.test(seg)) dansLien++;
        else if (/^<\/a>/i.test(seg)) dansLien--;
        continue;
      }
      if (!dansLien && seg.includes(texte)) return true;
    }
  }
  return false;
}

describe("le catalogue des sources", () => {
  test("au moins un guide publie ses sources", () => {
    assert.ok(avecSources.length > 0);
  });

  test("chaque clé citée par un guide existe au catalogue, et chaque entrée du catalogue est citée", () => {
    const citees = new Set<string>();
    for (const g of avecSources) {
      for (const r of g.sources as Reference[]) {
        assert.ok(SOURCES[r.cle], `${g.slug} : clé « ${r.cle} » absente de SOURCES`);
        citees.add(r.cle);
      }
      const cles = (g.sources as Reference[]).map((r) => r.cle);
      assert.equal(new Set(cles).size, cles.length, `${g.slug} : une source est citée deux fois`);
    }
    for (const cle of Object.keys(SOURCES)) assert.ok(citees.has(cle), `source « ${cle} » au catalogue mais citée par aucun guide`);
  });

  test("chaque source a ses deux libellés, une adresse https, et le jour de sa consultation", () => {
    for (const [cle, s] of Object.entries(SOURCES) as [string, Source][]) {
      assert.ok(s.libelle && s.libelle_en, `${cle} : libellé manquant`);
      for (const u of [s.url, s.url_en].filter(Boolean) as string[]) {
        assert.match(u, /^https:\/\/[^\s"<>]+$/, `${cle} : adresse invalide ${u}`);
        // Wikipédia est un point d'entrée, jamais la source d'un fait.
        assert.doesNotMatch(u, /wikipedia\.org/, `${cle} : Wikipédia citée comme source`);
      }
      assert.match(s.consulte, /^\d{4}-\d{2}-\d{2}$/, `${cle} : date de consultation invalide`);
      assert.ok(!Number.isNaN(Date.parse(s.consulte)), `${cle} : date de consultation impossible`);
    }
  });

  test("aucun tiret cadratin ni demi-cadratin dans les libellés", () => {
    for (const [cle, s] of Object.entries(SOURCES) as [string, Source][]) {
      assert.doesNotMatch(s.libelle + s.libelle_en + (s.libelle_de || ""), /[–—]/, `${cle} : tiret long dans un libellé`);
    }
  });

  test("chaque mention se trouve dans un paragraphe ou une liste du guide, hors lien", () => {
    for (const g of avecSources) {
      for (const r of g.sources as Reference[]) {
        if (r.mention) assert.ok(dansUnParagraphe(g.corps, r.mention), `${g.slug} : mention « ${r.mention} » introuvable dans un paragraphe`);
        if (r.mention_en) assert.ok(dansUnParagraphe(g.corps_en, r.mention_en), `${g.slug} (en) : mention « ${r.mention_en} » introuvable dans un paragraphe`);
      }
    }
  });
});

describe("les pages générées reprennent les sources", () => {
  for (const lang of ["fr", "en"] as const) {
    test(`version ${lang} : liste, sommaire, citation et liens dans le texte`, () => {
      for (const g of avecSources) {
        if (lang === "en" && !g.corps_en) continue;
        const html = lire(lang === "en" ? `guides/en/${g.slug}.html` : `guides/${g.slug}.html`);
        const refs = g.sources as Reference[];
        const url = (r: Reference) => (lang === "en" && SOURCES[r.cle].url_en) || SOURCES[r.cle].url;

        // La liste en fin d'article, sous son intertitre, dans l'article.
        assert.match(html, /<h2 id="sources">Sources<\/h2>/, `${g.slug} (${lang}) : intertitre Sources absent`);
        const liste = html.match(/<ul class="guide-sources">([\s\S]*?)<\/ul>/);
        assert.ok(liste, `${g.slug} (${lang}) : liste des sources absente`);
        const article = html.slice(html.indexOf("<article>"), html.indexOf("</article>"));
        assert.ok(article.includes('<ul class="guide-sources">'), `${g.slug} (${lang}) : liste hors de l'article`);
        const hrefs = [...liste[1].matchAll(/<a href="([^"]+)"/g)].map((m) => decoder(m[1]));
        assert.deepEqual(hrefs, refs.map(url), `${g.slug} (${lang}) : la liste ne suit pas le champ sources`);

        // Le sommaire y mène, comme il mène à la FAQ.
        assert.ok(html.includes('<a href="#sources">Sources</a>'), `${g.slug} (${lang}) : sommaire sans entrée Sources`);

        // La propriété citation de l'Article dit la même chose que la liste.
        const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
        const articleLd = ld["@graph"].find((n: any) => n["@type"] === "Article");
        assert.deepEqual((articleLd.citation || []).map((c: any) => c.url), refs.map(url), `${g.slug} (${lang}) : citation différente de la liste`);

        // La première mention, dans le corps (avant la FAQ, donc hors de la
        // liste), est un lien vers la source, sans nouvel onglet.
        const corps = article.slice(0, article.indexOf('<h2 id="faq">')).replace(/ /g, " ");
        const echapRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        for (const r of refs) {
          const mention = lang === "en" ? r.mention_en : r.mention;
          if (!mention) continue;
          const u = url(r).replace(/&/g, "&amp;");
          const motif = new RegExp(`<a href="${echapRe(u)}" rel="noopener"(?: hreflang="[a-z]{2}")?>${echapRe(mention)}</a>`);
          assert.match(corps, motif, `${g.slug} (${lang}) : mention « ${mention} » non liée dans le texte`);
        }
        assert.doesNotMatch(article, /<a [^>]*target=/, `${g.slug} (${lang}) : lien ouvert dans un nouvel onglet`);
      }
    });
  }
});

/* La version allemande (guides/de/) n'existe que pour les guides qui ont un
   corps allemand. build-guides.cjs lui donne le libellé libelle_de d'une
   source, et à défaut l'anglais : sans ce test, une source ajoutée à un tel
   guide sans libellé allemand passerait en ligne en anglais au milieu d'une
   page allemande, sans que rien ne le signale. */
describe("la version allemande reprend les sources", () => {
  const avecAllemand = avecSources.filter((g: any) => g.corps_de);

  test("chaque source citée par un guide traduit en allemand a son libellé allemand", () => {
    for (const g of avecAllemand) {
      for (const r of g.sources as Reference[]) {
        assert.ok((SOURCES[r.cle] as Source).libelle_de, `${g.slug} : source « ${r.cle} » sans libelle_de`);
      }
    }
  });

  test("liste « Quellen », sommaire et citation, dans l'ordre du champ sources", () => {
    for (const g of avecAllemand) {
      const html = lire(`guides/de/${g.slug}.html`);
      const refs = g.sources as Reference[];
      // Le lecteur étranger reçoit la version anglaise quand elle existe.
      const url = (r: Reference) => SOURCES[r.cle].url_en || SOURCES[r.cle].url;
      assert.match(html, /<h2 id="sources">Quellen<\/h2>/, `${g.slug} (de) : intertitre Quellen absent`);
      assert.ok(html.includes('<a href="#sources">Quellen</a>'), `${g.slug} (de) : sommaire sans entrée Quellen`);
      const liste = html.match(/<ul class="guide-sources">([\s\S]*?)<\/ul>/);
      assert.ok(liste, `${g.slug} (de) : liste des sources absente`);
      const lignes = [...liste[1].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
      assert.deepEqual(lignes.map((m) => decoder(m[1])), refs.map(url), `${g.slug} (de) : la liste ne suit pas le champ sources`);
      assert.deepEqual(lignes.map((m) => decoder(m[2])), refs.map((r) => (SOURCES[r.cle] as Source).libelle_de), `${g.slug} (de) : libellés différents de libelle_de`);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
      const articleLd = ld["@graph"].find((n: any) => n["@type"] === "Article");
      assert.deepEqual((articleLd.citation || []).map((c: any) => c.url), refs.map(url), `${g.slug} (de) : citation différente de la liste`);
    }
  });
});
