/* Adresses publiques du site, pour les liens posés dans les courriels.
 *
 * Même découpe que TAXONOMIE.slugTitre (taxonomie.js) et am_slug_titre
 * (inc/athena.php). Les trois doivent coïncider : une adresse fabriquée
 * autrement redirige, ce qui fonctionne mais ajoute un aller-retour dans un
 * courriel, et certains clients de messagerie affichent la redirection comme
 * un lien suspect.
 *
 * Ce fichier est volontairement dupliqué dans chaque fonction qui en a besoin,
 * au lieu de vivre dans _shared/. Ces fonctions se déploient depuis le tableau
 * de bord, qui n'expose que les fichiers de la fonction courante : un import
 * vers ../_shared/ s'y résoudrait dans le vide. Un test compare les copies
 * entre elles et avec taxonomie.js (tests/taxonomie.test.ts).
 */

const SITE = "https://www.athenamilitaria.fr";

export function slugTitre(titre: unknown): string {
  let t = String(titre ?? "");
  t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  t = t.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
       .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (t.length > 60) {
    t = t.slice(0, 60);
    const coupe = t.lastIndexOf("-");
    if (coupe > 20) t = t.slice(0, coupe);
    t = t.replace(/-+$/, "");
  }
  return t || "annonce";
}

/** Adresse absolue d'une fiche : /annonce/<titre>-<identifiant>. */
export function urlFiche(id: unknown, titre?: unknown, lang?: string): string {
  return SITE + "/annonce/" + slugTitre(titre) + "-" + encodeURIComponent(String(id))
    + (lang === "en" ? "?lang=en" : "");
}
