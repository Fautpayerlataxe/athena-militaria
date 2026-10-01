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
const V_CSS = versionRessource("style.min.css");
/* Le moteur de traduction et la table de la langue de la page : une page
   anglaise ne charge pas le dictionnaire français, et inversement. */
const V_I18N = versionRessource("i18n-runtime.js");
const V_DICT_FR = versionRessource("i18n-fr.js");
const V_DICT_EN = V_DICT_FR.replace("i18n-fr.js", "i18n-en.js");
const V_SCRIPT = versionRessource("script.js");
const V_SBCLIENT = versionRessource("supabaseClient.js");
const V_ANALYTICS = versionRessource("analytics.js");

/* --------------------------------------------------------------------------
   Contenu des guides. Un objet par guide, du texte et rien d'autre : toute la
   mécanique (balises, données structurées, fil d'Ariane) est générée plus bas.
-------------------------------------------------------------------------- */
const { GUIDES } = require("./guides-contenu.cjs");

/* Illustrations : une par guide, choisie sur Wikimedia Commons parmi les
   fichiers libres (guides-illustrations.json pour les légendes et crédits,
   guides/img/manifeste.json pour les dimensions et la licence relue à la
   source par fabriquer-illustrations.py). Jusque-là, tous les guides
   déclaraient og-cover.jpg : sans image propre, pas de vignette dans les
   résultats mobiles, rien à trouver pour Google Images ou Lens.
   Un guide sans illustration retombe sur og-cover.jpg, comme avant. */
const ILLUSTRATIONS = (() => {
  try {
    const textes = JSON.parse(fs.readFileSync("guides-illustrations.json", "utf8"));
    const manifeste = JSON.parse(fs.readFileSync(path.join(DOSSIER, "img", "manifeste.json"), "utf8"));
    const out = {};
    for (const [slug, m] of Object.entries(manifeste)) {
      if (!textes[slug]) continue;
      out[slug] = { ...textes[slug], ...m };
      // Photos du corps : légendes d'un côté, dimensions et licence de l'autre,
      // dans le même ordre.
      out[slug].galerie = (m.galerie || []).map((g, i) => ({ ...(textes[slug].galerie || [])[i], ...g }));
    }
    return out;
  } catch (e) {
    return {};
  }
})();

/* Libellés de l'habillage des pages de guides, par langue.
   La version anglaise ne se contentait pas d'être absente : elle n'existait pas.
   Un visiteur en ?lang=en recevait le HTML français, que le script de traduction
   ne pouvait qu'effleurer, faute de clés sur le corps de l'article. On génère
   donc un fichier par langue, chacun cohérent de bout en bout : son sommaire,
   ses ancres, sa FAQ, ses données structurées et sa balise canonique. */
/* Les guides sont signés. Un article sur l'identification d'une pièce
   demande qu'on sache qui l'a écrit : c'est ce que cherche un lecteur avant
   de suivre un conseil, et c'est ce que Google appelle l'expérience de
   l'auteur. Le prénom suffit, et la fonction est vérifiable ; rien d'autre
   n'est affirmé ici tant que l'intéressé ne l'a pas écrit lui-même. */
const AUTEUR = "Augustin";

const MOIS = {
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
       "août", "septembre", "octobre", "novembre", "décembre"],
  en: ["January", "February", "March", "April", "May", "June", "July",
       "August", "September", "October", "November", "December"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
       "August", "September", "Oktober", "November", "Dezember"],
};

/* « 2026-09-20 » devient « 20 septembre 2026 » ou « 20 September 2026 ». */
function dateLongue(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const jour = String(Number(m[3]));
  const mois = (MOIS[lang] || MOIS.fr)[Number(m[2]) - 1];
  return lang === "de" ? jour + ". " + mois + " " + m[1] : jour + " " + mois + " " + m[1];
}

const TEXTES = {
  fr: {
    sommaire: "Au sommaire", faq: "Questions fréquentes", aLireAussi: "À lire aussi",
    accueil: "Accueil", guides: "Guides", filAriane: "Fil d'Ariane",
    ctaTitre: "Vous avez identifié vos pièces&nbsp;?",
    ctaTexte: "La mise en ligne d'une annonce est gratuite, et elle est vue par des collectionneurs.",
    ctaBouton: "Déposer une annonce", lireGuide: "Lire le guide",
    ctaIndexTitre: "Prêt à mettre une pièce en vente&nbsp;?",
    indexTitre: "Guides du collectionneur de militaria",
    indexDesc: "Identifier, authentifier, conserver et vendre des objets militaires de collection. Nos guides pratiques, écrits pour les héritiers comme pour les collectionneurs.",
    indexChapeau: "Hériter d'une malle, douter devant une annonce, ne pas savoir si l'on a le droit de vendre : ces situations reviennent sans cesse. Voici ce que nous avons écrit pour y répondre, sans jargon et sans affirmation approximative.",
    locale: "fr_FR", inLanguage: "fr-FR", htmlLang: "fr",
    par: "Par", auteurRole: "fondateur d'Athena Militaria",
    publieLe: "Publié le", misAJourLe: "mis à jour le",
  },
  en: {
    sommaire: "Contents", faq: "Frequently asked questions", aLireAussi: "Further reading",
    accueil: "Home", guides: "Guides", filAriane: "Breadcrumb",
    ctaTitre: "Have you identified your pieces?",
    ctaTexte: "Listing an item is free, and it is seen by collectors.",
    ctaBouton: "List an item", lireGuide: "Read the guide",
    ctaIndexTitre: "Ready to list a piece?",
    indexTitre: "Militaria collector's guides",
    indexDesc: "Identifying, authenticating, preserving and selling collectable military items. Practical guides written for heirs and collectors alike.",
    indexChapeau: "Inheriting a trunk, hesitating over a listing, not knowing whether you are allowed to sell: these situations come up again and again. Here is what we have written to answer them, without jargon and without loose claims.",
    locale: "en_US", inLanguage: "en", htmlLang: "en",
    par: "By", auteurRole: "founder of Athena Militaria",
    publieLe: "Published", misAJourLe: "updated",
  },
  /* Allemand : une seule page à ce jour (les faux), ouverte parce que deux
     questions allemandes sur les faux sortaient chaque semaine en positions
     9 et 10 sans une ligne d'allemand sur le site. L'habillage (en-tête,
     pied de page) reste celui de la version anglaise, et les liens internes
     mènent aux pages anglaises. */
  de: {
    sommaire: "Inhalt", faq: "Häufige Fragen", aLireAussi: "Weiterlesen (auf Englisch)",
    accueil: "Startseite", guides: "Leitfäden", filAriane: "Brotkrumennavigation",
    ctaTitre: "Haben Sie Ihre Stücke bestimmt?",
    ctaTexte: "Eine Anzeige aufzugeben ist kostenlos, und sie wird von Sammlern gesehen.",
    ctaBouton: "Anzeige aufgeben", lireGuide: "Leitfaden lesen",
    ctaIndexTitre: "Bereit, ein Stück anzubieten?",
    indexTitre: "", indexDesc: "", indexChapeau: "",
    locale: "de_DE", inLanguage: "de", htmlLang: "de",
    par: "Von", auteurRole: "Gründer von Athena Militaria",
    publieLe: "Veröffentlicht am", misAJourLe: "aktualisiert am",
  },
};

/* Champ d'un guide dans la langue demandée, avec repli sur le français.
   Un guide non encore traduit reste ainsi lisible plutôt que vide. */
const champ = (g, nom, lang) => (lang !== "fr" && g[nom + "_" + lang]) || g[nom];
// Un guide a une version allemande s'il a un corps allemand.
const traduitDe = (g) => Boolean(g.corps_de);
/* Langue des liens internes et des textes de repli : l'allemand renvoie aux
   pages anglaises, puisqu'il n'existe pas de site allemand. */
const langueLiens = (lang) => (lang === "de" ? "en" : lang);
const champIllustration = (il, nom, lang) =>
  (lang !== "fr" && (il[nom + "_" + lang] || il[nom + "_" + langueLiens(lang)])) || il[nom];

// Un guide n'a de version anglaise que si son corps est traduit.
/* Un guide est traduit s'il a un corps anglais, ou, pour un lexique, si
   chacun de ses termes a le sien. Sans ce second cas, le lexique restait
   français et n'avait pas de page anglaise du tout. */
const traduit = (g) => Boolean(g.corps_en) ||
  Boolean(g.termes && g.termes.length && g.termes.every((t) => t.t_en && t.d_en));

/* -------------------------------------------------------------------------- */

/* Date du guide au format complet, heure et fuseau compris. Google signale
   une date sans fuseau comme incorrecte dans les données d'article, et
   l'interprète à sa guise. Midi, heure de Paris, avec le décalage de la
   saison (+01:00 l'hiver, +02:00 l'été). */
function dateIso(jour) {
  if (!jour) return jour;
  const partie = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" })
    .formatToParts(new Date(jour + "T12:00:00Z"))
    .find((x) => x.type === "timeZoneName").value; // « GMT+2 »
  const h = Number(partie.replace("GMT", "") || 0);
  return `${jour}T12:00:00${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:00`;
}

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

  const haut = absolutiser(src.slice(iBody + "<body>".length, iMain));
  const bas = absolutiser(src.slice(iFinMain + "</main>".length));
  /* Deux jeux : le français tel quel, l'anglais dont les liens internes
     portent ?lang=en. Sans cela, une page anglaise ne renvoyait qu'à des
     pages françaises et l'anglais restait un ensemble de pages orphelines,
     que Search Console classait « détectées, actuellement non indexées ». */
  /* L'habillage anglais est traduit ici, à la construction, et non plus
     seulement par le JavaScript du navigateur : Googlebot lisait le bandeau
     « Un mot de l'équipe », le pied de page et le lien d'évitement en
     français sur chaque page anglaise (audit du 1er oct. 2026). Même
     mécanique que am_traduire (inc/athena.php), sur la table de
     inc/i18n-dict.json. */
  return {
    hautFr: haut, basFr: bas,
    hautEn: traduireShell(anglaiser(haut), "en"), basEn: traduireShell(anglaiser(bas), "en"),
  };
}

const DICT = (() => {
  try { return JSON.parse(fs.readFileSync(path.join("inc", "i18n-dict.json"), "utf8")); } catch (e) { return null; }
})();
const decoderEntites = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function finElement(html, nom, depuis) {
  let prof = 1;
  const re = new RegExp("<(/?)" + nom + "(?=[\\s>/])", "ig");
  re.lastIndex = depuis;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === "/") { if (--prof === 0) return m.index; } else prof++;
  }
  return null;
}
function traduireShell(html, lang) {
  if (!DICT || !DICT[lang] || lang === "fr") return html;
  const table = { ...DICT.fr, ...DICT[lang] };
  const t = (k) => (table[k] !== undefined ? table[k] : k);
  const abri = [];
  html = String(html).replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, (m) => {
    abri.push(m);
    return "\u0000" + (abri.length - 1) + "\u0000";
  });
  html = html.replace(/<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*\bdata-i18n-(?:placeholder|aria-label|title|alt)="[^"]*"[^>]*>/g, (balise) => {
    for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
      const k = balise.match(new RegExp("\\sdata-i18n-" + attr + '="([^"]*)"'));
      if (!k || !k[1]) continue;
      const valeur = attr + '="' + echapper(t(decoderEntites(k[1]))) + '"';
      const motif = new RegExp("(\\s)" + attr + '="[^"]*"');
      balise = motif.test(balise)
        ? balise.replace(motif, (x, s) => s + valeur)
        : balise.replace(/^<[a-zA-Z][a-zA-Z0-9-]*/, (x) => x + " " + valeur);
    }
    return balise;
  });
  const vides = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  const motif = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?\sdata-i18n(-html)?="([^"]*)"[^>]*>/g;
  let sortie = "", pos = 0, m;
  while ((m = motif.exec(html))) {
    const finOuv = m.index + m[0].length;
    const nom = m[1].toLowerCase();
    const cle = decoderEntites(m[3]);
    const fin = (vides.has(nom) || !cle) ? null : finElement(html, nom, finOuv);
    sortie += html.slice(pos, finOuv);
    if (fin === null) { pos = finOuv; motif.lastIndex = finOuv; continue; }
    const v = t(cle);
    sortie += m[2] === "-html" ? v : echapper(v);
    pos = fin;
    motif.lastIndex = fin;
  }
  html = sortie + html.slice(pos);
  /* Le lien d'évitement n'a pas de clé de traduction : i18n.js le traduit à
     part, on fait de même. */
  html = html.replace(">Aller au contenu principal<", ">Skip to main content<");
  return html.replace(/\u0000(\d+)\u0000/g, (x, i) => abri[+i]);
}

/* Les nœuds que les graphes des guides référencent par @id (publisher,
   worksFor, isPartOf) sans les définir : Google ignore une référence sans
   nœud. Définis une fois, repris dans chaque page. */
const NOEUDS_SITE = [
  {
    "@type": "Organization",
    "@id": SITE + "/#organization",
    name: "Athena Militaria",
    url: SITE + "/",
    logo: { "@type": "ImageObject", url: SITE + "/icon-192.png", width: 192, height: 192 },
  },
  {
    "@type": "WebSite",
    "@id": SITE + "/#website",
    url: SITE + "/",
    name: "Athena Militaria",
    inLanguage: ["fr-FR", "en"],
    publisher: { "@id": SITE + "/#organization" },
  },
];


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

/* Un lien posé dans le texte d'un guide anglais renvoyait vers la page
   française : le lecteur cliquait sur « the whole catalogue » et recevait le
   catalogue en français, et Google voyait une page anglaise qui ne pointe
   que vers des pages françaises. Les adresses du site acceptent toutes
   ?lang=en ; on l'ajoute donc aux liens internes des pages anglaises, en
   respectant l'ancre quand il y en a une. */
function anglaiser(html) {
  return String(html).replace(/href="(\/[^"#?]*)(#[^"]*)?"/g, (tout, chemin, ancre) => {
    /* Un fichier se reconnaît à un point dans son dernier segment
       (/logo.webp, /favicon.ico) : lui coller ?lang=en le laisserait
       fonctionner mais ferait une adresse de plus à explorer pour rien. */
    const coupe = chemin.lastIndexOf("/");
    const dernier = coupe === -1 ? chemin : chemin.slice(coupe);
    if (dernier.includes(".")) return tout;
    return `href="${chemin}?lang=en${ancre || ""}"`;
  });
}

/* Première mention d'un terme du lexique dans un guide : lien vers sa
   définition. Le lexique n'était cité que par une page de guide, et Google
   l'avait exploré sans l'indexer ; un terme technique expliqué d'un clic
   sert aussi le lecteur. Trois liens au plus par guide, dans les
   paragraphes et les listes seulement, jamais dans un titre ni dans un lien
   existant. Les termes ambigus hors de leur contexte sont écartés : « bombe »
   ou « shell » désignent la calotte d'un casque dans le lexique, un obus
   ailleurs ; « douille » y est celle d'une baïonnette, pas d'une cartouche. */
const LEXIQUE_ECARTES = {
  fr: new Set(["Bombe", "Étoile", "Douille", "Au même numéro", "Cote", "Reproduction", "Provenance"]),
  en: new Set(["Shell", "Star", "Socket", "Matching", "Stamp", "Palm", "Skirt", "Price guide", "Reproduction", "Provenance"]),
};
function lierLexique(html, lang, slug) {
  if (!LEXIQUE_ECARTES[lang]) return html;
  const lexique = GUIDES.find((x) => x.slug === "lexique-militaria");
  if (!lexique || !lexique.termes || slug === lexique.slug) return html;
  const termes = lexique.termes
    .map((t) => (lang === "en" ? t.t_en : t.t))
    .filter((t) => t && !LEXIQUE_ECARTES[lang].has(t))
    .sort((a, b) => b.length - a.length);
  const echapRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let restants = 3;
  const faits = new Set();
  return html.replace(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/g, (bloc) => {
    if (restants <= 0) return bloc;
    let dansLien = 0;
    return bloc.split(/(<[^>]+>)/).map((seg) => {
      if (seg.startsWith("<")) {
        if (/^<a\b/i.test(seg)) dansLien++;
        else if (/^<\/a>/i.test(seg)) dansLien--;
        return seg;
      }
      if (dansLien > 0 || restants <= 0) return seg;
      for (const t of termes) {
        if (faits.has(t)) continue;
        const m = seg.match(new RegExp("(^|[^\\p{L}])(" + echapRe(t) + ")(?![\\p{L}])", "iu"));
        if (!m) continue;
        const i = m.index + m[1].length;
        const url = `/${DOSSIER}/lexique-militaria${lang === "en" ? "?lang=en" : ""}#terme-${ancre(t)}`;
        faits.add(t);
        restants--;
        // Un seul lien par fragment de texte : la suite contient désormais
        // une balise, qu'un second passage risquerait de couper.
        return seg.slice(0, i) + `<a href="${url}">${m[2]}</a>` + seg.slice(i + m[2].length);
      }
      return seg;
    }).join("");
  });
}

/* Un guide peut porter un lexique plutôt qu'un corps rédigé (champ termes).
   Chaque entrée est écrite une fois dans guides-contenu.cjs et sert deux
   fois : au lecteur, en liste de définitions groupée par famille, et au
   moteur, en DefinedTermSet. Les deux ne peuvent donc pas diverger, ce qui
   est tout l'intérêt : un lexique dont le balisage ment sur le contenu ne
   vaut rien. */
function lexiqueHtml(termes, lang) {
  const familles = [];
  for (const t of termes) {
    let f = familles.find((x) => x.nom === t.g);
    if (!f) { f = { nom: t.g, entrees: [] }; familles.push(f); }
    f.entrees.push(t);
  }
  return familles.map((f) => {
    const entrees = f.entrees.map((t) => {
      const mot = echapper(lang === "en" ? t.t_en : t.t);
      const def = echapper(lang === "en" ? t.d_en : t.d);
      const lien = t.v
        ? ` <a class="lexique-voir" href="/${DOSSIER}/${t.v}${lang === "en" ? "?lang=en" : ""}">${lang === "en" ? "the guide" : "le guide"}</a>`
        : "";
      return `          <dt id="terme-${ancre(lang === "en" ? t.t_en : t.t)}">${mot}</dt>\n          <dd>${def}${lien}</dd>`;
    }).join("\n");
    return `        <h2>${echapper(f.nom)}</h2>\n        <dl class="lexique">\n${entrees}\n        </dl>`;
  }).join("\n\n");
}

/* Encart vendeur au milieu de l'article, juste après la section sur la
   valeur : c'est là que le lecteur se demande s'il vend. L'invitation
   n'existait qu'en bas de page, après 1500 mots que peu lisent jusqu'au bout.
   Pas d'encart là où il serait déplacé : munitions (la sécurité d'abord),
   lexique, faux, débuter une collection (des acheteurs), entretien. */
const SANS_ENCART_VENDEUR = new Set([
  "munitions-obus-que-faire", "lexique-militaria", "reconnaitre-un-faux-militaria",
  "commencer-collection-militaria", "entretien-militaria-cuir-textile-metal",
]);
function encartVendeur(corps, lang, slug) {
  if (SANS_ENCART_VENDEUR.has(slug) || (lang !== "fr" && lang !== "en")) return corps;
  const texte = lang === "en"
    ? "Thinking of selling? Listing is free, and your piece is seen by collectors who know what they are looking at. Describe what you see, say what you do not know: that is what sells."
    : "Vous pensez vendre ? La mise en ligne est gratuite, et votre pièce est vue par des collectionneurs qui savent ce qu'ils regardent. Décrivez ce que vous voyez, dites ce que vous ignorez : c'est ce qui fait vendre.";
  const bouton = lang === "en" ? "List a piece" : "Déposer une annonce";
  const lien = lang === "en" ? "/sell?lang=en" : "/sell";
  const encart = `<aside class="guide-vendre"><p>${texte}</p><a class="guide-vendre-btn" href="${lien}">${bouton}</a></aside>\n`;
  // Après la section « valeur » si elle existe, sinon avant « Ce que je ne peux pas vous dire ».
  const titres = [...corps.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
  const iValeur = titres.findIndex((m) => (lang === "en" ? /value|worth|valu/i : /valeur|estimer/i).test(m[1]));
  let pos = -1;
  if (iValeur !== -1 && titres[iValeur + 1]) pos = titres[iValeur + 1].index;
  if (pos === -1) {
    const fin = titres.find((m) => (lang === "en" ? /cannot tell you/i : /ne peux pas vous dire/i).test(m[1]));
    if (fin) pos = fin.index;
  }
  // À défaut, avant la dernière section (ex. « Rédiger une annonce qui vous protège »).
  if (pos === -1 && titres.length > 1) pos = titres[titres.length - 1].index;
  return pos === -1 ? corps : corps.slice(0, pos) + encart + corps.slice(pos);
}

/* Figure placée sous le chapeau. Pas de chargement différé : sur grand
   écran, elle est souvent dans l'écran initial. Mais une priorité basse :
   mesuré sur mobile bridé, elle disputait la bande passante à la police
   du chapeau, qui est l'élément principal de la page (LCP 1,17 s avant les
   images, 1,4 à 1,6 s avec une priorité normale). */
function illustrationHtml(il, slug, lang) {
  const alt = champIllustration(il, "alt", lang);
  const legende = champIllustration(il, "legende", lang);
  const credit = champIllustration(il, "credit", lang);
  const [w, h] = il.l760;
  const [W] = il.l1200;
  const base = `/${DOSSIER}/img/${slug}`;
  const srcset = W > w
    ? ` srcset="${base}-760.webp ${w}w, ${base}-1200.webp ${W}w" sizes="(max-width: 800px) 100vw, ${w}px"`
    : "";
  return `        <figure class="guide-illustration">
          <img src="${base}-760.webp"${srcset} width="${w}" height="${h}" alt="${echapper(alt)}" decoding="async" fetchpriority="low">
          <figcaption>${echapper(legende)} <span class="guide-credit"><a href="${echapper(il.page)}" rel="noopener">${echapper(credit)}</a></span></figcaption>
        </figure>
`;
}

/* Photos placées dans le texte, chacune à la fin de la section qui décrit ce
   qu'elle montre (champ « apres » : le titre de la section, h2 ou h3).
   Pourquoi : relevé Search Console du 28 sept. 2026, une bonne part des
   impressions des guides vient de Google Lens (« valeur », « oui »,
   « real or fake »). Lens rapproche une photo des pages qui montrent la même
   pièce, et une seule image par guide ne montrait qu'un angle. Chargement
   différé : elles sont toutes sous la ligne de flottaison.
   Une photo dont la section est introuvable dans cette langue est omise. */
function insererGalerie(corps, il, slug, lang) {
  if (!il || !il.galerie || !il.galerie.length) return corps;
  const titres = [...corps.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/g)];
  const texte = (h) => h.replace(/<[^>]+>/g, "").trim();
  const ajouts = new Map();
  il.galerie.forEach((p, i) => {
    const cible = champIllustration(p, "apres", lang);
    const k = titres.findIndex((m) => texte(m[2]) === cible);
    if (k === -1) {
      if (lang !== "de") console.warn(`   ⚠️ ${slug} (${lang}) : section « ${cible} » introuvable, photo ${i + 1} omise`);
      return;
    }
    // Fin de la section : prochain titre de même niveau ou supérieur, sinon
    // le titre suivant quel qu'il soit (une h2 suivie de ses h3 garde la photo
    // juste après son paragraphe d'introduction).
    const suivant = titres[k + 1];
    const pos = suivant ? suivant.index : corps.length;
    ajouts.set(pos, (ajouts.get(pos) || "") + figureGalerie(p, `${slug}-g${i + 1}`, lang));
  });
  return [...ajouts.keys()].sort((a, b) => b - a)
    .reduce((c, pos) => c.slice(0, pos) + ajouts.get(pos) + c.slice(pos), corps);
}

/* Auteur d'une image, pour le champ « creator » que Google Images demande
   avec « copyrightNotice » (rapport Métadonnées d'image du 27 sept. 2026 :
   les deux manquaient sur toutes les images). Tiré du crédit, « Photo X,
   CC BY-SA 4.0 » donnant X ; un champ « auteur » explicite l'emporte. */
function createurImage(p) {
  const segments = String(p.credit || "").split(",").map((x) => x.trim());
  const nom = p.auteur || segments.slice(0, Math.max(1, segments.length - 1))[0]
    .replace(/^(Photo|Scan|Collection|Infographie)\s+/, "");
  const institution = /Musées|Musée|Museum|Bibliothèque|Institution|Command|Europeana|Agence|Contemporaine|Archives/i.test(nom);
  return { "@type": institution ? "Organization" : "Person", name: nom };
}

function figureGalerie(p, base, lang) {
  const [w, h] = p.l760;
  const [W] = p.l1200;
  const chemin = `/${DOSSIER}/img/${base}`;
  const srcset = W > w
    ? ` srcset="${chemin}-760.webp ${w}w, ${chemin}-1200.webp ${W}w" sizes="(max-width: 800px) 100vw, ${w}px"`
    : "";
  return `<figure class="guide-illustration guide-illustration-corps">
  <img src="${chemin}-760.webp"${srcset} width="${w}" height="${h}" alt="${echapper(champIllustration(p, "alt", lang))}" loading="lazy" decoding="async">
  <figcaption>${echapper(champIllustration(p, "legende", lang))} <span class="guide-credit"><a href="${echapper(p.page)}" rel="noopener">${echapper(champIllustration(p, "credit", lang))}</a></span></figcaption>
</figure>
`;
}

function pageGuide(g, { hautFr, basFr, hautEn, basEn }, lang) {
  const liens = langueLiens(lang);
  const haut = liens === "en" ? hautEn : hautFr;
  const bas = liens === "en" ? basEn : basFr;
  const T = TEXTES[lang];
  const url = `${SITE}/${DOSSIER}/${g.slug}`;
  const urlEn = `${url}?lang=en`;
  const urlDe = `${url}?lang=de`;
  const aDe = traduitDe(g);
  // L'adresse canonique est celle de la version servie, pas celle du français.
  const canon = lang === "en" ? urlEn : lang === "de" ? urlDe : url;
  const gTitle = champ(g, "title", lang);
  const gDesc = champ(g, "description", lang);
  const gH1 = champ(g, "h1", lang);
  const gChapeau = lang === "en" ? anglaiser(champ(g, "chapeau", lang)) : champ(g, "chapeau", lang);
  const gCorps = g.termes
    ? lexiqueHtml(g.termes, lang)
    : encartVendeur(insererGalerie(lierLexique(lang === "en" ? anglaiser(champ(g, "corps", lang)) : champ(g, "corps", lang), lang, g.slug), ILLUSTRATIONS[g.slug], g.slug, lang), lang, g.slug);
  const gFaqBrut = (lang !== "fr" && g["faq_" + lang] && g["faq_" + lang].length) ? g["faq_" + lang] : g.faq;
  const gFaq = lang === "en" ? gFaqBrut.map((f) => ({ q: f.q, r: anglaiser(f.r) })) : gFaqBrut;

  /* « À lire aussi » : quatre guides, pas les quatorze autres. Une liste
     complète au bas de chaque page est un pied de page déguisé, que le
     lecteur saute et où chaque lien pèse d'autant moins.

     Le voisinage est déclaré guide par guide (champ voisins), parce qu'il
     relève de l'éditorial : c'est l'auteur qui sait qu'un lecteur venu pour
     la croix de guerre ira vers les médailles, pas vers les baïonnettes.
     À défaut, on retombe sur les guides les plus proches dans l'ordre de
     lecture, ce qui garantit qu'il y en a toujours quatre. */
  const parSlug = new Map(GUIDES.map((x) => [x.slug, x]));
  const choisis = (g.voisins || [])
    .map((s) => parSlug.get(s))
    .filter((x) => x && x.slug !== g.slug);
  const complement = GUIDES
    .filter((x) => x.slug !== g.slug && !choisis.includes(x))
    .sort((a, b) => Math.abs((a.ordre || 99) - (g.ordre || 99)) - Math.abs((b.ordre || 99) - (g.ordre || 99)));
  const autres = choisis.concat(complement).slice(0, 4);
  const autresGuides = autres.length
    ? `      <section class="guide-lies" aria-labelledby="guides-lies">
        <h2 id="guides-lies">${T.aLireAussi}</h2>
        <ul>
${autres.map((x) => `          <li><a href="${liens === "en" ? `/${DOSSIER}/${x.slug}?lang=en` : `/${DOSSIER}/${x.slug}`}">${echapper(champ(x, "h1", liens))}</a><span>${echapper(champ(x, "description", liens))}</span></li>`).join("\n")}
        </ul>
      </section>`
    : "";

  const TITRE_FAQ = T.faq;
  const { corps, sommaire } = sommaireEtAncres(gCorps, TITRE_FAQ, T.sommaire);

  const il = ILLUSTRATIONS[g.slug];
  const imagePartage = il ? `${SITE}/${DOSSIER}/img/${g.slug}-og.jpg` : `${SITE}/og-cover.jpg`;
  const altPartage = il ? echapper(champIllustration(il, "alt", lang)) : "";
  /* L'image déclarée porte sa licence : Google Images affiche alors la
     mention « Licence » et renvoie vers la page source, ce que demandent
     de toute façon les licences Creative Commons. */
  const imageLd = il
    ? [
        {
          "@type": "ImageObject",
          "@id": canon + "#illustration",
          contentUrl: `${SITE}/${DOSSIER}/img/${g.slug}-1200.webp`,
          url: `${SITE}/${DOSSIER}/img/${g.slug}-1200.webp`,
          width: il.l1200[0],
          height: il.l1200[1],
          caption: champIllustration(il, "legende", lang),
          creditText: champIllustration(il, "credit", lang),
          creator: createurImage(il),
          copyrightNotice: champIllustration(il, "credit", lang),
          license: il.licenceUrl || il.page,
          acquireLicensePage: il.page,
        },
        { "@type": "ImageObject", url: imagePartage, width: 1200, height: 630 },
        ...(il.galerie || []).map((p, i) => ({
          "@type": "ImageObject",
          contentUrl: `${SITE}/${DOSSIER}/img/${g.slug}-g${i + 1}-1200.webp`,
          url: `${SITE}/${DOSSIER}/img/${g.slug}-g${i + 1}-1200.webp`,
          width: p.l1200[0],
          height: p.l1200[1],
          caption: champIllustration(p, "legende", lang),
          creditText: champIllustration(p, "credit", lang),
          creator: createurImage(p),
          copyrightNotice: champIllustration(p, "credit", lang),
          license: p.licenceUrl || p.page,
          acquireLicensePage: p.page,
        })),
      ]
    : SITE + "/og-cover.jpg";

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
        datePublished: dateIso(g.datePublication),
        dateModified: dateIso(g.dateModification),
        mainEntityOfPage: { "@type": "WebPage", "@id": canon },
        /* L'auteur est une personne, l'éditeur l'organisation. Un guide
           d'identification signé d'une société n'engage personne ; signé
           d'un nom, il engage quelqu'un, et c'est ce que le lecteur cherche.

           La personne est référencée par son identifiant, et définie plus
           bas dans le même graphe. Un auteur déclaré au fil des pages, sans
           identifiant commun, donne quinze auteurs homonymes ; avec, c'est
           le même, et ce qu'il écrit s'additionne. */
        author: { "@id": SITE + "/#augustin" },
        publisher: { "@id": SITE + "/#organization" },
        image: imageLd,
        /* Sujet de l'article, relié à sa page Wikipédia : le moteur sait alors
           de quel objet il est question, sans deviner d'après le texte. */
        ...(g.apropos && g.apropos.length
          ? { about: g.apropos.map((a) => ({ "@type": "Thing", name: a.nom, sameAs: a.url })) }
          : {}),
      },
      ...(g.termes ? [{
        "@type": "DefinedTermSet",
        "@id": canon + "#lexique",
        name: gH1,
        inLanguage: T.inLanguage,
        hasDefinedTerm: g.termes.map((t) => ({
          "@type": "DefinedTerm",
          name: lang === "en" ? t.t_en : t.t,
          description: lang === "en" ? t.d_en : t.d,
          inDefinedTermSet: { "@id": canon + "#lexique" },
          url: canon + "#terme-" + ancre(lang === "en" ? t.t_en : t.t),
        })),
      }] : []),
      {
        "@type": "Person",
        "@id": SITE + "/#augustin",
        name: AUTEUR,
        jobTitle: T.auteurRole,
        url: SITE + "/about",
        worksFor: { "@id": SITE + "/#organization" },
      },
      ...NOEUDS_SITE,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: T.accueil, item: SITE + "/" + (liens === "en" ? "?lang=en" : "") },
          { "@type": "ListItem", position: 2, name: T.guides, item: SITE + "/" + DOSSIER + (liens === "en" ? "?lang=en" : "") },
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
  <link rel="alternate" hreflang="en" href="${urlEn}">${aDe ? `
  <link rel="alternate" hreflang="de" href="${urlDe}">` : ""}
  <link rel="alternate" hreflang="x-default" href="${url}">

  <meta property="og:type" content="article">
  <meta property="og:title" content="${echapper(gTitle)}">
  <meta property="og:description" content="${echapper(gDesc)}">
  <meta property="og:url" content="${canon}">
  <meta property="og:image" content="${imagePartage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">${altPartage ? `
  <meta property="og:image:alt" content="${altPartage}">` : ""}
  <meta property="og:locale" content="${T.locale}">
  <meta property="og:site_name" content="Athena Militaria">
  <meta property="article:published_time" content="${dateIso(g.datePublication)}">
  <meta property="article:modified_time" content="${dateIso(g.dateModification)}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${echapper(gTitle)}">
  <meta name="twitter:description" content="${echapper(gDesc)}">
  <meta name="twitter:image" content="${imagePartage}">

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
  <script defer src="/${V_SBCLIENT}"></script>
  <script defer src="/${liens === "en" ? V_DICT_EN : V_DICT_FR}"></script>
  <script defer src="/${V_I18N}"></script>
  <script defer src="/${V_SCRIPT}"></script>
  <script defer src="/${V_ANALYTICS}"></script>
</head>
<body>
${haut}<main id="main-content" class="legal-page guide-page">
      <nav class="guide-breadcrumb" aria-label="${T.filAriane}">
        <a href="${liens === "en" ? "/?lang=en" : "/"}">${T.accueil}</a> <span aria-hidden="true">/</span>
        <span>${T.guides}</span> <span aria-hidden="true">/</span>
        <span>${echapper(gH1)}</span>
      </nav>

      <article>
        <h1>${echapper(gH1)}</h1>
        <p class="guide-signature">${T.par} <strong>${AUTEUR}</strong>, ${T.auteurRole}
          <span aria-hidden="true">·</span>
          ${T.publieLe} <time datetime="${g.datePublication}">${dateLongue(g.datePublication, lang)}</time>${
            g.dateModification && g.dateModification !== g.datePublication
              ? `, ${T.misAJourLe} <time datetime="${g.dateModification}">${dateLongue(g.dateModification, lang)}</time>`
              : ""}</p>
        <p class="guide-chapeau">${gChapeau}</p>
${il ? illustrationHtml(il, g.slug, lang) : ""}${sommaire}
${corps}
        <h2 id="faq">${TITRE_FAQ}</h2>
${faqHtml}
      </article>

${autresGuides}
      <aside class="guide-cta">
        <p class="guide-cta-kicker">Athena Militaria</p>
        <h2>${T.ctaTitre}</h2>
        <p>${T.ctaTexte}</p>
        <p class="guide-cta-action"><a class="cta-btn" href="${liens === "en" ? "/sell?lang=en" : "/sell"}">${T.ctaBouton}</a></p>
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
function pageIndex({ hautFr, basFr, hautEn, basEn }, lang) {
  const haut = lang === "en" ? hautEn : hautFr;
  const bas = lang === "en" ? basEn : basFr;
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
  /* Vignette de l'illustration du guide. Le lien qu'elle porte double celui
     du titre : il est retiré de la tabulation et des lecteurs d'écran, pour
     ne pas annoncer deux fois la même destination. Les premières vignettes
     sont dans l'écran initial et ne sont pas différées. */
  /* L'alt est celui de l'illustration : Google Images et Lens lisent cet
     attribut, aria-hidden ou non, et une vignette sans texte n'était pour
     eux qu'une image anonyme de plus. */
  const altVignette = (g) => {
    const il = ILLUSTRATIONS[g.slug];
    return echapper((lang === "en" && il.alt_en) || il.alt || champ(g, "h1", lang));
  };
  const vignette = (g, i) => ILLUSTRATIONS[g.slug]
    ? `\n          <a class="guide-index-vignette" href="${lienGuide(g)}" tabindex="-1" aria-hidden="true"><img src="/${DOSSIER}/img/${g.slug}-vignette.webp" width="132" height="132" alt="${altVignette(g)}"${i > 2 ? ' loading="lazy"' : ""} decoding="async"></a>`
    : "";
  const cartes = liste.map((g, i) => `
        <li class="guide-index-item${ILLUSTRATIONS[g.slug] ? "" : " sans-vignette"}">${vignette(g, i)}
          <div class="guide-index-texte">
          <h2><a href="${lienGuide(g)}"${cle(g, "h1")}>${echapper(champ(g, "h1", lang))}</a></h2>
          <p${cle(g, "desc")}>${echapper(champ(g, "description", lang))}</p>
          <p class="guide-index-lire"><a href="${lienGuide(g)}"${cleLire}>${T.lireGuide}</a></p>
          </div>
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
      ...NOEUDS_SITE,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: T.accueil, item: SITE + "/" + (lang === "en" ? "?lang=en" : "") },
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
  <script defer src="/${V_SBCLIENT}"></script>
  <script defer src="/${lang === "en" ? V_DICT_EN : V_DICT_FR}"></script>
  <script defer src="/${V_I18N}"></script>
  <script defer src="/${V_SCRIPT}"></script>
  <script defer src="/${V_ANALYTICS}"></script>
</head>
<body>
${tableTraductions()}
${haut}<main id="main-content" class="legal-page guide-page guide-index">
      <nav class="guide-breadcrumb" aria-label="Fil d'Ariane">
        <a href="${lang === "en" ? "/?lang=en" : "/"}">${T.accueil}</a> <span aria-hidden="true">/</span>
        <span>${T.guides}</span>
      </nav>
      <h1${lang === "fr" ? ' data-i18n="guides.index_title"' : ""}>${echapper(titre)}</h1>
      <p class="guide-chapeau"${lang === "fr" ? ' data-i18n="guides.index_intro"' : ""}>${T.indexChapeau}</p>
      <ul class="guide-index-list">
${cartes}
      </ul>
      <aside class="guide-cta">
        <p class="guide-cta-kicker">Athena Militaria</p>
        <h2>${T.ctaIndexTitre}</h2>
        <p>${T.ctaTexte}</p>
        <p class="guide-cta-action"><a class="cta-btn" href="${lang === "en" ? "/sell?lang=en" : "/sell"}">${T.ctaBouton}</a></p>
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
   de clés. On les génère ici à partir de guides-contenu.cjs plutôt que de les
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
   serait retirée de guides-contenu.cjs laisserait sinon sa page en ligne, servie
   par la règle de réécriture, et donc une version anglaise orpheline. */
for (const f of fs.readdirSync(DOSSIER_EN)) {
  if (f.endsWith(".html")) fs.unlinkSync(path.join(DOSSIER_EN, f));
}

/* Dossier allemand, vidé à chaque génération comme l'anglais. */
const DOSSIER_DE = path.join(DOSSIER, "de");
fs.mkdirSync(DOSSIER_DE, { recursive: true });
for (const f of fs.readdirSync(DOSSIER_DE)) {
  if (f.endsWith(".html")) fs.unlinkSync(path.join(DOSSIER_DE, f));
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
  if (traduitDe(g)) {
    const destDe = path.join(DOSSIER_DE, g.slug + ".html");
    fs.writeFileSync(destDe, pageGuide(g, s, "de"));
    produits.push(destDe);
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

/* Liste des guides pour les pages rendues par PHP : product.php s'en sert
   pour proposer, sous chaque fiche, les guides qui concernent la pièce
   (champs motsCles et pourTousLesAcheteurs de guides-contenu.cjs). */
fs.mkdirSync("inc", { recursive: true });
fs.writeFileSync(path.join("inc", "guides.json"), JSON.stringify(GUIDES.map((g) => ({
  slug: g.slug,
  h1: g.h1,
  h1_en: traduit(g) ? g.h1_en : null,
  description: g.description,
  description_en: traduit(g) ? g.description_en : null,
  motsCles: g.motsCles || [],
  pourTousLesAcheteurs: Boolean(g.pourTousLesAcheteurs),
})), null, 1));

/* llms.txt (llmstxt.org) : la carte du site pour les assistants. robots.txt
   les autorise explicitement ; ce fichier leur dit en une page ce qu'est le
   site, sa ligne éditoriale, et où sont les pages qui répondent à une
   question, au lieu de les laisser le déduire de l'accueil. Régénéré à chaque
   déploiement, il suit la liste des guides. */
const llms = [
  "# Athena Militaria",
  "",
  "> Place de marché française de militaria : achat et vente entre collectionneurs de casques, uniformes, médailles, insignes, équipements et documents militaires, de la Révolution à la Guerre froide. Guides pratiques signés, écrits pour les héritiers comme pour les collectionneurs : identifier, dater, estimer, conserver et vendre légalement.",
  "",
  "Site en français ; chaque page existe en anglais avec le paramètre ?lang=en. Les guides expliquent une méthode et ne donnent jamais de cote : la valeur d'une pièce se lit dans des ventes réellement conclues. Les pièces de 1933-1945 sont traitées comme des documents historiques, décrites et datées. Les guides sont signés d'Augustin, fondateur du site.",
  "",
  "## Pages principales",
  "- [Accueil](" + SITE + "/): dernières annonces et guides",
  "- [Catalogue militaria](" + SITE + "/militaria): toutes les annonces, par période et par type de pièce",
  "- [Vendre une pièce](" + SITE + "/sell): déposer une annonce",
  "- [Archive des ventes](" + SITE + "/ventes): pièces vendues sur le site, avec leur prix",
  "- [Qui sommes-nous](" + SITE + "/about)",
  "",
  "## Guides du collectionneur (français)",
  ...GUIDES.map((g) => "- [" + g.h1 + "](" + SITE + "/" + DOSSIER + "/" + g.slug + "): " + g.description),
  "",
  "## Collector's guides (English)",
  ...GUIDES.filter(traduit).map((g) => "- [" + g.h1_en + "](" + SITE + "/" + DOSSIER + "/" + g.slug + "?lang=en): " + g.description_en),
  "",
  "## Optional",
  "- [Plan du site](" + SITE + "/sitemap.xml)",
  "- [Conditions générales et mentions légales](" + SITE + "/legal)",
];
fs.writeFileSync("llms.txt", llms.join("\n") + "\n");

module.exports = { GUIDES, DOSSIER };
