/* Écrit les deux feuilles servies aux visiteurs.

   style.css est commenté à dessein : chaque bloc explique ce qu'il corrige et
   pourquoi, et c'est ce qui rend le fichier modifiable sans tout casser. Mais
   ces 52 Ko de commentaires partent chez chaque visiteur, sur chaque page,
   avant le moindre pixel : la feuille bloque le rendu. On garde donc les
   commentaires dans le dépôt et on n'envoie que les règles.

   Second découpage : les espaces privés. Mesure du 21 septembre 2026
   (couverture-sections.mjs) : sur 283 Ko servis, une page publique n'en
   utilise que 9 à 15 %. L'essentiel de l'inutilisé est réparti page par page
   et ne peut pas se séparer sans risque. Mais les sections du compte, de
   l'administration, de la messagerie et des commandes ne sont touchées par
   AUCUNE page publique, et leurs pages sont derrière une connexion et
   interdites aux robots. Celles-là partent dans une seconde feuille, chargée
   par ces seules pages.

   La règle qui rend le découpage sûr, et qu'il ne faut pas assouplir : une
   section touchée par une page publique, ne serait-ce que d'un octet, reste
   dans la feuille publique. La liste ci-dessous est donc explicite et non
   calculée : elle se relit, et toute modification se remesure.

   Rien d'autre n'est touché : ni l'ordre, ni les sélecteurs, ni les valeurs.
   Appelé par deploy-ovh.sh avant l'upload. */
const fs = require("fs");

const SOURCE = "style.css";
const SORTIE = "style.min.css";
const SORTIE_PRIVEE = "style-espace.min.css";

/* Titres exacts des sections réservées aux pages derrière connexion.
   Vérifiés un par un : aucune n'est touchée par une page publique, menu
   mobile et modale de connexion ouverts. */
const SECTIONS_PRIVEES = [
  "Commandes : statuts, actions vendeur/acheteur, page de confirmation",
  "PAGE MON COMPTE",
  "MESSAGERIE",
  "PAGE ADMIN",
  "MESSAGERIE — amélioration mobile",
  "🛡 PANNEAU DE MODÉRATION ADMIN (intégré dans Mon Compte)",
  "Onglets compte — design professionnel militaria",
  "REFONTE CHAT — carte propre, proportions soignées",
  "ADMIN — Signalements & actions",
  "🛡 OPTIMISATION UX ADMIN MODÉRATION (v4)",
  "SOUS-ONGLETS MODÉRATION (account.html admin)",
  "MESSAGERIE — conversations, chat, temps réel",
  "ADMIN ARTICLES — toolbar avancée + cartes",
  "MESSAGERIE — réactions, séparateurs de jour, confort",
  "MODALE ÉDITION D'ANNONCE",
  "ACTIONS DES CARTES PARAMÈTRES",
];

/* Retire les commentaires en suivant le texte caractère par caractère : une
   expression régulière seule couperait aussi au milieu d'une chaîne contenant
   « /* », par exemple dans un content: ou une url(). */
function sansCommentaires(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const fin = css.indexOf(c, i + 1);
      const j = fin === -1 ? css.length : fin + 1;
      out += css.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const fin = css.indexOf("*/", i + 2);
      i = fin === -1 ? css.length : fin + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* Bornes des sections, par numéro de ligne de la source. Le titre est la
   première ligne non décorative qui suit une ligne d'égals. */
function sections(css) {
  const lignes = css.split("\n");
  const out = [];
  for (let n = 0; n < lignes.length; n++) {
    if (!/^\/\*\s*=+/.test(lignes[n].trim())) continue;
    for (let m = n; m < Math.min(n + 3, lignes.length); m++) {
      const t = lignes[m].replace(/^\/\*\s*=*\s*/, "").replace(/\s*=*\s*\*\/\s*$/, "").trim();
      if (t && !/^=+$/.test(t)) { out.push({ debut: n, titre: t }); break; }
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i].fin = i + 1 < out.length ? out[i + 1].debut : lignes.length;
  }
  return out;
}

function nettoyer(texte) {
  return sansCommentaires(texte)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "")
    .join("\n");
}

function construire() {
  const css = fs.readFileSync(SOURCE, "utf8");
  const lignes = css.split("\n");
  const decoupe = sections(css);

  const privees = new Set(SECTIONS_PRIVEES);
  const inconnues = [...privees].filter((t) => !decoupe.some((s) => s.titre === t));
  if (inconnues.length) {
    throw new Error("section privée introuvable dans style.css : " + inconnues.join(" | "));
  }

  const marque = new Array(lignes.length).fill(false);
  for (const s of decoupe) {
    if (!privees.has(s.titre)) continue;
    for (let n = s.debut; n < s.fin; n++) marque[n] = true;
  }

  const pub = nettoyer(lignes.filter((_, n) => !marque[n]).join("\n")) + "\n";
  const prv = nettoyer(lignes.filter((_, n) => marque[n]).join("\n")) + "\n";
  fs.writeFileSync(SORTIE, pub);
  fs.writeFileSync(SORTIE_PRIVEE, prv);

  const ko = (t) => Math.round(t.length / 1024);
  return `${SORTIE} : ${ko(pub)} Ko (au lieu de ${ko(css)} Ko commentés), ${SORTIE_PRIVEE} : ${ko(prv)} Ko pour les pages derrière connexion`;
}

if (require.main === module) {
  try { console.log("   " + construire()); } catch (e) { console.error("   erreur:", e.message); process.exit(1); }
}

module.exports = { construire };
