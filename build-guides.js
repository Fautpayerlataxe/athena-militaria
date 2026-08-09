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
function sommaireEtAncres(corps, titreFaq) {
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
    '        <nav class="guide-sommaire" aria-label="Sommaire">\n' +
    "          <p>Au sommaire</p>\n          <ol>\n" + liste + "\n          </ol>\n        </nav>";
  return { corps: avecId, sommaire: html };
}

function pageGuide(g, { haut, bas }) {
  const url = `${SITE}/${DOSSIER}/${g.slug}`;
  const urlEn = `${url}?lang=en`;

  const autres = GUIDES.filter((x) => x.slug !== g.slug);
  const autresGuides = autres.length
    ? `      <section class="guide-lies" aria-labelledby="guides-lies">
        <h2 id="guides-lies">À lire aussi</h2>
        <ul>
${autres.map((x) => `          <li><a href="/${DOSSIER}/${x.slug}">${echapper(x.h1)}</a><span>${echapper(x.description)}</span></li>`).join("\n")}
        </ul>
      </section>`
    : "";

  const TITRE_FAQ = "Questions fréquentes";
  const { corps, sommaire } = sommaireEtAncres(g.corps, TITRE_FAQ);

  const faqHtml = g.faq.map((f) =>
    `        <h3>${echapper(f.q)}</h3>\n        <p>${f.r}</p>`).join("\n");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": url + "#article",
        headline: g.title,
        description: g.description,
        inLanguage: "fr-FR",
        datePublished: g.datePublication,
        dateModified: g.dateModification,
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        // L'éditeur est l'organisation : aucun auteur individuel n'est
        // identifiable, on ne va pas en inventer un.
        author: { "@id": SITE + "/#organization" },
        publisher: { "@id": SITE + "/#organization" },
        image: SITE + "/og-cover.jpg",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Accueil", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/" + DOSSIER },
          { "@type": "ListItem", position: 3, name: g.h1, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: g.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.r.replace(/<[^>]+>/g, "") },
        })),
      },
    ],
  };

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${echapper(g.title)}</title>
  <meta name="description" content="${echapper(g.description)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${url}">

  <link rel="alternate" hreflang="fr" href="${url}">
  <link rel="alternate" hreflang="en" href="${urlEn}">
  <link rel="alternate" hreflang="x-default" href="${url}">

  <meta property="og:type" content="article">
  <meta property="og:title" content="${echapper(g.title)}">
  <meta property="og:description" content="${echapper(g.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og-cover.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:site_name" content="Athena Militaria">
  <meta property="article:published_time" content="${g.datePublication}">
  <meta property="article:modified_time" content="${g.dateModification}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${echapper(g.title)}">
  <meta name="twitter:description" content="${echapper(g.description)}">
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
      <nav class="guide-breadcrumb" aria-label="Fil d'Ariane">
        <a href="/">Accueil</a> <span aria-hidden="true">/</span>
        <span>Guides</span> <span aria-hidden="true">/</span>
        <span>${echapper(g.h1)}</span>
      </nav>

      <article>
        <h1>${echapper(g.h1)}</h1>
        <p class="guide-chapeau">${g.chapeau}</p>
${sommaire}
${corps}
        <h2 id="faq">${TITRE_FAQ}</h2>
${faqHtml}
      </article>

${autresGuides}
      <aside class="guide-cta">
        <p class="guide-cta-kicker">Athena Militaria</p>
        <h2>Vous avez identifié vos pièces&nbsp;?</h2>
        <p>La mise en ligne d'une annonce est gratuite et le paiement est sécurisé.</p>
        <p class="guide-cta-action"><a class="cta-btn" href="/sell">Déposer une annonce</a></p>
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
function pageIndex({ haut, bas }) {
  const url = `${SITE}/${DOSSIER}`;
  const titre = "Guides du collectionneur de militaria";
  const desc = "Identifier, authentifier, conserver et vendre des objets militaires de collection. Nos guides pratiques, écrits pour les héritiers comme pour les collectionneurs.";

  const cartes = GUIDES.map((g) => `
        <li class="guide-index-item">
          <h2><a href="/${DOSSIER}/${g.slug}">${echapper(g.h1)}</a></h2>
          <p>${echapper(g.description)}</p>
          <p class="guide-index-lire"><a href="/${DOSSIER}/${g.slug}">Lire le guide</a></p>
        </li>`).join("\n");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": url + "#page",
        name: titre,
        description: desc,
        inLanguage: "fr-FR",
        isPartOf: { "@id": SITE + "/#website" },
        publisher: { "@id": SITE + "/#organization" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Accueil", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: "Guides", item: url },
        ],
      },
      {
        // Liste ordonnée des guides : aide le moteur à comprendre que ces
        // pages forment un ensemble et non des articles sans rapport.
        "@type": "ItemList",
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        numberOfItems: GUIDES.length,
        itemListElement: GUIDES.map((g, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${SITE}/${DOSSIER}/${g.slug}`,
          name: g.h1,
        })),
      },
    ],
  };

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${echapper(titre)} | Athena Militaria</title>
  <meta name="description" content="${echapper(desc)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="fr" href="${url}">
  <link rel="alternate" hreflang="en" href="${url}?lang=en">
  <link rel="alternate" hreflang="x-default" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${echapper(titre)}">
  <meta property="og:description" content="${echapper(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og-cover.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="fr_FR">
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
${haut}<main id="main-content" class="legal-page guide-page guide-index">
      <nav class="guide-breadcrumb" aria-label="Fil d'Ariane">
        <a href="/">Accueil</a> <span aria-hidden="true">/</span>
        <span>Guides</span>
      </nav>
      <h1>${echapper(titre)}</h1>
      <p class="guide-chapeau">Hériter d'une malle, douter devant une annonce, ne pas savoir si l'on a le droit de vendre : ces situations reviennent sans cesse. Voici ce que nous avons écrit pour y répondre, sans jargon et sans affirmation approximative.</p>
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
function blocAccueil() {
  const carte = (g, i) => `        <li class="hg-item">
          <span class="hg-num">${String(i + 1).padStart(2, "0")}</span>
          <div class="hg-body">
            <h3><a href="/${DOSSIER}/${g.slug}">${echapper(g.h1)}</a></h3>
            <p>${echapper(g.description)}</p>
            <a class="hg-lire" href="/${DOSSIER}/${g.slug}">Lire le guide</a>
          </div>
        </li>`;

  const une = GUIDES.slice(0, 3).map(carte).join("\n");
  const reste = GUIDES.slice(3);

  const replie = reste.length
    ? `      <details class="hg-plus">
        <summary><span>Voir les ${reste.length} autres guides</span></summary>
        <ul class="hg-list">
${reste.map((g, i) => carte(g, i + 3)).join("\n")}
        </ul>
      </details>`
    : "";

  return `    <div class="hg-inner">
      <div class="hg-head">
        <h2 id="home-guides-titre">Guides du collectionneur</h2>
        <a class="hg-tous" href="/${DOSSIER}">Tous les guides</a>
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
if (!fs.existsSync(DOSSIER)) fs.mkdirSync(DOSSIER);
const produits = [];
for (const g of GUIDES) {
  const dest = path.join(DOSSIER, g.slug + ".html");
  fs.writeFileSync(dest, pageGuide(g, s));
  produits.push(dest);
}
fs.writeFileSync(path.join(DOSSIER, "index.html"), pageIndex(s));
produits.push(path.join(DOSSIER, "index.html"));
console.log("   " + produits.length + " page(s) générée(s) dans " + DOSSIER + "/");
console.log("   " + ecrireBlocAccueil());

module.exports = { GUIDES, DOSSIER };
