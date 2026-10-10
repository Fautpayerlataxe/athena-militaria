/* Contrôle du HTML servi aux moteurs, contre le site en ligne.

   Ce que ce fichier vérifie n'est visible qu'en lisant la réponse brute, sans
   exécuter de JavaScript : c'est ce que lisent Bing, les aperçus de partage,
   les robots d'IA, et Google avant son rendu différé.

   Lancement : npm run test:seo
   Autre origine : SEO_BASE=https://exemple.fr npm run test:seo */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SHIPPING_CATALOG } from "../supabase/functions/_shared/payments.ts";

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

/* Protection acheteurs, en centimes : 5 % du prix arrondi au centime
   + 0,70 €, comme la fonction SQL buyer_protection_fee_cents (les trois
   calculs sont comparés dans tests/protection-acheteurs.test.ts). */
const protection = (prix: number) => Math.floor((Math.round(prix * 100) * 500 + 5000) / 10000) + 70;
const TARIFS_EXPEDIES = [SHIPPING_CATALOG.post.amountCents, SHIPPING_CATALOG.relay.amountCents];

/* Règle des fiches d'armes, lue dans product.php : un mot d'arme dans le
   titre du vendeur (la traduction anglaise ne compte pas), ou la catégorie
   Armes. */
const MOTS_ARMES = [...readFileSync(new URL("../product.php", import.meta.url), "utf8")
  .match(/const FICHE_MOTS_ARMES = ([^;]+);/)![1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join("");
const motArme = new RegExp("(?:^|[^\\p{L}\\p{N}_])(?:" + MOTS_ARMES + ")(?![\\p{L}\\p{N}_])", "iu");

async function toutesLesAnnonces() {
  const { html } = await lire("/sitemap-annonces.xml");
  return [...new Set([...html.matchAll(/<loc>[^<]*(\/annonce\/[^<]*-\d+)<\/loc>/g)].map((m) => m[1]))];
}

test("fiche : contenu, balises et données structurées dans le HTML servi", async () => {
  /* La plus récente qui n'est pas une arme : une fiche d'arme n'a pas de
     Product, ce que contrôle un test plus bas. */
  let chemin = "";
  let code = 0;
  let html = "";
  for (const c of await toutesLesAnnonces()) {
    ({ code, html } = await lire(c));
    chemin = c;
    if (!motArme.test(balise(html, /<h1 class="p-title">([^<]+)<\/h1>/) || "")) break;
  }
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

test("fiches : Protection acheteurs annoncée et comprise dans la livraison déclarée", async () => {
  const chemins = await toutesLesAnnonces();
  assert.ok(chemins.length > 0, "aucune fiche dans le sitemap des annonces");
  let expediees = 0;
  for (const chemin of chemins) {
    const { html } = await lire(chemin);
    const produit = jsonLd(html).find((n) => n["@type"] === "Product");
    const centimes = produit
      ? protection(Number(produit.offers.price))
      : protection(Number(balise(html, /<meta property="product:price:amount" content="([^"]*)"/)));

    // La ligne visible, écrite par le serveur, dès qu'un mode d'achat est proposé.
    if (/id="payShip"/.test(html)) {
      const montant = (centimes / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€";
      const contenu = balise(html, /<p class="pay-protection" id="payProtection"[^>]*>([\s\S]*?)<\/p>/) || "";
      const ligne = contenu.replace(/<[^>]+>/g, "");
      assert.match(ligne, /^Protection acheteurs\u00a0: /, chemin);
      assert.ok(ligne.includes(montant), `${chemin} : « ${ligne} », attendu ${montant}`);
      /* Elle se termine par le lien vers les conditions de vente (article
         1119 du Code civil : des conditions générales n'engagent l'acheteur
         que s'il a pu les connaître). */
      assert.match(contenu, /En payant, vous acceptez nos <a [^>]*href="\/legal#cgv"[^>]*>conditions de vente<\/a>\.$/, chemin);
      // Le bouton d'achat y renvoie, pour le clavier et les lecteurs d'écran.
      assert.match(html, /<button class="cta-btn" id="buyBtn" aria-describedby="payProtection">/, chemin);
    }

    /* Aucune politique de retour commune à toutes les fiches : les 14 jours
       de rétractation ne valent que face à un vendeur professionnel
       (conditions de vente, article 3.6). */
    assert.equal(produit?.offers?.hasMerchantReturnPolicy, undefined, `${chemin} : hasMerchantReturnPolicy`);

    // Frais de livraison déclarés = tarif du mode + Protection ; main propre seule inchangée.
    for (const d of produit?.offers?.shippingDetails ?? []) {
      if (d.doesNotShip) {
        assert.equal(d.shippingRate, undefined, chemin);
        continue;
      }
      expediees++;
      assert.match(d.shippingLabel, /, Protection acheteurs comprise$/, chemin);
      const tarif = Math.round(Number(d.shippingRate.value) * 100) - centimes;
      assert.ok(TARIFS_EXPEDIES.includes(tarif),
        `${chemin} : ${d.shippingRate.value} € déclarés, soit ${tarif} centimes hors Protection`);
    }
  }
  assert.ok(expediees > 0, "aucune fiche expédiée contrôlée");
});

test("fiches d'armes : ni Product ni mainEntity, ItemPage et fil d'Ariane gardés", async () => {
  for (const chemin of await toutesLesAnnonces()) {
    const fr = jsonLd((await lire(chemin)).html);
    const en = jsonLd((await lire(chemin + "?lang=en")).html);
    // Le nom de l'ItemPage française est le titre du vendeur.
    const titre = fr.find((n) => n["@type"] === "ItemPage")?.name ?? "";
    const fil = fr.find((n) => n["@type"] === "BreadcrumbList");
    const arme = motArme.test(titre)
      || (fil?.itemListElement ?? []).some((e: { item?: string }) => /\/armes(\?|$)/.test(e.item ?? ""));
    for (const [graphe, langue] of [[fr, "fr"], [en, "en"]] as const) {
      const page = graphe.find((n) => n["@type"] === "ItemPage");
      assert.ok(page, `${chemin} (${langue}) : ItemPage absent`);
      assert.ok(graphe.some((n) => n["@type"] === "BreadcrumbList"), `${chemin} (${langue}) : fil absent`);
      const produit = graphe.some((n) => n["@type"] === "Product");
      assert.equal(produit, !arme, `${chemin} (${langue}) : Product ${produit ? "présent" : "absent"}`);
      assert.equal(page.mainEntity !== undefined, !arme, `${chemin} (${langue}) : mainEntity`);
    }
  }
});

test("flux Shopping : g:shipping comprend la Protection acheteurs", async () => {
  const { code, html: xml } = await lire("/flux-produits.xml");
  assert.equal(code, 200);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  for (const item of items) {
    const id = balise(item, /<g:id>([^<]*)<\/g:id>/);
    const centimes = protection(Number(balise(item, /<g:price>([\d.]+) EUR<\/g:price>/)));
    const envois = [...item.matchAll(/<g:shipping>([\s\S]*?)<\/g:shipping>/g)].map((m) => m[1]);
    assert.ok(envois.length > 0, `article ${id} sans g:shipping`);
    for (const envoi of envois) {
      assert.match(envoi, /<g:service>[^<]*, Protection acheteurs comprise<\/g:service>/, `article ${id}`);
      const tarif = Math.round(Number(balise(envoi, /<g:price>([\d.]+) EUR<\/g:price>/)) * 100) - centimes;
      assert.ok(TARIFS_EXPEDIES.includes(tarif), `article ${id} : ${tarif} centimes de port hors Protection`);
    }
  }
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

/* À propos et conditions de vente, tels que les lisent les moteurs et les
   assistants (la FAQ est balisée en FAQPage) : plus aucune des promesses
   fausses relevées le 9 oct. 2026 (inscription « via Google »,
   rétractation de 14 jours sans condition, armes « de catégorie D libre »,
   plateforme européenne de règlement des litiges fermée, mesure d'audience
   par Google Analytics), et des réponses balisées identiques au texte
   affiché. */
test("à propos et conditions : textes exacts dans le HTML servi", async () => {
  const texteSeul = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "\u00a0").replace(/[ \t\r\n]+/g, " ").trim();
  for (const chemin of ["/about", "/about?lang=en", "/legal", "/legal?lang=en"]) {
    const { code, html: brut } = await lire(chemin);
    assert.equal(code, 200, chemin);
    // Les commentaires du source expliquent ce qui a été retiré : hors lecture.
    const html = brut.replace(/<!--[\s\S]*?-->/g, "");
    assert.doesNotMatch(html, /via Google|\(WWI, WWII|catégorie D libre|category D weapons freely/, chemin);
    assert.doesNotMatch(html, /Comme l'exige la loi|As required by French law|14 jours pour changer d'avis|14 days to change your mind/, chemin);
    assert.doesNotMatch(html, /négocier directement|negotiate directly/, chemin);
    assert.doesNotMatch(html, /524\/2013|ec\.europa\.eu\/consumers\/odr|Google Analytics/, chemin);
  }

  const { html: apropos } = await lire("/about");
  const faq = jsonLd(apropos).find((n) => n["@type"] === "FAQPage");
  assert.ok(faq, "FAQPage absent de /about");
  for (const [i, cle] of [[1, "tr_about.faq_a2"], [4, "tr_about.faq_a5"]] as const) {
    const visible = balise(apropos, new RegExp(`<p data-i18n(?:-html)?="${cle.replace(".", "\\.")}">([\\s\\S]*?)</p>`));
    assert.ok(visible, `${cle} absent du HTML`);
    assert.equal(faq.mainEntity[i].acceptedAnswer.text, texteSeul(visible as string), `FAQPage ${cle}`);
  }
  assert.match(apropos, /href="\/guides\/vendre-militaria-legalement-france"/, "lien vers le guide de la loi");
  // La FAQ des armes suit la CGU 2.4 (toutes les armes à feu en état de
  // fonctionnement), comme le paragraphe sur la modération de la même page.
  assert.match(apropos, /Les armes à feu en état de fonctionnement sont interdites sur le site \(article 2\.4 de nos <a href="\/legal#cgu">/);
  assert.doesNotMatch(apropos, /catégories A, B et C sont interdites/);

  const { html: conditions } = await lire("/legal");
  assert.match(conditions, /ne s'applique qu'aux ventes conclues entre un vendeur professionnel et un acheteur consommateur/);
  assert.match(conditions, /Lorsque le vendeur est un particulier, l'acheteur ne dispose d'aucun droit de rétractation/);
  assert.match(conditions, /Une annonce vendue à compter du 19 septembre 2026/);
  // L221-21 : toute déclaration dénuée d'ambiguïté, la messagerie n'étant qu'un exemple.
  assert.match(conditions, /informe le vendeur de sa décision par toute déclaration dénuée d'ambiguïté, par exemple par la messagerie du site/);
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

/* ---------------------------------------------------------------------
   Correctifs de l'audit du 10 oct. 2026 : ce que le HTML servi doit dire
   une fois product.php et category.php déployés.
   --------------------------------------------------------------------- */

test("fiche : adresse courte et identifiant à zéros redirigés vers l'adresse canonique", async () => {
  const chemin = await uneAnnonce();
  const id = (chemin.match(/-(\d+)$/) as RegExpMatchArray)[1];
  const court = await lire("/annonce/" + id);
  assert.equal(court.code, 301, "/annonce/" + id);
  assert.equal(court.entetes.get("location"), BASE + chemin);
  const zero = await lire(chemin.replace(/-(\d+)$/, "-0$1"));
  assert.equal(zero.code, 301, "identifiant précédé d'un zéro");
  assert.equal(zero.entetes.get("location"), BASE + chemin);
});

test("fiches : « à vendre » au titre de toute pièce en vente, noms rognés, valeurs servies relues par product.js", async () => {
  for (const chemin of await toutesLesAnnonces()) {
    const { html } = await lire(chemin);
    if (!/<span class="p-sold-badge">/.test(html)) assert.match(titre(html) || "", /à vendre/, chemin);
    for (const n of jsonLd(html)) {
      if (typeof n.name === "string") assert.equal(n.name, n.name.trim(), `${chemin} : ${n["@type"]}.name`);
    }
    assert.doesNotMatch(html, /alt="[^"]* , photo \d+"/, `${chemin} : espace avant « , photo »`);
    assert.match(html, /<div id="product-container" data-ssr="1" data-ssr-lang="fr" data-prix="[\d.]+" data-statut="(published|sold)" data-titre="/, chemin);
  }
});

test("catalogue : une catégorie sans texte propre ne recopie pas celui de /militaria", async () => {
  const { html: plan } = await lire("/sitemap-annonces.xml");
  const chemins = [...new Set([...plan.matchAll(/<loc>[^<]*(\/militaria\/[a-z0-9-]+\/[a-z0-9-]+)<\/loc>/g)].map((m) => m[1]))];
  for (const chemin of chemins) {
    const { code, html } = await lire(chemin);
    assert.equal(code, 200, chemin);
    if (html.includes("contexte-fr:debut")) continue; // texte rédigé (build-categories.cjs)
    assert.doesNotMatch(html, /Le catalogue militaria d'Athena Militaria/, `${chemin} : texte générique du catalogue`);
    assert.match(html, /<section class="about-section" id="catalogue-guide"[^>]*>\s*<h2 id="catalogue-guide-title">/, chemin);
  }
});

test("conditions : identifiants uniques, plus de « panier », hébergement à Londres", async () => {
  const { html } = await lire("/legal");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), []);
  assert.doesNotMatch(html, /panier non sauvegardé/);
  assert.match(html, /Londres \(Royaume-Uni\)/);
});
