/* Génère sitemap.xml : pages fixes + fiches produits publiées (Supabase).
   Appelé par deploy-ovh.sh avant l'upload. En cas d'erreur réseau/API,
   le script sort en erreur et le sitemap existant est conservé. */
const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");

const SITE = "https://www.athenamilitaria.fr";
const SUPABASE_URL = "https://uctaxgfqdoxtcidllyjv.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdGF4Z2ZxZG94dGNpZGxseWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzQ0NzgsImV4cCI6MjA5MTQ1MDQ3OH0.AEFktTgMmccF0UiKcCiJBTej0Px5q6_jqi7l7hgePVA";

// Pages fixes. La date de dernière modification vient du dernier commit git
// touchant le fichier (voir fileDate) : elle suit le contenu et non les
// manipulations de fichiers. Corollaire : une modification non commitée ne
// change pas le lastmod, ce qui est le comportement souhaité.
const STATIC_PAGES = [
  { path: "/", file: "index.html", changefreq: "daily", priority: "1.0", alt: true },
  { path: "/category", file: "category.html", changefreq: "daily", priority: "0.9", alt: true },
  { path: "/about", file: "about.html", changefreq: "monthly", priority: "0.7", alt: true },
  { path: "/community", file: "community.html", changefreq: "weekly", priority: "0.6", alt: true },
  { path: "/sell", file: "sell.html", changefreq: "monthly", priority: "0.8", alt: true },
  { path: "/legal", file: "legal.html", changefreq: "yearly", priority: "0.3", alt: true },
];

/* Date de dernière modification d'une page.
   On interroge git plutôt que le système de fichiers : une date de fichier
   change à chaque enregistrement, et un simple clone du dépôt donnerait à
   toutes les pages la date du jour. Google n'exploite le lastmod que s'il le
   juge fiable et ignore la balise sur tout le site quand elle ne l'est pas.
   Si git n'est pas disponible, on renvoie null : une date absente vaut
   mieux qu'une date fausse. */
function fileDate(name) {
  try {
    /* Une page modifiée mais pas encore commitée n'a PAS la date de son
       dernier commit : c'est la version modifiée qui part en ligne. Le cas
       est permanent pour index.html, réécrit à chaque déploiement par
       ecrireDernieresAnnonces() et jamais commité. Sans ce test, six pages
       refondues annonçaient à Google une date vieille de plusieurs mois,
       juste après leur refonte, ce qui déprioritise leur réexploration et
       peut faire juger l'ensemble des lastmod du site peu fiables. */
    const modifie = execFileSync("git", ["status", "--porcelain", "--", name],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (modifie) {
      const t = fs.statSync(name).mtime;
      return t.toISOString().slice(0, 10);
    }
    const d = execFileSync("git", ["log", "-1", "--format=%cs", "--", name],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch (e) {
    return null;
  }
}

// Les URLs du site encodent les espaces en tirets (?cat=2nde-Guerre-Mondiale).
// Le sitemap doit produire exactement les mêmes URLs que les liens internes,
// sinon on déclare des adresses que personne ne pointe.
const slug = (v) => encodeURIComponent(String(v).trim().replace(/ /g, "-"));

/* La base et les URLs ne parlent pas le même vocabulaire pour deux
   sous-catégories : le formulaire de vente enregistre la forme longue,
   alors que toute la navigation du site utilise un segment court (voir
   SUB_DB et window.dbToSubSlug dans script.js).
   Slugifier la valeur brute produisait donc, pour une même page, une adresse
   déclarée au sitemap et une autre pointée par les liens internes. Les deux
   affichent la même liste et chacune se déclare canonique d'elle-même : deux
   pages identiques pour Google, dont une orpheline.
   Ces trois copies de la correspondance doivent rester alignées :
   script.js (SUB_DB), ce fichier, et supabase/functions/sitemap/index.ts. */
const SUB_COURT = {
  "Armes (neutralisées/maquettes)": "Armes",
  "Médailles & décorations": "Médailles",
};
const slugSub = (v) => slug(SUB_COURT[String(v).trim()] || v);

function fetchProducts() {
  return new Promise((resolve, reject) => {
    const url = SUPABASE_URL + "/rest/v1/products?status=eq.published&select=id,created_at,period,subcategory,title,price,image_url,historically_sensitive&order=created_at.desc&limit=5000";
    const req = https.get(url, { headers: { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

/* Produit les entrées d'une URL. Quand la page existe en deux langues, la
   spécification impose une entrée <url> PAR version, chacune répétant le jeu
   complet d'alternates. N'annoncer que la version française laissait la
   version anglaise hors du sitemap. */
function urlEntry(loc, changefreq, priority, withAlt, lastmod) {
  const sep = loc.includes("?") ? "&amp;" : "?";
  const locEn = loc + sep + "lang=en";

  const alternates = withAlt
    ? '    <xhtml:link rel="alternate" hreflang="fr" href="' + loc + '"/>\n' +
      '    <xhtml:link rel="alternate" hreflang="en" href="' + locEn + '"/>\n' +
      '    <xhtml:link rel="alternate" hreflang="x-default" href="' + loc + '"/>\n'
    : "";

  const bloc = (href) => {
    let s = "  <url>\n    <loc>" + href + "</loc>\n";
    if (lastmod) s += "    <lastmod>" + lastmod + "</lastmod>\n";
    s += "    <changefreq>" + changefreq + "</changefreq>\n    <priority>" + priority + "</priority>\n";
    return s + alternates + "  </url>\n";
  };

  return withAlt ? bloc(loc) + bloc(locEn) : bloc(loc);
}

/* ---------------------------------------------------------------------------
   Pré-rendu des dernières annonces dans index.html.

   La grille de l'accueil est remplie en JavaScript : le HTML servi ne
   contenait donc aucun lien vers une fiche produit. Search Console le
   confirmait, /product?id=9 était signalée « aucune page d'origine détectée »,
   c'est-à-dire orpheline, découvrable par le seul sitemap.

   On écrit ici les mêmes cartes que renderProductCard (script.js) : mêmes
   balises, mêmes classes, même URL d'image. Le script les remplace au
   chargement par des cartes identiques. Ce n'est donc pas du contenu masqué
   ni un contenu différent de celui vu par le visiteur.

   Les annonces marquées historiquement sensibles sont volontairement exclues :
   elles s'affichent floutées aux visiteurs non connectés, et reproduire ce
   floutage en statique serait fragile. Elles restent visibles via le script.
--------------------------------------------------------------------------- */
const IMG_FN = "https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/img";

function imgUrlNode(url, largeur) {
  if (!url || typeof url !== "string") return "hero.png";
  const m = url.match(/\/storage\/v1\/(?:object|render\/image)\/public\/product-images\/(.+?)(?:\?.*)?$/);
  if (!m) return url;
  let chemin;
  try { chemin = decodeURIComponent(m[1]).split("/").map(encodeURIComponent).join("/"); }
  catch (e) { chemin = m[1]; }
  return IMG_FN + "?path=" + chemin + "&w=" + largeur;
}

const echapper = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function ecrireDernieresAnnonces(products) {
  const FICHIER = "index.html";
  const DEBUT = "<!-- annonces:debut -->";
  const FIN = "<!-- annonces:fin -->";

  let html;
  try { html = fs.readFileSync(FICHIER, "utf8"); } catch (e) { return "index.html illisible"; }
  const a = html.indexOf(DEBUT);
  const b = html.indexOf(FIN);
  if (a === -1 || b === -1 || b < a) return "marqueurs absents d'index.html";

  const visibles = products.filter((p) => !p.historically_sensitive).slice(0, 8);
  if (visibles.length === 0) return "aucune annonce publiable, bloc laissé en l'état";

  const cartes = visibles.map((p) => {
    const titre = echapper(p.title || "");
    return `      <a class="item-card" href="/product?id=${encodeURIComponent(p.id)}">\n` +
           `        <div class="item-card-img"><img src="${echapper(imgUrlNode(p.image_url, 400))}" alt="${titre}" loading="lazy" decoding="async"></div>\n` +
           `        <h3>${titre}</h3>\n` +
           `        <p class="price">${echapper(p.price)} €</p>\n` +
           `      </a>`;
  }).join("\n");

  const nouveau = html.slice(0, a + DEBUT.length) + "\n" + cartes + "\n      " + html.slice(b);
  fs.writeFileSync(FICHIER, nouveau);
  return visibles.length + " annonce(s) pré-rendue(s) dans index.html";
}

const ENTETE_URLSET = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
  '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n\n';

/* Index de sitemaps : sitemap.xml ne liste plus les URLs directement, il
   renvoie vers les deux moitiés du plan de site. C'est ce découpage qui
   permet d'automatiser la partie vivante :

     - sitemap-pages.xml, écrit ici, contient les pages fixes et les guides.
       Leur date de dernière modification vient de git, information qui
       n'existe qu'à cet endroit : la génération reste donc au déploiement.
     - sitemap-annonces.xml est servi par sitemap.php, qui appelle la fonction
       Supabase « sitemap ». Une annonce publiée aujourd'hui y figure dans
       l'heure, sans attendre le prochain déploiement.

   robots.txt et Search Console continuent de ne connaître que sitemap.xml. */
function ecrireIndex(datePages, dateAnnonces) {
  const entree = (nom, date) =>
    "  <sitemap>\n    <loc>" + SITE + "/" + nom + "</loc>\n" +
    (date ? "    <lastmod>" + date + "</lastmod>\n" : "") +
    "  </sitemap>\n";

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entree("sitemap-pages.xml", datePages) +
    entree("sitemap-annonces.xml", dateAnnonces) +
    "</sitemapindex>\n";
  fs.writeFileSync("sitemap.xml", xml);
}

(async () => {
  const products = await fetchProducts();
  let xml = ENTETE_URLSET;
  const datesPages = [];
  for (const p of STATIC_PAGES) {
    const d = fileDate(p.file);
    if (d) datesPages.push(d);
    xml += urlEntry(SITE + p.path, p.changefreq, p.priority, p.alt, d) + "\n";
  }

  // Guides éditoriaux : contenu permanent, la priorité est volontairement
  // élevée car ce sont aujourd'hui les seules pages du site à porter du
  // contenu de fond.
  try {
    const { GUIDES, DOSSIER } = require("./build-guides.js");
    // Page de tête du silo éditorial
    xml += urlEntry(SITE + "/" + DOSSIER, "monthly", "0.85", true, null) + "\n";
    for (const g of GUIDES) {
      if (g.dateModification) datesPages.push(g.dateModification);
      xml += urlEntry(SITE + "/" + DOSSIER + "/" + g.slug, "monthly", "0.9", true,
                      g.dateModification || null) + "\n";
    }
  } catch (e) {
    console.log("   guides non déclarés au sitemap : " + e.message);
  }

  xml += "</urlset>\n";
  fs.writeFileSync("sitemap-pages.xml", xml);
  const nbPages = (xml.match(/<loc>/g) || []).length;

  /* Copie de secours des annonces : même contenu que la fonction Supabase,
     calculé ici. sitemap.php ne s'en sert que si Supabase est injoignable ET
     que son cache local est vide, typiquement au tout premier passage après
     un déploiement. */
  xml = ENTETE_URLSET;

  // Pages catégories et sous-catégories : uniquement celles qui contiennent
  // réellement des annonces. Soumettre une page de catalogue vide, c'est
  // envoyer Google sur une page sans contenu, ce qui dessert le site entier.
  const periods = new Map();   // période -> date de l'annonce la plus récente
  const subs = new Map();      // "période|sous-catégorie" -> idem
  for (const prod of products) {
    const d = String(prod.created_at || "");
    if (prod.period) {
      const prev = periods.get(prod.period);
      if (!prev || d > prev) periods.set(prod.period, d);
    }
    if (prod.period && prod.subcategory) {
      const k = prod.period + "|" + prod.subcategory;
      const prev = subs.get(k);
      if (!prev || d > prev) subs.set(k, d);
    }
  }

  for (const [period, last] of periods) {
    const url = SITE + "/category?cat=" + slug(period);
    xml += urlEntry(url, "weekly", "0.85", true, last ? last.slice(0, 10) : null) + "\n";
  }

  for (const [k, last] of subs) {
    const [period, sub] = k.split("|");
    const url = SITE + "/category?cat=" + slug(period) + "&amp;sub=" + slugSub(sub);
    xml += urlEntry(url, "weekly", "0.8", true, last ? last.slice(0, 10) : null) + "\n";
  }

  for (const prod of products) {
    const lastmod = prod.created_at ? String(prod.created_at).slice(0, 10) : null;
    xml += urlEntry(SITE + "/product?id=" + prod.id, "weekly", "0.8", true, lastmod) + "\n";
  }
  xml += "</urlset>\n";
  fs.writeFileSync("sitemap-annonces-secours.xml", xml);
  const nbAnnonces = (xml.match(/<loc>/g) || []).length;

  /* Volontairement AUCUNE date pour l'entrée des annonces.
     sitemap.xml est un fichier statique, déposé au déploiement, alors que
     sitemap-annonces.xml est régénéré toutes les six heures. Y inscrire la
     date de l'annonce la plus récente connue au moment du build revenait à
     affirmer à Google que ce sitemap n'a pas bougé depuis le déploiement :
     il n'avait alors aucune raison d'aller le relire, et les annonces
     publiées entre deux déploiements restaient invisibles, c'est-à-dire
     exactement le retard que ce découpage devait supprimer.
     Une date absente laisse Google relire l'enfant à son rythme, et
     sitemap.php lui annonce la fraîcheur réelle via Last-Modified. */
  datesPages.sort();
  ecrireIndex(datesPages[datesPages.length - 1] || null, null);

  console.log("   " + ecrireDernieresAnnonces(products));
  console.log("   sitemap-pages.xml : " + nbPages + " URLs (" + STATIC_PAGES.length +
    " pages fixes + guides, versions FR+EN incluses)");
  console.log("   sitemap-annonces-secours.xml : " + nbAnnonces + " URLs (" +
    periods.size + " catégorie(s), " + subs.size + " sous-catégorie(s), " +
    products.length + " annonce(s))");
  console.log("   sitemap.xml : index des deux, annonces servies par sitemap.php");
})().catch((e) => { console.error("   erreur:", e.message); process.exit(1); });
