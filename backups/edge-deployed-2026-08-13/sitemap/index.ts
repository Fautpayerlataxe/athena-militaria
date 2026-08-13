import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE = "https://www.athenamilitaria.fr";

const slug = (v: string) => encodeURIComponent(String(v).trim().replace(/ /g, "-"));

const SUB_COURT: Record<string, string> = {
  "Armes (neutralisées/maquettes)": "Armes",
  "Médailles & décorations": "Médailles",
};

const slugSub = (v: string) => slug(SUB_COURT[String(v).trim()] || v);

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
        "Cache-Control": "public, max-age=3600",
        "X-Sitemap-Urls": String((xml.match(/<loc>/g) || []).length),
        "X-Sitemap-Annonces": String(produits.length),
      },
    });
  } catch (e) {
    return new Response("Erreur : " + (e as Error).message, { status: 500 });
  }
});
