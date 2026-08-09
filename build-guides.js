/* Génère les pages de /guides/ à partir du gabarit de legal.html.
   On réutilise l'ossature existante (bandeau, pied de page, modale de
   connexion, scripts) plutôt que de la dupliquer à la main : une évolution du
   header se répercute ainsi sur les guides au prochain build.
   Appelé par deploy-ovh.sh avant l'upload. */
const fs = require("fs");
const path = require("path");

const SITE = "https://www.athenamilitaria.fr";
const GABARIT = "legal.html";
const DOSSIER = "guides";

/* Numéros de version des ressources (style.css?v=101 et compagnie), lus dans
   le gabarit plutôt que recopiés ici.
   Ils étaient écrits en dur, à deux endroits qui plus est : incrémenter la
   version dans toutes les pages du site ne suffisait donc pas, ce build
   réécrivait ensuite les guides avec les anciens numéros et la production
   servait un script.js périmé sur /guides, sans que rien ne le signale.
   Une version introuvable dans le gabarit vaut mieux sans paramètre du tout
   qu'avec un numéro inventé : le fichier reste servi, simplement non versionné. */
function versionRessource(fichier) {
  try {
    const html = fs.readFileSync(GABARIT, "utf8");
    const m = html.match(new RegExp(fichier.replace(".", "\\.") + "\\?v=(\\d+)"));
    return m ? fichier + "?v=" + m[1] : fichier;
  } catch (e) {
    return fichier;
  }
}
const V_CSS = versionRessource("style.css");
const V_I18N = versionRessource("i18n.js");
const V_SCRIPT = versionRessource("script.js");
const V_SBCLIENT = versionRessource("supabaseClient.js");

/* --------------------------------------------------------------------------
   Contenu des guides. Un objet par guide, du texte et rien d'autre : toute la
   mécanique (balises, données structurées, fil d'Ariane) est générée plus bas.
-------------------------------------------------------------------------- */
const { GUIDES } = require("./guides-contenu.js");

/* Libellés de l'habillage des pages de guides, par langue.
   La version anglaise ne se contentait pas d'être absente : elle n'existait pas.
   Un visiteur en ?lang=en recevait le HTML français, que le script de traduction
   ne pouvait qu'effleurer, faute de clés sur le corps de l'article. On génère
   donc un fichier par langue, chacun cohérent de bout en bout : son sommaire,
   ses ancres, sa FAQ, ses données structurées et sa balise canonique. */
const TEXTES = {
  fr: {
    sommaire: "Au sommaire", faq: "Questions fréquentes", aLireAussi: "À lire aussi",
    accueil: "Accueil", guides: "Guides", filAriane: "Fil d'Ariane",
    ctaTitre: "Vous avez identifié vos pièces&nbsp;?",
    ctaTexte: "La mise en ligne d'une annonce est gratuite et le paiement est sécurisé.",
    ctaBouton: "Déposer une annonce", lireGuide: "Lire le guide",
    indexTitre: "Guides du collectionneur de militaria",
    indexDesc: "Identifier, authentifier, conserver et vendre des objets militaires de collection. Nos guides pratiques, écrits pour les héritiers comme pour les collectionneurs.",
    indexChapeau: "Hériter d'une malle, douter devant une annonce, ne pas savoir si l'on a le droit de vendre : ces situations reviennent sans cesse. Voici ce que nous avons écrit pour y répondre, sans jargon et sans affirmation approximative.",
    locale: "fr_FR", inLanguage: "fr-FR", htmlLang: "fr",
  },
  en: {
    sommaire: "Contents", faq: "Frequently asked questions", aLireAussi: "Further reading",
    accueil: "Home", guides: "Guides", filAriane: "Breadcrumb",
    ctaTitre: "Have you identified your pieces?",
    ctaTexte: "Listing an item is free and payment is secure.",
    ctaBouton: "List an item", lireGuide: "Read the guide",
    indexTitre: "Militaria collector's guides",
    indexDesc: "Identifying, authenticating, preserving and selling collectable military items. Practical guides written for heirs and collectors alike.",
    indexChapeau: "Inheriting a trunk, hesitating over a listing, not knowing whether you are allowed to sell: these situations come up again and again. Here is what we have written to answer them, without jargon and without loose claims.",
    locale: "en_US", inLanguage: "en", htmlLang: "en",
  },
};

/* Champ d'un guide dans la langue demandée, avec repli sur le français.
   Un guide non encore traduit reste ainsi lisible plutôt que vide. */
const champ = (g, nom, lang) => (lang === "en" && g[nom + "_en"]) || g[nom];

// Un guide n'a de version anglaise que si son corps est traduit.
const traduit = (g) => Boolean(g.corps_en);

/* -------------------------------------------------------------------------- */

const echapper = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function shell() {
  const src = fs.readFileSync(GABARIT, "utf8");
  const iBody = src.indexOf("<body>");
  const iMain = src.indexOf('<main id="main-content"');
  const iFinMain = src.indexOf("</main>");
  if (iBody === -1 || iMain === -1 || iFinMain === -1) throw new Error("gabarit illisible");
  /* Les guides vivent dans /guides/, un niveau plus bas que le gabarit.
     Tout chemin relatif du bandeau ou du pied de page s'y résoudrait donc
     dans /guides/ et renverrait 404 : c'est exactement ce qui cassait le
     logo. On absolutise les ressources reprises du gabarit. */
  const absolutiser = (html) => html.replace(
    /(src|href)="(?!https?:|\/|#|mailto:|tel:|data:)([^"]+\.(?:png|jpe?g|webp|svg|ico|css|js)(?:\?[^"]*)?)"/g,
    '$1="/$2"'
  );

  return {
    // Tout ce qui précède le contenu : bandeau et navigation
    haut: absolutiser(src.slice(iBody + "<body>".length, iMain)),
    // Tout ce qui suit : pied de page, modale de connexion, scripts
    bas: absolutiser(src.slice(iFinMain + "</main>".length)),
  };
}


/* Ancre stable dérivée du titre : sans accent ni ponctuation, pour que les
   liens du sommaire restent lisibles et partageables. */
function ancre(txt) {
  return String(txt)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* Ajoute un id à chaque <h2> du corps et renvoie le sommaire associé.
   Sur des articles de 1500 à 2400 mots, un sommaire n'est pas un ornement :
   il donne la structure d'un coup d'oeil et crée des ancres que Google peut
   proposer directement dans ses résultats. */
function sommaireEtAncres(corps, titreFaq, libelleSommaire) {
  const entrees = [];
  const avecId = corps.replace(/<h2>([^<]+)<\/h2>/g, (m, t) => {
    const id = ancre(t);
    entrees.push({ id, t });
    return `<h2 id="${id}">${t}</h2>`;
  });
  entrees.push({ id: "faq", t: titreFaq });
  // Certains guides numérotent déjà leurs sections dans le titre. Le sommaire
  // étant une liste ordonnée, on retire ce préfixe pour ne pas afficher
  // « 1. 1. Comptez les pièces ».
  const liste = entrees
    .map((e) => `          <li><a href="#${e.id}">${echapper(e.t.replace(/^\s*\d+\.\s*/, ""))}</a></li>`)
    .join("\n");
  const html =
    '        <nav class="guide-sommaire" aria-label="' + libelleSommaire + '">\n' +
    "          <p>" + libelleSommaire + "</p>\n          <ol>\n" + liste + "\n          </ol>\n        </nav>";
  return { corps: avecId, sommaire: html };
}

function pageGuide(g, { haut, bas }, lang) {
  const T = TEXTES[lang];
  const url = `${SITE}/${DOSSIER}/${g.slug}`;
  const urlEn = `${url}?lang=en`;
  // L'adresse canonique est celle de la version servie, pas celle du français.
  const canon = lang === "en" ? urlEn : url;
  const gTitle = champ(g, "title", lang);
  const gDesc = champ(g, "description", lang);
  const gH1 = champ(g, "h1", lang);
  const gChapeau = champ(g, "chapeau", lang);
  const gCorps = champ(g, "corps", lang);
  const gFaq = (lang === "en" && g.faq_en && g.faq_en.length) ? g.faq_en : g.faq;

  const autres = GUIDES.filter((x) => x.slug !== g.slug);
  const autresGuides = autres.length
    ? `      <section class="guide-lies" aria-labelledby="guides-lies">
        <h2 id="guides-lies">${T.aLireAussi}</h2>
        <ul>
${autres.map((x) => `          <li><a href="${lang === "en" ? `/${DOSSIER}/${x.slug}?lang=en` : `/${DOSSIER}/${x.slug}`}">${echapper(champ(x, "h1", lang))}</a><span>${echapper(champ(x, "description", lang))}</span></li>`).join("\n")}
        </ul>
      </section>`
    : "";

  const TITRE_FAQ = T.faq;
  const { corps, sommaire } = sommaireEtAncres(gCorps, TITRE_FAQ, T.sommaire);

  const faqHtml = gFaq.map((f) =>
    `        <h3>${echapper(f.q)}</h3>\n        <p>${f.r}</p>`).join("\n");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": canon + "#article",
        headline: gTitle,
        description: gDesc,
        inLanguage: T.inLanguage,
        datePublished: g.datePublication,
        dateModified: g.dateModification,
        mainEntityOfPage: { "@type": "WebPage", "@id": canon },
        // L'éditeur est l'organisation : aucun auteur individuel n'est
        // identifiable, on ne va pas en inventer un.
        author: { "@id": SITE + "/#organization" },
        publisher: { "@id": SITE + "/#organization" },
        image: SITE + "/og-cover.jpg",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: T.accueil, item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: T.guides, item: SITE + "/" + DOSSIER },
          { "@type": "ListItem", position: 3, name: gH1, item: canon },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: gFaq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.r.replace(/<[^>]+>/g, "") },
        })),
      },
    ],
  };

  return `<!doctype html>
<html lang="${T.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${echapper(gTitle)}</title>
  <meta name="description" content="${echapper(gDesc)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${canon}">

  <link rel="alternate" hreflang="fr" href="${url}">
  <link rel="alternate" hreflang="en" href="${urlEn}">
  <link rel="alternate" hreflang="x-default" href="${url}">

  <meta property="og:type" content="article">
  <meta property="og:title" content="${echapper(gTitle)}">
  <meta property="og:description" content="${echapper(gDesc)}">
  <meta property="og:url" content="${canon}">
  <meta property="og:image" content="${SITE}/og-cover.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${T.locale}">
  <meta property="og:site_name" content="Athena Militaria">
  <meta property="article:published_time" content="${g.datePublication}">
  <meta property="article:modified_time" content="${g.dateModification}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${echapper(gTitle)}">
  <meta name="twitter:description" content="${echapper(gDesc)}">
  <meta name="twitter:image" content="${SITE}/og-cover.jpg">

  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://uctaxgfqdoxtcidllyjv.supabase.co">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"></noscript>
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#1f2a3c">
  <link rel="stylesheet" href="/${V_CSS}">
  <script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script defer src="/${V_SBCLIENT}"></script>
  <script defer src="/${V_I18N}"></script>
  <script defer src="/${V_SCRIPT}"></script>
</head>
<body>
${haut}<main id="main-content" class="legal-page guide-page">
      <nav class="guide-breadcrumb" aria-label="${T.filAriane}">
        <a href="/">${T.accueil}</a> <span aria-hidden="true">/</span>
        <span>${T.guides}</span> <span aria-hidden="true">/</span>
        <span>${echapper(gH1)}</span>
      </nav>

      <article>
        <h1>${echapper(gH1)}</h1>
        <p class="guide-chapeau">${gChapeau}</p>
${sommaire}
${corps}
        <h2 id="faq">${TITRE_FAQ}</h2>
${faqHtml}
      </article>

${autresGuides}
      <aside class="guide-cta">
        <p class="guide-cta-kicker">Athena Militaria</p>
        <h2>${T.ctaTitre}</h2>
        <p>${T.ctaTexte}</p>
        <p class="guide-cta-action"><a class="cta-btn" href="/sell">${T.ctaBouton}</a></p>
      </aside>
</main>${bas}`;
}


/* --------------------------------------------------------------------------
   Page d'index /guides.
   Sans elle, le fil d'Ariane des guides annonce un niveau « Guides » qui
   n'existe nulle part, et les cinq articles restent une collection de pages
   isolées au lieu de former un ensemble cohérent aux yeux d'un moteur.
   C'est la page de tête du silo éditorial.
-------------------------------------------------------------------------- */
function pageIndex({ haut, bas }, lang) {
  const T = TEXTES[lang];
  const url = `${SITE}/${DOSSIER}`;
  const canon = lang === "en" ? `${url}?lang=en` : url;
  const titre = T.indexTitre;
  const desc = T.indexDesc;
  // En anglais, la liste ne montre que les guides réellement traduits.
  const liste = lang === "en" ? GUIDES.filter(traduit) : GUIDES;

  const lienGuide = (g) => (lang === "en" ? `/${DOSSIER}/${g.slug}?lang=en` : `/${DOSSIER}/${g.slug}`);
  /* La version française conserve ses clés de traduction. Un guide sans page
     anglaise ne déclenche pas la réécriture : c'est ce fichier-ci qui est
     alors servi en ?lang=en, et sans clés il resterait tout en français. */
  const cle = (g, suffixe) => (lang === "fr" ? ` data-i18n="guides.${g.slug}.${suffixe}"` : "");
  const cleLire = lang === "fr" ? ' data-i18n="guides.read"' : "";
  const cartes = liste.map((g) => `
        <li class="guide-index-item">
          <h2><a href="${lienGuide(g)}"${cle(g, "h1")}>${echapper(champ(g, "h1", lang))}</a></h2>
          <p${cle(g, "desc")}>${echapper(champ(g, "description", lang))}</p>
          <p class="guide-index-lire"><a href="${lienGuide(g)}"${cleLire}>${T.lireGuide}</a></p>
        </li>`).join("\n");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": canon + "#page",
        name: titre,
        description: desc,
        inLanguage: T.inLanguage,
        isPartOf: { "@id": SITE + "/#website" },
        publisher: { "@id": SITE + "/#organization" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: T.accueil, item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: T.guides, item: canon },
        ],
      },
      {
        // Liste ordonnée des guides : aide le moteur à comprendre que ces
        // pages forment un ensemble et non des articles sans rapport.
        "@type": "ItemList",
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        numberOfItems: liste.length,
        itemListElement: liste.map((g, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: SITE + lienGuide(g),
          name: champ(g, "h1", lang),
        })),
      },
    ],
  };

  return `<!doctype html>
<html lang="${T.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${echapper(titre)} | Athena Militaria</title>
  <meta name="description" content="${echapper(desc)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${canon}">
  <link rel="alternate" hreflang="fr" href="${url}">
  <link rel="alternate" hreflang="en" href="${url}?lang=en">
  <link rel="alternate" hreflang="x-default" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${echapper(titre)}">
  <meta property="og:description" content="${echapper(desc)}">
  <meta property="og:url" content="${canon}">
  <meta property="og:image" content="${SITE}/og-cover.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${T.locale}">
  <meta property="og:site_name" content="Athena Militaria">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${echapper(titre)}">
  <meta name="twitter:description" content="${echapper(desc)}">
  <meta name="twitter:image" content="${SITE}/og-cover.jpg">

  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"></noscript>
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#1f2a3c">
  <link rel="stylesheet" href="/${V_CSS}">
  <script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script defer src="/${V_SBCLIENT}"></script>
  <script defer src="/${V_I18N}"></script>
  <script defer src="/${V_SCRIPT}"></script>
</head>
<body>
${tableTraductions()}
${haut}<main id="main-content" class="legal-page guide-page guide-index">
      <nav class="guide-breadcrumb" aria-label="Fil d'Ariane">
        <a href="/">${T.accueil}</a> <span aria-hidden="true">/</span>
        <span>${T.guides}</span>
      </nav>
      <h1${lang === "fr" ? ' data-i18n="guides.index_title"' : ""}>${echapper(titre)}</h1>
      <p class="guide-chapeau"${lang === "fr" ? ' data-i18n="guides.index_intro"' : ""}>${T.indexChapeau}</p>
      <ul class="guide-index-list">
${cartes}
      </ul>
      <aside class="guide-cta">
        <p class="guide-cta-kicker">Athena Militaria</p>
        <h2>Prêt à mettre une pièce en vente&nbsp;?</h2>
        <p>La mise en ligne est gratuite et le paiement est sécurisé.</p>
        <p class="guide-cta-action"><a class="cta-btn" href="/sell">Déposer une annonce</a></p>
      </aside>
</main>${bas}`;
}


/* --------------------------------------------------------------------------
   Bloc « Guides du collectionneur » de la page d'accueil.
   Écrit entre deux marqueurs d'index.html, donc régénéré à chaque
   déploiement : un nouveau guide y apparaît sans toucher au HTML.
   Les trois premiers sont mis en avant façon colonne de journal ; les
   suivants sont repliés dans un <details>, élément natif du navigateur. On
   évite ainsi tout JavaScript, et surtout le contenu replié reste présent
   dans le HTML servi, donc lisible par les moteurs.
-------------------------------------------------------------------------- */
/* Table des traductions déposée dans la page.
   Le bloc restait entièrement en français en version anglaise : ni les
   libellés, ni les titres, ni les résumés des guides n'étaient traduits, faute
   de clés. On les génère ici à partir de guides-contenu.js plutôt que de les
   recopier dans i18n.js, où ils auraient divergé au premier guide ajouté.
   i18n.js fusionne cette table dans son dictionnaire au chargement. */
function tableTraductions() {
  const fr = {
    "guides.home_title": "Guides du collectionneur",
    "guides.all": "Tous les guides",
    "guides.read": "Lire le guide",
    "guides.more_prefix": "Voir les",
    "guides.more_suffix": "autres guides",
    "guides.index_title": "Guides du collectionneur de militaria",
    "guides.index_intro": "Hériter d'une malle, douter devant une annonce, ne pas savoir si l'on a le droit de vendre : ces situations reviennent sans cesse. Voici ce que nous avons écrit pour y répondre, sans jargon et sans affirmation approximative.",
  };
  const en = {
    "guides.home_title": "Collector's guides",
    "guides.all": "All guides",
    "guides.read": "Read the guide",
    "guides.more_prefix": "See the",
    "guides.more_suffix": "other guides",
    "guides.index_title": "Militaria collector's guides",
    "guides.index_intro": "Inheriting a trunk, hesitating over a listing, not knowing whether you are allowed to sell: these situations come up again and again. Here is what we have written to answer them, without jargon and without loose claims.",
  };
  for (const g of GUIDES) {
    fr["guides." + g.slug + ".h1"] = g.h1;
    fr["guides." + g.slug + ".desc"] = g.description;
    // Une traduction absente n'est pas une anomalie : t() retombe sur le français.
    if (g.h1_en) en["guides." + g.slug + ".h1"] = g.h1_en;
    if (g.description_en) en["guides." + g.slug + ".desc"] = g.description_en;
  }
  return `    <script>window.__guidesI18n = ${JSON.stringify({ fr, en })};</script>`;
}

function blocAccueil() {
  const carte = (g, i) => `        <li class="hg-item">
          <span class="hg-num">${String(i + 1).padStart(2, "0")}</span>
          <div class="hg-body">
            <h3><a href="/${DOSSIER}/${g.slug}" data-i18n="guides.${g.slug}.h1">${echapper(g.h1)}</a></h3>
            <p data-i18n="guides.${g.slug}.desc">${echapper(g.description)}</p>
            <a class="hg-lire" href="/${DOSSIER}/${g.slug}" data-i18n="guides.read">Lire le guide</a>
          </div>
        </li>`;

  const une = GUIDES.slice(0, 3).map(carte).join("\n");
  const reste = GUIDES.slice(3);

  /* Le nombre reste hors des clés : une seule table sert les deux langues,
     et un compteur figé dans la traduction se serait démenti au guide suivant. */
  const replie = reste.length
    ? `      <details class="hg-plus">
        <summary><span><span data-i18n="guides.more_prefix">Voir les</span> ${reste.length} <span data-i18n="guides.more_suffix">autres guides</span></span></summary>
        <ul class="hg-list">
${reste.map((g, i) => carte(g, i + 3)).join("\n")}
        </ul>
      </details>`
    : "";

  return `${tableTraductions()}
    <div class="hg-inner">
      <div class="hg-head">
        <h2 id="home-guides-titre" data-i18n="guides.home_title">Guides du collectionneur</h2>
        <a class="hg-tous" href="/${DOSSIER}" data-i18n="guides.all">Tous les guides</a>
      </div>
      <ul class="hg-list">
${une}
      </ul>
${replie}
    </div>`;
}

function ecrireBlocAccueil() {
  const FICHIER = "index.html";
  const DEBUT = "<!-- guides:debut -->";
  const FIN = "<!-- guides:fin -->";
  let html;
  try { html = fs.readFileSync(FICHIER, "utf8"); } catch (e) { return "index.html illisible"; }
  const a = html.indexOf(DEBUT), b = html.indexOf(FIN);
  if (a === -1 || b === -1 || b < a) return "marqueurs guides absents d'index.html";
  const nouveau = html.slice(0, a + DEBUT.length) + "\n" + blocAccueil() + "\n    " + html.slice(b);
  fs.writeFileSync(FICHIER, nouveau);
  return GUIDES.length + " guide(s) placés sur la page d'accueil";
}

const s = shell();
const DOSSIER_EN = path.join(DOSSIER, "en");
fs.mkdirSync(DOSSIER_EN, { recursive: true });

/* Le dossier anglais est vidé avant génération : un guide dont la traduction
   serait retirée de guides-contenu.js laisserait sinon sa page en ligne, servie
   par la règle de réécriture, et donc une version anglaise orpheline. */
for (const f of fs.readdirSync(DOSSIER_EN)) {
  if (f.endsWith(".html")) fs.unlinkSync(path.join(DOSSIER_EN, f));
}

const produits = [];
for (const g of GUIDES) {
  const dest = path.join(DOSSIER, g.slug + ".html");
  fs.writeFileSync(dest, pageGuide(g, s, "fr"));
  produits.push(dest);
  if (traduit(g)) {
    const destEn = path.join(DOSSIER_EN, g.slug + ".html");
    fs.writeFileSync(destEn, pageGuide(g, s, "en"));
    produits.push(destEn);
  }
}
fs.writeFileSync(path.join(DOSSIER, "index.html"), pageIndex(s, "fr"));
produits.push(path.join(DOSSIER, "index.html"));
if (GUIDES.some(traduit)) {
  fs.writeFileSync(path.join(DOSSIER_EN, "index.html"), pageIndex(s, "en"));
  produits.push(path.join(DOSSIER_EN, "index.html"));
}
const nbEn = produits.filter((f) => f.includes(path.sep + "en" + path.sep)).length;
console.log("   " + produits.length + " page(s) générée(s) dans " + DOSSIER + "/ dont " + nbEn + " en anglais");
console.log("   " + ecrireBlocAccueil());

module.exports = { GUIDES, DOSSIER };
