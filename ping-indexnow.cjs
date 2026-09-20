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

   Ce script n'envoie pas tout le site à chaque fois. Le protocole demande de
   signaler ce qui a changé, pas de répéter l'existant : on ne retient donc
   que les adresses dont le sitemap annonce une modification récente.

   Usage :
     node ping-indexnow.cjs                 les pages modifiées depuis 7 jours
     node ping-indexnow.cjs 30              depuis 30 jours
     node ping-indexnow.cjs https://…/x …   ces adresses précisément
*/
const fs = require("fs");
const path = require("path");

const SITE = "https://www.athenamilitaria.fr";
const HOTE = "www.athenamilitaria.fr";
const POINT_DE_COLLECTE = "https://api.indexnow.org/IndexNow";
const JOURS_PAR_DEFAUT = 7;

/* La clé est le fichier .txt de 32 caractères hexadécimaux déposé à la
   racine : le nom du fichier EST la clé, et son contenu la répète. On la
   retrouve ainsi sans la réécrire ici, et une rotation ne demande que de
   remplacer le fichier. */
function trouverCle() {
  const f = fs.readdirSync(".").find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (!f) return null;
  const contenu = fs.readFileSync(f, "utf8").trim();
  const cle = path.basename(f, ".txt");
  if (contenu !== cle) throw new Error(`${f} ne contient pas sa propre clé`);
  return cle;
}

function lireSitemap(fichier) {
  let xml;
  try { xml = fs.readFileSync(fichier, "utf8"); } catch (e) { return []; }
  const out = [];
  for (const bloc of xml.split("<url>").slice(1)) {
    const loc = (bloc.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    const last = (bloc.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
    if (loc) out.push({ loc: loc.replace(/&amp;/g, "&"), last: last || null });
  }
  return out;
}

function adressesRecentes(jours) {
  const limite = Date.now() - jours * 86400000;
  const vues = new Set();
  const retenues = [];
  for (const f of ["sitemap-pages.xml", "sitemap-annonces-secours.xml"]) {
    for (const { loc, last } of lireSitemap(f)) {
      if (vues.has(loc)) continue;
      /* Sans date, on ne peut pas savoir : on s'abstient plutôt que de
         renvoyer indéfiniment la même adresse. */
      if (!last) continue;
      if (Date.parse(last) < limite) continue;
      vues.add(loc);
      retenues.push(loc);
    }
  }
  return retenues;
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
  });
  return rep.status;
}

async function principal() {
  const args = process.argv.slice(2);
  const cle = trouverCle();
  if (!cle) {
    console.log("   pas de clé IndexNow à la racine : rien d'envoyé");
    return 0;
  }

  const explicites = args.filter((a) => /^https?:\/\//.test(a));
  const jours = Number(args.find((a) => /^\d+$/.test(a))) || JOURS_PAR_DEFAUT;
  const urls = explicites.length ? explicites : adressesRecentes(jours);

  if (!urls.length) {
    console.log("   aucune page modifiée récemment : rien à signaler");
    return 0;
  }
  /* Le protocole accepte 10 000 adresses par envoi ; on reste loin du
     plafond, mais la garde évite un refus silencieux si le catalogue grossit. */
  const lot = urls.slice(0, 10000);

  let code;
  try {
    code = await annoncer(lot, cle);
  } catch (e) {
    console.log("   IndexNow injoignable (" + e.message + ") : sans conséquence");
    return 0;
  }
  /* 200 accepté, 202 accepté mais clé encore en cours de vérification. */
  if (code === 200 || code === 202) {
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

module.exports = { adressesRecentes, trouverCle };
