/* Adresses publiques du site, pour les liens posés dans les courriels.
 *
 * Même découpe que TAXONOMIE.slugTitre (taxonomie.js) et am_slug_titre
 * (inc/athena.php). Les trois doivent coïncider : une adresse fabriquée
 * autrement redirige, ce qui fonctionne mais ajoute un aller-retour dans un
 * courriel, et certains clients de messagerie affichent la redirection comme
 * un lien suspect.
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
