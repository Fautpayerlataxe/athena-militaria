/* Génère une copie de category.html par catégorie disposant d'un texte de
   contexte, dans categories/.

   Le fichier générique reste servi tel quel pour /category et pour toute
   catégorie sans texte : ces copies ne remplacent rien, elles s'ajoutent.
   Apache choisit la bonne au moment de la requête (règle 5 quater du
   .htaccess), l'adresse affichée ne change pas, et le JavaScript de la page
   continue de faire exactement le même travail qu'avant.

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

const { CATEGORIES } = require("./categories-contenu.js");

/* Libellés lisibles, repris de i18n.js (clés cat.*). Ils servent à composer les
   mêmes titres que ceux calculés par applyCategorySeo dans script.js : les deux
   doivent coïncider, sinon la balise servie et celle affichée diffèrent. */
const LIBELLE = {
  "Guerre-Napoléonienne": "Guerre Napoléonienne",
  "1ère-Guerre-Mondiale": "1ère Guerre Mondiale",
  "2nde-Guerre-Mondiale": "2nde Guerre Mondiale",
  "Guerre-froide": "Guerre froide",
  "Uniformes": "Uniformes",
  "Armes": "Armes",
  "Documents": "Documents",
  "Médailles": "Médailles",
  "Objets-divers": "Objets divers",
  "Équipements": "Équipements",
};

/* Balises de tête propres à la page.
   C'est la correction la plus importante de ce fichier. category.html porte un
   titre, une description et surtout une balise canonical qui désignent
   /category. Les copies en héritaient telles quelles : dans le HTML servi, les
   seize pages se déclaraient donc toutes comme la même adresse. script.js
   corrige tout cela à l'exécution, mais un moteur qui lit le document avant de
   rendre le JavaScript voit seize doublons, et le contenu propre à chaque page
   ne lui est jamais attribué.
   On écrit donc ces balises dans le fichier, à la génération. Les valeurs
   reproduisent exactement celles que calcule applyCategorySeo, pour qu'aucune
   ne change au chargement. */
function enTete(c) {
  const catL = LIBELLE[c.cat] || String(c.cat).replace(/-/g, " ");
  const subL = c.sub ? (LIBELLE[c.sub] || String(c.sub).replace(/-/g, " ")) : "";
  const theme = subL ? `${subL} ${catL}` : catL;

  const params = new URLSearchParams();
  params.set("cat", c.cat);
  if (c.sub) params.set("sub", c.sub);
  const urlFr = SITE + "/category?" + params.toString();
  const urlEn = urlFr + "&lang=en";
  // Dans un attribut HTML, l'esperluette s'écrit &amp; : elle se relit &.
  const att = (u) => u.replace(/&/g, "&amp;");

  return {
    titre: `${theme} : annonces de militaria | Athena Militaria`,
    description: `Annonces de militaria ${theme} entre collectionneurs : pièces vérifiées, description détaillée, paiement sécurisé et échange direct avec le vendeur.`,
    ogTitre: `${theme} : annonces de militaria`,
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

function bloc(c) {
  const id = "contexte-" + c.slug;
  return `      <section class="about-section" id="${id}" aria-labelledby="${id}-title">
        <h2 id="${id}-title">${c.titre}</h2>${c.corps}
      </section>`;
}

function construire() {
  const gabarit = fs.readFileSync(GABARIT, "utf8");
  const a = gabarit.indexOf(DEBUT);
  const b = gabarit.indexOf(FIN);
  if (a === -1 || b === -1 || b < a) {
    throw new Error("marqueurs de contexte absents de " + GABARIT);
  }

  fs.mkdirSync(DOSSIER, { recursive: true });

  /* Les fichiers d'une catégorie retirée de categories-contenu.js resteraient
     sinon sur le disque, seraient réenvoyés à chaque déploiement et
     continueraient d'être servis par une règle .htaccess qu'on aurait oublié
     de retirer. On repart d'un dossier propre. */
  for (const f of fs.readdirSync(DOSSIER)) {
    if (f.endsWith(".html")) fs.unlinkSync(path.join(DOSSIER, f));
  }

  const regles = [];
  for (const c of CATEGORIES) {
    const html = gabarit.slice(0, a + DEBUT.length) + "\n" + bloc(c) + "\n      " + gabarit.slice(b);
    fs.writeFileSync(path.join(DOSSIER, c.slug + ".html"), reecrireEnTete(sansResumePeriodes(html), c));

    /* Apache compare la chaîne de requête BRUTE, telle qu'elle arrive. Or une
       valeur accentuée comme « 1ère-Guerre-Mondiale » ou « Équipements »
       n'arrive pas toujours sous la même forme : les navigateurs encodent
       l'accent en UTF-8 (1%C3%A8re), mais rien ne garantit que tout client le
       fasse. On accepte donc les deux écritures. Une règle qui ne
       reconnaîtrait que la forme encodée échouerait en silence : le visiteur
       recevrait la page générique, sans texte, et personne ne s'en
       apercevrait. */
    const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const formes = (v) => [...new Set([v, encodeURIComponent(v)])].map(echapper).join("|");

    /* Une entrée de sous-catégorie EXIGE le paramètre sub, une entrée de
       période l'INTERDIT. Sans cette symétrie, la page de période et celle de
       sa sous-catégorie recevraient le même fichier et redeviendraient deux
       adresses pour un seul contenu, ce que ce découpage cherche à éviter. */
    regles.push(
      `  RewriteCond %{QUERY_STRING} (^|&)cat=(${formes(c.cat)})($|&)\n` +
      (c.sub
        ? `  RewriteCond %{QUERY_STRING} (^|&)sub=(${formes(c.sub)})($|&)\n`
        : `  RewriteCond %{QUERY_STRING} !(^|&)sub=\n`) +
      `  RewriteCond %{QUERY_STRING} !(^|&)q=\n` +
      `  RewriteRule ^category$ ${DOSSIER}/${c.slug}.html [L]`
    );
  }

  console.log("   " + CATEGORIES.length + " page(s) de catégorie générée(s) dans " + DOSSIER + "/");

  /* Les règles ne sont pas écrites dans .htaccess automatiquement : une
     erreur dans ce fichier renvoie une 500 sur le site entier, ce n'est pas
     un endroit où un script doit écrire sans relecture. On les affiche. */
  const attendu = regles.join("\n\n");
  let actuel = "";
  try { actuel = fs.readFileSync(".htaccess", "utf8"); } catch (e) { /* absent */ }
  const manquantes = CATEGORIES.filter((c) => !actuel.includes(DOSSIER + "/" + c.slug + ".html"));
  if (manquantes.length) {
    console.log("   ⚠️  règle .htaccess absente pour : " + manquantes.map((c) => c.slug).join(", "));
    console.log("   À insérer dans le bloc mod_rewrite, AVANT la règle 6 :\n");
    console.log(attendu + "\n");
  }
}

if (require.main === module) {
  try { construire(); } catch (e) { console.error("   erreur:", e.message); process.exit(1); }
}

module.exports = { CATEGORIES, DOSSIER, construire };
