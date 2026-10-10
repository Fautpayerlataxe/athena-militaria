/**
 * Protection acheteurs : un barème, trois calculs, les mêmes centimes.
 *
 * L'acheteur paie, en plus du prix et de la livraison, 5 % du prix arrondi
 * au centime + 0,70 €. Stripe débite le montant calculé par la fonction SQL
 * buyer_protection_fee_cents (migration 20260813000200). Depuis le 9 oct.
 * 2026, la fiche l'affiche et le compte dans les frais de livraison déclarés
 * à Google (product.php), le flux Shopping aussi (flux-produits.php), et
 * product.js écrit la même ligne quand il redessine la fiche. Le calcul est
 * donc refait en PHP (am_protection_cents, inc/athena.php) et en JavaScript
 * (protectionAcheteursCentimes, product.js) : la fonction SQL rend un nombre
 * seul, qu'am_api n'accepte pas.
 *
 * Un centime d'écart entre la fiche et Stripe serait un prix annoncé faux,
 * ce que Merchant Center sanctionne. Ces contrôles comparent donc les trois
 * calculs sur toute la plage de prix usuels, puis la fonction en ligne sur
 * quelques montants : un barème modifié dans le tableau de bord Supabase,
 * sans migration, se verrait ici.
 *
 * Ils vérifient aussi que la règle des fiches d'armes (ni Product ni
 * mainEntity) est la même dans product.php et product.js.
 *
 * Lancement : npm run test:unit pour les contrôles locaux. Le contrôle en
 * ligne interroge la base de production (rôle anon, lecture seule) : il ne
 * tourne que sur demande explicite, avec npm run test:en-ligne
 * (AM2_TEST_EN_LIGNE=1). La suite unitaire doit pouvoir tourner sans
 * toucher à la production. Il est aussi sauté hors réseau, ou si Supabase
 * répond 429 ou 5xx.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (nom: string) => readFileSync(new URL(`../${nom}`, import.meta.url), "utf8");

/* ================================================================== *
 *  La référence : la fonction SQL, telle qu'elle est écrite
 * ================================================================== */

const migration = lire("supabase/migrations/20260813000200_buyer_protection_pricing.sql");
const debutSql = migration.indexOf("FUNCTION public.buyer_protection_fee_cents(");
const corpsSql = migration.slice(debutSql, migration.indexOf("\n$$;", debutSql));
const tauxSql = Number((/v_rate\s*:=\s*(\d+);/.exec(corpsSql) || [])[1]);
const fixeSql = Number((/v_fixed\s*:=\s*(\d+);/.exec(corpsSql) || [])[1]);

/* ROUND(c × taux / 10000) + fixe, au sens de PostgreSQL : sur un numeric,
 * ROUND arrondit la demie en s'éloignant de zéro. Calcul en entiers, donc
 * exact : c'est la référence à laquelle les deux copies sont comparées. */
function selonSql(centimes: number): number {
  const n = centimes * tauxSql;
  const q = Math.floor(n / 10000);
  const reste = n - q * 10000;
  return q + (2 * reste >= 10000 ? 1 : 0) + fixeSql;
}

/* Valeurs connues de la fonction : celles de tests/db-payout.test.ts (base
 * locale) et celles relevées sur la fonction en ligne le 9 oct. 2026
 * (rpc/buyer_protection_fee_cents, rôle anon). 10, 30, 50 et 10 010
 * centimes tombent sur une demie : 0,5 → 1, 1,5 → 2, 2,5 → 3, 500,5 → 501. */
const CONNUES: Array<[number, number]> = [
  [0, 70], [1, 70], [10, 71], [19, 71], [21, 71], [30, 72], [50, 73],
  [100, 75], [500, 95], [1000, 120], [1999, 170], [2500, 195], [4000, 270],
  [4500, 295], [9000, 520], [10000, 570], [10010, 571], [12345, 687],
  [25000, 1320], [50000, 2570], [99999, 5070],
];

/* Prix des annonces, en centimes, contrôlés un par un : de 0 à 2 000 €. */
const PLAGE = 200_000;

describe("la fonction SQL de référence", () => {
  test("le barème de la migration est bien 5 % + 0,70 €, arrondi par ROUND", () => {
    assert.notEqual(debutSql, -1, "buyer_protection_fee_cents absente de la migration");
    assert.equal(tauxSql, 500);
    assert.equal(fixeSql, 70);
    assert.match(corpsSql, /RETURN ROUND\(\(p_product_cents \* v_rate\)::numeric \/ 10000\)::int \+ v_fixed;/,
      "la formule a changé : refaire les calculs PHP et JavaScript, et ce test");
  });

  test("la référence rend les valeurs connues de la fonction", () => {
    for (const [c, attendu] of CONNUES) assert.equal(selonSql(c), attendu, `${c} centimes`);
  });
});

/* ================================================================== *
 *  Le calcul PHP (inc/athena.php), exécuté sans PHP
 * ================================================================== */

const athena = lire("inc/athena.php");

function constantePhp(nom: string): number {
  const m = new RegExp(`const ${nom}\\s*=\\s*(\\d+);`).exec(athena);
  assert.ok(m, `constante ${nom} absente de inc/athena.php`);
  return Number(m[1]);
}

/* L'expression rendue par une fonction PHP d'une seule instruction. */
function retourPhp(nom: string): { parametre: string; expression: string } {
  const m = new RegExp(`function ${nom}\\(\\s*(?:int\\s+)?\\$(\\w+)\\s*\\)\\s*:\\s*int\\s*\\{\\s*return ([^;]+);\\s*\\}`).exec(athena);
  assert.ok(m, `${nom} absente de inc/athena.php, ou plus d'une instruction : adapter ce test`);
  return { parametre: m[1], expression: m[2] };
}

/* Traduction littérale, limitée aux tournures employées : un cast (int)
 * devant un appel, un cast (float) devant une variable, intdiv, round, max
 * et les constantes du fichier. Toute autre tournure fait échouer le test,
 * qu'il faudra alors étendre plutôt que contourner. */
function enJavaScript(expression: string): string {
  let js = expression
    .replace(/\bAM_\w+\b/g, (nom) => String(constantePhp(nom)))
    .replace(/\(float\)\s*\$(\w+)/g, "Number($1)")
    .replace(/\$(\w+)/g, "$1")
    .replace(/\bintdiv\(/g, "__intdiv(")
    .replace(/\bround\(/g, "__round(")
    .replace(/\bmax\(/g, "Math.max(");
  for (let i = js.indexOf("(int)"); i !== -1; i = js.indexOf("(int)")) {
    const debut = js.indexOf("(", i + 5);
    let profondeur = 0;
    let fin = debut;
    for (; fin < js.length; fin++) {
      if (js[fin] === "(") profondeur++;
      if (js[fin] === ")" && --profondeur === 0) break;
    }
    js = js.slice(0, i) + "Math.trunc(" + js.slice(i + 5, fin + 1).trim() + ")" + js.slice(fin + 1);
  }
  assert.doesNotMatch(js, /\((?:int|float|string|bool|array)\)|\$|::/, `tournure PHP non traduite : ${js}`);
  return js;
}

const AIDES_PHP = `
  const __intdiv = (a, b) => Math.trunc(a / b);
  const __round = (x) => Math.sign(x) * Math.round(Math.abs(x));
`;

function fonctionPhp(nom: string): (x: number) => number {
  const { parametre, expression } = retourPhp(nom);
  return new Function(parametre, AIDES_PHP + "return " + enJavaScript(expression) + ";") as (x: number) => number;
}

const amCentimes = fonctionPhp("am_centimes");
const amProtection = fonctionPhp("am_protection_cents");

describe("le calcul PHP de la fiche et du flux", () => {
  test("ses constantes sont celles de la migration", () => {
    assert.equal(constantePhp("AM_PROTECTION_TAUX_BPS"), tauxSql);
    assert.equal(constantePhp("AM_PROTECTION_FIXE_CENTS"), fixeSql);
  });

  test("il rend les valeurs connues de la fonction SQL", () => {
    for (const [c, attendu] of CONNUES) assert.equal(amProtection(c), attendu, `${c} centimes`);
  });

  test("prix lu en base → centimes → Protection : identique à la référence de 0 à 2 000 €", () => {
    for (let c = 0; c <= PLAGE; c++) {
      /* PostgREST rend le prix en nombre JSON (19.99), décodé en flottant. */
      const prix = c / 100;
      const centimes = amCentimes(prix);
      if (centimes !== c) assert.fail(`am_centimes(${prix}) = ${centimes}, attendu ${c}`);
      const p = amProtection(centimes);
      if (p !== selonSql(c)) assert.fail(`am_protection_cents(${c}) = ${p}, attendu ${selonSql(c)}`);
    }
  });

  test("le montant affiché garde ses deux décimales et ses espaces insécables", () => {
    const corps = /function am_montant_cents\([\s\S]*?\n\}/.exec(athena)?.[0] ?? "";
    assert.match(corps, /'€' \. number_format\(\$n, 2, '\.', ','\)/, "anglais : €13.20");
    assert.match(corps, /number_format\(\$n, 2, ',', "\\u\{202F\}"\) \. "\\u\{00A0\}€"/, "français : 13,20 €");
  });

  test("la fiche et le flux s'en servent pour les frais de livraison déclarés", () => {
    const fiche = lire("product.php");
    assert.match(fiche, /\$protection = am_protection_cents\(am_centimes\(\$p\['price'\] \?\? 0\)\);/);
    assert.match(fiche, /'value' => am_nombre\(\(\(int\) \$r\['amount_cents'\] \+ \$protection\) \/ 100\)/);
    assert.match(fiche, /tr_js_product\.protection_line/, "la ligne visible sous le choix de livraison");
    const flux = lire("flux-produits.php");
    assert.match(flux, /\$protection = am_protection_cents\(am_centimes\(\$p\['price'\]\)\);/);
    assert.match(flux, /number_format\(\(\(int\) \$tarifs\[\$mode\]\['amount_cents'\] \+ \$protection\) \/ 100, 2, '\.', ''\)/);
  });
});

/* ================================================================== *
 *  Le calcul JavaScript (product.js)
 * ================================================================== */

const produitJs = lire("product.js");

function fonctionJs<T>(nom: string): T {
  const m = new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(produitJs);
  assert.ok(m, `${nom} absente de product.js`);
  return new Function(m[0] + `\nreturn ${nom};`)() as T;
}

const protectionJs = fonctionJs<(prix: unknown) => number>("protectionAcheteursCentimes");
const montantJs = fonctionJs<(c: number, anglais: boolean) => string>("montantCentimes");

describe("le calcul JavaScript de la fiche redessinée", () => {
  test("identique à la référence de 0 à 2 000 €, prix donné en euros", () => {
    for (let c = 0; c <= PLAGE; c++) {
      const p = protectionJs(c / 100);
      if (p !== selonSql(c)) assert.fail(`protectionAcheteursCentimes(${c / 100}) = ${p}, attendu ${selonSql(c)}`);
    }
    // Le prix arrive aussi en chaîne ou manquant : jamais de NaN affiché.
    assert.equal(protectionJs("250"), 1320);
    assert.equal(protectionJs(undefined), 70);
  });

  test("montant écrit comme les tarifs de livraison", () => {
    assert.equal(montantJs(1320, false), "13,20\u00a0€");
    assert.equal(montantJs(270, false), "2,70\u00a0€");
    assert.equal(montantJs(100070, false), "1\u202f000,70\u00a0€");
    assert.equal(montantJs(1320, true), "€13.20");
    assert.equal(montantJs(100070, true), "€1,000.70");
  });
});

/* ================================================================== *
 *  Les textes annoncent le même barème
 * ================================================================== */

describe("les textes", () => {
  const dico = lire("i18n.js");
  const valeurs = (cle: string) =>
    [...dico.matchAll(new RegExp(`"${cle.replace(/\./g, "\\.")}": "((?:[^"\\\\]|\\\\.)*)"`, "g"))].map((m) => m[1]);

  test("la ligne de la fiche, en français et en anglais", () => {
    const [fr, en] = valeurs("tr_js_product.protection_line");
    assert.ok(fr && en, "clé tr_js_product.protection_line absente");
    assert.match(fr, /^Protection acheteurs\u00a0: \{montant\} \(5\u00a0% du prix de l’article \+\u00a00,70\u00a0€\)/);
    assert.match(en, /^Buyer Protection: \{montant\} \(5% of the item price \+\u00a0€0\.70\)/);
    assert.equal(tauxSql, 500, "le texte dit 5 %");
    assert.equal(fixeSql, 70, "le texte dit 0,70 €");
  });

  test("les conditions de vente décrivent les mêmes frais, sans commission vendeur", () => {
    const [fr, en] = valeurs("tr_legal.s3_4_body");
    assert.match(fr, /Protection acheteurs de 5\u00a0% du prix de l'article \+\u00a00,70\u00a0€/);
    assert.match(fr, /ne paie aucune commission/);
    assert.match(en, /Buyer Protection fee of 5% of the item price \+\u00a0€0\.70/);
    /* « qui reviennent à », pas « conservés par » : le site n'a aucune règle
       sur le sort de ces frais en cas de remboursement, et le texte ne doit
       pas en laisser entendre une. */
    assert.doesNotMatch(fr + en, /conservés par|kept by/);
    const [faqFr, faqEn] = valeurs("tr_about.faq_a1");
    assert.match(faqFr, /de 5\u00a0% du prix de l'article \+\u00a00,70\u00a0€/);
    assert.match(faqEn, /of 5% of the item price \+\u00a0€0\.70/);
    assert.doesNotMatch(lire("legal.html"), /perçoit, le cas échéant, une commission/);
    assert.doesNotMatch(lire("about.html"), /Une commission peut être prélevée/);
    assert.doesNotMatch(lire("account.html"), /commission de 8/);
  });
});

/* ================================================================== *
 *  Fiches d'armes : la même règle des deux côtés
 * ================================================================== */

describe("fiches d'armes, sans Product", () => {
  /* Concatène les littéraux d'une constante écrite sur plusieurs lignes. */
  function listeMots(source: string, debut: RegExp, guillemet: string): string {
    const m = debut.exec(source);
    assert.ok(m, "liste des mots d'armes introuvable");
    const fin = source.indexOf(";", m.index);
    const litteral = new RegExp(`${guillemet}([^${guillemet}]*)${guillemet}`, "g");
    return [...source.slice(m.index, fin).matchAll(litteral)].map((x) => x[1]).join("");
  }

  const motsPhp = listeMots(lire("product.php"), /const FICHE_MOTS_ARMES = /, "'");
  const motsJs = listeMots(produitJs, /const MOTS_ARMES = /, '"');
  // ficheArme lit la constante MOTS_ARMES du fichier : on la lui fournit.
  const arme = new Function("MOTS_ARMES",
    /function ficheArme\([^)]*\) \{[\s\S]*?\n\}/.exec(produitJs)![0] + "\nreturn ficheArme;")(motsJs) as
    (p: Record<string, unknown>) => boolean;

  test("product.php et product.js ont la même liste", () => {
    assert.ok(motsPhp.includes("dagues?") && motsPhp.includes("munitions?"));
    assert.equal(motsJs, motsPhp);
  });

  test("seul le titre décide, ou la catégorie Armes", () => {
    // Les neuf annonces publiées le 9 oct. 2026 : seule la dague (21) est une arme.
    const enLigne: Array<[number, string, string, string, boolean]> = [
      [9, "Caisses militaire françaises d’origine, modèle 1956", "Original French military crates, 1956 model", "Équipements", false],
      [21, "Belle Dague C.Jul. Herbetz acier inoxidable lame avec motifs Damas", "Beautiful dagger by C.Jul. Herbetz, with a stainless steel blade featuring Damascene patterns", "Objets divers", true],
      [22, "Casque à pointe", "Spiked helmet", "Uniformes", false],
      [23, "Livre sur la détection des reproductions des insignes de combat du IIIeme Reich", "A book on identifying reproductions of Third Reich combat insignia", "Médailles & décorations", false],
      [25, "MASQUE A GAZ ALLEMAND COMPLET WW2", "COMPLETE GERMAN GAS MASK, WW2", "Équipements", false],
      [26, "CASQUE US WW2 D'ORIGINE", "ORIGINAL US WW2 HELMET", "Équipements", false],
      [27, "Plaque identité ww1 plaque belges ", "WW1 identity tags – Belgian tags ", "Objets divers", false],
      [28, "CASQUE US TANKISTE WW2 ", "WW2 US TANK CREW HELMET ", "Équipements", false],
      [30, "Trousse hypodermique de poche pour gilet ", "Pocket hypodermic kit for a waistcoat ", "Objets divers", false],
    ];
    for (const [id, title, title_en, subcategory, attendu] of enLigne) {
      assert.equal(arme({ title, title_en, subcategory }), attendu, `annonce ${id}`);
    }
    const cas: Array<[Record<string, unknown>, boolean]> = [
      [{ title: "Épée d'officier d'infanterie modèle 1882" }, true],
      [{ title: "Baïonnette Lebel 1886" }, true],
      [{ title: "Sabre-briquet" }, true],
      [{ title: "Insigne de fusilier marin" }, false],
      [{ title: "Cartouchière en cuir" }, false],
      /* Le titre du vendeur décide, pas sa traduction automatique : une
         giberne traduite en « cartridge box » n'est pas une arme. La
         traduction ne sert que si le titre manque. */
      [{ title: "Cartouchière en cuir", title_en: "Leather cartridge pouch" }, false],
      [{ title: "Giberne d'infanterie modèle 1845", title_en: "Infantry cartridge box, model 1845" }, false],
      [{ title: "WW1 French bayonet", title_en: "WW1 French bayonet" }, true],
      [{ title: "", title_en: "WW1 French bayonet" }, true],
      [{ title: "Caisse à munitions vide" }, true],
      [{ title: "Lebel 1886 neutralisé", subcategory: "Armes (neutralisées/maquettes)" }, true],
      [{ title: "Képi de capitaine", description: "Vendu avec une baïonnette" }, false],
    ];
    for (const [p, attendu] of cas) assert.equal(arme(p), attendu, String(p.title));
  });

  test("product.php retire Product et mainEntity, garde ItemPage et le fil", () => {
    const fiche = lire("product.php");
    // Même règle que ficheArme : le titre du vendeur, sa traduction s'il manque.
    assert.match(fiche, /\$titreArme = trim\(\(string\) \(\$p\['title'\] \?\? ''\)\) !== '' \? \(string\) \$p\['title'\] : \(string\) \(\$p\['title_en'\] \?\? ''\);/);
    assert.match(fiche, /FICHE_MOTS_ARMES \. '\)\\b~iu', \$titreArme\) === 1;/);
    assert.match(fiche, /'mainEntity' => \$arme \? null :/);
    assert.match(fiche, /\$arme \? null : \$produit,/);
    assert.match(fiche, /'@type'      => 'ItemPage'/);
    assert.match(fiche, /'@type' => 'BreadcrumbList', '@id' => \$canonique \. '#fil'/);
  });
});

/* ================================================================== *
 *  La fonction en ligne, rôle anon
 * ================================================================== */

test("la fonction en ligne rend les mêmes centimes", async (t) => {
  if (process.env.AM2_TEST_EN_LIGNE !== "1") {
    t.skip("contrôle en ligne sur demande seulement : npm run test:en-ligne");
    return;
  }
  const client = lire("supabaseClient.js");
  const url = (/SUPABASE_URL = "([^"]+)"/.exec(client) || [])[1];
  const cle = (/SUPABASE_ANON_KEY = "([^"]+)"/.exec(client) || [])[1];
  assert.ok(url && cle, "adresse ou clé publique introuvable dans supabaseClient.js");
  for (const [c] of CONNUES.filter((_, i) => i % 3 === 0)) {
    let rep: Response;
    try {
      rep = await fetch(url + "/rest/v1/rpc/buyer_protection_fee_cents", {
        method: "POST",
        headers: { apikey: cle, Authorization: "Bearer " + cle, "Content-Type": "application/json" },
        body: JSON.stringify({ p_product_cents: c }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      t.skip("Supabase injoignable : contrôle en ligne sauté");
      return;
    }
    /* Débit limité ou service en panne : rien ne dit alors que le barème
       a changé, et la suite unitaire ne doit pas échouer pour autant. Toute
       autre réponse (clé refusée, fonction disparue) reste une erreur. */
    if (rep.status === 429 || rep.status >= 500) {
      t.skip(`Supabase indisponible (${rep.status}) : contrôle en ligne sauté`);
      return;
    }
    assert.equal(rep.status, 200, `rpc/buyer_protection_fee_cents a répondu ${rep.status}`);
    assert.equal(Number(await rep.text()), selonSql(c), `${c} centimes`);
  }
});
