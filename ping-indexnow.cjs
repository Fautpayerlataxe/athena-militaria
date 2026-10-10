/* Prévient les moteurs qu'une page a changé, sans attendre leur prochaine
   exploration.

   Un sitemap est une invitation : le moteur le relit quand il le décide, et
   Search Console montrait qu'il s'était écoulé plusieurs jours entre un dépôt
   et la lecture du plan de site. IndexNow fait l'inverse : le site annonce
   lui-même ce qui a bougé, et Bing, Yandex, Seznam et Naver partagent cette
   annonce entre eux. Google n'en fait pas partie, et son sitemap est relancé
   séparément par deploy-ovh.sh.

   L'authentification tient en un fichier : une clé déposée à la racine du
   site, sous son propre nom, que le moteur va lire pour vérifier que
   l'annonce vient bien du propriétaire du domaine.

   Ce script n'envoie que les pages réellement modifiées depuis le dernier
   envoi accepté. Le protocole demande de signaler ce qui a été ajouté,
   modifié ou retiré, et de ne pas répéter l'existant (indexnow.org, FAQ).

   Jusqu'au 9 oct. 2026, il retenait les adresses dont le sitemap annonçait
   une date de moins de sept jours. Deux défauts : un déploiement fait plus
   d'une semaine après une modification ne la signalait jamais, et une page
   dont le texte change sans que sa date bouge (une catégorie sans annonce
   n'a pas de date au sitemap, un guide corrigé garde souvent la sienne)
   passait inaperçue.

   Désormais, chaque adresse reçoit une empreinte calculée sur ce qui lui est
   propre : titre, description et contenu principal (<main>) pour une page
   ou un guide, avec les traductions qu'il appelle ; texte, cartes de guides
   et date de la dernière annonce pour une catégorie ; date de publication ou
   de traduction pour une fiche. Le bandeau et le pied de page, communs à
   tout le site, n'y entrent pas : les retoucher ne fait pas de chaque page
   une page modifiée. Les empreintes du dernier envoi accepté sont gardées
   dans .cache/indexnow-empreintes.json (propre à cette machine, ignoré par
   git) ; on signale les adresses dont l'empreinte diffère, les nouvelles, et
   celles qui ont quitté le plan de site.

   Garde-fou : si plus de la moitié des adresses connues semblent modifiées,
   rien n'est envoyé automatiquement. C'est le plus souvent le signe d'un
   changement de gabarit ou d'une erreur de calcul, et IndexNow n'est pas
   fait pour recevoir le site entier d'un coup. Mais le site ne compte
   qu'environ 130 adresses (131 le 9 oct. 2026), et un dépôt qui regroupe
   plusieurs chantiers atteint vite la moitié : ce soir-là, la liste du
   dépôt suivant en comptait déjà 47. On lit donc la liste avec --essai,
   puis :
   - si elle est juste, --confirmer l'envoie malgré le garde-fou, et ces
     pages entrent dans la mémoire comme après tout envoi accepté ;
   - si elle est fausse (gabarit, calcul), --accepter prend l'état local
     comme référence sans rien envoyer. Jamais sur une liste juste : les
     pages réellement modifiées ne seraient alors jamais signalées.
   Le dépôt (deploy-ovh.sh) n'emploie ni l'un ni l'autre : passer outre
   reste une décision prise après avoir lu la liste.

   Usage :
     node ping-indexnow.cjs                 signale les pages modifiées
     node ping-indexnow.cjs --essai         affiche la liste, n'envoie rien
     node ping-indexnow.cjs --confirmer     envoie la liste même au-delà du
                                            garde-fou, une fois vérifiée
     node ping-indexnow.cjs --amorcer       prend l'état en ligne (fichiers
                                            du dernier commit, plans de site
                                            lus sur le site) comme référence,
                                            sans rien envoyer
     node ping-indexnow.cjs --accepter      prend l'état des fichiers locaux
                                            comme référence, sans rien envoyer
                                            (liste fausse : rien à signaler)
     node ping-indexnow.cjs https://…/x …   ces adresses précisément
*/
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const SITE = "https://www.athenamilitaria.fr";
const HOTE = "www.athenamilitaria.fr";
const POINT_DE_COLLECTE = "https://api.indexnow.org/IndexNow";
const RACINE = __dirname;
const MEMOIRE = path.join(RACINE, ".cache", "indexnow-empreintes.json");
const PART_MAX = 0.5;

/* Les deux moitiés du plan de site, telles que generate-sitemap.cjs les
   écrit avant chaque dépôt. En ligne, la moitié « annonces » est servie par
   sitemap.php sous un autre nom ; son contenu est le même (vérifié le
   9 oct. 2026 : mêmes 58 adresses, mêmes dates). */
const SITEMAPS = {
  "sitemap-pages.xml": SITE + "/sitemap-pages.xml",
  "sitemap-annonces-secours.xml": SITE + "/sitemap-annonces.xml",
};

/* Pages fixes : le fichier source et le préfixe de leurs balises seo.* dans
   inc/i18n-dict.json (titre et description de la version anglaise, posés
   par page.php et category.php). */
const PAGES_FIXES = {
  "/": ["index.html", "index"],
  "/militaria": ["category.html", "category"],
  "/about": ["about.html", "about"],
  "/community": ["community.html", "community"],
  "/sell": ["sell.html", "sell"],
  "/legal": ["legal.html", "legal"],
};

/* La clé est le fichier .txt de 32 caractères hexadécimaux déposé à la
   racine : le nom du fichier EST la clé, et son contenu la répète. On la
   retrouve ainsi sans la réécrire ici, et une rotation ne demande que de
   remplacer le fichier. */
function trouverCle() {
  const f = fs.readdirSync(RACINE).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (!f) return null;
  const contenu = fs.readFileSync(path.join(RACINE, f), "utf8").trim();
  const cle = path.basename(f, ".txt");
  if (contenu !== cle) throw new Error(`${f} ne contient pas sa propre clé`);
  return cle;
}

/* Deux façons de lire les fichiers du site : tels qu'ils sont sur le disque
   (ce qui vient d'être déposé), ou tels qu'ils étaient au dernier commit,
   pour amorcer la mémoire avec ce qui est en ligne. Un fichier absent vaut
   null : la page n'a alors pas d'empreinte et n'est jamais signalée seule. */
function lecteurDisque() {
  return (f) => {
    try { return fs.readFileSync(path.join(RACINE, f), "utf8"); } catch (e) { return null; }
  };
}
function lecteurGit(ref) {
  const deja = new Map();
  return (f) => {
    if (!deja.has(f)) {
      let texte = null;
      try {
        texte = execFileSync("git", ["show", ref + ":" + f],
          { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
      } catch (e) { /* fichier absent de ce commit */ }
      deja.set(f, texte);
    }
    return deja.get(f);
  };
}

function lireSitemap(xml) {
  const out = [];
  for (const bloc of String(xml || "").split("<url>").slice(1)) {
    const loc = (bloc.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    const last = (bloc.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
    if (loc) out.push({ loc: loc.replace(/&amp;/g, "&"), last: last || null });
  }
  return out;
}

const json = (texte, defaut) => {
  try { return texte ? JSON.parse(texte) : defaut; } catch (e) { return defaut; }
};

/* Les numéros de version des ressources (script.js?v=104) changent dans
   toutes les pages à chaque retouche de CSS ou de JS, et les espaces
   dépendent du générateur : ni l'un ni l'autre ne fait une page modifiée.
   Même règle que changeAutreChoseQueLesVersions() dans generate-sitemap.cjs. */
const normaliser = (s) => String(s || "").replace(/\?v=\d+/g, "").replace(/\s+/g, " ").trim();
const empreinte = (morceaux) =>
  crypto.createHash("sha256").update(normaliser(morceaux.join("\n"))).digest("hex").slice(0, 20);

function entre(html, debut, fin) {
  const a = html.indexOf(debut);
  const b = a === -1 ? -1 : html.indexOf(fin, a + debut.length);
  return b === -1 ? "" : html.slice(a + debut.length, b);
}

/* Ce qui est propre à une page : son titre, sa description et son contenu
   principal. Tout le site a un <main> ; sans lui, on garde le document
   entier plutôt que rien. */
function partiesPage(html) {
  if (!html) return null;
  const titre = (html.match(/<title>[\s\S]*?<\/title>/) || [""])[0];
  const description = (html.match(/<meta name="description" content="[^"]*"/) || [""])[0];
  const a = html.search(/<main\b/);
  const b = html.lastIndexOf("</main>");
  return [titre, description, a !== -1 && b > a ? html.slice(a, b) : html];
}

/* Les textes que la page tire du dictionnaire (attributs data-i18n*) : la
   version anglaise d'une page fixe est le même fichier traduit par page.php,
   elle change donc quand une de ses traductions change. */
function traductions(fragment, dict, lang) {
  const table = (dict && dict[lang]) || {};
  const cles = new Set();
  for (const m of fragment.matchAll(/\bdata-i18n(?:-[a-z-]+)?="([^"]+)"/g)) cles.add(m[1]);
  return [...cles].sort().map((k) => k + "=" + (table[k] ?? ""));
}

/* Empreinte de chaque adresse des deux sitemaps, d'après les fichiers que
   lire() renvoie et les plans de site fournis. */
function calculerEmpreintes(lire, xmlSitemaps) {
  const entrees = [];
  const vues = new Set();
  for (const xml of xmlSitemaps) {
    for (const e of lireSitemap(xml)) {
      if (vues.has(e.loc)) continue;
      vues.add(e.loc);
      entrees.push(e);
    }
  }

  const dict = json(lire("inc/i18n-dict.json"), {});
  const guides = new Map(json(lire("inc/guides.json"), []).map((g) => [g.slug, g]));
  const categories = json(lire("inc/categories.json"), []);
  /* taxonomie.js est un script de navigateur : on l'exécute dans un bac à
     sable, comme generate-sitemap.cjs, pour retrouver l'adresse de chaque
     catégorie exactement comme le site la calcule. */
  const bac = {};
  try { require("vm").runInNewContext(lire("taxonomie.js") || "", bac); } catch (e) { /* sans taxonomie, pas de catégorie */ }
  const T = bac.TAXONOMIE;
  const parChemin = new Map();
  if (T) {
    for (const c of categories) {
      if (c.periode) parChemin.set(T.urlCategorie(c.periode, c.type || null, "fr"), c);
    }
  }
  /* Le catalogue entier montre les annonces : la plus récente le date. */
  const derniereAnnonce = entrees
    .filter((e) => e.last && new URL(e.loc).pathname.startsWith("/annonce/"))
    .map((e) => e.last).sort().pop() || "";

  const resultat = new Map();
  for (const { loc, last } of entrees) {
    let u;
    try { u = new URL(loc); } catch (e) { continue; }
    const lang = u.searchParams.get("lang") || "fr";
    const chemin = u.pathname.replace(/\/+$/, "") || "/";
    let morceaux = null;

    if (PAGES_FIXES[chemin]) {
      const [fichier, seo] = PAGES_FIXES[chemin];
      const p = partiesPage(lire(fichier));
      if (p) {
        const table = dict[lang] || {};
        morceaux = ["page", lang, ...p, ...traductions(p.join("\n"), dict, lang),
          table["seo." + seo + ".title"] || "", table["seo." + seo + ".desc"] || ""];
        if (chemin === "/militaria") morceaux.push("annonces " + derniereAnnonce);
      }
    } else if (chemin === "/guides" || chemin.startsWith("/guides/")) {
      const slug = chemin === "/guides" ? "index" : chemin.slice("/guides/".length);
      const p = partiesPage(lire("guides/" + (lang === "fr" ? "" : lang + "/") + slug + ".html"));
      if (p) morceaux = ["guide", lang, ...p, ...traductions(p.join("\n"), dict, lang)];
    } else if (parChemin.has(chemin)) {
      /* Catégorie enrichie : son texte dans la langue servie, ses cartes de
         guides (titre et résumé, que category.php recopie) et la date de sa
         dernière annonce. Le reste de la page est le gabarit du catalogue,
         commun aux seize catégories. */
      const c = parChemin.get(chemin);
      const html = lire("categories/" + c.slug + ".html");
      if (html) {
        const texte = (lang === "en" && entre(html, "<!-- contexte-en:debut -->", "<!-- contexte-en:fin -->"))
          || entre(html, "<!-- contexte-fr:debut -->", "<!-- contexte-fr:fin -->");
        const tete = lang === "fr"
          ? [(html.match(/<title>[\s\S]*?<\/title>/) || [""])[0],
             (html.match(/<meta name="description" content="[^"]*"/) || [""])[0],
             (html.match(/<h1 id="category-title"[^>]*>[^<]*<\/h1>/) || [""])[0]]
          : [];
        const cartes = (c.guides || []).map((s) => {
          const g = guides.get(s) || {};
          const en = lang === "en" && g.h1_en;
          return [s, en ? g.h1_en : g.h1, en && g.description_en ? g.description_en : g.description].join(" | ");
        });
        morceaux = ["categorie", lang, ...tete, texte, ...cartes, "annonces " + (last || "")];
      }
    } else if (last) {
      /* Fiche d'annonce, ou catégorie sans texte propre : seule la date du
         plan de site (publication, traduction, dernière annonce) en dit
         quelque chose. */
      morceaux = ["date", last];
    }
    /* Sans source ni date, on ne peut pas savoir : l'adresse n'est jamais
       signalée seule, plutôt que de l'être à chaque fois. */
    resultat.set(loc, morceaux ? empreinte(morceaux) : null);
  }
  return resultat;
}

function lireMemoire() {
  const m = json((() => { try { return fs.readFileSync(MEMOIRE, "utf8"); } catch (e) { return null; } })(), null);
  return m && m.empreintes && typeof m.empreintes === "object" ? m.empreintes : null;
}

function ecrireMemoire(empreintes, origine) {
  fs.mkdirSync(path.dirname(MEMOIRE), { recursive: true });
  const tri = {};
  for (const k of Object.keys(empreintes).sort()) tri[k] = empreintes[k];
  fs.writeFileSync(MEMOIRE, JSON.stringify({
    note: "Empreintes des pages au dernier envoi IndexNow accepté (ping-indexnow.cjs). Sans ce fichier, la référence est reprise sur le dernier commit.",
    majLe: new Date().toISOString(),
    origine,
    empreintes: tri,
  }, null, 1) + "\n");
}

/* L'état en ligne, pour amorcer la mémoire : les fichiers du dernier commit
   (le 9 oct. 2026, les guides de e322aec relus en ligne leur étaient
   identiques octet pour octet, le dépôt ayant précédé le commit d'une
   minute) et les plans de site lus sur le site lui-même. Si le site ne
   répond pas, on prend ceux du commit. */
async function etatEnLigne(ref) {
  const lire = lecteurGit(ref);
  const xml = [];
  let source = "en ligne";
  for (const [local, enLigne] of Object.entries(SITEMAPS)) {
    let texte = null;
    try {
      const rep = await fetch(enLigne, { signal: AbortSignal.timeout(20000) });
      if (rep.ok) texte = await rep.text();
    } catch (e) { /* repli ci-dessous */ }
    if (!texte || !texte.includes("<urlset")) {
      texte = lire(local);
      source = "du commit";
    }
    xml.push(texte);
  }
  return { empreintes: calculerEmpreintes(lire, xml), source };
}

function commitCourant() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"],
      { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (e) { return "HEAD"; }
}

async function annoncer(urls, cle) {
  const corps = {
    host: HOTE,
    key: cle,
    keyLocation: `${SITE}/${cle}.txt`,
    urlList: urls,
  };
  const rep = await fetch(POINT_DE_COLLECTE, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(30000),
  });
  return rep.status;
}

async function principal() {
  const args = process.argv.slice(2);
  const essai = args.includes("--essai");
  const confirmer = args.includes("--confirmer");
  const explicites = args.filter((a) => /^https?:\/\//.test(a));
  if (args.some((a) => /^\d+$/.test(a))) {
    console.log("   un nombre de jours n'a plus d'effet : la comparaison se fait avec le dernier envoi accepté");
  }

  if (args.includes("--amorcer")) {
    const ref = commitCourant();
    const { empreintes, source } = await etatEnLigne("HEAD");
    const connues = Object.fromEntries([...empreintes].filter(([, e]) => e));
    ecrireMemoire(connues, `amorçage : fichiers du commit ${ref}, plans de site ${source}`);
    console.log(`   mémoire IndexNow amorcée : ${Object.keys(connues).length} adresse(s) (commit ${ref}, plans de site ${source}), rien d'envoyé`);
    return 0;
  }

  const cle = trouverCle();
  if (!cle) {
    console.log("   pas de clé IndexNow à la racine : rien d'envoyé");
    return 0;
  }

  /* Sans mémoire (première fois, ou autre machine), on part du dernier
     commit plutôt que de tout envoyer : au pire, ce déploiement-ci ne
     signale que ce qui a changé depuis ce commit. */
  let memoire = lireMemoire();
  let amorcee = false;
  if (!memoire) {
    const lire = lecteurGit("HEAD");
    const base = calculerEmpreintes(lire, Object.keys(SITEMAPS).map((f) => lire(f)));
    memoire = Object.fromEntries([...base].filter(([, e]) => e));
    amorcee = true;
    console.log(`   pas encore de mémoire IndexNow : référence prise sur le commit ${commitCourant()}`);
  }

  const lireDisque = lecteurDisque();
  const actuelles = calculerEmpreintes(lireDisque, Object.keys(SITEMAPS).map((f) => lireDisque(f)));

  /* Quand la liste dépasse le garde-fou et que --essai la montre fausse
     (gabarit commun, erreur de calcul) : l'état des fichiers déposés
     devient la référence, sans rien envoyer. Une liste juste s'envoie avec
     --confirmer : l'accepter ici effacerait ces pages sans les signaler. */
  if (args.includes("--accepter")) {
    const connues = Object.fromEntries([...actuelles].filter(([, e]) => e));
    ecrireMemoire(connues, "état des fichiers locaux accepté sans envoi (--accepter)");
    console.log(`   référence IndexNow remplacée par l'état local : ${Object.keys(connues).length} adresse(s), rien d'envoyé`);
    return 0;
  }

  let urls;
  let tropNombreuses = false;
  if (explicites.length) {
    urls = explicites;
  } else {
    const modifiees = [...actuelles].filter(([u, e]) => e && memoire[u] !== e).map(([u]) => u);
    /* Une adresse sortie du plan de site (annonce retirée, page supprimée)
       est aussi un changement à signaler : le moteur constatera la
       redirection ou l'erreur 404 au lieu de garder l'ancienne page. */
    const retirees = Object.keys(memoire).filter((u) => !actuelles.has(u));
    urls = modifiees.concat(retirees);
    const total = new Set([...Object.keys(memoire), ...actuelles.keys()]).size;
    tropNombreuses = urls.length > total * PART_MAX;
    if (tropNombreuses && !essai && !confirmer) {
      console.log(`   ${urls.length} adresse(s) sur ${total} semblent modifiées, plus de la moitié : rien d'envoyé.`);
      console.log("   Lisez la liste avec node ping-indexnow.cjs --essai.");
      console.log("   Si elle est juste, node ping-indexnow.cjs --confirmer l'envoie.");
      console.log("   Si elle est fausse, node ping-indexnow.cjs --accepter en fait la référence sans rien envoyer.");
      return 0;
    }
  }

  if (!urls.length) {
    if (amorcee && !essai) ecrireMemoire(memoire, `amorçage automatique sur le commit ${commitCourant()}`);
    console.log("   aucune page modifiée depuis le dernier envoi : rien à signaler");
    return 0;
  }
  /* Le protocole accepte 10 000 adresses par envoi ; on reste loin du
     plafond, mais la garde évite un refus silencieux si le catalogue grossit. */
  const lot = urls.slice(0, 10000);

  if (essai) {
    console.log(`   essai : ${lot.length} adresse(s) seraient signalées, rien d'envoyé`);
    if (tropNombreuses) console.log("   (plus de la moitié des adresses connues : le dépôt n'enverra rien ; si la liste est juste, --confirmer l'envoie)");
    for (const u of lot) console.log("     " + u + (actuelles.has(u) ? "" : "  (retirée du plan de site)"));
    return 0;
  }

  let code;
  try {
    code = await annoncer(lot, cle);
  } catch (e) {
    console.log("   IndexNow injoignable (" + e.message + ") : sans conséquence, les mêmes adresses partiront au prochain envoi");
    return 0;
  }
  /* 200 accepté, 202 accepté mais clé encore en cours de vérification.
     La mémoire n'est mise à jour qu'à ce moment : un envoi refusé ou perdu
     laisse les adresses à signaler au prochain déploiement. */
  if (code === 200 || code === 202) {
    for (const u of lot) {
      const e = actuelles.get(u);
      if (e) memoire[u] = e;
      else if (!actuelles.has(u)) delete memoire[u];
    }
    ecrireMemoire(memoire, `envoi accepté (${code}) de ${lot.length} adresse(s)`);
    console.log(`   ${lot.length} adresse(s) signalée(s) à IndexNow (Bing, Yandex, Seznam, Naver)`);
  } else {
    console.log(`   IndexNow a répondu ${code} : les moteurs exploreront à leur rythme`);
  }
  return 0;
}

if (require.main === module) {
  principal().then((c) => process.exit(c)).catch((e) => {
    console.log("   erreur IndexNow :", e.message);
    process.exit(0);
  });
}

module.exports = { calculerEmpreintes, lecteurDisque, lecteurGit, trouverCle };
