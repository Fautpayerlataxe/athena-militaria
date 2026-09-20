/* Contrôle du HTML servi aux moteurs, contre le site en ligne.

   Ce que ce fichier vérifie n'est visible qu'en lisant la réponse brute, sans
   exécuter de JavaScript : c'est ce que lisent Bing, les aperçus de partage,
   les robots d'IA, et Google avant son rendu différé.

   Lancement : npm run test:seo
   Autre origine : SEO_BASE=https://exemple.fr npm run test:seo */
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = (process.env.SEO_BASE || "https://www.athenamilitaria.fr").replace(/\/$/, "");
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

async function lire(chemin: string) {
  const rep = await fetch(BASE + chemin, { redirect: "manual", headers: { "User-Agent": UA } });
  return { code: rep.status, entetes: rep.headers, html: await rep.text() };
}

const balise = (html: string, motif: RegExp) => (html.match(motif) || [])[1] ?? null;
const titre = (html: string) => balise(html, /<title>([\s\S]*?)<\/title>/);
const canonique = (html: string) => balise(html, /<link rel="canonical" href="([^"]*)"/);
const robots = (html: string) => balise(html, /<meta name="robots" content="([^"]*)"/);
const langue = (html: string) => balise(html, /<html lang="([^"]*)"/);
function jsonLd(html: string) {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((m) => { const d = JSON.parse(m[1]); return d["@graph"] || [d]; });
}

/* Une annonce publiée, prise dans le sitemap : le test ne dépend d'aucun
   identifiant écrit en dur. */
async function uneAnnonce() {
  const { html } = await lire("/sitemap-annonces.xml");
  const chemin = balise(html, /<loc>[^<]*(\/annonce\/[^<]*-\d+)<\/loc>/);
  assert.ok(chemin, "aucune fiche dans le sitemap des annonces");
  return chemin as string;
}

test("fiche : contenu, balises et données structurées dans le HTML servi", async () => {
  const chemin = await uneAnnonce();
  const { code, html } = await lire(chemin);
  assert.equal(code, 200);
  assert.doesNotMatch(titre(html) || "", /Fiche article de collection militaire/);
  assert.equal(canonique(html), BASE + chemin);
  assert.match(html, /<div id="product-container" data-ssr="1"/);
  assert.match(html, /<h1 class="p-title">[^<]+<\/h1>/);
  assert.doesNotMatch(html, /Chargement du produit/);
  const produit = jsonLd(html).find((n) => n["@type"] === "Product");
  assert.ok(produit, "Product absent");
  assert.equal(produit.brand, undefined, "la place de marché n'est pas la marque");
  assert.ok(produit.offers?.price !== undefined && produit.offers?.priceCurrency === "EUR");
  assert.notEqual(produit.offers?.seller?.name, "Athena Militaria");
  assert.ok(produit.offers?.shippingDetails, "shippingDetails absent");
  assert.equal(produit.aggregateRating, undefined);
  assert.ok(jsonLd(html).some((n) => n["@type"] === "BreadcrumbList"));
});

test("fiche : codes HTTP", async () => {
  assert.equal((await lire("/annonce/inexistante-987654321")).code, 404);
  assert.equal((await lire("/annonce/sans-identifiant")).code, 404);
  assert.equal((await lire("/product?id=abc")).code, 404);
  for (const sans of [await lire("/product"), await lire("/annonce")]) {
    assert.equal(sans.code, 301);
    assert.equal(sans.entetes.get("location"), BASE + "/militaria");
  }
  assert.equal((await lire("/product.php?id=1")).code, 404, "le relais ne doit pas être joignable en direct");
});

test("fiche : l'ancienne adresse et un titre périmé redirigent en 301", async () => {
  const chemin = await uneAnnonce();
  const id = (chemin.match(/-(\d+)$/) || [])[1];
  assert.ok(id);

  const ancienne = await lire("/product?id=" + id);
  assert.equal(ancienne.code, 301);
  assert.equal(ancienne.entetes.get("location"), BASE + chemin);

  // Les autres paramètres survivent : ?checkout=canceled a son message.
  const annule = await lire("/product?id=" + id + "&checkout=canceled");
  assert.equal(annule.code, 301);
  assert.equal(annule.entetes.get("location"), BASE + chemin + "?checkout=canceled");

  // Anglais : même page, même adresse, le paramètre en plus.
  const anglais = await lire("/product?id=" + id + "&lang=en");
  assert.equal(anglais.code, 301);
  assert.equal(anglais.entetes.get("location"), BASE + chemin + "?lang=en");

  // Titre recopié de travers : l'identifiant décide, le titre est corrigé.
  const perime = await lire("/annonce/titre-qui-nexiste-plus-" + id);
  assert.equal(perime.code, 301);
  assert.equal(perime.entetes.get("location"), BASE + chemin);
});

test("catalogue : annonces liées dans le HTML, catégories inconnues en 404", async () => {
  const tout = await lire("/militaria");
  assert.equal(tout.code, 200);
  assert.equal(canonique(tout.html), BASE + "/militaria");
  assert.match(tout.html, /<a class="item-card" href="\/annonce\/[a-z0-9-]+-\d+"/);
  assert.equal((await lire("/militaria/antiquite")).code, 404);
  assert.equal((await lire("/militaria/guerre-froide/inconnu")).code, 404);
  assert.equal((await lire("/militaria/guerre-froide/armes/trop")).code, 404);
  assert.equal((await lire("/category?cat=Antiquite")).code, 404);
  assert.equal((await lire("/category?cat=Guerre-froide&sub=Inconnu")).code, 404);
  const recherche = await lire("/militaria?q=casque");
  assert.equal(robots(recherche.html), "noindex, follow");
});

test("catalogue : les anciennes adresses redirigent en 301 vers les nouvelles", async () => {
  const cas: [string, string][] = [
    ["/category", "/militaria"],
    ["/category?lang=en", "/militaria?lang=en"],
    ["/category?cat=Guerre-froide", "/militaria/guerre-froide"],
    ["/category?cat=1%C3%A8re-Guerre-Mondiale&sub=M%C3%A9dailles", "/militaria/premiere-guerre-mondiale/medailles"],
    ["/category?cat=Guerre-Napol%C3%A9onienne&sub=Armes&lang=en", "/militaria/revolution-premier-empire/armes?lang=en"],
    ["/category?cat=Guerre-froide&sub=%C3%89quipements", "/militaria/guerre-froide/equipements"],
    ["/category?q=casque", "/militaria?q=casque"],
  ];
  for (const [ancienne, nouvelle] of cas) {
    const r = await lire(ancienne);
    assert.equal(r.code, 301, ancienne);
    assert.equal(r.entetes.get("location"), BASE + nouvelle, ancienne);
  }
});

test("catalogue : période renommée et périodes ajoutées", async () => {
  const empire = await lire("/militaria/revolution-premier-empire");
  assert.equal(empire.code, 200);
  assert.match(empire.html, /<h1 id="category-title" data-ssr="1">Militaria Révolution et Premier Empire<\/h1>/);
  // Sans annonce, une période ajoutée existe mais reste hors index.
  const indochine = await lire("/militaria/guerre-indochine");
  assert.equal(indochine.code, 200);
  assert.match(robots(indochine.html) || "", /^noindex/);
});

test("catalogue : une période avec annonces a son titre, son H1 et sa canonique", async () => {
  const { html: plan } = await lire("/sitemap-annonces.xml");
  const loc = balise(plan, /<loc>([^<]*\/militaria\/[a-z0-9-]+)<\/loc>/);
  assert.ok(loc, "aucune période dans le sitemap");
  const chemin = (loc as string).replace(BASE, "");
  const { code, html } = await lire(chemin);
  assert.equal(code, 200);
  assert.equal(canonique(html), loc);
  assert.match(robots(html) || "", /^index/);
  assert.match(html, /<h1 id="category-title" data-ssr="1">Militaria /);
  assert.ok(jsonLd(html).some((n) => n["@type"] === "ItemList"));
});

test("archive des ventes : page propre, hors index tant qu'elle est vide", async () => {
  const { code, html } = await lire("/ventes");
  assert.equal(code, 200);
  assert.equal(canonique(html), BASE + "/ventes");
  assert.match(html, /<h1 id="category-title" data-ssr="1">Archive des ventes<\/h1>/);
  assert.match(html, /data-statut="sold"/);
  const vide = !/<a class="item-card is-sold"/.test(html);
  assert.match(robots(html) || "", vide ? /^noindex/ : /^index/);
});

test("versions anglaises : langue et canonique écrites par le serveur", async () => {
  for (const chemin of ["/?lang=en", "/about?lang=en", "/militaria?lang=en"]) {
    const { code, html } = await lire(chemin);
    assert.equal(code, 200, chemin);
    assert.equal(langue(html), "en", chemin);
    assert.equal(canonique(html), BASE + chemin, chemin);
  }
});

test("accueil : dernières annonces présentes dans le HTML", async () => {
  const { code, html } = await lire("/");
  assert.equal(code, 200);
  assert.match(html, /<a class="item-card" href="\/annonce\/[a-z0-9-]+-\d+"/);
  assert.match(html, /<h1[^>]*>[\s\S]*militaria[\s\S]*<\/h1>/i);
});

test("coulisses fermées", async () => {
  assert.equal((await lire("/inc/athena.php")).code, 403);
  assert.equal((await lire("/inc/i18n-dict.json")).code, 403);
  assert.equal((await lire("/cache/")).code, 403);
});

test("sitemap des annonces : photos et versions anglaises", async () => {
  const { code, html } = await lire("/sitemap-annonces.xml");
  assert.equal(code, 200);
  assert.match(html, /xmlns:image=/);
  assert.match(html, /<image:loc>https:\/\/www\.athenamilitaria\.fr\/media\//);
  assert.match(html, /hreflang="en"/);
});

test("photos : servies en WebP depuis le domaine", async () => {
  const { html } = await lire("/sitemap-annonces.xml");
  const img = balise(html, /<image:loc>([^<]+)<\/image:loc>/);
  assert.ok(img);
  const rep = await fetch(img as string, { headers: { "User-Agent": UA } });
  assert.equal(rep.status, 200);
  assert.equal(rep.headers.get("content-type"), "image/webp");
  assert.match(rep.headers.get("cache-control") || "", /immutable/);
});
