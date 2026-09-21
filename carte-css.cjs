/* Correspondance exacte entre la feuille servie et la source.
   build-css.cjs ne fait que retirer les commentaires et les lignes vides :
   l'ordre et le texte des règles sont inchangés. On rejoue donc la même
   transformation en notant, pour chaque octet servi, la ligne d'origine.
   Un repérage approximatif par sélecteur ne suffisait pas : les sections
   partagent leurs premiers sélecteurs. */
const fs = require("fs");

function sansCommentairesAvecLignes(css) {
  let out = "", lignes = [], ligne = 1, i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const fin = css.indexOf(c, i + 1);
      const j = fin === -1 ? css.length : fin + 1;
      for (let k = i; k < j; k++) { out += css[k]; lignes.push(ligne); if (css[k] === "\n") ligne++; }
      i = j; continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const fin = css.indexOf("*/", i + 2);
      const j = fin === -1 ? css.length : fin + 2;
      for (let k = i; k < j; k++) if (css[k] === "\n") ligne++;
      i = j; continue;
    }
    out += c; lignes.push(ligne);
    if (c === "\n") ligne++;
    i++;
  }
  return { texte: out, lignes };
}

const src = fs.readFileSync("style.css", "utf8");
const { texte, lignes } = sansCommentairesAvecLignes(src);

/* Même filtrage des lignes vides que build-css.cjs, en conservant la carte. */
let servi = "", carte = [];
let debutLigne = 0;
for (let i = 0; i <= texte.length; i++) {
  if (i === texte.length || texte[i] === "\n") {
    const brut = texte.slice(debutLigne, i).replace(/\s+$/, "");
    if (brut.trim() !== "") {
      for (let k = 0; k < brut.length; k++) { servi += brut[k]; carte.push(lignes[debutLigne + k]); }
      servi += "\n"; carte.push(lignes[Math.min(debutLigne, texte.length - 1)]);
    }
    debutLigne = i + 1;
  }
}
servi += "";

const reel = fs.readFileSync("style.min.css", "utf8");
console.error("carte", servi.length, "octets | fichier servi", reel.length, "octets |",
  servi === reel ? "IDENTIQUES" : "DIFFERENTS");

/* Sections de la source, par ligne. */
const titres = [];
const parLigne = src.split("\n");
for (let n = 0; n < parLigne.length; n++) {
  const l = parLigne[n];
  if (/^\/\*\s*=+\s*$/.test(l.trim()) || /^\/\*\s*=+/.test(l.trim())) {
    for (let m = n; m < Math.min(n + 3, parLigne.length); m++) {
      const t = parLigne[m].replace(/^\/\*\s*=*\s*/, "").replace(/\s*=*\s*\*\/\s*$/, "").trim();
      if (t && !/^=+$/.test(t)) { titres.push({ ligne: n + 1, titre: t }); break; }
    }
  }
}
for (let i = 0; i < titres.length; i++) {
  titres[i].finLigne = i + 1 < titres.length ? titres[i + 1].ligne - 1 : parLigne.length;
}
console.error(titres.length, "sections dans la source");

/* Plage d'octets servis pour chaque section. */
for (const t of titres) {
  let debut = -1, fin = -1;
  for (let i = 0; i < carte.length; i++) {
    if (carte[i] >= t.ligne && carte[i] <= t.finLigne) { if (debut === -1) debut = i; fin = i + 1; }
  }
  t.debut = debut; t.fin = fin; t.taille = debut === -1 ? 0 : fin - debut;
}
fs.writeFileSync("/tmp/carte-sections.json", JSON.stringify(titres, null, 1));
const avec = titres.filter(t => t.taille > 0);
console.log(avec.length, "sections situées,", Math.round(avec.reduce((n,t)=>n+t.taille,0)/1024), "Ko couverts sur", Math.round(reel.length/1024), "Ko");
