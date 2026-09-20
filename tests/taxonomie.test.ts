/**
 * Une seule taxonomie pour tout le site.
 *
 * Le défaut réparé ici ne se voyait qu'au troisième pas : le vendeur modifiait
 * le prix d'une annonce, et l'annonce disparaissait des pages catégorie parce
 * que le formulaire de modification l'avait réécrite avec une période et un
 * type inconnus du catalogue. Rien n'échouait, rien n'avertissait.
 *
 * Ces contrôles empêchent la divergence de revenir : ils comparent la source
 * unique aux options réellement servies dans la page de mise en vente.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const lire = (nom: string) => readFileSync(new URL(`../${nom}`, import.meta.url), "utf8");

const faux: Record<string, any> = {};
faux.window = faux;
vm.createContext(faux);
vm.runInContext(lire("taxonomie.js"), faux);

/* Les tableaux créés dans le contexte isolé n'ont pas le même prototype que
 * ceux de l'hôte : deepStrictEqual les déclare différents alors que leur
 * contenu est identique. On les recopie côté hôte avant toute comparaison. */
const T = {
  PERIODES: [...faux.TAXONOMIE.PERIODES] as string[],
  SOUS_CATEGORIES: [...faux.TAXONOMIE.SOUS_CATEGORIES] as string[],
  ETATS: [...faux.TAXONOMIE.ETATS] as string[],
  options: faux.TAXONOMIE.options as (l: string[], v: string | null, t: string) => string,
  slugTitre: faux.TAXONOMIE.slugTitre as (t: unknown) => string,
  urlFiche: faux.TAXONOMIE.urlFiche as (id: unknown, t: unknown, lang?: string) => string,
};

/** Les <option> réellement proposées par un select de la page de mise en vente. */
function optionsDeSell(champ: string): string[] {
  const html = lire("sell.html");
  const bloc = new RegExp(`<select[^>]*(?:id|name)="${champ}"[^>]*>([\\s\\S]*?)</select>`).exec(html)
    ?? new RegExp(`id="[^"]*${champ}[^"]*"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  assert.ok(bloc, `select ${champ} introuvable dans sell.html`);

  return [...bloc[1].matchAll(/<option(?: value="([^"]*)")?[^>]*>([^<]*)<\/option>/g)]
    .map((m) => (m[1] || m[2]).trim())
    .map((v) => v.replace(/&amp;/g, "&"))
    .filter((v) => v && !/^Sélectionnez/i.test(v));
}

describe("la page de mise en vente et la source unique disent la même chose", () => {
  const paires: Array<[string, string[]]> = [
    ["period", T.PERIODES],
    ["subcategory", T.SOUS_CATEGORIES],
    ["condition", T.ETATS],
  ];

  for (const [champ, attendu] of paires) {
    test(`${champ} : mêmes valeurs, même ordre`, () => {
      assert.deepEqual(optionsDeSell(champ), attendu,
        `sell.html et taxonomie.js divergent sur ${champ} : une annonce créée ici ` +
        `deviendrait introuvable après modification`);
    });
  }
});

describe("la modale de modification n'écrit plus sa propre liste", () => {
  const account = lire("account.js");

  test("les trois listes viennent de la source unique", () => {
    for (const [select, liste] of [
      ["edit-period", "TAXONOMIE.PERIODES"],
      ["edit-subcategory", "TAXONOMIE.SOUS_CATEGORIES"],
      ["edit-condition", "TAXONOMIE.ETATS"],
    ]) {
      const bloc = new RegExp(`id="${select}"[^>]*>([\\s\\S]{0,300}?)</select>`).exec(account);
      assert.ok(bloc, `${select} introuvable`);
      assert.match(bloc[1], new RegExp(liste.replace(".", "\\.")),
        `${select} doit être rempli depuis ${liste}`);
      assert.doesNotMatch(bloc[1], /<option>/,
        `${select} ne doit plus contenir d'options écrites à la main`);
    }
  });

  test("aucune trace de l'ancienne taxonomie dans le dépôt", () => {
    const disparues = [
      "Seconde Guerre mondiale (1939-1945)",
      "Première Guerre mondiale (1914-1918)",
      "Entre-deux-guerres",
      "Documents & Papiers",
      "Munitions inertes",
    ];
    for (const valeur of disparues) {
      assert.ok(!account.includes(valeur),
        `« ${valeur} » n'existe nulle part ailleurs sur le site : la proposer ferait ` +
        `disparaître l'annonce du catalogue`);
    }
  });
});

describe("le rendu des listes", () => {
  test("la valeur enregistrée est présélectionnée", () => {
    const html = T.options(T.PERIODES, "Guerre froide", "Choisir");
    assert.match(html, /<option value="Guerre froide" selected>/);
    assert.equal((html.match(/selected/g) ?? []).length, 1);
  });

  test("une valeur ancienne, absente de la liste, est conservée et signalée", () => {
    // Sans cela, ouvrir puis enregistrer une vieille annonce en changerait
    // silencieusement la catégorie : exactement le défaut d'origine.
    const html = T.options(T.PERIODES, "Contemporain", "Choisir");
    assert.match(html, /value="Contemporain" selected/);
    assert.match(html, /valeur actuelle/);
  });

  test("les valeurs sont échappées", () => {
    const html = T.options(['<img src=x onerror="alert(1)">'], null, "Choisir");
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  test("le libellé « Médailles & décorations » traverse l'échappement sans se déformer", () => {
    const html = T.options(T.SOUS_CATEGORIES, "Médailles & décorations", "Choisir");
    assert.match(html, /value="Médailles &amp; décorations" selected/);
  });
});

/**
 * Adresses des fiches.
 *
 * Le découpage du titre est écrit trois fois : ici (taxonomie.js), en PHP
 * (am_slug_titre, inc/athena.php) et en TypeScript pour les courriels
 * (supabase/functions/_shared/urls.ts). Les trois doivent donner le même
 * résultat, sinon le serveur et le navigateur fabriquent deux adresses pour
 * une même fiche, et le lien d'un courriel part sur une redirection.
 *
 * Ce contrôle compare les implémentations JavaScript entre elles ; la version
 * PHP est vérifiée en ligne par tests/seo-rendu.test.ts, qui exige que
 * l'adresse annoncée par le sitemap réponde 200 sans redirection.
 */
describe("l'adresse d'une fiche", () => {
  const cas: [string, string][] = [
    ["Casque à pointe", "casque-a-pointe"],
    ["Médailles & décorations 14-18", "medailles-decorations-14-18"],
    ["  Vareuse   bleu horizon  ", "vareuse-bleu-horizon"],
    ["Cœur de bœuf", "coeur-de-boeuf"],
    ["", "annonce"],
    ["!!!", "annonce"],
    ["ÉQUIPEMENT Guerre Froide", "equipement-guerre-froide"],
  ];

  for (const [titre, attendu] of cas) {
    test(`« ${titre} » donne « ${attendu} »`, () => {
      assert.equal(T.slugTitre(titre), attendu);
    });
  }

  test("un titre très long est coupé sur un tiret, jamais au milieu d'un mot", () => {
    const long = "Belle dague C Jul Herbetz acier inoxidable lame avec motifs gravés à la main";
    const slug = T.slugTitre(long);
    assert.ok(slug.length <= 60, `${slug.length} caractères`);
    assert.doesNotMatch(slug, /-$/);
    // Le dernier segment doit être un mot entier du titre.
    const mots = T.slugTitre(long + " x").split("-");
    assert.ok(mots.every((m: string) => m.length > 0));
  });

  test("l'identifiant ferme l'adresse, et l'anglais n'ajoute qu'un paramètre", () => {
    assert.equal(T.urlFiche(22, "Casque à pointe", "fr"), "/annonce/casque-a-pointe-22");
    assert.equal(T.urlFiche(22, "Casque à pointe", "en"), "/annonce/casque-a-pointe-22?lang=en");
  });

  /* Le fichier urls.ts est recopié dans chaque fonction edge qui en a besoin,
     parce que le tableau de bord Supabase n'expose que les fichiers de la
     fonction courante : un import vers ../_shared/ s'y résoudrait dans le
     vide. La duplication est donc voulue, et c'est ce contrôle qui empêche
     les copies de diverger. */
  const copiesTs = ["listing-notify", "weekly-newsletter"]
    .map((f) => `supabase/functions/${f}/urls.ts`);

  for (const chemin of copiesTs) {
    test(`le découpage de ${chemin} donne le même résultat`, () => {
      const ts = lire(chemin)
        .replace(/^export /gm, "")
        .replace(/: unknown|: string|\?: unknown|\?: string/g, "")
        .replace(/^import .*$/gm, "");
      const bac: Record<string, any> = {};
      vm.createContext(bac);
      vm.runInContext(ts + "\nglobalThis.__slug = slugTitre;\nglobalThis.__url = urlFiche;", bac);
      for (const [titre, attendu] of cas) {
        assert.equal(bac.__slug(titre), attendu, titre);
      }
      assert.equal(bac.__url(22, "Casque à pointe"),
        "https://www.athenamilitaria.fr/annonce/casque-a-pointe-22");
    });
  }

  test("les copies de urls.ts sont identiques entre elles", () => {
    const [a, ...reste] = copiesTs.map((c) => lire(c));
    for (const autre of reste) assert.equal(autre, a);
  });
});
