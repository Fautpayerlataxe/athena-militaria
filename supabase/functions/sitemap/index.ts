import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/* =====================================================================
   Sitemap des annonces (partie vivante du plan de site).

   Le sitemap était jusqu'ici entièrement généré par generate-sitemap.js au
   moment du déploiement. Conséquence : une annonce publiée le lundi
   n'apparaissait dans le sitemap qu'au déploiement suivant, parfois des
   semaines plus tard. Sur une place de marché où les annonces sont
   précisément le contenu qui bouge, c'est la moitié utile du sitemap qui
   arrivait en retard.

   Répartition retenue :
     - sitemap-pages.xml  : pages fixes + guides. Contenu figé entre deux
       déploiements, et dont la date de dernière modification vient de git :
       il reste généré au déploiement, là où l'information existe.
     - cette fonction     : catégories, sous-catégories et fiches produits,
       lues en base à chaque appel, donc toujours à jour.

   Elle est appelée par sitemap.php côté OVH (qui garde l'URL en
   www.athenamilitaria.fr et met en cache), et régénérée chaque nuit par
   pg_cron (migration 20260810000000_sitemap_cron.sql).

   Déploiement : supabase functions deploy sitemap --no-verify-jwt
   (lecture publique de données déjà publiques, aucun secret en jeu).
   ===================================================================== */

const SITE = "https://www.athenamilitaria.fr";

/* Les URLs du site encodent les espaces en tirets (?cat=2nde-Guerre-Mondiale).
   Le sitemap doit produire exactement les mêmes URLs que les liens internes,
   sinon on déclare des adresses que personne ne pointe. Règle identique à
   celle de generate-sitemap.js : les deux doivent rester alignées. */
const slug = (v: string) => encodeURIComponent(String(v).trim().replace(/ /g, "-"));

/* La base et les URLs ne parlent pas le même vocabulaire pour deux
   sous-catégories : le formulaire de vente enregistre la forme longue, alors
   que toute la navigation du site utilise un segment court (SUB_DB et
   window.dbToSubSlug dans script.js). Slugifier la valeur brute déclarait au
   sitemap une adresse que ne pointe aucun lien interne, en double de celle
   que le site utilise, les deux se déclarant canoniques d'elles-mêmes.
   Copie à garder alignée avec script.js et generate-sitemap.js. */
const SUB_COURT: Record<string, string> = {
  "Armes (neutralisées/maquettes)": "Armes",
  "Médailles & décorations": "Médailles",
};
const slugSub = (v: string) => slug(SUB_COURT[String(v).trim()] || v);

/* Une page bilingue impose une entrée <url> PAR version, chacune répétant le
   jeu complet d'alternates. N'annoncer que la version française laissait la
   version anglaise hors du sitemap. */
function urlEntry(loc: string, changefreq: string, priority: string, lastmod: string | null) {
  const sep = loc.includes("?") ? "&amp;" : "?";
  const locEn = loc + sep + "lang=en";

  const alternates =
    '    <xhtml:link rel="alternate" hreflang="fr" href="' + loc + '"/>\n' +
    '    <xhtml:link rel="alternate" hreflang="en" href="' + locEn + '"/>\n' +
    '    <xhtml:link rel="alternate" hreflang="x-default" href="' + loc + '"/>\n';

  const bloc = (href: string) => {
    let s = "  <url>\n    <loc>" + href + "</loc>\n";
    if (lastmod) s += "    <lastmod>" + lastmod + "</lastmod>\n";
    s += "    <changefreq>" + changefreq + "</changefreq>\n";
    s += "    <priority>" + priority + "</priority>\n";
    return s + alternates + "  </url>\n";
  };

  return bloc(loc) + bloc(locEn);
}

type Produit = {
  id: number | string;
  created_at: string | null;
  period: string | null;
  subcategory: string | null;
};

Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    /* Clé anonyme et non service_role : on ne lit que des annonces publiées,
       c'est-à-dire ce que n'importe quel visiteur voit déjà. Aucune raison de
       manipuler une clé d'administration pour ça. */
    const url =
      SUPABASE_URL +
      "/rest/v1/products?status=eq.published" +
      "&select=id,created_at,period,subcategory" +
      "&order=created_at.desc&limit=5000";

    const rep = await fetch(url, {
      headers: { apikey: ANON, Authorization: "Bearer " + ANON },
    });
    if (!rep.ok) {
      return new Response("Base injoignable (HTTP " + rep.status + ")", { status: 502 });
    }
    const produits: Produit[] = await rep.json();

    let xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n\n';

    /* Catégories et sous-catégories : uniquement celles qui contiennent
       réellement des annonces. Soumettre une page de catalogue vide, c'est
       envoyer Google sur une page sans contenu, ce qui dessert le site
       entier. La date retenue est celle de l'annonce la plus récente de la
       catégorie : c'est bien la dernière fois que la page a changé. */
    const periodes = new Map<string, string>();
    const sous = new Map<string, string>();
    for (const p of produits) {
      const d = String(p.created_at || "");
      if (p.period) {
        const prec = periodes.get(p.period);
        if (!prec || d > prec) periodes.set(p.period, d);
      }
      if (p.period && p.subcategory) {
        const k = p.period + "|" + p.subcategory;
        const prec = sous.get(k);
        if (!prec || d > prec) sous.set(k, d);
      }
    }

    for (const [periode, dernier] of periodes) {
      const loc = SITE + "/category?cat=" + slug(periode);
      xml += urlEntry(loc, "weekly", "0.85", dernier ? dernier.slice(0, 10) : null) + "\n";
    }

    for (const [k, dernier] of sous) {
      const [periode, sc] = k.split("|");
      const loc = SITE + "/category?cat=" + slug(periode) + "&amp;sub=" + slugSub(sc);
      xml += urlEntry(loc, "weekly", "0.8", dernier ? dernier.slice(0, 10) : null) + "\n";
    }

    for (const p of produits) {
      const lastmod = p.created_at ? String(p.created_at).slice(0, 10) : null;
      xml += urlEntry(SITE + "/product?id=" + p.id, "weekly", "0.8", lastmod) + "\n";
    }

    xml += "</urlset>\n";

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        /* Une heure : assez court pour qu'une annonce du jour soit visible
           vite, assez long pour qu'une rafale de robots ne relance pas la
           génération à chaque requête. */
        "Cache-Control": "public, max-age=3600",
        "X-Sitemap-Urls": String((xml.match(/<loc>/g) || []).length),
        "X-Sitemap-Annonces": String(produits.length),
      },
    });
  } catch (e) {
    return new Response("Erreur : " + (e as Error).message, { status: 500 });
  }
});
