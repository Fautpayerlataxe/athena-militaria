/**
 * Langue des pages, liens anglais et recherche du catalogue.
 *
 * Défauts relevés par l'audit du 10 oct. 2026, que ces contrôles empêchent de
 * revenir sans qu'on le voie :
 *   - une préférence « en » enregistrée habillait une page française servie
 *     comme telle (H1 anglais, cartes françaises, lang="en" sur le tout) ;
 *   - le tiroir du téléphone, l'aide de /sell et « Contacter le vendeur »
 *     perdaient ?lang=en ;
 *   - la recherche ignorait les titres anglais, les accents et les pluriels ;
 *   - un prix se lisait « 90 € » à côté de « €5.20 » sur une fiche anglaise ;
 *   - un clic sur Acheter, Contacter ou Favori arrivé avant les écouteurs de
 *     la fiche restait sans effet ni signe.
 *
 * Rien n'est exécuté contre le site : i18n.js et les fonctions de script.js
 * tournent dans un bac à sable, avec un document réduit au strict nécessaire.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const lire = (nom: string) => readFileSync(new URL(`../${nom}`, import.meta.url), "utf8");

/* i18n.js dans un bac à sable : adresse, langue servie, présence de
   hreflang et préférence enregistrée au choix. */
function moteur({ search = "", lang = "fr", ssr = false, hreflang = false, prefere = null as string | null } = {}) {
  const neutre = () => {};
  const stockage: Record<string, string> = prefere ? { lang: prefere } : {};
  const racine = {
    getAttribute: (n: string) => (n === "lang" ? lang : null),
    setAttribute: (n: string, v: string) => { if (n === "lang") lang = v; },
    dataset: ssr ? { ssr: "1" } : {},
  };
  const bac: Record<string, any> = {
    window: {},
    document: {
      documentElement: racine,
      addEventListener: neutre,
      querySelector: (sel: string) => (hreflang && sel.includes("hreflang") ? {} : null),
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: neutre },
      dispatchEvent: neutre,
    },
    location: { search, pathname: "/" },
    localStorage: {
      getItem: (k: string) => stockage[k] ?? null,
      setItem: (k: string, v: string) => { stockage[k] = v; },
    },
    URLSearchParams,
    CustomEvent: function CustomEvent() {},
    console,
    Promise,
  };
  vm.createContext(bac);
  vm.runInContext(lire("i18n.js"), bac, { filename: "i18n.js" });
  return { I18N: bac.window.I18N, langue: () => lang, stockage };
}

/* Même règle que am_anglaiser_liens (inc/athena.php) et anglaiser()
   (build-guides.cjs), recopiée de ce dernier : la référence côté serveur. */
const anglaiserServeur = (html: string) => html.replace(/href="(\/[^"#?]*)(#[^"]*)?"/g, (tout, chemin, ancre) => {
  const dernier = chemin.slice(chemin.lastIndexOf("/"));
  if (dernier.includes(".")) return tout;
  return `href="${chemin}?lang=en${ancre || ""}"`;
});

describe("langue d'une page servie dans une seule langue", () => {
  test("une page française servie par le serveur reste française malgré une préférence anglaise", () => {
    const m = moteur({ ssr: true, prefere: "en" });
    assert.equal(m.I18N.current, "fr");
  });

  test("une page française qui annonce sa version anglaise (hreflang) reste française", () => {
    const m = moteur({ hreflang: true, prefere: "en" });
    assert.equal(m.I18N.current, "fr");
  });

  test("une page sans version propre par langue (Mon compte) suit la préférence", () => {
    const m = moteur({ prefere: "en" });
    assert.equal(m.I18N.current, "en");
  });

  test("?lang=en l'emporte, et la préférence n'est pas effacée par une page française", () => {
    assert.equal(moteur({ search: "?lang=en", ssr: true }).I18N.current, "en");
    const m = moteur({ ssr: true, prefere: "en" });
    assert.equal(m.stockage.lang, "en");
  });

  test("les gabarits portent la redirection précoce vers la version anglaise", () => {
    const gabarits = ["index.html", "category.html", "product.html", "about.html", "sell.html", "community.html", "legal.html"];
    const guides = readdirSync(new URL("../guides/", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => `guides/${f}`);
    for (const g of [...gabarits, ...guides]) {
      const html = lire(g);
      const corps = html.indexOf(">", html.indexOf("<body")) + 1;
      const script = html.indexOf("<script>/* Préférence anglaise sur une page française", corps);
      assert.ok(corps > 0 && script > corps, `${g} : redirection absente`);
      // Avant tout contenu visible : seuls d'autres scripts peuvent la précéder.
      const avant = html.slice(corps, script).replace(/<script[\s\S]*?<\/script>/g, "");
      assert.equal(avant.trim(), "", `${g} : la redirection doit précéder le bandeau`);
    }
  });
});

describe("liens dans la langue affichée", () => {
  const en = moteur({ search: "?lang=en" }).I18N;
  const fr = moteur({ search: "" }).I18N;

  test("I18N.lien suit la règle du serveur, ancre après le paramètre", () => {
    const cas: [string, string][] = [
      ["/", "/?lang=en"],
      ["/militaria", "/militaria?lang=en"],
      ["/about#how-it-works", "/about?lang=en#how-it-works"],
      // Une adresse à requête reste telle quelle, comme côté serveur.
      ["/messages?to=abc&product=30", "/messages?to=abc&product=30"],
      ["/legal?lang=en#cgv", "/legal?lang=en#cgv"],
      ["/logo.webp", "/logo.webp"],
      ["https://exemple.fr/a", "https://exemple.fr/a"],
      ["//exemple.fr/a", "//exemple.fr/a"],
    ];
    for (const [entree, attendu] of cas) assert.equal(en.lien(entree), attendu, entree);
    assert.equal(fr.lien("/militaria"), "/militaria");
  });

  test("I18N.lien donne le même résultat que am_anglaiser_liens sur les adresses sans requête", () => {
    for (const chemin of ["/", "/sell", "/guides/heritage-militaria-que-faire", "/about#faq", "/media/400/x.webp"]) {
      assert.equal(`href="${en.lien(chemin)}"`, anglaiserServeur(`href="${chemin}"`), chemin);
    }
  });

  test("le tiroir du téléphone et la fiche passent par I18N.lien", () => {
    const script = lire("script.js");
    assert.doesNotMatch(script, /class="mm-item[^"]*" href="\//, "lien du tiroir écrit en dur");
    assert.match(lire("product.js"), /lienFiche\("\/messages"\)/);
  });
});

/* Fonctions de recherche de script.js, extraites telles quelles. */
const source = lire("script.js");
const bloc = source.slice(source.indexOf("function normaliserRecherche"), source.indexOf("let tourCatalogue"));
const recherche: Record<string, any> = {};
vm.createContext(recherche);
vm.runInContext(bloc + "\nglobalThis.R = { normaliserRecherche, motsRecherche, motifRecherche, filtrerRecherche };", recherche);
const R = recherche.R;

describe("recherche du catalogue", () => {
  const annonces = [
    { id: 22, title: "Casque à pointe", title_en: "Spiked helmet" },
    { id: 27, title: "Plaque d'identité WW1 plaque belges", title_en: "WW1 identity tag" },
    { id: 31, title: "Dague d'officier allemand de la seconde guerre mondiale", title_en: "German officer's dagger from the Second World War" },
    { id: 9, title: "Bras de fauteuil", title_en: null },
    { id: 10, title: "Brassard", title_en: null },
  ];
  const ids = (q: string) => R.filtrerRecherche(annonces, R.motsRecherche(q)).map((p: { id: number }) => p.id);

  test("titre anglais, accents, casse", () => {
    assert.deepEqual(ids("helmet"), [22]);
    assert.deepEqual(ids("dagger"), [31]);
    assert.deepEqual(ids("identite"), [27]);
    assert.deepEqual(ids("IDENTITÉ"), [27]);
  });

  test("pluriel retiré seulement en second essai", () => {
    assert.deepEqual(ids("casques"), [22]);
    assert.deepEqual(ids("dagues"), [31]);
    // « bras » trouve d'abord « bras » : le « s » n'est pas retiré.
    assert.deepEqual(ids("bras"), [9, 10]);
  });

  test("plusieurs mots : tous doivent figurer", () => {
    assert.deepEqual(ids("dague allemand"), [31]);
    assert.deepEqual(ids("dague tankiste"), []);
  });

  test("le motif envoyé à la base ne contient que des caractères sûrs pour or()", () => {
    for (const q of ["identité", "d'officier, (allemand).", "\"xx\\yy:zz", "cœur"]) {
      const motif = R.motifRecherche(R.motsRecherche(q));
      assert.match(motif, /^[a-z0-9_*]+$/, q);
    }
    assert.equal(R.motifRecherche(R.motsRecherche("identite")), "_d_nt_t_");
    // « oe » vaut aussi « œ », et « c » vaut aussi « ç », côté base.
    assert.equal(R.motifRecherche(R.motsRecherche("coeur")), "_*_r");
  });
});

describe("prix dans la langue de la page", () => {
  const debut = source.indexOf("window.formatPrice = function");
  const fin = source.indexOf("\n};", debut) + 3;
  const prix = (langue: string) => {
    const bac: Record<string, any> = { window: { I18N: { current: langue } } };
    vm.createContext(bac);
    vm.runInContext(source.slice(debut, fin), bac);
    return bac.window.formatPrice;
  };

  test("français inchangé, anglais à la manière des frais de livraison", () => {
    assert.equal(prix("fr")(5000), "5\u202f000 €");
    assert.equal(prix("fr")(12.5), "12,5 €");
    assert.equal(prix("en")(5000), "€5,000");
    assert.equal(prix("en")(90), "€90");
    assert.equal(prix("en")(12.5), "€12.5");
  });

  test("am_prix (PHP) suit la même règle", () => {
    const php = lire("inc/athena.php");
    const corps = php.slice(php.indexOf("function am_prix"), php.indexOf("function am_prix") + 600);
    assert.match(corps, /\$en \? '€' \. \$s : \$s \. ' €'/);
    assert.match(corps, /\$milliers = \$en \? ',' : "\\u\{202F\}"/);
  });
});

/* Fiche : un clic sur Acheter, Contacter ou Favori arrivé avant que
   product.js ait posé ses écouteurs (3 à 11 s en 3G mesurées le 10 oct.
   2026) ne faisait rien. Il est désormais retenu, puis rejoué une fois. */
describe("fiche : clic arrivé avant les écouteurs", () => {
  const src = lire("product.js");
  const bloc = src.slice(src.indexOf("const ACTIONS_FICHE"), src.indexOf("/* Le dictionnaire de la langue affichée"));

  /* precoce : la retenue posée par le script en ligne de product.html,
     exécuté tel quel dans le même bac, avant product.js. */
  function page(precoce = false) {
    const ecouteurs: Function[] = [];
    const rejoues: string[] = [];
    const minuteries: Function[] = [];
    const bouton = (id: string) => {
      const attrs: Record<string, string> = {};
      const b: any = {
        id, disabled: false, attrs,
        setAttribute: (n: string, v: string) => { attrs[n] = v; },
        removeAttribute: (n: string) => { delete attrs[n]; },
        click: () => rejoues.push(id),
        closest: () => b,
      };
      return b;
    };
    const boutons: Record<string, any> = { buyBtn: bouton("buyBtn"), favBtn: bouton("favBtn"), contactSellerBtn: bouton("contactSellerBtn") };
    const bac: Record<string, any> = {
      window: {},
      document: {
        addEventListener: (type: string, f: Function, capture: boolean) => { if (type === "click" && capture) ecouteurs.push(f); },
        removeEventListener: (type: string, f: Function) => { const i = ecouteurs.indexOf(f); if (i >= 0) ecouteurs.splice(i, 1); },
        querySelectorAll: () => Object.values(boutons),
        getElementById: (id: string) => boutons[id] || null,
      },
      setTimeout: (f: Function) => { minuteries.push(f); return minuteries.length; },
      clearTimeout: () => {},
    };
    vm.createContext(bac);
    const cliquer = (id: string) => {
      let bloque = false;
      const ev = { target: boutons[id], preventDefault: () => { bloque = true; }, stopImmediatePropagation: () => {} };
      ecouteurs.slice().forEach((f) => f(ev));
      return bloque;
    };
    if (precoce) {
      vm.runInContext(enLigne, bac);
      // Clic pendant le chargement, avant product.js.
      cliquer("buyBtn");
    }
    vm.runInContext(bloc + "\nglobalThis.retenir = retenirLesClics;", bac);
    return { retenue: bac.retenir(), boutons, rejoues, ecouteurs, minuteries, cliquer, bac };
  }
  const gabarit = lire("product.html");
  const enLigne = (() => {
    const i = gabarit.indexOf("window.__clicsFiche=");
    const debut = gabarit.lastIndexOf("<script>", i) + "<script>".length;
    return gabarit.slice(debut, gabarit.indexOf("</script>", i));
  })();

  test("le dernier geste est rejoué une seule fois, et les boutons ne restent pas occupés", () => {
    const p = page();
    assert.equal(p.cliquer("buyBtn"), true, "clic retenu");
    p.cliquer("buyBtn");
    p.cliquer("favBtn");
    assert.equal(p.boutons.buyBtn.attrs["aria-busy"], "true");
    p.retenue.liberer();
    assert.deepEqual(p.rejoues, ["favBtn"]);
    assert.equal(p.ecouteurs.length, 0, "écouteur provisoire retiré");
    assert.equal(p.boutons.buyBtn.attrs["aria-busy"], undefined);
    p.retenue.liberer();
    assert.deepEqual(p.rejoues, ["favBtn"], "pas de second rejeu");
  });

  test("sans clic, rien n'est rejoué ; un bouton désactivé n'est pas retenu", () => {
    const p = page();
    p.boutons.buyBtn.disabled = true;
    assert.equal(p.cliquer("buyBtn"), false);
    p.retenue.liberer();
    assert.deepEqual(p.rejoues, []);
  });

  test("un clic retenu par product.html avant product.js est rejoué, sans doublon d'écouteur", () => {
    const p = page(true);
    assert.equal(p.boutons.buyBtn.attrs["aria-busy"], "true", "retenu dès l'affichage");
    assert.equal(p.ecouteurs.length, 1, "product.js reprend la retenue au lieu d'en poser une seconde");
    assert.equal(p.bac.window.__clicsFiche, null);
    p.retenue.liberer();
    assert.deepEqual(p.rejoues, ["buyBtn"]);
    assert.equal(p.ecouteurs.length, 0);
  });

  test("filet : si les écouteurs ne viennent jamais, les boutons sont rendus sans rejeu", () => {
    const p = page();
    p.cliquer("contactSellerBtn");
    p.minuteries.forEach((f) => f());
    assert.deepEqual(p.rejoues, []);
    assert.equal(p.boutons.contactSellerBtn.attrs["aria-busy"], undefined);
    assert.equal(p.ecouteurs.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 *  Redirection précoce vers l'anglais (script en ligne des gabarits)
 *
 *  Relecture finale de l'audit du 10 oct. 2026 :
 *    - les paramètres de l'adresse étaient perdus (?checkout=canceled au
 *      retour de Stripe, étiquettes de campagne) ;
 *    - la provenance aussi : après location.replace, la mesure d'audience
 *      lisait la page française comme page d'origine ;
 *    - une page servie par PHP sans hreflang anglais (recherche, fiche sans
 *      titre anglais) restait entièrement française.
 * ------------------------------------------------------------------ */

const GABARITS_ANGLAIS = ["index.html", "category.html", "product.html", "about.html", "sell.html", "community.html", "legal.html"];
/* Gelés jusqu'au 20 oct. 2026 (title, h1, description, intertitres) : ils
   gardent la version précédente du script jusqu'à leur régénération. */
const GUIDES_GELES = ["heritage-militaria-que-faire", "estimer-valeur-casque-adrian", "croix-de-guerre-1914-1918",
  "identifier-casque-allemand-ww2", "identifier-baionnette-francaise"];
const scriptAnglais = (html: string) => {
  const m = /<script>(\/\* Préférence anglaise[\s\S]*?)<\/script>/.exec(html);
  return m ? m[1] : null;
};

/** Le script, exécuté sur une page simulée : rend l'adresse visée (ou null) et le stockage de session. */
function redirection({ href, lang = "fr", ssr = false, hreflangEn = null as string | null, canonique = null as string | null,
  prefere = "en" as string | null, referrer = "" } = { href: "" }) {
  const url = new URL(href);
  const session: Record<string, string> = {};
  let cible: string | null = null;
  const bac: Record<string, any> = {
    window: {},
    URL, URLSearchParams, JSON,
    document: {
      documentElement: { lang, dataset: ssr ? { ssr: "1" } : {} },
      referrer,
      querySelector: (sel: string) => {
        if (sel.includes('hreflang="en"')) return hreflangEn ? { href: hreflangEn } : null;
        if (sel.includes('rel="canonical"')) return canonique ? { href: canonique } : null;
        return null;
      },
    },
    location: {
      href: url.href, search: url.search, hash: url.hash, pathname: url.pathname,
      replace: (u: string) => { cible = u; },
    },
    localStorage: { getItem: (k: string) => (k === "lang" ? prefere : null) },
    sessionStorage: { setItem: (k: string, v: string) => { session[k] = v; } },
  };
  vm.createContext(bac);
  vm.runInContext(scriptAnglais(lire("index.html")) as string, bac);
  return { cible: cible as string | null, session, depart: bac.window.__versAnglais === 1 };
}

const SITE = "https://www.athenamilitaria.fr";

describe("redirection précoce vers la version anglaise", () => {
  test("le même script dans chaque gabarit et chaque page générée (hors guides gelés)", () => {
    const reference = scriptAnglais(lire("index.html"));
    assert.ok(reference, "script absent d'index.html");
    const pages = [
      ...GABARITS_ANGLAIS,
      ...readdirSync(new URL("../categories/", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => `categories/${f}`),
      ...["guides/", "guides/en/"].flatMap((d) => readdirSync(new URL(`../${d}`, import.meta.url))
        .filter((f) => f.endsWith(".html") && !GUIDES_GELES.includes(f.replace(/\.html$/, "")))
        .map((f) => d + f)),
    ];
    for (const p of pages) assert.equal(scriptAnglais(lire(p)), reference, `${p} : script différent du gabarit`);
  });

  test("les paramètres et l'ancre suivent, lang n'est pas doublé", () => {
    const r = redirection({
      href: `${SITE}/annonce/casque-adrian-22?checkout=canceled&utm_source=lettre#acheter`,
      hreflangEn: `${SITE}/annonce/casque-adrian-22?lang=en`, canonique: `${SITE}/annonce/casque-adrian-22`,
    });
    assert.equal(r.cible, `${SITE}/annonce/casque-adrian-22?lang=en&checkout=canceled&utm_source=lettre#acheter`);
  });

  test("un guide sans paramètre va à son adresse anglaise telle quelle", () => {
    const r = redirection({ href: `${SITE}/guides/militaria-definition`, hreflangEn: `${SITE}/guides/militaria-definition?lang=en` });
    assert.equal(r.cible, `${SITE}/guides/militaria-definition?lang=en`);
  });

  test("la provenance est gardée pour la page d'arrivée, et la page quittée le sait", () => {
    const r = redirection({ href: `${SITE}/about`, hreflangEn: `${SITE}/about?lang=en`, referrer: "https://www.google.com/" });
    assert.deepEqual(JSON.parse(r.session.athena_provenance), { p: "/about", r: "https://www.google.com/" });
    assert.equal(r.depart, true);
    const direct = redirection({ href: `${SITE}/about`, hreflangEn: `${SITE}/about?lang=en` });
    assert.deepEqual(JSON.parse(direct.session.athena_provenance), { p: "/about", r: "" }, "accès direct : provenance vide, pas absente");
  });

  test("page écrite par le serveur sans hreflang : même adresse avec lang=en", () => {
    const recherche = redirection({ href: `${SITE}/militaria?q=casque+adrian`, ssr: true });
    assert.equal(recherche.cible, `${SITE}/militaria?lang=en&q=casque+adrian`);
    const fiche = redirection({ href: `${SITE}/annonce/ceinturon-41?checkout=canceled`, ssr: true, canonique: `${SITE}/annonce/ceinturon-41` });
    assert.equal(fiche.cible, `${SITE}/annonce/ceinturon-41?lang=en&checkout=canceled`);
  });

  test("jamais de boucle ni de redirection hors de propos", () => {
    const aucune = [
      // L'adresse dit déjà sa langue, quelle qu'elle soit.
      { href: `${SITE}/militaria?q=casque&lang=en`, ssr: true },
      { href: `${SITE}/militaria?lang=fr&q=casque`, ssr: true },
      // Page d'arrivée : servie en anglais (lang="en"), avec ou sans hreflang.
      { href: `${SITE}/annonce/ceinturon-41?lang=en`, lang: "en", ssr: true },
      { href: `${SITE}/annonce/ceinturon-41`, lang: "en", ssr: true },
      // Pas de préférence anglaise (robot, nouveau visiteur).
      { href: `${SITE}/militaria?q=casque`, ssr: true, prefere: null },
      { href: `${SITE}/about`, hreflangEn: `${SITE}/about?lang=en`, prefere: "fr" },
      // Page statique sans version anglaise ni rendu serveur.
      { href: `${SITE}/guides/un-guide-non-traduit` },
      // La page se déclare elle-même anglaise (canonique = hreflang en), ou l'est déjà.
      { href: `${SITE}/guides/de/un-guide`, hreflangEn: `${SITE}/guides/un-guide?lang=en`, canonique: `${SITE}/guides/un-guide?lang=en` },
      { href: `${SITE}/guides/un-guide-en#plan`, hreflangEn: `${SITE}/guides/un-guide-en` },
    ];
    for (const cas of aucune) {
      const r = redirection(cas as any);
      assert.equal(r.cible, null, JSON.stringify(cas));
      assert.deepEqual(r.session, {}, "rien n'est gardé sans redirection");
      assert.equal(r.depart, false);
    }
  });
});

/* compterVue (script.js) : provenance reprise après la redirection. */
describe("mesure d'audience après la redirection vers l'anglais", () => {
  const source = lire("script.js");
  const debut = source.indexOf("(function compterVue()");
  const fin = source.indexOf("})();", debut) + 5;
  const code = source.slice(debut, fin);

  function compter({ pathname = "/about", referrer = "", garde = null as string | null, depart = false, search = "?lang=en" } = {}) {
    const session: Record<string, string> = garde === null ? {} : { athena_provenance: garde };
    const balises: string[] = [];
    const bac: Record<string, any> = {
      window: depart ? { __versAnglais: 1 } : {},
      navigator: { sendBeacon: (_u: string, corps: { texte: string }) => { balises.push(corps.texte); return true; } },
      Blob: function Blob(this: any, parts: string[]) { this.texte = parts.join(""); },
      location: { hostname: "www.athenamilitaria.fr", pathname, search },
      document: { referrer, documentElement: { lang: "en" } },
      localStorage: { getItem: () => null },
      sessionStorage: {
        getItem: (k: string) => session[k] ?? null,
        removeItem: (k: string) => { delete session[k]; },
      },
      URL, URLSearchParams, JSON, String,
    };
    vm.createContext(bac);
    vm.runInContext(code, bac);
    return { mesure: balises.length ? JSON.parse(balises[0]) : null, session };
  }

  test("la page d'arrivée compte la provenance d'origine, puis l'oublie", () => {
    const r = compter({ referrer: `${SITE}/about`, garde: JSON.stringify({ p: "/about", r: "https://www.google.com/search" }) });
    assert.deepEqual(r.mesure, { p: "/about", l: "en", r: "www.google.com" });
    assert.deepEqual(r.session, {}, "clé à usage unique");
  });

  test("accès direct avant la redirection : aucune provenance, pas la page française", () => {
    const r = compter({ referrer: `${SITE}/about`, garde: JSON.stringify({ p: "/about", r: "" }) });
    assert.equal(r.mesure.r, "");
  });

  test("une provenance gardée pour une autre page est effacée sans servir", () => {
    const r = compter({ pathname: "/sell", referrer: `${SITE}/about`, garde: JSON.stringify({ p: "/about", r: "https://www.google.com/" }) });
    assert.equal(r.mesure.r, "www.athenamilitaria.fr");
    assert.deepEqual(r.session, {});
  });

  test("la page française quittée ne compte pas et laisse la clé à la page d'arrivée", () => {
    const garde = JSON.stringify({ p: "/about", r: "https://www.google.com/" });
    const r = compter({ pathname: "/about", search: "", depart: true, garde });
    assert.equal(r.mesure, null);
    assert.equal(r.session.athena_provenance, garde);
  });

  test("sans redirection, rien ne change", () => {
    const r = compter({ referrer: "https://www.bing.com/" });
    assert.equal(r.mesure.r, "www.bing.com");
  });
});
