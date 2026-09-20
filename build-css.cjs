/* Écrit style.min.css, la feuille servie aux visiteurs.

   style.css est commenté à dessein : chaque bloc explique ce qu'il corrige et
   pourquoi, et c'est ce qui rend le fichier modifiable sans tout casser. Mais
   ces 52 Ko de commentaires partent chez chaque visiteur, sur chaque page,
   avant le moindre pixel : la feuille bloque le rendu. On garde donc les
   commentaires dans le dépôt et on n'envoie que les règles.

   Rien d'autre n'est touché : ni l'ordre, ni les sélecteurs, ni les valeurs.
   Un « minifieur » plus ambitieux réécrirait les règles et pourrait changer
   la cascade ; ici, le résultat est strictement la même feuille, sans ses
   commentaires ni ses lignes vides.

   Appelé par deploy-ovh.sh avant l'upload. */
const fs = require("fs");

const SOURCE = "style.css";
const SORTIE = "style.min.css";

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

function construire() {
  const css = fs.readFileSync(SOURCE, "utf8");
  const propre = sansCommentaires(css)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "")
    .join("\n") + "\n";
  fs.writeFileSync(SORTIE, propre);
  const avant = Math.round(css.length / 1024);
  const apres = Math.round(propre.length / 1024);
  return `${SORTIE} : ${apres} Ko au lieu de ${avant} Ko (commentaires et lignes vides retirés)`;
}

if (require.main === module) {
  try { console.log("   " + construire()); } catch (e) { console.error("   erreur:", e.message); process.exit(1); }
}

module.exports = { construire };
