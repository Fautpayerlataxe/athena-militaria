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
