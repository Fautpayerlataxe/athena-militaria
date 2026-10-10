const TRp = (key) => (window.TR ? window.TR(key) : key);
const ERRp = (e) => (window.messageErreur ? window.messageErreur(e) : TRp("err.generique"));

/* ---------------------------------------------------------------------------
   MAINTENANCE DES PAIEMENTS
   ---------------------------------------------------------------------------
   Mettre à false pour rouvrir l'achat. C'est le seul interrupteur côté site :
   il n'y en a pas d'autre à chercher.

   Il ne protège rien à lui seul — un bouton masqué se contourne depuis la
   console. Le vrai blocage est côté serveur : la fonction create-checkout
   déployée renvoie 503 sans jamais appeler Stripe. Celui-ci évite simplement
   qu'un visiteur bute sur une erreur en cliquant.

   Les deux doivent être levés ensemble, serveur d'abord.
--------------------------------------------------------------------------- */
const PAIEMENTS_EN_MAINTENANCE = false; // doit suivre product.php

/* Icônes au trait des boutons secondaires : la même famille que le partage
   et le signalement (SVG 14 px, trait 2), plutôt que les caractères ♡ et ✉
   qu'une police de secours dessinait chacune à sa façon. Mêmes tracés dans
   product.php. */
const ICONE_COEUR = '<svg class="btn-icone" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const ICONE_ENVELOPPE = '<svg class="btn-icone" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>';

/* Protection acheteurs, en centimes, pour un prix en euros : 5 % du prix
   arrondi au centime (la demie vers le haut, comme ROUND en PostgreSQL),
   plus 0,70 €. C'est la fonction SQL buyer_protection_fee_cents
   (migration 20260813000200), que Stripe débite, et am_protection_cents
   dans inc/athena.php, qui écrit la même ligne dans la fiche servie.
   tests/protection-acheteurs.test.ts vérifie que les trois calculs rendent
   les mêmes centimes. En entiers : aucun écart de virgule flottante. */
function protectionAcheteursCentimes(prix) {
  const centimes = Math.max(0, Math.round(Number(prix) * 100) || 0);
  return Math.floor((centimes * 500 + 5000) / 10000) + 70;
}

/* Montant en centimes avec ses deux décimales, comme les tarifs de
   livraison : « 13,20 € » (espaces insécables, comme am_montant_cents),
   « €13.20 ». */
/* Lien de la ligne Protection acheteurs vers les conditions de vente : le
   dessin de .product-vendre a (style.css), écrit en ligne faute de règle
   .pay-protection dans la feuille. Même valeur dans product.php. */
const STYLE_LIEN_PROTECTION = "color:var(--gold-text);text-decoration:underline;text-decoration-thickness:1px;text-decoration-color:rgba(201,168,76,0.7);text-underline-offset:3px";

function montantCentimes(centimes, anglais) {
  const n = centimes / 100;
  return anglais
    ? "€" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€";
}

/* Pièces d'armement : ni Product ni mainEntity dans les données
   structurées, Google excluant les armes de ses fiches marchandes. Même
   liste et même règle que product.php (FICHE_MOTS_ARMES) : le titre du
   vendeur seul, sa traduction automatique seulement s'il manque (traduite,
   une giberne devient une « cartridge box »). Le test protection-acheteurs
   vérifie que les deux listes restent identiques. Les bords sont écrits à
   la main : \b, en JavaScript, ignore les lettres accentuées (« épée » n'y
   aurait pas de bord de mot), et un regard en arrière (?<!…) ferait
   échouer Safari avant iOS 16.4. */
const MOTS_ARMES = "dagues?|poignards?|ba[iï]onnettes?|couteaux?|sabres?|[ée]p[ée]es?|glaives?|fusils?|carabines?"
  + "|pistolets?|revolvers?|mousquetons?|grenades?|obus|cartouches?|munitions?"
  + "|daggers?|bayonets?|knife|knives|swords?|sabers?|rifles?|carbines?|pistols?|musketoons?|cartridges?|ammunition";
function ficheArme(product) {
  if (String((product && product.subcategory) || "").startsWith("Armes")) return true;
  const titre = String((product && product.title) || "").trim() !== ""
    ? String(product.title) : String((product && product.title_en) || "");
  return new RegExp("(?:^|[^\\p{L}\\p{N}_])(?:" + MOTS_ARMES + ")(?![\\p{L}\\p{N}_])", "iu").test(titre);
}

/* Langue des dates : « Member since September 2026 » sur la page anglaise,
   pas « septembre ». */
function localeDates() {
  return window.I18N && window.I18N.current === "en" ? "en-GB" : "fr-FR";
}

/* État de conservation dans la langue de la page : la base garde la valeur
   française du formulaire (même table que am_etat dans inc/athena.php). */
function libelleEtat(etat) {
  if (window.TAXONOMIE && window.TAXONOMIE.libelleEtat) {
    return window.TAXONOMIE.libelleEtat(etat, window.I18N && window.I18N.current === "en" ? "en" : "fr");
  }
  return etat || "";
}

/* URL de la page catalogue correspondant à une annonce (/militaria/…),
   calculée par taxonomie.js comme côté serveur (am_url_categorie). Une page
   anglaise renvoie vers des pages anglaises : la langue ne vit que dans
   l'URL, c'est elle que lisent les moteurs. */
function urlCategorie(product, sansType) {
  const lang = enAnglaisDansUrl() ? "en" : "fr";
  if (!window.TAXONOMIE) return "/militaria" + (lang === "en" ? "?lang=en" : "");
  return window.TAXONOMIE.urlCategorie(product && product.period, sansType ? null : product && product.subcategory, lang);
}

function enAnglaisDansUrl() {
  return new URLSearchParams(window.location.search).get("lang") === "en";
}

function urlFiche(id, titre) {
  const lang = enAnglaisDansUrl() ? "en" : "fr";
  if (!window.TAXONOMIE) return "/annonce/annonce-" + encodeURIComponent(id) + (lang === "en" ? "?lang=en" : "");
  return window.TAXONOMIE.urlFiche(id, titre || "", lang);
}

/* Identifiant de l'annonce affichée : il ferme l'adresse
   (/annonce/<titre>-<identifiant>). ?id=… reste lu, le temps que les anciens
   liens disparaissent des favoris et des courriels ; product.php les redirige
   déjà. */
function identifiantDemande() {
  const chemin = decodeURIComponent(window.location.pathname);
  const m = /^\/annonce\/(?:.*-)?([0-9]{1,12})\/?$/.exec(chemin);
  if (m) return m[1];
  return new URLSearchParams(window.location.search).get("id");
}

/* Un site statique ne peut pas renvoyer un vrai code 404 sur /product?id=inexistant :
   le serveur sert toujours product.html avec un code 200. Sans précaution, Google
   indexe donc une page "annonce introuvable" par identifiant supprimé ou erroné,
   ce qu'il classe en soft 404 et qui dilue la qualité perçue du site.
   On bascule la page en noindex et on neutralise sa canonical. */
function marquerIntrouvable() {
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.setAttribute("name", "robots");
    document.head.appendChild(robots);
  }
  robots.setAttribute("content", "noindex, follow");

  // Une canonical auto-référente sur une page vide reviendrait à la revendiquer
  // comme contenu légitime : on la fait pointer vers le catalogue.
  const canon = document.getElementById("canonical-link");
  if (canon) canon.setAttribute("href", "https://www.athenamilitaria.fr/militaria");

  // Les hreflang n'ont plus d'objet sur une page qui ne doit pas être indexée.
  document.querySelectorAll('link[rel="alternate"][hreflang]').forEach((l) => l.remove());
}

/* Adresse interne dans la langue affichée (I18N.lien, i18n.js). */
function lienFiche(chemin) {
  return window.I18N && window.I18N.lien ? window.I18N.lien(chemin) : chemin;
}

/* Action réservée aux membres : la fenêtre de connexion s'ouvre et dit
   pourquoi. Le message était un toast posé en haut de l'écran, par-dessus la
   croix de la fenêtre sur un petit téléphone (3,8 s à 375 × 667), et la
   fenêtre elle-même ne disait pas pourquoi il fallait se connecter. */
function demanderConnexion(cle) {
  if (window.ouvrirModaleAuth) window.ouvrirModaleAuth("login", TRp(cle));
  else if (window.toast) window.toast(TRp(cle));
}

/* Carte « annonce introuvable » ou « momentanément indisponible », dans la
   langue affichée. Les liens gardent ?lang=en sur une page anglaise. */
function carteAbsente(cleTitre, cleTexte) {
  const L = (c) => (window.I18N && window.I18N.lien ? window.I18N.lien(c) : c);
  return `<section class="auth-required-card"><div class="auth-required-icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h1>${TRp(cleTitre)}</h1><p>${TRp(cleTexte)}</p><div class="auth-required-actions"><a href="${L("/militaria")}" class="cta-btn">${TRp("tr_js_product.browse_listings")}</a><a href="${L("/")}" class="btn outline">${TRp("tr_js_product.back_home")}</a></div></section>`;
}

/* Colonnes lues par la fiche : celles de product.php ($colonnes), rien de
   plus. select("*") remontait aussi des champs internes que la page
   n'affiche pas (réservation en cours, compte qui a authentifié la pièce). */
const COLONNES_FICHE = "id,user_id,title,title_en,description,description_en,period,subcategory,condition,price,quantity,"
  + "location,ship_pickup,ship_post,ship_relay,status,created_at,sold_at,image_url,image_urls,historically_sensitive,authenticated_at";

/* Fiche servie par product.php alors que la base ne répond pas : de quoi
   brancher Acheter, Favori, Contacter et Signaler sur le HTML servi, sans
   rien redessiner. product.php écrit ces valeurs sur le conteneur
   (data-prix, data-statut, data-vendeur…) ; une page servie avant lui n'a
   que son balisage, d'où les replis. */
function ficheDepuisLeHtml(root, id) {
  const d = root.dataset;
  const modes = new Set([...root.querySelectorAll('input[name="payship"]')].map((i) => i.value));
  const prix = d.prix !== undefined && d.prix !== "" ? Number(d.prix) : null;
  return {
    id: Number(id),
    user_id: d.vendeur || null,
    title: d.titre !== undefined ? d.titre : (root.querySelector("h1.p-title")?.textContent || "").trim(),
    price: prix,
    status: d.statut || (root.querySelector(".p-sold-badge") ? "sold" : "published"),
    period: d.periode || "",
    subcategory: d.type || "",
    historically_sensitive: !!root.querySelector(".has-sensitive"),
    ship_pickup: modes.has("pickup"),
    ship_post: modes.has("post"),
    ship_relay: modes.has("relay"),
  };
}

/* Acheter, Contacter le vendeur et Ajouter aux favoris sont dans le HTML
   servi, mais leurs écouteurs ne sont posés qu'après la lecture de
   l'annonce et de la session, et les scripts différés (supabase-js, depuis
   jsDelivr) retardent DOMContentLoaded lui-même. Sur un téléphone en 3G, un
   clic restait 3 à 11 s sans effet ni signe, et le visiteur cliquait
   jusqu'à dix-sept fois (audit du 10 oct. 2026). Un clic arrivé trop tôt
   est donc retenu : le bouton se dit occupé (aria-busy, style.css), et le
   dernier geste est rejoué une fois les vrais écouteurs branchés. La
   retenue commence dans product.html (window.__clicsFiche), dès
   l'affichage ; ce script la reprend, ou la pose s'il est seul. Le chemin
   du paiement ne change pas : c'est son propre écouteur qui reçoit le clic
   rejoué. */
const ACTIONS_FICHE = "#buyBtn, #contactSellerBtn, #favBtn";
function retenirLesClics() {
  let retenue = window.__clicsFiche;
  if (retenue) {
    clearTimeout(retenue.garde);
  } else {
    retenue = { dernier: null };
    retenue.retenir = (ev) => {
      const bouton = ev.target && ev.target.closest ? ev.target.closest(ACTIONS_FICHE) : null;
      if (!bouton || bouton.disabled) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      retenue.dernier = bouton.id;
      bouton.setAttribute("aria-busy", "true");
    };
    document.addEventListener("click", retenue.retenir, true);
  }
  window.__clicsFiche = null;
  let actif = true;
  let garde = null;
  const finir = (rejouer) => {
    if (!actif) return;
    actif = false;
    clearTimeout(garde);
    document.removeEventListener("click", retenue.retenir, true);
    document.querySelectorAll(ACTIONS_FICHE).forEach((b) => b.removeAttribute("aria-busy"));
    const cible = rejouer && retenue.dernier ? document.getElementById(retenue.dernier) : null;
    if (cible && !cible.disabled) cible.click();
  };
  /* Filet : si le branchement s'arrête en route (exception, fiche
     remplacée), les boutons ne restent pas « occupés » pour toujours. */
  garde = setTimeout(() => finir(false), 20000);
  return { liberer: () => finir(true) };
}

/* Le dictionnaire de la langue affichée, attendu au plus quelques secondes :
   une préférence anglaise sur un réseau lent donnait une fiche au titre
   anglais et aux libellés français (« Mode de livraison », « Acheter »). */
function dictionnairePret() {
  const pret = window.I18N && window.I18N.pret;
  if (!pret) return Promise.resolve();
  return Promise.race([pret, new Promise((r) => setTimeout(r, 3000))]);
}

document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("product-container");
  if (!root) return;
  // Avant tout appel réseau : voir retenirLesClics.
  const clicsRetenus = retenirLesClics();

  const params = new URLSearchParams(window.location.search);
  const id = identifiantDemande();

  /* Fiche déjà écrite par le serveur (product.php) : titre, description,
     canonique, balises de partage et données structurées sont dans le HTML
     servi, calculés avec les mêmes règles. Les réécrire ici ne pourrait que
     les faire diverger. Ce script ne s'en charge plus qu'en secours, si la
     page arrive sans rendu serveur. */
  const rendueParServeur = root.dataset.ssr === "1";

  if (!id) {
    root.innerHTML = carteAbsente("tr_js_product.not_found_title", "tr_js_product.not_found_text");
    if (!rendueParServeur) marquerIntrouvable();
    return;
  }

  /* maybeSingle et non single : une annonce absente rend data null sans
     erreur. Avec single, l'absence était une erreur comme une autre, et
     toute panne passagère (quota, délai, 5xx, réseau coupé) devenait
     « Produit introuvable », avec noindex et une canonique vers le
     catalogue, sur une fiche que le serveur venait de servir. Si Google
     rendait la page à ce moment-là, il lisait ce noindex.
     Sur une fiche servie, l'attente est bornée : supabase-js relance
     plusieurs fois une requête en échec, et les boutons n'étaient
     branchés qu'au bout (10 s mesurées sur une 503). */
  let requete = window.sb.from("products").select(COLONNES_FICHE).eq("id", id);
  if (rendueParServeur && typeof AbortController === "function") {
    const arret = new AbortController();
    setTimeout(() => arret.abort(), 5000);
    requete = requete.abortSignal(arret.signal);
  }
  let [{ data: product, error }] = await Promise.all([requete.maybeSingle(), dictionnairePret()]);

  /* Panne de la base sur une fiche servie : on garde le HTML du serveur, qui
     a tranché (404 réel pour une annonce absente), et l'on branche les
     boutons sur ce qu'il a écrit. Rien n'est touché dans la tête du
     document : ni robots, ni canonique, ni hreflang. */
  const enSecours = !!error && rendueParServeur;
  if (error) console.warn("[fiche] lecture de l'annonce impossible :", error.message || error);
  if (enSecours) product = ficheDepuisLeHtml(root, id);

  if (!product) {
    if (error) {
      // Sans rendu serveur et sans base : rien ne dit que l'annonce n'existe
      // pas. On le dit tel quel, sans noindex.
      root.innerHTML = carteAbsente("tr_js_product.unavailable_title", "tr_js_product.unavailable_text");
      return;
    }
    root.innerHTML = carteAbsente("tr_js_product.not_found_title", "tr_js_product.not_found_text");
    // Sur une fiche servie, le serveur décide de l'indexation (vraie 404 au
    // passage suivant) : le navigateur ne réécrit pas la tête.
    if (!rendueParServeur) marquerIntrouvable();
    return;
  }

  // Mettre à jour les meta dynamiquement (SEO + partage)
  const esc = window.escapeHtml || ((s) => s);
  const libellePeriode = window.libellePeriode ? window.libellePeriode(product.period) : (product.period || "");
  const libelleSous = window.libelleSous ? window.libelleSous(product.subcategory) : (product.subcategory || "");

  // Modes de livraison proposés à l'achat : uniquement ceux activés par le vendeur.
  // Les clés/tarifs correspondent à ceux attendus par la fonction serveur create-checkout.
  const SHIP_OPTS = [
    { key: "pickup", label: TRp("tr_js_product.ship_pickup"), price: TRp("tr_js_product.ship_free"), flag: "ship_pickup" },
    { key: "post",   label: TRp("tr_js_product.ship_post"), price: TRp("tr_js_product.ship_price_post"), flag: "ship_post" },
    { key: "relay",  label: TRp("tr_js_product.ship_relay"), price: TRp("tr_js_product.ship_price_relay"), flag: "ship_relay" },
  ];
  const availableShip = SHIP_OPTS.filter((o) => product[o.flag]);

  /* --------------------------------------------------------------------
     Protection acheteurs : une ligne sous le choix de livraison.

     Le détail du prix avait été retiré de la fiche, pour que le barème ne
     vive qu'en SQL : Stripe montrait seul la Protection, sur la page de
     paiement. Mais un montant que l'acheteur ne découvre qu'au paiement est,
     pour Google, une présentation trompeuse, que Merchant Center sanctionne
     par la suspension du compte. Depuis le 9 oct. 2026, la fiche servie par
     product.php écrit donc la ligne ; ce script écrit la même quand il
     redessine la fiche. Le calcul est refait ici (voir
     protectionAcheteursCentimes), et le test protection-acheteurs garde les
     trois calculs d'accord avec la fonction en ligne. Rien d'autre n'est
     calculé : ni total, ni frais de livraison, déjà écrits dans les
     libellés.
     Le bouton d'achat renvoie à cette ligne (aria-describedby="payProtection"),
     comme dans product.php : au clavier, on passe des modes de livraison au
     bouton sans lire ce paragraphe. Ligne et bouton n'existent qu'ensemble
     (un mode proposé, ni vendu ni maintenance).
  -------------------------------------------------------------------- */
  /* Un dictionnaire resté en cache (i18n-fr.js et i18n-en.js sont servis
     « immutable ») peut ignorer la clé : TRp rend alors la clé elle-même.
     On écrit dans ce cas la phrase courte plutôt que « tr_js_product… ». */
  const pageAnglaise = !!(window.I18N && window.I18N.current === "en");
  const cleProtection = "tr_js_product.protection_line";
  const modeleProtection = TRp(cleProtection) !== cleProtection ? TRp(cleProtection)
    : (pageAnglaise ? "Buyer Protection: {montant} (5% of the item price + €0.70)."
      : "Protection acheteurs : {montant} (5 % du prix de l’article + 0,70 €).");
  /* La ligne se termine par le renvoi aux conditions de vente, comme dans
     product.php (article 1119 du Code civil : des conditions générales
     n'engagent l'acheteur que s'il a pu les connaître). Texte du
     dictionnaire, HTML compris ; même repli si la clé manque. Le lien prend
     le dessin des liens de la fiche (or de texte, soulignement fin), en
     style en ligne comme la ligne elle-même : sans règle dans style.css, il
     sortait en bleu par défaut du navigateur. Même style dans product.php. */
  const cleCgv = "tr_js_product.protection_cgv";
  const renvoiCgv = (TRp(cleCgv) !== cleCgv ? TRp(cleCgv)
    : (pageAnglaise ? 'By paying, you accept our <a href="/legal?lang=en#cgv">terms of sale</a>.'
      : 'En payant, vous acceptez nos <a href="/legal#cgv">conditions de vente</a>.'))
    .replace(/<a /g, '<a style="' + STYLE_LIEN_PROTECTION + '" ');
  const protectionHtml = `<p class="pay-protection" id="payProtection" style="margin:8px 0 0;font-size:13px;line-height:1.5;color:var(--muted)">${esc(
    modeleProtection.replace("{montant}", () => montantCentimes(protectionAcheteursCentimes(product.price), pageAnglaise)))} ${renvoiCgv}</p>`;

  const shipHtml = availableShip.length
    ? `<div class="pay-ship" id="payShip" role="radiogroup" aria-labelledby="payShipTitle">
        <div class="pay-ship-title" id="payShipTitle">${TRp("tr_js_product.ship_title")}</div>
        ${availableShip.map((o, i) => `
          <label class="pay-ship-opt">
            <input type="radio" name="payship" value="${o.key}">
            <span class="pay-ship-name">${esc(o.label)}</span>
            <span class="pay-ship-price">${esc(o.price)}</span>
          </label>`).join("")}
        <div class="pay-ship-relay" id="payShipRelay" style="display:none">
          <input type="text" id="payShipPostal" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="${TRp("tr_js_product.ship_relay_postal_ph")}" aria-label="${TRp("tr_js_product.ship_relay_postal_ph")}">
        </div>
        <p class="pay-ship-error" id="payShipErr" hidden>${TRp("tr_js_product.choose_shipping")}</p>
      </div>${protectionHtml}`
    : "";
  const price = window.formatPrice ? window.formatPrice(product.price) : (product.price + " €");
  if (!rendueParServeur) {
  /* Titre et description de la fiche.
     Avant : le titre se limitait au nom de l'annonce et la description était
     une troncature brute à 155 caractères, vide si le vendeur n'avait rien
     écrit. On y ajoute la période et l'état, qui sont les critères de
     recherche réels des collectionneurs, et on coupe sur un mot entier. */
  const coupe = (txt, max) => {
    const t = String(txt || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const bout = t.slice(0, max);
    return bout.slice(0, bout.lastIndexOf(" ")) + "…";
  };

  /* On tronque le nom seul, puis on n'ajoute le contexte que s'il tient
     entièrement. Couper la chaîne complète laissait des titres finissant sur
     un séparateur orphelin, du type « … modèle 1956 —… | Athena Militaria ». */
  const nom = product.title || TRp("tr_js_product.item_default");
  const contexte = [product.period, product.subcategory].filter(Boolean).join(", ");
  const PLACE = 58;   // avant le suffixe de marque
  let titre = coupe(nom, PLACE);
  if (contexte && titre.length + 3 + contexte.length <= PLACE) titre += " · " + contexte;
  document.title = titre.length <= 41 ? titre + " | Athena Militaria" : titre;

  // Description : celle du vendeur si elle existe, complétée sinon par les
  // caractéristiques factuelles de l'annonce. Aucune donnée inventée.
  const faits = [product.period, product.subcategory, product.condition]
    .filter(Boolean).join(", ");
  const brut = product.description && product.description.trim().length > 40
    ? product.description
    : [nom, faits, TRp("tr_js_product.meta_fallback_tail")].filter(Boolean).join(". ");
  const desc = coupe(brut, 155);

  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", desc);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", coupe(nom, 90));
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute("content", coupe(brut, 200));
  let ogImg = document.querySelector('meta[property="og:image"]');
  if (!ogImg) {
    ogImg = document.createElement("meta");
    ogImg.setAttribute("property", "og:image");
    document.head.appendChild(ogImg);
  }
  // Adresse absolue : imgUrl renvoie désormais un chemin du site (/media/…).
  const imagePartage = product.image_url
    ? new URL(imgUrl(product.image_url, 1200), location.origin).href
    : location.origin + "/og-cover.jpg";
  ogImg.setAttribute("content", imagePartage);

  // twitter:image et les dimensions déclarées doivent suivre, sinon la carte
  // sociale annonce une image et ses mesures qui ne correspondent plus.
  const twImg = document.querySelector('meta[name="twitter:image"]');
  if (twImg) twImg.setAttribute("content", imagePartage);
  if (product.image_url) {
    // Dimensions inconnues pour une photo de vendeur : mieux vaut ne rien
    // déclarer que déclarer faux.
    document.querySelectorAll('meta[property="og:image:width"], meta[property="og:image:height"]')
      .forEach((m) => m.remove());
    const alt = document.querySelector('meta[property="og:image:alt"]');
    if (alt) alt.setAttribute("content", product.title || "Annonce Athena Militaria");
  }

  // Canonical, og:url et hreflang de la fiche.
  // La version anglaise doit se déclarer canonique d'elle-même : sinon elle
  // pointe vers l'URL française et n'est jamais indexée, ce qui rend les
  // hreflang incohérents.
  const cheminFiche = window.TAXONOMIE
    ? window.TAXONOMIE.urlFiche(product.id, product.title || "", "fr")
    : "/annonce/annonce-" + encodeURIComponent(product.id);
  const urlFr = "https://www.athenamilitaria.fr" + cheminFiche;
  const urlEn = urlFr + "?lang=en";
  const isEn = new URLSearchParams(location.search).get("lang") === "en";
  const selfUrl = isEn ? urlEn : urlFr;

  const canon = document.getElementById("canonical-link");
  if (canon) canon.setAttribute("href", selfUrl);

  let ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute("content", selfUrl);

  document.querySelectorAll('link[rel="alternate"][hreflang]').forEach((l) => {
    l.setAttribute("href", l.getAttribute("hreflang") === "en" ? urlEn : urlFr);
  });

  // JSON-LD Product (rich snippets Google) + BreadcrumbList
  const oldLd = document.getElementById("product-jsonld");
  if (oldLd) oldLd.remove();
  const ld = document.createElement("script");
  ld.type = "application/ld+json";
  ld.id = "product-jsonld";
  const productUrl = urlFr;
  const productJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "name": product.title || "Article militaria",
        "description": (product.description || "").slice(0, 500),
        "image": product.image_url
          ? new URL(imgUrl(product.image_url, 1200), location.origin).href
          : "https://www.athenamilitaria.fr/og-cover.jpg",
        "url": productUrl,
        "sku": String(product.id),
        "category": [libellePeriode, libelleSous].filter(Boolean).join(" > ") || "Militaria",
        // Ni « brand » ni « seller » : la place de marché n'est ni la marque
        // de la pièce ni son vendeur. product.php déclare le vendeur réel.
        "offers": {
          "@type": "Offer",
          "url": productUrl,
          "priceCurrency": "EUR",
          "price": Number(product.price) || 0,
          /* Voir product.php : sans date de validité, Google finit par
             retirer le prix de l'extrait. Un an, redéclaré à chaque rendu. */
          "priceValidUntil": new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
          "itemCondition": product.condition === "Neuf"
            ? "https://schema.org/NewCondition"
            : "https://schema.org/UsedCondition",
          "availability": product.status === "sold"
            ? "https://schema.org/SoldOut"
            : "https://schema.org/InStock"
          /* Pas de politique de retour (hasMerchantReturnPolicy), depuis le
             10 oct. 2026 : les 14 jours déclarés pour toute annonce ne valent
             que face à un vendeur professionnel (article 3.6 des conditions
             de vente), et le site ne sait pas encore qui l'est. Raisons
             détaillées dans product.php. */
        }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Accueil", "item": "https://www.athenamilitaria.fr/" },
          ...(product.period ? [{ "@type": "ListItem", "name": libellePeriode, "item": "https://www.athenamilitaria.fr" + urlCategorie(product, true) }] : []),
          ...(product.subcategory ? [{ "@type": "ListItem", "name": libelleSous, "item": "https://www.athenamilitaria.fr" + urlCategorie(product) }] : []),
          { "@type": "ListItem", "name": product.title || "Article" }
        ].map((el, i) => ({ ...el, position: i + 1 }))
      }
    ]
  };
  // Pièce d'armement : le fil d'Ariane seul, sans Product (voir ficheArme).
  if (ficheArme(product)) productJsonLd["@graph"] = productJsonLd["@graph"].filter((n) => n["@type"] !== "Product");
  ld.textContent = JSON.stringify(productJsonLd);
  document.head.appendChild(ld);
  }

  const isSold = product.status === "sold";
  const soldOverlay = isSold ? `<div class="sold-overlay">${TRp("tr_js_product.sold_overlay")}</div>` : '';

  // Vérifier si l'utilisateur est connecté (pour gérer le flou des objets sensibles)
  const { data: { user: currentUser } } = await window.sb.auth.getUser();
  const isSensitive = !!product.historically_sensitive;
  const shouldBlur = isSensitive && !currentUser;

  // Galerie multi-photos : utilise image_urls[] si présent, sinon fallback sur image_url
  const photosList = (Array.isArray(product.image_urls) && product.image_urls.length > 0)
    ? product.image_urls
    : (product.image_url ? [product.image_url] : ['/hero.png']);
  const hasGallery = photosList.length > 1;

  // Même cartel que product.php : une étiquette blanche posée sur la photo,
  // avec un vrai bouton de connexion (écouté plus bas, par délégation).
  const sensitiveOverlayHtml = shouldBlur ? `
    <div class="sensitive-overlay sensitive-overlay-large">
      <div class="sensitive-label">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <strong>${TRp("tr_js_product.sensitive_title")}</strong>
        <button type="button" class="sensitive-login">${TRp("tr_js_product.sensitive_login")}</button>
      </div>
    </div>
  ` : '';

  // En mode EN : affiche la traduction automatique (DeepL) si disponible
  const useEnglish = window.I18N && window.I18N.current === "en";
  /* Titre rogné et espaces réduites, comme am_titre_annonce : un titre
     enregistré « CASQUE US TANKISTE WW2 » suivi d'une espace donnait
     « …WW2 , photo 1 » dans les textes alternatifs. */
  const displayTitle = String((useEnglish && product.title_en) ? product.title_en : (product.title || "")).replace(/\s+/g, " ").trim();
  const displayDescription = ((useEnglish && product.description_en) ? product.description_en : (product.description || "")).trim();
  const hasDescription = displayDescription.length > 0;
  const isMachineTranslated = useEnglish && (product.title_en || product.description_en);
  const autoTranslateNote = isMachineTranslated
    ? `<p class="p-auto-translate">${TRp("tr_js_product.auto_translated")}</p>`
    : "";

  const sensitiveBadgeHtml = isSensitive ? `
    <div class="sensitive-badge-bar">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>${TRp("tr_js_product.sensitive_notice")}</span>
    </div>
  ` : '';

  /* Avis de la modération (même balisage que product.php) : la pièce a été
     jugée authentique sur photos et description. */
  const avisAuthentiqueHtml = product.authenticated_at ? `
        <div class="p-authentique"><svg class="sceau" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 19.5 5.6v5.6c0 4.5-3.1 8.4-7.5 10-4.4-1.6-7.5-5.5-7.5-10V5.6z"/><path d="m8.7 12.1 2.3 2.3 4.4-4.6"/></svg>
          <div>
            <p class="p-authentique-titre">${TRp("tr_js_product.auth_title")}</p>
            <p class="p-authentique-texte">${TRp("tr_js_product.auth_text")}</p>
          </div>
        </div>` : "";

  /* La photo, le tampon « vendu » et le voile vivent dans un cadre à eux
     (.product-main, position: relative). Avant, le voile en position absolue
     cherchait un ancêtre positionné, n'en trouvait pas, et se calait sur la
     fenêtre : il se décalait au défilement et couvrait n'importe quoi.
     La photo est aussi un lien vers sa version 1 200 px, pour l'agrandir
     d'un toucher (même règle que product.php). Ici la condition est le
     voile et non la sensibilité : un membre connecté voit la pièce sans
     voile, il peut l'agrandir.
     L'aria-label du lien remplace le alt de la photo pour un lecteur
     d'écran : il reprend donc le titre de la pièce, sans quoi le lien ne
     disait plus de quoi il s'agit. Remplacement par fonction : un « $ »
     dans un titre ne doit pas être lu comme un motif de replace(). */
  const zoom = !shouldBlur && photosList[0] !== '/hero.png';
  const libelleZoom = TRp("tr_js_product.photo_zoom").replace("{titre}", () => displayTitle.trim());
  const mainImgHtml = `
    <div class="product-main">
      ${soldOverlay}
      ${zoom ? `<a class="product-zoom" id="productZoom" href="${esc(imgUrl(photosList[0], 1200))}" target="_blank" rel="noopener" aria-label="${esc(libelleZoom)}">` : ''}<img id="product-main-img" src="${esc(imgUrl(photosList[0], 800))}" alt="${esc(displayTitle)}" class="product-img${shouldBlur ? ' is-blurred' : ''}"
           fetchpriority="high" decoding="async" onerror="this.onerror=null;this.src='/hero.png'">${zoom ? '</a>' : ''}
      ${sensitiveOverlayHtml}
    </div>
  `;
  const thumbsHtml = hasGallery ? `
    <div class="product-thumbs" role="group" aria-label="${TRp("tr_js_product.photos_aria")}"${shouldBlur ? ' aria-hidden="true"' : ''}>
      ${photosList.map((url, i) => `
        <button type="button" class="product-thumb${i === 0 ? ' is-active' : ''}${shouldBlur ? ' is-blurred' : ''}" data-img="${esc(imgUrl(url, 800))}"${zoom ? ` data-zoom="${esc(imgUrl(url, 1200))}"` : ''} aria-pressed="${i === 0 ? 'true' : 'false'}" aria-label="Photo ${i + 1} / ${photosList.length}"${shouldBlur ? ' tabindex="-1"' : ''}>
          <img src="${esc(imgUrl(url, 400))}" alt="${esc(displayTitle + ", photo " + (i + 1))}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/hero.png'">
        </button>
      `).join('')}
    </div>
  ` : '';

  /* Le HTML du serveur est gardé tel quel s'il correspond à ce que ce script
     afficherait : même langue, et pas de pièce sensible à dévoiler pour un
     membre connecté. Le réécrire recréerait les images et ferait clignoter la
     page sans rien changer. */
  /* Le serveur sert un cache qui peut avoir quelques minutes (am_api) : un
     prix, un statut ou un titre changés depuis par le vendeur s'y lisaient
     encore, et « Acheter 400 € » annonçait un montant que Stripe ne
     débiterait pas. product.php écrit ces trois valeurs sur le conteneur ;
     si la base dit autre chose, la fiche est redessinée. Une page servie
     sans ces attributs n'est pas comparée. */
  const d = root.dataset;
  const servieAJour = enSecours || (
    (d.prix === undefined || Number(d.prix) === Number(product.price))
    && (d.statut === undefined || d.statut === product.status)
    && (d.titre === undefined || d.titre === (product.title || "")));
  const reprendreServeur = enSecours || (rendueParServeur
    && servieAJour
    && root.dataset.ssrLang === (useEnglish ? "en" : "fr")
    && !(isSensitive && currentUser));

  if (!reprendreServeur) root.innerHTML = `
    <nav class="breadcrumb" aria-label="${TRp("tr_js_product.breadcrumb_aria")}">
      <a href="${enAnglaisDansUrl() ? "/?lang=en" : "/"}">${TRp("tr_js_product.home")}</a>
      ${product.period ? `<span class="crumb"><span class="crumb-sep" aria-hidden="true">›</span><a href="${urlCategorie(product, true)}">${esc(libellePeriode)}</a></span>` : ""}
      ${product.subcategory ? `<span class="crumb"><span class="crumb-sep" aria-hidden="true">›</span><a href="${urlCategorie(product)}">${esc(libelleSous)}</a></span>` : ""}
      <span class="crumb"><span class="crumb-sep" aria-hidden="true">›</span><span class="crumb-current">${esc(displayTitle)}</span></span>
    </nav>

    ${sensitiveBadgeHtml}

    <div class="product-grid">
      <div class="product-image ${isSold ? 'is-sold' : ''}${shouldBlur ? ' has-sensitive' : ''}">
        ${mainImgHtml}
        ${thumbsHtml}
      </div>
      <div class="info">
          <h1 class="p-title">${esc(displayTitle)}</h1>
          <div class="p-price-row">
            <div class="p-price">${price}</div>
            ${product.condition ? `<span class="p-badge">${esc(libelleEtat(product.condition))}</span>` : ''}
            ${isSold ? `<span class="p-sold-badge">${TRp("tr_js_product.sold_badge")}</span>` : ''}
          </div>${avisAuthentiqueHtml}
        <!-- La description vit dans le flux d'achat, sous le prix : c'est la
             notice de la pièce, elle doit se voir sans avoir à la chercher.
             Repliée à quelques lignes, dépliable sur place. -->
        <div class="p-description" id="productDescription">
          <h2 class="p-description-title">${TRp("tr_js_product.description_title")}</h2>
          <p class="p-short${hasDescription ? '' : ' p-desc-empty'}" id="descText">${hasDescription ? esc(displayDescription) : TRp("tr_js_product.desc_empty")}</p>
          <button type="button" class="p-desc-toggle" id="descToggle" aria-expanded="false" aria-controls="descText" hidden>${TRp("tr_js_product.desc_more")}</button>
          ${autoTranslateNote}
        </div>
        <ul class="p-vendor">
          ${product.period ? `<li><strong>${TRp("tr_js_product.period")}</strong> <span>${esc(libellePeriode)}</span></li>` : ''}
          ${product.subcategory ? `<li><strong>${TRp("tr_js_product.subcategory")}</strong> <span>${esc(libelleSous)}</span></li>` : ''}
          ${product.location ? `<li><strong>${TRp("tr_js_product.location")}</strong> <span>${esc(product.location)}</span></li>` : ''}
          ${product.quantity ? `<li><strong>${TRp("tr_js_product.stock")}</strong> <span>${esc(product.quantity)}</span></li>` : ''}
          <li><strong>${TRp("tr_js_product.published")}</strong> <span data-date="${esc(product.created_at || '')}">${window.timeAgo ? window.timeAgo(product.created_at) : ''}</span></li>
        </ul>
        ${isSold || PAIEMENTS_EN_MAINTENANCE ? '' : shipHtml}
        ${!isSold && PAIEMENTS_EN_MAINTENANCE
          ? `<p class="pay-maintenance">${TRp("tr_js_product.maintenance_notice")}</p>`
          : (!isSold && !availableShip.length ? `<p class="pay-maintenance">${TRp("tr_js_product.no_shipping_notice")}</p>` : '')}
        <div class="product-actions">
          ${isSold
            ? `<button class="cta-btn" disabled>${TRp("tr_js_product.sold_button")}</button>`
            : PAIEMENTS_EN_MAINTENANCE
            ? `<button class="cta-btn" disabled>${TRp("tr_js_product.maintenance_button")}</button>`
            : !availableShip.length
            ? `<button class="cta-btn" disabled>${TRp("tr_js_product.no_shipping_button")}</button>`
            : `<button class="cta-btn" id="buyBtn" aria-describedby="payProtection">${TRp("tr_js_product.buy")} ${price}</button>`
          }
          <button class="btn outline fav-btn" id="favBtn" data-id="${product.id}">${ICONE_COEUR}<span>${TRp("tr_js_product.fav_add")}</span></button>
          <button class="btn outline" id="contactSellerBtn">${ICONE_ENVELOPPE}<span>${TRp("tr_js_product.contact_seller")}</span></button>
        </div>

        <!-- Signalement -->
        <button type="button" class="report-link" id="reportBtn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ${TRp("tr_js_product.report")}
        </button>
      </div>
        <!-- Partage : troisième enfant de la grille. Sur ordinateur il se cale
             au bas de la colonne photo, face à « Signaler » ; sur téléphone il
             vient après les boutons d'achat, plus avant le titre. -->
        <div class="share-row" role="group" aria-label="${TRp("tr_js_product.share_aria")}">
          <span class="share-label">${TRp("tr_js_product.share")}</span>
          <div class="share-buttons">
            <button class="share-btn share-btn--copy" data-share="copy" title="${TRp("tr_js_product.share_copy")}" aria-label="${TRp("tr_js_product.share_copy")}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </button>
            <a class="share-btn share-btn--facebook" data-share="facebook" title="${TRp("tr_js_product.share_facebook")}" aria-label="${TRp("tr_js_product.share_facebook")}" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/></svg>
            </a>
            <a class="share-btn share-btn--twitter" data-share="twitter" title="${TRp("tr_js_product.share_twitter")}" aria-label="${TRp("tr_js_product.share_twitter")}" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a class="share-btn share-btn--whatsapp" data-share="whatsapp" title="${TRp("tr_js_product.share_whatsapp")}" aria-label="${TRp("tr_js_product.share_whatsapp")}" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            </a>
            <a class="share-btn share-btn--email" data-share="email" title="${TRp("tr_js_product.share_email")}" aria-label="${TRp("tr_js_product.share_email")}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
            </a>
          </div>
        </div>
    </div>

    <!-- Bloc vendeur -->
    <section class="seller-card" id="seller-card" aria-labelledby="seller-title">
      <h2 id="seller-title" class="sr-only">${TRp("tr_js_product.seller_title")}</h2>
      <div class="seller-loading">${TRp("tr_js_product.seller_loading")}</div>
    </section>

    <!-- Produits similaires -->
    <section class="similar-products" id="similar-products" aria-labelledby="similar-title">
      <div class="similar-header">
        <h2 id="similar-title">${TRp("tr_js_product.similar_title")}</h2>
        <a href="${urlCategorie(product)}" class="similar-link">${TRp("tr_js_product.see_more")} <span aria-hidden="true">›</span></a>
      </div>
      <div class="similar-grid" id="similar-grid">
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
      </div>
    </section>

    <!-- Avis -->
    <section class="user-reviews" id="reviews-section" aria-labelledby="reviews-title">
      <h2 id="reviews-title">${TRp("tr_js_product.reviews_title")}</h2>
      <div id="reviews-list"><p class="empty-muted">${TRp("tr_js_product.loading")}</p></div>
      <div class="review-form" id="review-form" style="display:none">
        <h3>${TRp("tr_js_product.leave_review")}</h3>
        <div class="star-input" id="star-input" role="radiogroup" aria-label="${TRp("tr_js_product.rating_label")}">
          <button type="button" role="radio" aria-checked="false" tabindex="0" data-star="1" aria-label="1 / 5">☆</button>
          <button type="button" role="radio" aria-checked="false" tabindex="-1" data-star="2" aria-label="2 / 5">☆</button>
          <button type="button" role="radio" aria-checked="false" tabindex="-1" data-star="3" aria-label="3 / 5">☆</button>
          <button type="button" role="radio" aria-checked="false" tabindex="-1" data-star="4" aria-label="4 / 5">☆</button>
          <button type="button" role="radio" aria-checked="false" tabindex="-1" data-star="5" aria-label="5 / 5">☆</button>
        </div>
        <textarea id="review-comment" placeholder="${TRp("tr_js_product.review_comment_ph")}" aria-label="${TRp("tr_js_product.review_comment_ph")}"></textarea>
        <button class="cta-btn" id="submitReview" type="button">${TRp("tr_js_product.publish_review")}</button>
      </div>
    </section>
  `;

  // La date relative écrite par le serveur date de sa mise en cache : on la
  // recalcule à l'heure du visiteur.
  if (reprendreServeur && window.timeAgo) {
    root.querySelectorAll("[data-date]").forEach((el) => {
      if (el.dataset.date) el.textContent = window.timeAgo(el.dataset.date);
    });
  }

  /* Repli de la description. Le clamp est purement visuel (CSS) : le texte
     intégral reste dans le DOM pour Google et les lecteurs d'écran. Le bouton
     « Lire la suite » n'apparaît que si le texte déborde réellement, mesuré
     après le rendu puis re-mesuré à l'arrivée des polices : Playfair change
     la hauteur des lignes, et une mesure trop précoce mentirait. */
  const descBox = document.getElementById("productDescription");
  const descText = document.getElementById("descText");
  const descToggle = document.getElementById("descToggle");
  if (descBox && descText && descToggle && !descText.classList.contains("p-desc-empty")) {
    descBox.classList.add("is-clamped");
    const mesurer = () => {
      if (descToggle.getAttribute("aria-expanded") === "true") return;
      const deborde = descText.scrollHeight - descText.clientHeight > 4;
      descToggle.hidden = !deborde;
      descBox.classList.toggle("is-clamped", deborde);
    };
    // Mesure directe et non par requestAnimationFrame : dans un onglet
    // ouvert en arrière-plan, les requestAnimationFrame ne tournent pas et
    // le bouton ne serait jamais apparu.
    mesurer();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => setTimeout(mesurer, 0));
    }
    descToggle.addEventListener("click", () => {
      const ouvert = descToggle.getAttribute("aria-expanded") === "true";
      descToggle.setAttribute("aria-expanded", String(!ouvert));
      descBox.classList.toggle("is-clamped", ouvert);
      descToggle.textContent = ouvert ? TRp("tr_js_product.desc_more") : TRp("tr_js_product.desc_less");
      // Au repli, la page ne doit pas laisser l'utilisateur au milieu du vide
      // que le texte occupait.
      if (ouvert) descBox.scrollIntoView({ block: "nearest" });
    });
  }

  // Interaction galerie : clic sur une miniature → change l'image principale.
  // Les miniatures affichées font foi : en secours, la liste des photos n'a
  // pas été relue, mais le serveur les a écrites.
  if (hasGallery || document.querySelectorAll(".product-thumb").length > 1) {
    const mainImg = document.getElementById("product-main-img");
    document.querySelectorAll(".product-thumb").forEach((thumb) => {
      thumb.addEventListener("click", () => {
        const url = thumb.dataset.img;
        if (url && mainImg) {
          mainImg.src = url;
          // Le lien d'agrandissement suit la photo choisie.
          document.getElementById("productZoom")?.setAttribute("href", thumb.dataset.zoom || url);
          document.querySelectorAll(".product-thumb").forEach((t) => {
            t.classList.remove("is-active");
            t.setAttribute("aria-pressed", "false");
          });
          thumb.classList.add("is-active");
          thumb.setAttribute("aria-pressed", "true");
        }
      });
    });
  }

  // --- Partage social ---
  const shareUrl = window.location.href;
  /* Le texte partagé dans la langue de la page : la fiche anglaise envoyait
     « Casque à pointe : Athena Militaria ». Deux-points précédés d'une
     espace insécable en français, collés au mot en anglais. */
  const shareText = (displayTitle || (useEnglish ? "Item" : "Article"))
    + (useEnglish ? ": " : " : ") + "Athena Militaria";
  const shareMap = {
    copy: null,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText + " " + shareUrl)}`,
    email: `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(shareUrl)}`,
  };
  document.querySelectorAll(".share-btn").forEach((el) => {
    const kind = el.dataset.share;
    if (kind === "copy") {
      el.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(shareUrl);
          window.toastSuccess ? toastSuccess(TRp("tr_js_product.link_copied")) : null;
          // Feedback visuel : check pendant 1.4s
          el.classList.add("is-copied");
          setTimeout(() => el.classList.remove("is-copied"), 1400);
        } catch {
          window.toastError ? toastError(TRp("tr_js_product.copy_failed")) : null;
        }
      });
    } else if (shareMap[kind]) {
      el.setAttribute("href", shareMap[kind]);
    }
  });

  /* Vendeur et pièces voisines : relus dans la base. En secours, le serveur
     les a déjà écrits, et une lecture en échec les remplacerait par
     « Utilisateur » et « Aucun article similaire ». Les avis, que le
     serveur n'écrit pas, sont tentés dans tous les cas. */
  if (!enSecours) {
    loadSellerInfo(product.user_id);
    loadSimilarProducts(product);
  }
  loadReviews(id);

  // Bouton contacter le vendeur
  /* Le bouton du cartel « Connectez-vous pour afficher les photos » : par
     délégation, parce que le HTML vient tantôt du serveur, tantôt d'ici. */
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".sensitive-login")) return;
    if (window.ouvrirModaleAuth) window.ouvrirModaleAuth();
    else window.location.href = lienFiche("/account");
  });

  const contactBtn = document.getElementById("contactSellerBtn");
  if (contactBtn) {
    contactBtn.addEventListener("click", async () => {
      const { data: { user } } = await window.sb.auth.getUser();
      if (!user) {
        // Même chemin que « Acheter » : la fenêtre de connexion dit pourquoi.
        demanderConnexion("tr_js_product.login_contact");
        return;
      }
      if (user.id === product.user_id) {
        toast(TRp("tr_js_product.own_article"));
        return;
      }
      // Fiche servie sans base par une version de product.php qui n'écrivait
      // pas le vendeur : impossible de savoir à qui écrire.
      if (!product.user_id) {
        toastError(TRp("tr_js_product.network_error"));
        return;
      }
      // La messagerie s'ouvre dans la langue de la fiche.
      const messagerie = lienFiche("/messages");
      window.location.href = messagerie + (messagerie.includes("?") ? "&" : "?")
        + "to=" + encodeURIComponent(product.user_id) + "&product=" + encodeURIComponent(id);
    });
  }

  // Formulaire d'avis — réutilise currentUser déjà récupéré plus haut
  const reviewForm = document.getElementById("review-form");
  if (currentUser && reviewForm) {
    reviewForm.style.display = "block";
    let selectedRating = 0;

    document.querySelectorAll("#star-input button").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedRating = Number(btn.dataset.star);
        // La forme change avec la couleur (☆ / ★), et la note retenue est dite.
        document.querySelectorAll("#star-input button").forEach((b, i) => {
          b.classList.toggle("active", i < selectedRating);
          b.textContent = i < selectedRating ? "★" : "☆";
          b.setAttribute("aria-checked", String(i + 1 === selectedRating));
          b.tabIndex = i + 1 === selectedRating ? 0 : -1;
        });
      });
    });
    // Groupe radio au clavier : les flèches changent la note, Tab en sort.
    document.getElementById("star-input")?.addEventListener("keydown", (e) => {
      const boutons = [...document.querySelectorAll("#star-input button")];
      const i = boutons.indexOf(document.activeElement);
      if (i < 0) return;
      let cible = null;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") cible = boutons[(i + 1) % boutons.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") cible = boutons[(i - 1 + boutons.length) % boutons.length];
      if (!cible) return;
      e.preventDefault();
      cible.focus();
      cible.click();
    });

    document.getElementById("submitReview")?.addEventListener("click", async () => {
      if (selectedRating === 0) {
        toast(TRp("tr_js_product.select_rating"));
        return;
      }
      const comment = document.getElementById("review-comment")?.value || "";
      const { error } = await window.sb.from("reviews").insert([{
        product_id: id,
        reviewer_id: currentUser.id,
        rating: selectedRating,
        comment,
      }]);
      if (error) {
        if (error.code === "23505") {
          toast(TRp("tr_js_product.already_reviewed"));
        } else {
          toastError(ERRp(error));
        }
      } else {
        toastSuccess(TRp("tr_js_product.review_published"));
        loadReviews(id);
        reviewForm.style.display = "none";
      }
    });
  }

  // Bouton Favori
  const favBtn = document.getElementById("favBtn");
  if (favBtn) {
    /* L'icône reste en place (un SVG, comme le partage) ; seuls le libellé,
       le remplissage du cœur et aria-pressed changent. */
    const poserFavori = (actif) => {
      favBtn.classList.toggle("fav-active", actif);
      favBtn.setAttribute("aria-pressed", actif ? "true" : "false");
      const lib = favBtn.querySelector("span");
      if (lib) lib.textContent = TRp(actif ? "tr_js_product.fav_added" : "tr_js_product.fav_add");
    };
    const { data: { user } } = await window.sb.auth.getUser();
    if (user) {
      // Vérifier si déjà en favori
      const { data: existing } = await window.sb
        .from("favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("product_id", id)
        .maybeSingle();

      if (existing) {
        poserFavori(true);
      }

      favBtn.addEventListener("click", async () => {
        if (favBtn.getAttribute("aria-busy") === "true") return;
        favBtn.setAttribute("aria-busy", "true");
        try {
          if (favBtn.classList.contains("fav-active")) {
            await window.sb.from("favorites").delete().eq("user_id", user.id).eq("product_id", id);
            poserFavori(false);
          } else {
            await window.sb.from("favorites").insert([{ user_id: user.id, product_id: id }]);
            poserFavori(true);
          }
        } finally {
          favBtn.removeAttribute("aria-busy");
        }
      });
    } else {
      favBtn.addEventListener("click", () => {
        // Même chemin que « Contacter » : la fenêtre de connexion dit pourquoi.
        demanderConnexion("tr_js_product.login_fav");
      });
    }
  }

  // Affiche le champ "code postal" seulement quand "Point relais" est sélectionné
  document.querySelectorAll('input[name="payship"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const selected = document.querySelector('input[name="payship"]:checked');

      const relayZone = document.getElementById("payShipRelay");
      if (relayZone) {
        relayZone.style.display = selected && selected.value === "relay" ? "block" : "none";
      }
      // Un choix est fait : le rappel « choisissez un mode » s'efface.
      const bloc = document.getElementById("payShip");
      if (bloc) {
        bloc.classList.remove("is-missing");
        bloc.removeAttribute("aria-invalid");
        bloc.removeAttribute("aria-describedby");
      }
      const err = document.getElementById("payShipErr");
      if (err) err.hidden = true;

    });
  });


  // L'acheteur revient d'un Checkout annulé : on le dit, sans rien conclure
  // sur un éventuel paiement. Le stock réservé se libère tout seul côté
  // serveur (session expirée ou nouvelle tentative).
  if (params.get("checkout") === "canceled") {
    toast(TRp("tr_js_product.checkout_canceled"));
    if (window.history?.replaceState) {
      window.history.replaceState({}, "", window.location.pathname + (enAnglaisDansUrl() ? "?lang=en" : ""));
    }
  }

  // Bouton Acheter → Stripe Checkout
  const buyBtnEl = document.getElementById("buyBtn");

  // Verrou en mémoire, indépendant de l'état visuel du bouton. Désactiver un
  // bouton n'est qu'un confort : il se réactive au retour arrière, se
  // contourne depuis la console, et ne protège rien. La garantie réelle est
  // côté serveur (réservation atomique + clé d'idempotence Stripe) ; ceci
  // évite simplement des appels inutiles.
  let checkoutInFlight = false;

  /* Libellé d'origine du bouton (« Acheter 400 € »), rendu tel quel après
     un échec : en secours, la fiche vient du serveur et le prix n'a pas été
     relu. */
  const libelleAchat = buyBtnEl ? buyBtnEl.textContent : "";

  if (buyBtnEl) buyBtnEl.addEventListener("click", async () => {
    const btn = document.getElementById("buyBtn");
    if (checkoutInFlight) return;
    /* Les messages d'un essai précédent (code postal invalide, mode de
       livraison manquant) ne valent plus : ils restaient affichés à côté du
       nouveau. */
    if (window.toastEffacer) window.toastEffacer();

    // Mode de livraison choisi (obligatoire pour le serveur)
    const shipEl = document.querySelector('input[name="payship"]:checked');
    const shippingMethod = shipEl ? shipEl.value : null;
    if (!shippingMethod) {
      // Rien n'est coché d'avance : on le dit, on montre le bloc et on y
      // place le clavier, au lieu de laisser un message s'effacer tout seul.
      toastError(TRp("tr_js_product.choose_shipping"));
      const bloc = document.getElementById("payShip");
      if (bloc) {
        bloc.classList.add("is-missing");
        bloc.setAttribute("aria-invalid", "true");
        bloc.setAttribute("aria-describedby", "payShipErr");
        const err = document.getElementById("payShipErr");
        if (err) err.hidden = false;
        const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        bloc.scrollIntoView({ block: "center", behavior: doux ? "smooth" : "auto" });
        bloc.querySelector('input[name="payship"]')?.focus({ preventScroll: true });
      }
      return;
    }
    let relayPostal = "";
    if (shippingMethod === "relay") {
      relayPostal = (document.getElementById("payShipPostal")?.value || "").trim();
      if (!/^\d{5}$/.test(relayPostal)) {
        toastError(TRp("tr_js_product.invalid_postal"));
        return;
      }
    }

    // L'achat exige un compte : sans buyer_id, la commande serait invisible
    // pour son propre acheteur (les politiques RLS filtrent sur buyer_id), et
    // il ne pourrait ni confirmer la réception ni ouvrir un litige.
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      demanderConnexion("tr_js_product.login_to_buy");
      return;
    }

    checkoutInFlight = true;
    /* Désactivé pendant l'appel, le bouton perdait le focus clavier, qui
       tombait sur la page : après une erreur, le lecteur d'écran ne savait
       plus où il était. On le lui rend, s'il n'est pas allé ailleurs. */
    const restore = () => {
      checkoutInFlight = false;
      btn.textContent = libelleAchat;
      btn.disabled = false;
      const actif = document.activeElement;
      if (!actif || actif === document.body) btn.focus({ preventScroll: true });
    };

    btn.textContent = TRp("tr_js_product.redirecting");
    btn.disabled = true;

    try {
      const res = await fetch(
        (window.SUPABASE_URL || "https://uctaxgfqdoxtcidllyjv.supabase.co") + "/functions/v1/create-checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": window.SUPABASE_ANON_KEY || "",
            "Authorization": "Bearer " + session.access_token,
          },
          body: JSON.stringify({ productId: Number(id), shippingMethod, relayPostal }),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      // Le serveur renvoie un code stable ; le texte français l'accompagne en
      // secours. Aucun message technique Stripe ne remonte jusqu'ici.
      toastError(checkoutErrorMessage(data.code) || data.error || TRp("tr_js_product.payment_failed"));
      restore();
    } catch (err) {
      toastError(TRp("tr_js_product.network_error"));
      restore();
    }
  });

  /* Traduction des codes d'erreur de create-checkout. */
  function checkoutErrorMessage(code) {
    const keys = {
      AUTH_REQUIRED: "tr_js_product.login_to_buy",
      PRODUCT_NOT_FOUND: "tr_js_product.err_not_found",
      PRODUCT_NOT_AVAILABLE: "tr_js_product.err_unavailable",
      PRODUCT_RESERVED: "tr_js_product.err_reserved",
      SELF_PURCHASE: "tr_js_product.err_self_purchase",
      SELLER_NOT_ONBOARDED: "tr_js_product.err_seller_not_ready",
      SELLER_BLOCKED: "tr_js_product.err_unavailable",
      SHIPPING_INVALID: "tr_js_product.choose_shipping",
      SHIPPING_NOT_OFFERED: "tr_js_product.err_shipping_not_offered",
      RELAY_POSTAL_INVALID: "tr_js_product.invalid_postal",
      TOO_MANY_RESERVATIONS: "tr_js_product.err_too_many",
      RATE_LIMITED: "tr_js_product.err_too_many",
      PAYMENT_PROVIDER_UNAVAILABLE: "tr_js_product.err_provider_down",
    };
    const key = keys[code];
    if (!key) return null;
    const text = TRp(key);
    // TRp renvoie la clé elle-même quand la traduction manque : dans ce cas on
    // laisse le message français du serveur prendre le relais.
    return text && text !== key ? text : null;
  }

  // Bouton Signaler
  const reportBtn = document.getElementById("reportBtn");
  if (reportBtn) {
    reportBtn.addEventListener("click", () => openReportModal(product));
  }

  // Tous les écouteurs sont posés : le clic retenu, s'il y en a un, part.
  clicsRetenus.liberer();
});

/* ============== Modale de signalement ============== */
/* Fermeture de la fenêtre ouverte, s'il y en a une. Une seconde ouverture
   passe par elle plutôt que d'ôter l'ancienne fenêtre en silence : sinon
   l'écouteur d'Échap de l'ancienne restait branché et, appelé plus tard,
   rendait la page alors que la nouvelle fenêtre était encore ouverte. */
let fermerSignalement = null;

function openReportModal(product) {
  if (fermerSignalement) fermerSignalement();
  const existing = document.getElementById("reportModal");
  if (existing) existing.remove();
  const dernierFocus = document.activeElement;

  const modal = document.createElement("div");
  modal.id = "reportModal";
  modal.className = "report-modal-overlay";
  modal.innerHTML = `
    <div class="report-modal-box" role="dialog" aria-modal="true" aria-labelledby="reportTitle" tabindex="-1">
      <button class="report-close" type="button" aria-label="${TRp("tr_js_script.close")}">×</button>
      <h2 id="reportTitle">${TRp("tr_js_product.report")}</h2>
      <p class="report-sub">${TRp("tr_js_product.report_sub")}</p>

      <label class="report-label">${TRp("tr_js_product.report_reason")} *</label>
      <select id="reportReason" required>
        <option value="">${TRp("tr_js_product.report_choose")}</option>
        <option value="Contrefaçon / faux">${TRp("tr_js_product.reason_fake")}</option>
        <option value="Objet illégal">${TRp("tr_js_product.reason_illegal")}</option>
        <option value="Contenu haineux ou illégal">${TRp("tr_js_product.reason_hate")}</option>
        <option value="Arnaque / fraude">${TRp("tr_js_product.reason_scam")}</option>
        <option value="Description trompeuse">${TRp("tr_js_product.reason_misleading")}</option>
        <option value="Doublon">${TRp("tr_js_product.reason_duplicate")}</option>
        <option value="Autre">${TRp("tr_js_product.reason_other")}</option>
      </select>

      <label class="report-label">${TRp("tr_js_product.report_desc")}</label>
      <textarea id="reportDesc" rows="4" placeholder="${TRp("tr_js_product.report_desc_ph")}" aria-label="${TRp("tr_js_product.report_desc_ph")}"></textarea>

      <div class="report-actions">
        <button type="button" class="btn outline" id="reportCancel">${TRp("tr_js_product.cancel")}</button>
        <button type="button" class="cta-btn" id="reportSend">${TRp("tr_js_product.report_send")}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  /* overflow: hidden ne retenait pas la page (style.css impose
     body { overflow: visible !important }) : elle défilait d'environ 400 px
     par glissé sous la fenêtre (mesuré le 6 oct. 2026 à 360 px). Même verrou
     que le menu et la connexion (script.js). */
  window.figerLaPage?.("signaler");

  /* Même conduite au clavier que la connexion et le tiroir (script.js).
     La fenêtre ne se fermait qu'à la souris, le focus restait sur le bouton
     « Signaler », sous le voile, et la tabulation parcourait la page figée
     derrière. Le focus va à la boîte elle-même (tabindex="-1") : le lecteur
     d'écran annonce son titre sans que le clavier du téléphone surgisse
     sur la liste des motifs. À la fermeture, il revient au bouton, sans
     défilement : la page vient d'être rendue à sa position. */
  const boite = modal.querySelector(".report-modal-box");
  const surEchap = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };
  const close = () => {
    if (fermerSignalement !== close) return;
    fermerSignalement = null;
    document.removeEventListener("keydown", surEchap);
    modal.remove();
    window.rendreLaPage?.("signaler");
    if (dernierFocus && document.contains(dernierFocus)) dernierFocus.focus({ preventScroll: true });
  };
  fermerSignalement = close;
  document.addEventListener("keydown", surEchap);
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const cibles = [...boite.querySelectorAll("button, select, textarea")]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!cibles.length) return;
    const premier = cibles[0], dernier = cibles[cibles.length - 1];
    const ici = document.activeElement;
    if (e.shiftKey && (ici === premier || ici === boite)) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && ici === dernier) { e.preventDefault(); premier.focus(); }
  });
  boite.focus({ preventScroll: true });

  modal.querySelector(".report-close").addEventListener("click", close);
  document.getElementById("reportCancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  /* Un double clic envoyait deux signalements : rien ne verrouillait
     l'envoi pendant les deux appels réseau. Verrou en mémoire, bouton
     désactivé, libérés quoi qu'il arrive. */
  const envoyer = document.getElementById("reportSend");
  let envoiEnCours = false;
  envoyer.addEventListener("click", async () => {
    if (envoiEnCours) return;
    const reason = document.getElementById("reportReason").value;
    const description = document.getElementById("reportDesc").value.trim();
    if (!reason) {
      (window.toastWarn || window.toast)(TRp("tr_js_product.choose_reason"));
      return;
    }
    envoiEnCours = true;
    envoyer.disabled = true;
    try {
      const { data: { user } } = await window.sb.auth.getUser();
      const payload = {
        product_id: product.id,
        reason,
        description: description || null,
        reporter_id: user?.id || null,
        reporter_email: user?.email || null,
      };
      const { error } = await window.sb.from("reports").insert([payload]);
      if (error) {
        (window.toastError || window.toast)(ERRp(error));
        return;
      }
      (window.toastSuccess || window.toast)(TRp("tr_js_product.report_sent"));
      close();
    } catch (err) {
      (window.toastError || window.toast)(ERRp(err));
    } finally {
      envoiEnCours = false;
      envoyer.disabled = false;
    }
  });
}

/* Charger les produits similaires (même sous-catégorie ou catégorie) */
async function loadSimilarProducts(currentProduct) {
  const grid = document.getElementById("similar-grid");
  if (!grid) return;

  let query = window.sb
    .from("products")
    .select("id, title, title_en, price, image_url, condition, subcategory, period, historically_sensitive, authenticated_at")
    .neq("id", currentProduct.id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(4);

  if (currentProduct.subcategory) {
    query = query.eq("subcategory", currentProduct.subcategory);
  } else if (currentProduct.period) {
    query = query.eq("period", currentProduct.period);
  }

  let { data, error } = await query;

  // Si pas assez de produits dans la sous-catégorie, compléter avec la catégorie
  if (!error && data && data.length < 4 && currentProduct.period) {
    const { data: extra } = await window.sb
      .from("products")
      .select("id, title, title_en, price, image_url, condition, subcategory, period, historically_sensitive, authenticated_at")
      .eq("period", currentProduct.period)
      .eq("status", "published")
      .neq("id", currentProduct.id)
      .order("created_at", { ascending: false })
      .limit(4);
    if (extra) {
      const ids = new Set(data.map(d => d.id));
      extra.forEach(p => { if (!ids.has(p.id)) data.push(p); });
      data = data.slice(0, 4);
    }
  }

  // Fallback : n'importe quels produits récents
  if (!data || data.length === 0) {
    const { data: fallback } = await window.sb
      .from("products")
      .select("id, title, title_en, price, image_url, condition, subcategory, period, historically_sensitive, authenticated_at")
      .eq("status", "published")
      .neq("id", currentProduct.id)
      .order("created_at", { ascending: false })
      .limit(4);
    data = fallback || [];
  }

  if (!data || data.length === 0) {
    grid.innerHTML = `<p class="similar-empty">${TRp("tr_js_product.similar_empty")}</p>`;
    return;
  }

  /* La carte d'une pièce voisine est LA carte du catalogue et de l'accueil
     (renderProductCard dans script.js, am_carte côté serveur) : une annonce
     garde le même dessin d'une page à l'autre. Le flou des pièces sensibles
     y suit l'état de connexion. */
  const { data: { user: currentUserSim } } = await window.sb.auth.getUser();
  window.__IS_LOGGED_IN = !!currentUserSim;
  if (window.renderProductCard) {
    grid.replaceChildren(...data.slice(0, 4).map((p) => window.renderProductCard(p)));
  }
}

/* Charger les infos vendeur (pseudo, avatar, nb ventes, note, depuis) */
async function loadSellerInfo(sellerId) {
  const card = document.getElementById("seller-card");
  if (!card || !sellerId) {
    if (card) card.style.display = "none";
    return;
  }
  const esc = window.escapeHtml || ((s) => s);

  // Récupérer le profil si la table existe
  let profile = null;
  try {
    // public_profiles et non profiles : la table n'est lisible que par son
    // propriétaire, donc un visiteur recevait une réponse vide et le vendeur
    // s'affichait toujours en « Utilisateur ».
    const { data } = await window.sb
      .from("public_profiles")
      .select("id, pseudo, avatar_url, created_at, location")
      .eq("id", sellerId)
      .maybeSingle();
    profile = data;
  } catch (e) { /* table peut ne pas exister */ }

  // Statistiques : nb annonces actives + nb ventes
  const [activeRes, soldRes] = await Promise.all([
    // Annonces en ligne seulement : « tout sauf vendu » comptait aussi les
    // brouillons et les annonces retirées par la modération.
    window.sb.from("products").select("id", { count: "exact", head: true }).eq("user_id", sellerId).eq("status", "published"),
    window.sb.from("products").select("id", { count: "exact", head: true }).eq("user_id", sellerId).eq("status", "sold"),
  ]);
  const nbActive = activeRes?.count || 0;
  const nbSold = soldRes?.count || 0;

  // Note moyenne à partir des avis sur les produits du vendeur
  let avgRating = null, nbReviews = 0;
  try {
    const { data: sellerProducts } = await window.sb
      .from("products").select("id").eq("user_id", sellerId);
    const ids = (sellerProducts || []).map(p => p.id);
    if (ids.length) {
      const { data: reviews } = await window.sb
        .from("reviews").select("rating").in("product_id", ids);
      if (reviews && reviews.length) {
        nbReviews = reviews.length;
        avgRating = reviews.reduce((s, r) => s + r.rating, 0) / nbReviews;
      }
    }
  } catch (e) {}

  const pseudo = profile?.pseudo || TRp("tr_js_product.seller_default");
  const avatarLetter = (pseudo[0] || "V").toUpperCase();
  const avatarHtml = profile?.avatar_url
    ? `<img src="${esc(profile.avatar_url)}" alt="${esc(pseudo)}" class="seller-avatar-img">`
    : `<div class="seller-avatar">${esc(avatarLetter)}</div>`;

  const sinceTxt = profile?.created_at
    ? `${TRp("tr_js_product.member_since")} ${new Date(profile.created_at).toLocaleDateString(localeDates(), { month: "long", year: "numeric" })}`
    : "";

  /* Une ligne discrète sous le nom, et seulement ce qui n'est pas nul (même
     calcul que product.php) : trois gros compteurs à zéro mesuraient la
     jeunesse du site plus qu'ils ne rassuraient. */
  const faits = [];
  const fait = (n, un, plusieurs) => TRp(n > 1 ? plusieurs : un).replace("{n}", n);
  if (nbActive > 0) faits.push(fait(nbActive, "tr_js_product.seller_listings_one", "tr_js_product.seller_listings_many"));
  if (nbSold > 0) faits.push(fait(nbSold, "tr_js_product.seller_sales_one", "tr_js_product.seller_sales_many"));
  if (avgRating != null) {
    const note = (Math.round(avgRating * 10) / 10).toString().replace(".", localeDates() === "fr-FR" ? "," : ".");
    faits.push(TRp("tr_js_product.seller_rating").replace("{note}", note).replace("{n}", nbReviews));
  }

  card.innerHTML = `
    <h2 id="seller-title" class="sr-only">${TRp("tr_js_product.seller_title")}</h2>
    <div class="seller-left">
      ${avatarHtml}
      <div class="seller-meta">
        <div class="seller-name">${esc(pseudo)}</div>
        ${sinceTxt ? `<div class="seller-since">${esc(sinceTxt)}</div>` : ''}
        ${profile?.location ? `<div class="seller-loc">${esc(profile.location)}</div>` : ''}
        ${faits.length ? `<div class="seller-faits">${esc(faits.join(" · "))}</div>` : ''}
      </div>
    </div>
  `;
}

/* Charger les avis d'un produit */
async function loadReviews(productId) {
  const list = document.getElementById("reviews-list");
  if (!list) return;

  const { data, error } = await window.sb
    .from("reviews")
    .select("rating, comment, created_at")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });

  /* Lecture en échec : on n'affirme pas « aucun avis », qui pourrait être
     faux ; la section reste vide. */
  if (error) {
    list.innerHTML = "";
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = "<p>" + TRp("tr_js_product.no_reviews") + "</p>";
    return;
  }

  /* Aucune note agrégée n'est déclarée aux moteurs. Sur une pièce unique,
     l'avis d'un acheteur juge la transaction et le vendeur plus que l'objet ;
     Google réserve les étoiles produit aux avis portant sur le produit, et
     baliser les premiers comme les seconds exposerait le site à une action
     manuelle pour données structurées trompeuses. Les avis restent affichés. */

  list.innerHTML = "";
  data.forEach((review) => {
    const card = document.createElement("div");
    card.className = "user-review-card";

    const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    const date = new Date(review.created_at).toLocaleDateString(localeDates(), {
      day: "numeric", month: "long", year: "numeric"
    });

    const esc = window.escapeHtml || ((s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"));
    card.innerHTML = `
      <span class="review-stars" role="img" aria-label="${review.rating} / 5">${stars}</span>
      <span class="review-date">${date}</span>
      ${review.comment ? "<p>" + esc(review.comment) + "</p>" : ""}
    `;
    list.appendChild(card);
  });
}
