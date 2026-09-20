/* Exporte le dictionnaire de i18n.js pour les pages rendues côté serveur.

   Les fiches, les catalogues et les versions anglaises sont désormais écrits
   par PHP (voir inc/athena.php) : le HTML servi doit contenir les mêmes
   libellés que ceux que le navigateur affiche ensuite. Recopier les
   traductions dans un second fichier aurait garanti qu'elles divergent au
   premier libellé modifié. On lit donc i18n.js lui-même, dans un bac à sable,
   et on dépose sa table telle quelle dans inc/i18n-dict.json.

   Appelé par deploy-ovh.sh avant l'upload. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = "i18n.js";
const SORTIE = path.join("inc", "i18n-dict.json");
const MARQUEUR = "const DICT = {";

function extraire() {
  let code = fs.readFileSync(SOURCE, "utf8");
  /* La table est une constante privée de la fermeture. Plutôt que de modifier
     i18n.js pour l'exposer au navigateur, on la rend visible ici seulement,
     le temps de l'exécution dans le bac à sable. */
  if (!code.includes(MARQUEUR)) throw new Error("déclaration du dictionnaire introuvable dans " + SOURCE);
  code = code.replace(MARQUEUR, "const DICT = globalThis.__DICT__ = {");

  const neutre = () => {};
  const bac = {
    window: {},
    document: {
      addEventListener: neutre,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { setAttribute: neutre },
    },
    location: { search: "", pathname: "/" },
    localStorage: { getItem: () => null, setItem: neutre },
    URLSearchParams,
    CustomEvent: function CustomEvent() {},
    console,
  };
  vm.createContext(bac);
  vm.runInContext(code, bac, { filename: SOURCE, timeout: 2000 });

  const dict = bac.__DICT__;
  if (!dict || !dict.fr || !dict.en) throw new Error("dictionnaire vide après exécution de " + SOURCE);
  return { fr: dict.fr, en: dict.en };
}

/* Fin de la table : on compte les accolades depuis le marqueur, en sautant
   les chaînes (beaucoup contiennent « { » : {n}, {date}) et les commentaires. */
function finDeTable(code, debut) {
  let profondeur = 0;
  for (let i = code.indexOf("{", debut); i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === "\\") i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") { i = code.indexOf("\n", i); continue; }
    if (c === "{") profondeur++;
    else if (c === "}" && --profondeur === 0) return i;
  }
  throw new Error("fin du dictionnaire introuvable dans " + SOURCE);
}

/* Le navigateur ne reçoit plus les deux langues. build produit :
     i18n-fr.js / i18n-en.js : une table chacun ;
     i18n-runtime.js         : ce fichier sans sa table.
   Une page charge sa langue et le moteur ; l'autre langue n'arrive que si le
   visiteur la demande (chargerDictionnaire, dans i18n.js). */
function decouper(dict) {
  const code = fs.readFileSync(SOURCE, "utf8");
  const debut = code.indexOf(MARQUEUR);
  const fin = finDeTable(code, debut);
  const moteur = code.slice(0, debut)
    + "const DICT = (window.__I18N_DICT = window.__I18N_DICT || { fr: {}, en: {} })"
    + code.slice(fin + 1);
  fs.writeFileSync("i18n-runtime.js", moteur);
  for (const lang of ["fr", "en"]) {
    fs.writeFileSync("i18n-" + lang + ".js",
      "window.__I18N_DICT = window.__I18N_DICT || {};\n"
      + "window.__I18N_DICT." + lang + " = " + JSON.stringify(dict[lang]) + ";\n");
  }
  return Math.round(fs.statSync("i18n-runtime.js").size / 1024);
}

function construire() {
  const dict = extraire();
  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, JSON.stringify(dict));
  const moteur = decouper(dict);
  return `${Object.keys(dict.fr).length} clés FR, ${Object.keys(dict.en).length} clés EN`
    + ` : ${SORTIE}, i18n-fr.js, i18n-en.js et i18n-runtime.js (${moteur} Ko)`;
}

if (require.main === module) {
  try { console.log("   " + construire()); } catch (e) { console.error("   erreur:", e.message); process.exit(1); }
}

module.exports = { extraire, construire };
