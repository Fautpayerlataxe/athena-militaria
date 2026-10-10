/* Génère une copie de category.html par catégorie disposant d'un texte de
   contexte, dans categories/.

   Le fichier générique reste servi tel quel pour /category et pour toute
   catégorie sans texte : ces copies ne remplacent rien, elles s'ajoutent.
   category.php choisit la bonne au moment de la requête d'après
   inc/categories.json, écrit ici, puis y ajoute les annonces. L'adresse
   affichée ne change pas.

   Régénérer à chaque déploiement est indispensable : la copie doit suivre
   toute évolution de category.html, sans quoi une catégorie servirait une
   version figée du bandeau, des filtres ou des scripts.

   Appelé par deploy-ovh.sh avant l'upload. */
const fs = require("fs");
const path = require("path");

const SITE = "https://www.athenamilitaria.fr";
const GABARIT = "category.html";
const DOSSIER = "categories";
const DEBUT = "<!-- contexte:debut -->";
const FIN = "<!-- contexte:fin -->";
const P_DEBUT = "<!-- periodes:debut -->";
const P_FIN = "<!-- periodes:fin -->";

/* Retire du corps générique le résumé des quatre périodes.
   Sur une page consacrée à une période, ce paragraphe fait double emploi avec
   le texte qui la précède, et il est rigoureusement identique sur les seize
   adresses du catalogue : le garder alourdissait la lecture et diluait la
   part du contenu propre à la page. Si les marqueurs manquent, on ne touche
   à rien plutôt que de mutiler la page. */
function sansResumePeriodes(html) {
  const a = html.indexOf(P_DEBUT);
  const b = html.indexOf(P_FIN);
  if (a === -1 || b === -1 || b < a) return html;
  return html.slice(0, a) + html.slice(b + P_FIN.length);
}

const { CATEGORIES } = require("./categories-contenu.cjs");

/* taxonomie.js est un script de navigateur (le dépôt est en modules ES) :
   on l'exécute dans un bac à sable, comme tests/taxonomie.test.ts. */
const TAXONOMIE = (() => {
  const bac = {};
  require("vm").runInNewContext(require("fs").readFileSync(require("path").join(__dirname, "taxonomie.js"), "utf8"), bac);
  return bac.TAXONOMIE;
})();

/* Libellés lisibles, repris des clés cat.* de i18n.js par taxonomie.js. Ils
   composent les mêmes titres que category.php, qui réécrit de toute façon
   ces balises à chaque demande : les deux doivent coïncider. */
function libelle(valeur, cles) {
  const cle = cles[valeur];
  const dict = require("./inc/i18n-dict.json");
  const texte = cle && dict.fr && dict.fr[cle];
  return texte ? texte.replace(/<[^>]+>/g, "") : valeur;
}

/* Balises de tête propres à la page.
   category.html porte un titre, une description et une canonique qui
   désignent le catalogue entier : les copies en hériteraient telles
   quelles, et les seize pages se déclareraient la même adresse dans le HTML
   servi. On les écrit donc dans le fichier, à la génération ; category.php
   les réécrit ensuite avec le nombre réel d'annonces. */
function enTete(c) {
  const catL = libelle(c.periode, TAXONOMIE.CLES_PERIODES);
  const subL = c.type ? libelle(c.type, TAXONOMIE.CLES_TYPES) : "";
  /* Un collectionneur ne tape pas « 2nde Guerre Mondiale » dans Google : il
     tape « militaria 39-45 ». Une seule mention, dans le titre visible de la
     page, et seulement sur la page de période. */
  /* Mêmes formules que category.php : « Médailles 14-18 à vendre ». */
  const ERES = { "1ère Guerre Mondiale": "14-18", "2nde Guerre Mondiale": "39-45", "Guerre froide": "guerre froide",
    "Guerre de 1870": "1870", "Guerre d'Indochine": "Indochine", "Guerre d'Algérie": "guerre d'Algérie" };
  const PRECISIONS = { "1ère Guerre Mondiale": " : Première Guerre mondiale", "2nde Guerre Mondiale": " : Seconde Guerre mondiale" };
  const ere = ERES[c.periode] || catL;
  const theme = subL ? `${subL} ${ere}` : `Militaria ${ere}`;

  const urlFr = SITE + TAXONOMIE.urlCategorie(c.periode, c.type || null, "fr");
  const urlEn = SITE + TAXONOMIE.urlCategorie(c.periode, c.type || null, "en");
  // Dans un attribut HTML, l'esperluette s'écrit &amp; : elle se relit &.
  const att = (u) => u.replace(/&/g, "&amp;");

  return {
    h1: c.type ? `${theme} à vendre` : `${theme}${PRECISIONS[c.periode] || ""}`,
    titre: `${theme} à vendre | Athena Militaria`,
    // Annonces modérées, pas expertisées : pas de « pièces vérifiées ».
    description: c.seoDescription || `${theme} à vendre entre collectionneurs : photos détaillées, état décrit, contact direct avec le vendeur. Dépôt d'annonce gratuit.`,
    ogTitre: `${theme} à vendre`,
    urlFr: att(urlFr),
    urlEn: att(urlEn),
  };
}

/* Remplace dans le document les balises héritées du fichier générique. */
function reecrireEnTete(html, c) {
  const t = enTete(c);
  const ech = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const remplacer = (source, motif, valeur) => {
    if (!motif.test(source)) throw new Error("balise introuvable pour " + c.slug + " : " + motif);
    return source.replace(motif, valeur);
  };

  html = remplacer(html, /<title>[^<]*<\/title>/, `<title>${ech(t.titre)}</title>`);
  html = remplacer(html,
    /<h1 id="category-title"[^>]*>[^<]*<\/h1>/,
    `<h1 id="category-title">${ech(t.h1)}</h1>`);
  html = remplacer(html, /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${ech(t.description)}">`);
  html = remplacer(html, /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${t.urlFr}">`);
  html = remplacer(html, /<link rel="alternate" hreflang="fr" href="[^"]*">/,
    `<link rel="alternate" hreflang="fr" href="${t.urlFr}">`);
  html = remplacer(html, /<link rel="alternate" hreflang="en" href="[^"]*">/,
    `<link rel="alternate" hreflang="en" href="${t.urlEn}">`);
  html = remplacer(html, /<link rel="alternate" hreflang="x-default" href="[^"]*">/,
    `<link rel="alternate" hreflang="x-default" href="${t.urlFr}">`);
  html = remplacer(html, /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${ech(t.ogTitre)}">`);
  html = remplacer(html, /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${ech(t.description)}">`);
  html = remplacer(html, /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${t.urlFr}">`);
  return html;
}

/* Texte de la catégorie, en français et, s'il existe, en anglais.
   Les deux versions sont écrites dans la copie ; category.php n'en garde
   qu'une, celle de la langue servie (marqueurs contexte-fr et contexte-en).
   Jusqu'au 28 sept. 2026 le texte n'existait qu'en français et la page
   anglaise le perdait entièrement : 490 mots contre 1 000, et des positions
   de 55 à 68 sur « ww1 militaria » ou « wwi militaria for sale ». */
function bloc(c) {
  const id = "contexte-" + c.slug;
  const fr = `      <!-- contexte-fr:debut -->
      <section class="about-section" id="${id}" aria-labelledby="${id}-title">
        <h2 id="${id}-title">${c.titre}</h2>${c.corps}
      </section>
      <!-- contexte-fr:fin -->`;
  if (!c.corps_en) return fr;
  return fr + `
      <!-- contexte-en:debut -->
      <section class="about-section" id="${id}-en" lang="en" aria-labelledby="${id}-en-title" hidden>
        <h2 id="${id}-en-title">${c.titre_en}</h2>${c.corps_en}
      </section>
      <!-- contexte-en:fin -->`;
}

function construire() {
  const gabarit = fs.readFileSync(GABARIT, "utf8");
  const a = gabarit.indexOf(DEBUT);
  const b = gabarit.indexOf(FIN);
  if (a === -1 || b === -1 || b < a) {
    throw new Error("marqueurs de contexte absents de " + GABARIT);
  }

  fs.mkdirSync(DOSSIER, { recursive: true });

  /* Les fichiers d'une catégorie retirée de categories-contenu.cjs resteraient
     sinon sur le disque, seraient réenvoyés à chaque déploiement et
     continueraient d'être servis par une règle .htaccess qu'on aurait oublié
     de retirer. On repart d'un dossier propre. */
  for (const f of fs.readdirSync(DOSSIER)) {
    if (f.endsWith(".html")) fs.unlinkSync(path.join(DOSSIER, f));
  }

  /* Guides qui répondent à la question du visiteur de chaque catégorie.
     Choix éditorial, écrit en clair : c'est l'auteur qui sait qu'un
     collectionneur de médailles 14-18 a besoin du guide des décorations et
     de celui de la croix de guerre, pas d'une liste calculée. category.php
     s'en sert pour qu'une catégorie sans annonce reste une page utile.
     Le 9 oct. 2026, sur « militaria guerre froide », Google affichait pour
     /militaria/guerre-froide un extrait tiré de la carte du guide de
     définition, alors première de la liste et sans rapport avec la période :
     le guide propre à la guerre froide passe donc en tête des quatre pages
     de la période. */
  const GUIDES_LIES = {
    "guerre-napoleonienne": [
      "legion-honneur-dater-valeur",
      "reconnaitre-un-faux-militaria",
      "estimer-objet-militaire-valeur"
    ],
    "1ere-guerre-mondiale": [
      "identifier-casque-adrian-1915",
      "medailles-14-18-identifier",
      "croix-de-guerre-1914-1918",
      "plaque-identite-militaire"
    ],
    "2nde-guerre-mondiale": [
      "identifier-casque-allemand-ww2",
      "vendre-militaria-legalement-france",
      "reconnaitre-un-faux-militaria"
    ],
    "guerre-froide": [
      "militaria-guerre-froide",
      "militaria-definition",
      "identifier-insigne-militaire-francais",
      "dater-uniforme-militaire-francais",
      "reconnaitre-un-faux-militaria"
    ],
    "guerre-napoleonienne-uniformes": [
      "dater-uniforme-militaire-francais",
      "entretien-militaria-cuir-textile-metal",
      "reconnaitre-un-faux-militaria"
    ],
    /* Le guide du sabre (10 oct. 2026) entre dans les deux pages d'armes :
       en tête sous l'Empire, où le sabre de cavalerie et le briquet sont les
       armes blanches de la période ; après la baïonnette pour 1914-1918,
       dont le texte de la catégorie parle déjà. */
    "guerre-napoleonienne-armes": [
      "sabre-militaire-francais",
      "identifier-baionnette-francaise",
      "vendre-militaria-legalement-france",
      "entretien-militaria-cuir-textile-metal"
    ],
    "guerre-napoleonienne-documents": [
      "documents-photos-militaires-identifier",
      "heritage-militaria-que-faire",
      "lexique-militaria"
    ],
    /* Le casque de cuirassier ou de dragon (10 oct. 2026) suit l'Adrian :
       c'est le casque à crinière de la cavalerie en 1914, sous sa housse,
       que l'Adrian a remplacé. */
    "1ere-guerre-mondiale-uniformes": [
      "casque-a-pointe-identifier",
      "dater-uniforme-militaire-francais",
      "identifier-casque-adrian-1915",
      "casque-cuirassier-dragon",
      "entretien-militaria-cuir-textile-metal"
    ],
    "1ere-guerre-mondiale-armes": [
      "identifier-baionnette-francaise",
      "sabre-militaire-francais",
      "munitions-obus-que-faire",
      "vendre-militaria-legalement-france"
    ],
    /* La fourragère (10 oct. 2026) ferme la liste : elle se trouve dans les
       mêmes boîtes et sur les mêmes photographies que les décorations, mais
       ce n'en est pas une, et les guides des médailles gardent la tête. */
    "1ere-guerre-mondiale-medailles": [
      "medailles-14-18-identifier",
      "medaille-militaire-dater-valeur",
      "croix-de-guerre-1914-1918",
      "medaille-commemorative-1914-1918",
      "medaille-de-verdun",
      "croix-du-combattant",
      "fourragere-militaire"
    ],
    "2nde-guerre-mondiale-uniformes": [
      "dater-uniforme-militaire-francais",
      "identifier-casque-allemand-ww2",
      "reconnaitre-un-faux-militaria"
    ],
    "2nde-guerre-mondiale-armes": [
      "identifier-baionnette-francaise",
      "vendre-militaria-legalement-france",
      "munitions-obus-que-faire"
    ],
    "2nde-guerre-mondiale-objets-divers": [
      "identifier-insigne-militaire-francais",
      "reconnaitre-un-faux-militaria",
      "heritage-militaria-que-faire"
    ],
    "guerre-froide-uniformes": [
      "militaria-guerre-froide",
      "dater-uniforme-militaire-francais",
      "identifier-insigne-militaire-francais",
      "entretien-militaria-cuir-textile-metal"
    ],
    "guerre-froide-documents": [
      "militaria-guerre-froide",
      "documents-photos-militaires-identifier",
      "lexique-militaria",
      "heritage-militaria-que-faire"
    ],
    /* Le guide de valeur du casque Adrian figurait ici jusqu'au 9 oct. 2026 :
       un objet de 14-18 n'a rien à faire parmi les équipements de 1947-1991. */
    "guerre-froide-equipements": [
      "militaria-guerre-froide",
      "identifier-insigne-militaire-francais",
      "entretien-militaria-cuir-textile-metal"
    ]
  };

  /* Premier paragraphe du texte de la catégorie, sans balises : les fiches
     l'affichent sous l'annonce. Une annonce fait souvent trois phrases, et
     Google range une page aussi courte en « explorée, non indexée » ; le
     contexte de la période lui donne de quoi être comprise, et un lien vers
     la catégorie qui la contient. */
  const resume = (corps) => {
    const m = String(corps || "").match(/<p[^>]*>([\s\S]*?)<\/p>/);
    return m ? m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
  };
  const manifeste = [];
  for (const c of CATEGORIES) {
    const html = gabarit.slice(0, a + DEBUT.length) + "\n" + bloc(c) + "\n      " + gabarit.slice(b);
    fs.writeFileSync(path.join(DOSSIER, c.slug + ".html"), reecrireEnTete(sansResumePeriodes(html), c));
    manifeste.push({ slug: c.slug, periode: c.periode, type: c.type || "", guides: GUIDES_LIES[c.slug] || [], seoDescription: c.seoDescription || "",
      resume: resume(c.corps), resume_en: resume(c.corps_en) });
  }

  /* Table lue par category.php pour choisir la copie à servir. Elle remplace
     les seize règles .htaccess qu'il fallait recopier à la main à chaque
     catégorie ajoutée, et dont l'oubli passait inaperçu. */
  fs.mkdirSync("inc", { recursive: true });
  fs.writeFileSync(path.join("inc", "categories.json"), JSON.stringify(manifeste, null, 1));

  console.log("   " + CATEGORIES.length + " page(s) de catégorie générée(s) dans " + DOSSIER + "/, index dans inc/categories.json");
}

if (require.main === module) {
  try { construire(); } catch (e) { console.error("   erreur:", e.message); process.exit(1); }
}

module.exports = { CATEGORIES, DOSSIER, construire };
