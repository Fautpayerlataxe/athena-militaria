/**
 * Objet du courriel « nouveau message », et élision de « de » devant un
 * pseudo. Sans dépendance à Deno : testé sous Node (tests/courriels.test.ts),
 * comme veille-site/veille.ts. À déployer avec index.ts.
 *
 * Le 10 octobre 2026, l'objet était « Nouveau message de Antoine au sujet
 * de … » : pas d'élision, et le pseudo seul en tête, sans la mention
 * « membre », si bien qu'un pseudo comme « AthenaMilitaria » pouvait passer
 * pour un message du site.
 */

/** Coupe un titre trop long pour un objet, avec des points de suspension.
 *  Même règle que _shared/courriels.ts (fonction autonome, voir urls.ts). */
export function abreger(texte: string, max: number): string {
  const t = String(texte ?? "").trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max - 1);
  const espace = coupe.lastIndexOf(" ");
  return (espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd() + "…";
}

/* Le h muet ou aspiré ne se devine pas à l'écriture. Muet par défaut, comme
 * dans la plupart des prénoms (Hélène, Henri, Hugo) ; aspiré pour les mots
 * courants qui le sont et qu'un pseudo de collectionneur peut reprendre
 * (« de Hussard1870 », et non « d'Hussard1870 »). Les pseudos ne contiennent
 * que des lettres ASCII, des chiffres, « _ » et « - »
 * (contrainte profiles_pseudo_format). */
const H_ASPIRE = [
  "hache", "haie", "hall", "hameau", "hampe", "hangar", "hardi", "harnais", "hasard", "haubert", "haut",
  "heaume", "heros", "herisson", "heron", "hetre", "hibou", "holland", "homard", "hongr", "honte",
  "hors", "huguenot", "huit", "hulan", "hussard", "hutte",
];

/** « de Bernard », « d'Antoine », « d'Yves », « de Yann », « d'Hugo »,
 *  « de Hussard1870 », « de 1erRegiment ». */
export function de(nom: string): string {
  const n = String(nom ?? "").trim();
  const bas = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const voyelle = /^[aeiouœæ]/.test(bas);
  // « y » suivi d'une consonne se prononce comme une voyelle (Yves, Yvonne) ;
  // suivi d'une voyelle, comme une consonne (Yann, Yasmine).
  const yVoyelle = /^y[^aeiouy]/.test(bas);
  const hMuet = bas.startsWith("h") && !H_ASPIRE.some((mot) => bas.startsWith(mot));
  return voyelle || yVoyelle || hMuet ? `d'${n}` : `de ${n}`;
}

/**
 * Objet du courriel.
 *   - Avec une annonce : elle dit de quoi il s'agit, et le pseudo n'y figure
 *     pas ; le corps présente l'auteur comme un membre.
 *   - Sans annonce, avec un pseudo : le pseudo, toujours suivi de « membre
 *     d'Athena Militaria ».
 *   - Sans annonce ni pseudo : « d'un membre ».
 * Insécables à l'intérieur des guillemets.
 */
export function objetDuMessage(pseudo: string | null | undefined, titreAnnonce: string | null | undefined): string {
  const titre = String(titreAnnonce ?? "").trim();
  if (titre) return `Nouveau message au sujet de «\u00a0${abreger(titre, 50)}\u00a0»`;
  const nom = String(pseudo ?? "").trim();
  if (nom) return `Nouveau message ${de(nom)}, membre d'Athena\u00a0Militaria`;
  return "Nouveau message d'un membre";
}
