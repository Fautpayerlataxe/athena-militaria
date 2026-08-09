/* Génère une copie de category.html par catégorie disposant d'un texte de
   contexte, dans categories/.

   Le fichier générique reste servi tel quel pour /category et pour toute
   catégorie sans texte : ces copies ne remplacent rien, elles s'ajoutent.
   Apache choisit la bonne au moment de la requête (règle 5 quater du
   .htaccess), l'adresse affichée ne change pas, et le JavaScript de la page
   continue de faire exactement le même travail qu'avant.

   Régénérer à chaque déploiement est indispensable : la copie doit suivre
   toute évolution de category.html, sans quoi une catégorie servirait une
   version figée du bandeau, des filtres ou des scripts.

   Appelé par deploy-ovh.sh avant l'upload. */
const fs = require("fs");
const path = require("path");

const GABARIT = "category.html";
const DOSSIER = "categories";
const DEBUT = "<!-- contexte:debut -->";
const FIN = "<!-- contexte:fin -->";
const P_DEBUT = "<!-- periodes:debut -->";
const P_FIN = "<!-- periodes:fin -->";

/* Retire du corps générique le résumé des quatre périodes.
   Sur une page consacrée à une période, ce paragraphe fait double emploi avec
   le texte qui la précède, et il est rigoureusement identique sur les seize
   adresses du catalogue : le garder alourdissait la lecture et diluait la
   part du contenu propre à la page. Si les marqueurs manquent, on ne touche
   à rien plutôt que de mutiler la page. */
function sansResumePeriodes(html) {
  const a = html.indexOf(P_DEBUT);
  const b = html.indexOf(P_FIN);
  if (a === -1 || b === -1 || b < a) return html;
  return html.slice(0, a) + html.slice(b + P_FIN.length);
}

const { CATEGORIES } = require("./categories-contenu.js");

function bloc(c) {
  const id = "contexte-" + c.slug;
  return `      <section class="about-section" id="${id}" aria-labelledby="${id}-title">
        <h2 id="${id}-title">${c.titre}</h2>${c.corps}
      </section>`;
}

function construire() {
  const gabarit = fs.readFileSync(GABARIT, "utf8");
  const a = gabarit.indexOf(DEBUT);
  const b = gabarit.indexOf(FIN);
  if (a === -1 || b === -1 || b < a) {
    throw new Error("marqueurs de contexte absents de " + GABARIT);
  }

  fs.mkdirSync(DOSSIER, { recursive: true });

  /* Les fichiers d'une catégorie retirée de categories-contenu.js resteraient
     sinon sur le disque, seraient réenvoyés à chaque déploiement et
     continueraient d'être servis par une règle .htaccess qu'on aurait oublié
     de retirer. On repart d'un dossier propre. */
  for (const f of fs.readdirSync(DOSSIER)) {
    if (f.endsWith(".html")) fs.unlinkSync(path.join(DOSSIER, f));
  }

  const regles = [];
  for (const c of CATEGORIES) {
    const html = gabarit.slice(0, a + DEBUT.length) + "\n" + bloc(c) + "\n      " + gabarit.slice(b);
    fs.writeFileSync(path.join(DOSSIER, c.slug + ".html"), sansResumePeriodes(html));

    /* Apache compare la chaîne de requête BRUTE, telle qu'elle arrive. Or une
       période accentuée comme « 1ère-Guerre-Mondiale » n'arrive pas toujours
       sous la même forme : les navigateurs encodent l'accent en UTF-8
       (1%C3%A8re), mais rien ne garantit que tout client le fasse.
       On accepte donc les deux écritures. Une règle qui ne reconnaîtrait que
       la forme encodée échouerait en silence : le visiteur recevrait la page
       générique, sans texte, et personne ne s'en apercevrait. */
    const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const formes = [...new Set([c.cat, encodeURIComponent(c.cat)])].map(echapper);
    regles.push(
      `  RewriteCond %{QUERY_STRING} (^|&)cat=(${formes.join("|")})($|&)\n` +
      `  RewriteCond %{QUERY_STRING} !(^|&)sub=\n` +
      `  RewriteCond %{QUERY_STRING} !(^|&)q=\n` +
      `  RewriteRule ^category$ ${DOSSIER}/${c.slug}.html [L]`
    );
  }

  console.log("   " + CATEGORIES.length + " page(s) de catégorie générée(s) dans " + DOSSIER + "/");

  /* Les règles ne sont pas écrites dans .htaccess automatiquement : une
     erreur dans ce fichier renvoie une 500 sur le site entier, ce n'est pas
     un endroit où un script doit écrire sans relecture. On les affiche. */
  const attendu = regles.join("\n\n");
  let actuel = "";
  try { actuel = fs.readFileSync(".htaccess", "utf8"); } catch (e) { /* absent */ }
  const manquantes = CATEGORIES.filter((c) => !actuel.includes(DOSSIER + "/" + c.slug + ".html"));
  if (manquantes.length) {
    console.log("   ⚠️  règle .htaccess absente pour : " + manquantes.map((c) => c.slug).join(", "));
    console.log("   À insérer dans le bloc mod_rewrite, AVANT la règle 6 :\n");
    console.log(attendu + "\n");
  }
}

if (require.main === module) {
  try { construire(); } catch (e) { console.error("   erreur:", e.message); process.exit(1); }
}

module.exports = { CATEGORIES, DOSSIER, construire };
