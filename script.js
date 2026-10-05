/* ============== URLs propres ==============
   Les boutons du header (connexion, messagerie) sont des <a href="#"> stylés.
   Sans ça, chaque clic ajoutait un "#" dans la barre d'adresse. On neutralise
   la navigation en phase de capture : les handlers de clic existants continuent
   de s'exécuter normalement derrière. */
document.addEventListener(
  "click",
  (e) => {
    const a = e.target.closest && e.target.closest('a[href="#"]');
    if (a) e.preventDefault();
  },
  true
);

/* ============== BOUTON "LIRE TOUS LES AVIS" ==============
   Recharge l'accueil en repartant du haut de page. Le href="/" garde une URL
   propre (pas de "#") et laisse le clic milieu ouvrir un onglet normalement ;
   le handler ne sert qu'à neutraliser la restauration du défilement, sinon le
   navigateur rouvrirait la page à l'endroit exact où on a cliqué. */
const reviewsAllBtn = document.getElementById("reviewsAllBtn");
if (reviewsAllBtn) {
  reviewsAllBtn.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    window.location.href = "/";
  });
}

/* ============== PHOTOS D'ANNONCE : service via la fonction img ==============
   Les photos sont stockées dans Supabase Storage, dont les deux points d'accès
   publics imposent « X-Robots-Tag: none » : aucune photo d'annonce ne pouvait
   donc apparaître dans Google Images, et le JSON-LD Product déclarait une
   image que les moteurs n'ont pas le droit d'indexer.
   Le stockage sert en outre le fichier brut, jusqu'à 4,5 Mo pour une vignette
   de 226 px, avec un « cache-control: no-cache ».
   La fonction img relaie la version redimensionnée sans cet en-tête.

   La conversion se fait à l'AFFICHAGE : la base garde ses URLs d'origine.
   C'est volontaire. La suppression d'une annonce retrouve le fichier à
   supprimer en découpant image_url sur "/product-images/" (account.js) :
   réécrire la colonne casserait ce nettoyage. Et si la fonction tombait, il
   suffirait de neutraliser ce helper pour revenir à l'état antérieur. */
const IMG_FN = "https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/img";
const IMG_LARGEURS = [400, 800, 1200];   // liste blanche imposée par la fonction

function imgUrl(url, largeur) {
  if (!url || typeof url !== "string") return url;
  // Seules les photos du bucket sont concernées : hero.png et toute URL
  // externe passent inchangées.
  const m = url.match(/\/storage\/v1\/(?:object|render\/image)\/public\/product-images\/(.+?)(?:\?.*)?$/);
  if (!m) return url;
  const w = IMG_LARGEURS.indexOf(largeur) !== -1 ? largeur : 800;
  // Le chemin est déjà encodé dans l'URL stockée : on le décode avant de le
  // réencoder segment par segment, sinon on obtiendrait un double encodage.
  let chemin;
  try {
    chemin = decodeURIComponent(m[1]).split("/").map(encodeURIComponent).join("/");
  } catch (e) {
    chemin = m[1];   // URL déjà mal encodée : on la laisse telle quelle
  }
  /* Relais du site (media.php) : la photo est servie en WebP depuis
     www.athenamilitaria.fr et gardée sur place après le premier appel, au lieu
     d'être recalculée en JPEG par la fonction à chaque visite (0,4 à 1,7 s
     mesurés). Réservé aux noms que le formulaire de vente produit lui-même :
     tout autre nom garde l'adresse de la fonction. Même règle que am_img
     (inc/athena.php), pour que le serveur et le navigateur écrivent la même
     adresse. */
  if (/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(chemin)) {
    return "/media/" + w + "/" + chemin + ".webp";
  }
  return IMG_FN + "?path=" + chemin + "&w=" + w;
}
window.imgUrl = imgUrl;

/* Adresse d'une fiche : /annonce/<titre>-<identifiant>. Le calcul est dans
   taxonomie.js, avec celui du serveur (inc/athena.php) ; cette enveloppe est
   là pour les pages membres (compte, messages, administration), qui
   fabriquent leurs liens sans passer par les cartes du catalogue. Le titre
   est toujours le français : une annonce n'a qu'une adresse. */
window.urlFiche = function (id, titre, lang) {
  if (window.TAXONOMIE) return window.TAXONOMIE.urlFiche(id, titre || "", lang);
  return "/annonce/annonce-" + encodeURIComponent(id) + (lang === "en" ? "?lang=en" : "");
};

/* ============== PHOTOS D'ANNONCE : préparation avant envoi ==============
   Les appareils photo et les téléphones produisent des fichiers de plusieurs
   méga-octets en 5000 px de large, alors que la plus grande zone d'affichage
   du site fait moins de 900 px. Une annonce pesait ainsi 4,5 Mo à elle seule,
   ce qui en faisait l'élément le plus lent du catalogue et de la fiche
   produit, sur mobile en particulier.
   On redimensionne et on réencode dans le navigateur avant l'envoi. En cas de
   souci (format exotique, image corrompue, navigateur récalcitrant), on
   retombe sur le fichier d'origine : mieux vaut une photo lourde que pas de
   photo du tout.

   Deux cas étaient jusqu'ici perdus, alors que cette fonction sait les traiter :

   1. Les fichiers de plus de 5 Mo étaient refusés AVANT d'arriver ici. Or ce
      sont précisément ceux qui gagnent le plus à être compressés : une photo
      d'appareil reflex de 12 Mo retombe sous le méga-octet. Le refus est donc
      remonté à un simple garde-fou (PHOTO_SOURCE_MAX_MO), au-delà duquel le
      navigateur cale de toute façon au décodage.

   2. Le HEIC, format par défaut des iPhone. Safari le décode nativement, mais
      ni Chrome ni Firefox : sur ces navigateurs, la photo n'était ni affichée
      en aperçu ni convertie, et arrivait telle quelle dans le stockage, donc
      invisible pour tous les visiteurs. On tente d'abord le décodage natif ;
      s'il échoue, on charge libheif (heic2any) à la demande, uniquement pour
      les visiteurs concernés. */
const PHOTO_LARGEUR_MAX = 2000;   // large pour le zoom, sans excès
const PHOTO_QUALITE = 0.82;
const PHOTO_POIDS_CIBLE = 1.5 * 1024 * 1024;   // au-delà, on repasse plus fort
const PHOTO_SOURCE_MAX_MO = 40;                // garde-fou décodage navigateur

/* Décodeur HEIC chargé à la demande : 1,5 Mo de wasm qu'il serait absurde
   d'imposer à tout le monde alors que seuls les iPhone sur Chrome/Firefox en
   ont besoin. */
const HEIC_CDN = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
let heicChargement = null;

function chargerDecodeurHeic() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (heicChargement) return heicChargement;
  heicChargement = new Promise((resolve, reject) => {
    /* L'échec doit effacer la promesse mémorisée, sans quoi elle serait
       renvoyée telle quelle à tout appel ultérieur : un vendeur dont le
       chargement a échoué faute de réseau ne pourrait plus jamais convertir
       un HEIC de la session, même revenu en ligne, et retirer puis remettre
       la photo ne changerait rien. */
    const echouer = (e) => { heicChargement = null; reject(e); };
    const s = document.createElement("script");
    s.src = HEIC_CDN;
    s.onload = () => (window.heic2any ? resolve(window.heic2any) : echouer(new Error("heic2any absent")));
    s.onerror = () => echouer(new Error("heic2any injoignable"));
    document.head.appendChild(s);
  });
  return heicChargement;
}

/* Un HEIC venu d'un iPhone arrive parfois avec un type MIME vide selon le
   navigateur et le système : le nom du fichier est alors le seul indice. */
function estHeic(file) {
  return /hei[cf]/i.test(file.type || "") || /\.hei[cf]$/i.test(file.name || "");
}

const PHOTO_EXT_CONNUES = /\.(jpe?g|png|webp|gif|bmp|avif|hei[cf])$/i;
function estFichierImage(file) {
  return String(file.type || "").startsWith("image/") || PHOTO_EXT_CONNUES.test(file.name || "");
}
window.estFichierImage = estFichierImage;

// Décode un blob en <img>. Rejette si le navigateur ne sait pas lire le format.
function chargerImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("décodage impossible")); };
    img.src = url;
  });
}

function encoderJpeg(img, largeurMax, qualite) {
  return new Promise((resolve) => {
    try {
      const ratio = Math.min(1, largeurMax / img.naturalWidth);
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      /* Le JPEG n'a pas de couche de transparence : sans ce fond, toute zone
         transparente d'un PNG ou d'un WebP ressortait en NOIR opaque.
         Cas très concret ici : pièce détourée sur fond transparent, scan de
         document, capture d'inventaire. On peint donc un fond blanc avant
         de dessiner l'image. */
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(resolve, "image/jpeg", qualite);
    } catch (e) {
      resolve(null);
    }
  });
}

/* Renvoie { blob, ext } : le fichier prêt à l'envoi, et l'extension à forcer
   quand le format a changé (null = on garde celle du fichier d'origine). */
async function preparerPhoto(file) {
  const original = { blob: file, ext: null };
  if (!file) return original;

  const heic = estHeic(file);
  /* Un HEIC passe toujours par la conversion, même léger : le poids n'est pas
     le problème, c'est qu'aucun navigateur hors Safari ne l'affiche. */
  if (!heic) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return original;
    if (file.size < 400 * 1024) return original;
  }

  let img;
  try {
    img = await chargerImage(file);
  } catch (e) {
    if (!heic) return original;
    try {
      const heic2any = await chargerDecodeurHeic();
      const converti = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
      img = await chargerImage(Array.isArray(converti) ? converti[0] : converti);
    } catch (e2) {
      return original;
    }
  }

  /* Une photo de 40 Mo en 8000 px ne tient pas sous la cible du premier coup :
     on rétrécit et on baisse la qualité tant qu'il le faut, sans jamais
     descendre assez bas pour abîmer le rendu d'une pièce de collection. */
  let largeur = PHOTO_LARGEUR_MAX;
  let qualite = PHOTO_QUALITE;
  let blob = null;
  for (let essai = 0; essai < 4; essai++) {
    blob = await encoderJpeg(img, largeur, qualite);
    if (!blob || blob.size <= PHOTO_POIDS_CIBLE) break;
    qualite = Math.max(0.62, qualite - 0.08);
    largeur = Math.round(largeur * 0.8);
  }
  if (!blob) return original;
  // Réencoder un JPEG déjà optimisé peut l'alourdir : on garde alors l'original.
  if (!heic && blob.size >= file.size) return original;
  return { blob, ext: "jpg" };
}
window.preparerPhoto = preparerPhoto;

/* Version « fichier » : renvoie un File prêt à afficher en aperçu ET à
   envoyer, marqué pour ne pas être recompressé une seconde fois au moment de
   la publication (double compression = perte de qualité inutile). */
async function preparerFichierPhoto(file) {
  const { blob, ext } = await preparerPhoto(file);
  if (!ext) return file;
  const nom = String(file.name || "photo").replace(/\.[^.]+$/, "") + "." + ext;
  const pret = new File([blob], nom, { type: blob.type || "image/jpeg" });
  pret.__prepared = true;
  return pret;
}
window.preparerFichierPhoto = preparerFichierPhoto;

// Les photos déjà préparées à la sélection ne repassent pas par l'encodeur.
function photoPourEnvoi(file) {
  return file && file.__prepared ? Promise.resolve({ blob: file, ext: null }) : preparerPhoto(file);
}

/* ============== AUTH : inscription & connexion ============== */
const TRs = (key) => (window.TR ? window.TR(key) : key);

/* Supabase n'est chargé que lorsqu'il sert (voir supabaseClient.js) : sur un
   guide ou une page de contenu, un visiteur déconnecté ne télécharge jamais
   la bibliothèque. Toute fonction qui interroge la base passe par ici. */
function dejaConnecte() {
  return typeof window.sessionPossible === "function" ? window.sessionPossible() : true;
}

async function sbPret() {
  if (window.sb) return window.sb;
  if (typeof window.chargerSupabase === "function") return window.chargerSupabase();
  return null;
}
const ERRs = (e) => (window.messageErreur ? window.messageErreur(e) : TRs("err.generique"));

/* Même règle que la contrainte SQL profiles_pseudo_format : si les deux
   divergent, la base rejette une saisie que le formulaire avait acceptée. */
const PSEUDO_RE = /^[A-Za-z0-9_-]{3,20}$/;

/* Un pseudo est-il libre ? La vue public_profiles n'expose que les champs
   publics et se lit sans être connecté, donc la vérification marche aussi
   pendant l'inscription. exceptUserId sert au changement de pseudo : on ne
   doit pas se déclarer soi-même comme conflit.
   Le "_" est un caractère autorisé dans un pseudo mais joker dans LIKE :
   sans échappement, "jean_doe" entrerait en collision avec "jeanXdoe". */
async function isPseudoAvailable(pseudo, exceptUserId) {
  const pattern = pseudo.replace(/([\\%_])/g, "\\$1");
  const { data, error } = await (await sbPret())
    .from("public_profiles").select("id").ilike("pseudo", pattern).limit(1);
  // Souci réseau : on laisse passer, l'index unique en base reste le garde-fou.
  if (error || !data || !data.length) return true;
  return exceptUserId ? data[0].id === exceptUserId : false;
}

async function registerUser(email, password, newsletterOptIn, pseudo) {
  const { data, error } = await (await sbPret()).auth.signUp({
    email,
    password,
    // Ces métadonnées sont relues par des triggers à la création du profil :
    // opt-in strict pour la newsletter, et pseudo pour l'affichage public.
    options: { data: { newsletter_opt_in: newsletterOptIn === true, pseudo } },
  });
  if (error) throw error;
  return data;
}

async function loginUser(email, password) {
  const { data, error } = await (await sbPret()).auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/* ============== AUTH : mise à jour UI selon état connecté ============== */
/* Un visiteur sans jeton de session est déconnecté : inutile de charger
   Supabase pour l'apprendre. */
async function utilisateurCourant() {
  if (!window.sb && !dejaConnecte()) return null;
  const client = await sbPret();
  if (!client) return null;
  const { data: { user } } = await client.auth.getUser();
  return user;
}

async function updateAuthUI() {
  const user = await utilisateurCourant();
  window.__IS_LOGGED_IN = !!user;
  // Une fois l'état auth connu → refloute/dévoile les images sensibles déjà rendues
  document.dispatchEvent(new CustomEvent("auth:statechange", { detail: { loggedIn: !!user } }));
  const loginBtn = document.getElementById("loginBtn");
  if (!loginBtn) return;

  // Le bouton de déconnexion est maintenant dans le HTML, masqué par défaut :
  // on ne le recrée plus à chaque appel, on l'affiche et on branche son clic.
  const logoutBtn = document.getElementById("logoutBtn");

  // Icône messagerie du bandeau (statique dans le HTML) : accès réservé
  // aux membres connectés — sinon le clic ouvre la modale de connexion.
  updateHeaderMessages(user);

  if (user) {
    // Connecté → "Mon compte". Le libellé vient du HTML (span .lbl-auth-in),
    // affiché par la classe .btn-account : rien à réécrire ici.
    loginBtn.setAttribute("href", "/account");
    loginBtn.classList.remove("outline");
    loginBtn.classList.add("btn-account");
    loginBtn.dataset.loggedIn = "true";
    loginBtn.style.cursor = "";

    if (logoutBtn) {
      logoutBtn.hidden = false;
      logoutBtn.title = TRs("tr_js_script.logout_title") + " (" + user.email + ")";
      if (!logoutBtn.dataset.bound) {
        logoutBtn.dataset.bound = "1";
        logoutBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          await (await sbPret()).auth.signOut();
          window.location.reload();
        });
      }
    }
  } else {
    // Déconnecté → bouton standard. Couvre aussi le cas d'une session périmée
    // que le pré-rendu avait prise pour valide.
    loginBtn.dataset.loggedIn = "false";
    loginBtn.setAttribute("href", "#");
    loginBtn.classList.remove("btn-account");
    if (!loginBtn.classList.contains("outline")) loginBtn.classList.add("outline");
    if (logoutBtn) logoutBtn.hidden = true;
  }
}

/* ============== ICÔNE MESSAGERIE DU BANDEAU ==============
   Connecté   : lien direct vers la messagerie + badge des non-lus.
   Déconnecté : le clic ouvre la modale de connexion (jamais d'accès direct).
   La page messages.html applique de son côté le même contrôle. */
async function updateHeaderMessages(user) {
  const btn = document.getElementById("headerMsgBtn");
  if (!btn) return;
  const badge = document.getElementById("headerMsgBadge");

  if (!user) {
    btn.setAttribute("href", "#");
    btn.dataset.loggedIn = "false";
    if (badge) badge.style.display = "none";
    return;
  }

  btn.setAttribute("href", "/messages");
  btn.dataset.loggedIn = "true";

  // Badge : nombre de messages reçus non lus (masqué si aucun)
  try {
    const { count } = await (await sbPret())
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", user.id)
      .eq("read", false);
    if (badge) {
      if (count && count > 0) {
        badge.textContent = count > 9 ? "9+" : String(count);
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
  } catch (e) { /* le badge est un bonus : jamais bloquant */ }
}

function initHeaderMessagesButton() {
  const btn = document.getElementById("headerMsgBtn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    if (btn.dataset.loggedIn === "true") return; // navigation normale
    e.preventDefault();
    if (window.ouvrirModaleAuth) window.ouvrirModaleAuth();
  });
}

/* ============== MODALE AUTH ============== */
function initAuthModal() {
  const openBtn = document.getElementById("loginBtn");
  const modal = document.getElementById("authModal");
  if (!openBtn || !modal) return;

  const closeBtn = modal.querySelector(".close");
  const withEmail = document.getElementById("withEmail");
  const goLogin = document.getElementById("goLogin");
  const panelReg = document.getElementById("panel-register");
  const panelLog = document.getElementById("panel-login");
  const panelForgot = document.getElementById("panel-forgot");
  const goForgot = document.getElementById("goForgot");
  const backToLogin = document.getElementById("backToLogin");
  const btnForgot = document.getElementById("btnForgot");

  /* Un seul endroit décide de ce que montre la modale : le panneau visible ET
   * les liens qui mènent aux autres. Auparavant chaque gestionnaire bricolait
   * son affichage, et « Vous avez déjà un compte ? Se connecter » restait offert
   * alors que le panneau de connexion était déjà ouvert : le lien semblait
   * actif, on cliquait, rien ne bougeait. */
  /* 4 octobre 2026 : la fenêtre titrait « Inscrivez-vous et commencez… »
   * au-dessus du formulaire de connexion, et un lien « Inscrivez-vous » restait
   * planté au milieu. Désormais deux onglets (Se connecter / Créer un compte),
   * un seul formulaire visible, et un titre qui dit ce que fait ce formulaire.
   * Sans panneau demandé, c'est la connexion : le cas le plus fréquent. */
  const titre = document.getElementById("authTitle");
  const sousTitre = document.getElementById("authSub");
  const onglets = modal.querySelector(".auth-onglets");
  const TEXTES = {
    login:    ["auth.title_login", "auth.sub_login"],
    register: ["auth.title_register", "auth.sub_register"],
    forgot:   ["auth.title_forgot", "auth.sub_forgot"],
  };
  function montrerPanneau(visible) {
    if (!visible) visible = panelLog;
    for (const el of [panelReg, panelLog, panelForgot]) {
      if (el) el.style.display = el === visible ? "block" : "none";
    }
    const mode = visible === panelReg ? "register" : visible === panelForgot ? "forgot" : "login";
    if (goLogin) goLogin.setAttribute("aria-pressed", mode === "login" ? "true" : "false");
    if (withEmail) withEmail.setAttribute("aria-pressed", mode === "register" ? "true" : "false");
    // Le mot de passe oublié est un détour de la connexion : pas d'onglets.
    if (onglets) onglets.style.display = mode === "forgot" ? "none" : "";
    const [cleTitre, cleSous] = TEXTES[mode];
    if (titre) { titre.setAttribute("data-i18n", cleTitre); titre.textContent = TRs(cleTitre); }
    if (sousTitre) { sousTitre.setAttribute("data-i18n", cleSous); sousTitre.textContent = TRs(cleSous); }
    // L'élément qui avait le focus vient peut-être d'être masqué (« Retour à
    // la connexion ») : le focus revient dans la fenêtre au lieu de tomber
    // sur la page, d'où Échap et Tab ne répondaient plus.
    const actif = document.activeElement;
    if (modal.classList.contains("open") && (!actif || actif === document.body || actif.offsetParent === null)) {
      modal.querySelector(".modal-content")?.focus({ preventScroll: true });
    }
  }

  /* --- Accessibilité ------------------------------------------------------
   *
   * La modale se déclarait role="dialog" aria-modal="true" sans rien tenir de
   * ce que cela promet : le focus restait derrière, Échap ne fermait rien, et
   * la tabulation continuait de parcourir la page cachée. Pour qui navigue au
   * clavier, la modale n'existait pas comme modale.
   *
   * Trois choses suffisent : donner le focus à l'ouverture, le retenir, et le
   * rendre au retour. */
  let dernierFocus = null;

  function focusables() {
    return [...modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
  }

  /* La page derrière la modale ne doit plus bouger. `overflow: hidden` seul
   * ne suffit pas : Safari sur iPhone continue de faire défiler la page sous
   * le doigt. Figer le body en position: fixed est la seule méthode qui tient
   * partout ; on mémorise la position pour la rendre telle quelle à la
   * fermeture, sans l'animation de défilement doux du site. */
  let positionFigee = 0;

  function figerLaPage() {
    positionFigee = window.scrollY || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${positionFigee}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
  }

  function rendreLaPage() {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    window.scrollTo({ top: positionFigee, left: 0, behavior: "instant" });
  }

  function ouvrirModale(mode) {
    dernierFocus = document.activeElement;
    montrerPanneau(mode === "register" ? panelReg : panelLog);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    figerLaPage();
    /* Le focus va à la boîte de dialogue elle-même (tabindex="-1", sans
     * anneau) : le lecteur d'écran annonce son titre, la touche Tab mène au
     * premier onglet. Le poser sur le premier lien dessinait un rectangle
     * noir autour de « Inscrivez-vous » dès l'ouverture, et le poser sur un
     * champ ferait surgir le clavier du téléphone avant toute intention. */
    const boite = modal.querySelector(".modal-content");
    if (boite) boite.focus({ preventScroll: true });
  }

  function fermerModale() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    rendreLaPage();
    // Rendre le focus là où il était évite de renvoyer l'utilisateur en haut
    // de page sans repère.
    if (dernierFocus && document.contains(dernierFocus)) dernierFocus.focus();
    dernierFocus = null;
  }

  // Les autres pages (fiche article, compte, messages) et l'en-tête ouvrent
  // aussi cette modale. Chacune bricolait son ouverture en posant la classe à
  // la main, sans verrou de défilement ni gestion du focus. Un seul chemin
  // d'ouverture désormais, exposé globalement.
  window.ouvrirModaleAuth = ouvrirModale;
  window.fermerModaleAuth = fermerModale;

  // Échap ferme la fenêtre où que soit le focus.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) { e.preventDefault(); fermerModale(); }
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return;
    if (e.key !== "Tab") return;

    const cibles = focusables();
    if (!cibles.length) return;
    const premier = cibles[0], dernier = cibles[cibles.length - 1];

    // Sans ces deux lignes, la tabulation sort de la modale et parcourt la page
    // qui se trouve derrière, invisible et pourtant atteignable.
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
  });

  openBtn.addEventListener("click", (e) => {
    // Déjà connecté : on laisse le lien naviguer vers la page compte.
    if (openBtn.dataset.loggedIn === "true") return;
    e.preventDefault();
    ouvrirModale("login");
  });

  if (closeBtn) closeBtn.addEventListener("click", fermerModale);

  window.addEventListener("click", (e) => {
    if (e.target === modal) fermerModale();
  });

  if (withEmail && panelReg && panelLog) {
    withEmail.addEventListener("click", (e) => {
      e.preventDefault();
      montrerPanneau(panelReg);
    });
  }

  if (goLogin && panelReg && panelLog) {
    goLogin.addEventListener("click", (e) => {
      e.preventDefault();
      montrerPanneau(panelLog);
    });
  }

  /* --- Mot de passe oublié -------------------------------------------------
   *
   * Le parcours n'existait pas du tout : ni lien, ni appel, ni page. Un membre
   * qui perdait son mot de passe perdait son compte, ses annonces et son
   * historique d'achats, sans autre recours que d'écrire à l'assistance.
   *
   * Le message de confirmation est volontairement le même que l'adresse existe
   * ou non. Dire « ce compte n'existe pas » transformerait le formulaire en
   * outil pour savoir qui est inscrit sur le site.
   */

  if (goForgot && panelForgot) {
    goForgot.addEventListener("click", (e) => {
      e.preventDefault();
      const saisi = document.getElementById("logEmail")?.value?.trim();
      const champ = document.getElementById("forgotEmail");
      if (saisi && champ) champ.value = saisi;
      montrerPanneau(panelForgot);
      champ?.focus();
    });
  }

  if (backToLogin && panelLog) {
    backToLogin.addEventListener("click", (e) => {
      e.preventDefault();
      montrerPanneau(panelLog);
    });
  }

  if (btnForgot) {
    btnForgot.addEventListener("click", async () => {
      const email = document.getElementById("forgotEmail")?.value?.trim() || "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        (window.toastError || toast)(TRs("tr_js_script.forgot_bad_email"));
        return;
      }

      btnForgot.disabled = true;
      const libelle = btnForgot.textContent;
      btnForgot.textContent = TRs("tr_js_script.forgot_sending");

      const { error } = await (await sbPret()).auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + "/account?recovery=1",
      });

      // Même réponse dans les deux cas : voir le commentaire ci-dessus.
      if (error) console.warn("[reset]", error);
      (window.toastSuccess || toast)(TRs("tr_js_script.forgot_sent"));
      btnForgot.disabled = false;
      btnForgot.textContent = libelle;
      montrerPanneau(panelLog);
    });
  }

  // Boutons inscription / connexion
  const btnRegister = document.getElementById("btnRegister");
  const btnLogin = document.getElementById("btnLogin");

  if (btnRegister) {
    btnRegister.addEventListener("click", async () => {
      const pseudo = document.getElementById("regPseudo")?.value.trim();
      const email = document.getElementById("regEmail")?.value.trim();
      const pass = document.getElementById("regPass")?.value;
      const pass2 = document.getElementById("regPass2")?.value;

      if (!pseudo || !email || !pass || !pass2) { toast(TRs("tr_js_script.fill_all")); return; }
      if (!PSEUDO_RE.test(pseudo)) { toast(TRs("tr_js_script.pseudo_format")); return; }
      if (pass.length < 6) { toast(TRs("tr_js_script.password_min")); return; }
      if (pass !== pass2) { toast(TRs("tr_js_script.password_mismatch")); return; }
      if (!(await isPseudoAvailable(pseudo))) { toast(TRs("tr_js_script.pseudo_taken")); return; }

      const newsletterOptIn = document.getElementById("regNewsletter")?.checked === true;

      try {
        await registerUser(email, pass, newsletterOptIn, pseudo);
        toastSuccess(TRs("tr_js_script.account_created"));
        fermerModale();
        updateAuthUI();
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        toastError(ERRs(err));
      }
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      const email = document.getElementById("logEmail")?.value.trim();
      const pass = document.getElementById("logPass")?.value;

      if (!email || !pass) { toast(TRs("tr_js_script.fill_all")); return; }

      try {
        await loginUser(email, pass);
        toastSuccess(TRs("tr_js_script.login_success"));
        fermerModale();
        updateAuthUI();
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        toastError(ERRs(err));
      }
    });
  }
}

/* ============== FORMULAIRE DE VENTE → Supabase ============== */
const SELL_DRAFT_KEY = "athena_pending_sale";

// Demande la traduction EN de l'annonce (DeepL, côté serveur).
// keepalive : la requête survit à la redirection qui suit la publication.
async function requestListingTranslation(productId) {
  try {
    const { data: { session } } = await (await sbPret()).auth.getSession();
    if (!session) return;
    fetch("https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/translate-listing", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + session.access_token,
      },
      body: JSON.stringify({ productId }),
    }).catch(() => {});
  } catch (e) { /* la traduction est un bonus : jamais bloquant */ }
}

// Prévient l'administrateur qu'une annonce vient d'être publiée (e-mail).
async function requestListingNotify(productId) {
  try {
    const { data: { session } } = await (await sbPret()).auth.getSession();
    if (!session) return;
    fetch("https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/listing-notify", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + session.access_token,
      },
      body: JSON.stringify({ productId }),
    }).catch(() => {});
  } catch (e) { /* notification : jamais bloquant */ }
}

/* Brouillon de vente, photos comprises.
   L'inscription et la connexion rechargent la page : les photos, gardées en
   mémoire seulement, étaient perdues à ce moment précis, celui où le vendeur
   allait publier. Le texte revenait (sessionStorage), pas les photos. Et un
   passage par un autre onglet perdait tout, sessionStorage ne vivant que
   dans l'onglet. Les photos vont donc dans IndexedDB, le texte aussi dans
   localStorage, les deux pour trois jours au plus. */
const BROUILLON_DUREE = 3 * 86400000;

function brouillonBase() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open("athena_brouillon", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function brouillonPhotos(action, fichiers) {
  try {
    const db = await brouillonBase();
    const res = await new Promise((ok, ko) => {
      const tx = db.transaction("photos", action === "lire" ? "readonly" : "readwrite");
      const st = tx.objectStore("photos");
      const q = action === "lire" ? st.get("vente")
        : action === "effacer" ? st.delete("vente")
        : st.put({ date: Date.now(), fichiers: fichiers.map((f) => ({ nom: f.name, type: f.type, blob: f })) }, "vente");
      q.onsuccess = () => ok(q.result);
      q.onerror = () => ko(q.error);
    });
    db.close();
    if (action !== "lire") return [];
    if (!res || Date.now() - res.date > BROUILLON_DUREE) return [];
    return res.fichiers.map((x) => new File([x.blob], x.nom || "photo.jpg", { type: x.type || "image/jpeg" }));
  } catch (e) {
    return [];   // navigation privée ou stockage refusé : on perd les photos, pas la fiche
  }
}

function oublierBrouillonVente() {
  try { sessionStorage.removeItem(SELL_DRAFT_KEY); } catch (e) {}
  try { localStorage.removeItem(SELL_DRAFT_KEY); } catch (e) {}
  brouillonPhotos("effacer");
}

function saveSellFormToSession() {
  const form = document.getElementById("sell-form");
  if (!form) return;
  const data = {
    title: document.getElementById("title")?.value || "",
    description: document.getElementById("description")?.value || "",
    period: document.getElementById("period")?.value || "",
    subcategory: document.getElementById("subcategory")?.value || "",
    condition: document.getElementById("condition")?.value || "",
    quantity: document.getElementById("quantity")?.value || "",
    price: document.getElementById("price")?.value || "",
    location: document.getElementById("location")?.value || "",
    ship_pickup: form.ship_pickup?.checked || false,
    ship_post: form.ship_post?.checked || false,
    ship_relay: form.ship_relay?.checked || false,
    historically_sensitive: document.getElementById("historicallySensitive")?.checked || false,
  };
  try { sessionStorage.setItem(SELL_DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
  try { localStorage.setItem(SELL_DRAFT_KEY, JSON.stringify({ ...data, date: Date.now() })); } catch (e) {}
}

function restoreSellFormFromSession() {
  let data;
  try {
    const raw = sessionStorage.getItem(SELL_DRAFT_KEY);
    if (raw) {
      data = JSON.parse(raw);
    } else {
      const local = JSON.parse(localStorage.getItem(SELL_DRAFT_KEY) || "null");
      if (!local || Date.now() - (local.date || 0) > BROUILLON_DUREE) return false;
      data = local;
    }
  } catch (e) { return false; }
  if (!data) return false;

  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== null && v !== undefined) el.value = v; };
  setVal("title", data.title);
  setVal("description", data.description);
  setVal("period", data.period);
  setVal("subcategory", data.subcategory);
  setVal("condition", data.condition);
  setVal("quantity", data.quantity);
  setVal("price", data.price);
  setVal("location", data.location);

  const form = document.getElementById("sell-form");
  if (form) {
    if (form.ship_pickup) form.ship_pickup.checked = !!data.ship_pickup;
    if (form.ship_post) form.ship_post.checked = !!data.ship_post;
    if (form.ship_relay) form.ship_relay.checked = !!data.ship_relay;
  }
  const sensCb = document.getElementById("historicallySensitive");
  if (sensCb) sensCb.checked = !!data.historically_sensitive;
  return true;
}

function openSellGateModal() {
  const m = document.getElementById("sellGateModal");
  if (!m) return;
  m.classList.add("open");
  m.setAttribute("aria-hidden", "false");
}
function closeSellGateModal() {
  const m = document.getElementById("sellGateModal");
  if (!m) return;
  m.classList.remove("open");
  m.setAttribute("aria-hidden", "true");
}

async function initSellForm() {
  const form = document.getElementById("sell-form");
  if (!form) return;

  // 1. Vérifier si l'utilisateur est bloqué (le formulaire reste accessible aux invités)
  const blocked = document.getElementById("sell-blocked");
  const content = document.getElementById("sell-content");

  try {
    const { data: { user } } = await (await sbPret()).auth.getUser();
    if (user) {
      const { data: profile } = await (await sbPret())
        .from("profiles")
        .select("blocked")
        .eq("id", user.id)
        .maybeSingle();
      if (profile && profile.blocked === true) {
        if (blocked) blocked.style.display = "block";
        if (content) content.style.display = "none";
        return; // on n'attache rien pour un compte bloqué
      }
      // Utilisateur connecté & non bloqué : restaurer un éventuel brouillon.
      // Les photos suivent plus bas, une fois l'aperçu branché.
      if (restoreSellFormFromSession()) {
        window.__brouillonARestaurer = true;
        try { sessionStorage.removeItem(SELL_DRAFT_KEY); } catch (e) {}
        try { localStorage.removeItem(SELL_DRAFT_KEY); } catch (e) {}
      }
    }
  } catch (e) { /* profile table optionnelle */ }

  // 2. Brancher la modale gate (boutons)
  const gateLoginBtn = document.getElementById("sellGateLoginBtn");
  const gateCloseBtn = document.getElementById("sellGateClose");
  const gateModal = document.getElementById("sellGateModal");
  if (gateLoginBtn) {
    gateLoginBtn.addEventListener("click", () => {
      closeSellGateModal();
      if (window.ouvrirModaleAuth) window.ouvrirModaleAuth();
    });
  }
  if (gateCloseBtn) gateCloseBtn.addEventListener("click", closeSellGateModal);
  if (gateModal) {
    gateModal.addEventListener("click", (e) => { if (e.target === gateModal) closeSellGateModal(); });
  }

  // ============== Aperçu des photos (multi + cumul + suppression) ==============
  const MAX_PHOTOS = 6;
  // État interne : les fichiers sélectionnés (au-delà de input.files qui est écrasé à chaque clic)
  window.__sellPhotos = [];
  // Vrai pendant la conversion/compression : la publication doit attendre.
  window.__sellPhotosBusy = false;

  const inputPhotos = document.getElementById("photos");
  const preview = document.getElementById("preview");

  function renderPhotosPreview() {
    if (!preview) return;
    preview.innerHTML = "";
    window.__sellPhotos.forEach((file, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "photo-thumb" + (idx === 0 ? " is-main" : "");

      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(img.src);
      wrap.appendChild(img);

      if (idx === 0) {
        const badge = document.createElement("span");
        badge.className = "photo-thumb-badge";
        badge.textContent = TRs("tr_js_script.main_photo_badge");
        wrap.appendChild(badge);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "photo-thumb-remove";
      btn.setAttribute("aria-label", TRs("tr_js_script.remove_photo"));
      btn.innerHTML = "&times;";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        window.__sellPhotos.splice(idx, 1);
        renderPhotosPreview();
      });
      wrap.appendChild(btn);

      preview.appendChild(wrap);
    });
    // Compteur
    const dropHint = document.querySelector(".photo-dropzone-hint");
    if (dropHint) {
      const count = window.__sellPhotos.length;
      if (window.__sellPhotosBusy) {
        dropHint.textContent = TRs("tr_js_script.photos_processing");
      } else if (count > 0) {
        dropHint.textContent = `${count}/${MAX_PHOTOS} ${TRs("tr_js_script.photos_count_suffix")}`;
      } else {
        dropHint.textContent = TRs("sell.card1_dropzone_hint");
      }
    }
  }

  if (inputPhotos && preview) {
    inputPhotos.addEventListener("change", async () => {
      /* Un lot déjà en cours interdit d'en démarrer un second. La zone reste
         cliquable pendant la conversion, et deux gestionnaires concurrents
         faisaient deux dégâts distincts : chacun calculait « restant » avant
         que l'autre n'ait rempli le tableau, ce qui laissait dépasser les
         6 photos ; et le lot le plus rapide remettait le drapeau à faux
         pendant que l'autre travaillait encore, si bien qu'une publication
         lancée à cet instant partait sans la photo en cours de conversion,
         sans le moindre message. */
      if (window.__sellPhotosBusy) {
        toastWarn(TRs("tr_js_script.photos_processing"));
        inputPhotos.value = "";
        return;
      }

      const newFiles = Array.from(inputPhotos.files);
      // Reset immédiat pour permettre la re-sélection du même fichier
      inputPhotos.value = "";

      const restant = MAX_PHOTOS - window.__sellPhotos.length;
      if (restant <= 0) {
        toastWarn(`${TRs("tr_js_script.max_photos_prefix")} ${MAX_PHOTOS} ${TRs("tr_js_script.max_photos_suffix")}`);
        return;
      }

      const valid = [];
      for (const f of newFiles) {
        if (!estFichierImage(f)) continue;
        /* Le seuil n'est plus une limite de publication mais un garde-fou :
           en dessous, la compression s'occupe du poids ; au-dessus, le
           navigateur échoue au décodage et mieux vaut le dire tout de suite. */
        if (f.size > PHOTO_SOURCE_MAX_MO * 1024 * 1024) {
          toastWarn(`${f.name} ${TRs("tr_js_script.file_too_big_mid")} ${PHOTO_SOURCE_MAX_MO} ${TRs("tr_js_script.file_too_big_end")}`);
          continue;
        }
        valid.push(f);
      }
      if (valid.length > restant) {
        toastWarn(`${TRs("tr_js_script.max_photos_prefix")} ${MAX_PHOTOS} ${TRs("tr_js_script.max_photos_suffix")}`);
      }
      const lot = valid.slice(0, restant);
      if (lot.length === 0) return;

      /* Conversion HEIC et compression : quelques secondes sur un gros
         fichier. On l'annonce, et on ajoute les vignettes au fur et à mesure
         plutôt que de laisser la zone vide jusqu'au bout. */
      window.__sellPhotosBusy = true;
      renderPhotosPreview();
      try {
        for (const f of lot) {
          let pret;
          try {
            pret = await preparerFichierPhoto(f);
          } catch (e) {
            pret = f;   // la préparation a échoué : on envoie l'original
          }
          window.__sellPhotos.push(pret);
          renderPhotosPreview();
        }
      } finally {
        window.__sellPhotosBusy = false;
        renderPhotosPreview();
      }
    });
  }

  if (window.__brouillonARestaurer) {
    window.__brouillonARestaurer = false;
    const photos = await brouillonPhotos("lire");
    if (photos.length) {
      window.__sellPhotos = photos.slice(0, MAX_PHOTOS);
      renderPhotosPreview();
    }
    brouillonPhotos("effacer");
    toastSuccess(TRs("tr_js_script.draft_restored"));
    // Le vendeur revient pour publier : on l'amène au bouton.
    form.querySelector(".btn-sell-primary")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  // L'indication « pas encore de compte ? » ne s'adresse qu'aux visiteurs.
  const indicationCompte = document.getElementById("sell-account-hint");
  if (indicationCompte && document.getElementById("loginBtn")?.dataset.loggedIn === "true") indicationCompte.hidden = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const price = document.getElementById("price");
    const terms = document.getElementById("terms");

    // Publier maintenant enverrait une annonce amputée des photos en cours de
    // conversion : on attend la fin plutôt que de les perdre en silence.
    if (window.__sellPhotosBusy) {
      toast(TRs("tr_js_script.photos_processing"));
      return;
    }

    // Au moins une photo est obligatoire pour publier une annonce
    const sellPhotos = window.__sellPhotos || [];
    if (sellPhotos.length === 0) {
      toast(TRs("tr_js_script.photo_required"));
      const dropzone = document.querySelector(".photo-dropzone");
      if (dropzone) dropzone.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      return;
    }

    if (price && (!price.value.trim() || +price.value <= 0 || isNaN(+price.value))) {
      toast(TRs("tr_js_script.valid_price"));
      price.focus();
      return;
    }
    if (terms && !terms.checked) {
      toast(TRs("tr_js_script.accept_rules"));
      return;
    }
    // Sans aucun mode de remise, l'annonce serait publiée mais impossible à
    // acheter en ligne : on le dit avant l'envoi.
    if (!form.ship_pickup?.checked && !form.ship_post?.checked && !form.ship_relay?.checked) {
      toast(TRs("tr_js_script.ship_required"));
      form.ship_pickup?.focus();
      return;
    }

    // Vérifier que l'utilisateur est connecté
    const { data: userData } = await (await sbPret()).auth.getUser();
    const user = userData?.user;

    if (!user) {
      // Sauvegarder la fiche et ses photos, ouvrir la modale d'engagement
      saveSellFormToSession();
      await brouillonPhotos("sauver", window.__sellPhotos || []);
      openSellGateModal();
      return;
    }

    // Vérifier que le compte n'est pas suspendu
    try {
      const { data: profile } = await (await sbPret())
        .from("profiles")
        .select("blocked")
        .eq("id", user.id)
        .maybeSingle();
      if (profile && profile.blocked === true) {
        toastError(TRs("tr_js_script.account_suspended_publish"));
        return;
      }
    } catch (e) { /* table optionnelle */ }

    // Upload des photos vers Supabase Storage (multi)
    const photos = window.__sellPhotos || [];
    const uploadedUrls = [];
    if (photos.length > 0) {
      const submitBtn = form.querySelector(".btn-sell-primary");
      if (submitBtn) submitBtn.disabled = true;
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        // Réduction avant envoi : voir preparerPhoto plus haut.
        const { blob, ext: extForce } = await photoPourEnvoi(file);
        const ext = extForce || (file.name.split(".").pop() || "jpg").toLowerCase();
        const rand = Math.random().toString(36).slice(2, 8);
        const filePath = user.id + "/" + Date.now() + "_" + i + "_" + rand + "." + ext;
        const { error: uploadError } = await (await sbPret()).storage
          .from("product-images")
          .upload(filePath, blob, { contentType: blob.type || file.type });
        if (uploadError) {
          if (submitBtn) submitBtn.disabled = false;
          toastError(`${TRs("tr_js_script.upload_error_prefix")} ${i + 1} : ` + uploadError.message);
          return;
        }
        const { data: urlData } = (await sbPret()).storage
          .from("product-images")
          .getPublicUrl(filePath);
        uploadedUrls.push(urlData.publicUrl);
      }
      if (submitBtn) submitBtn.disabled = false;
    }

    const payload = {
      user_id: user.id,
      title: document.getElementById("title").value,
      period: document.getElementById("period").value,
      subcategory: document.getElementById("subcategory").value,
      condition: document.getElementById("condition").value,
      description: document.getElementById("description").value,
      price: Number(document.getElementById("price").value),
      quantity: Number(document.getElementById("quantity").value),
      location: document.getElementById("location").value,
      image_url: uploadedUrls[0] || null,
      image_urls: uploadedUrls,
      ship_pickup: form.ship_pickup.checked,
      ship_post: form.ship_post.checked,
      ship_relay: form.ship_relay.checked,
      historically_sensitive: document.getElementById("historicallySensitive")?.checked || false,
      status: "published",
    };

    const { data: inserted, error } = await (await sbPret()).from("products").insert([payload]).select("id").single();

    if (error) {
      toastError(ERRs(error));
    } else {
      // Traduction EN automatique de l'annonce (arrière-plan, n'attend pas)
      if (inserted?.id) requestListingTranslation(inserted.id);
      // Notification e-mail à l'administrateur
      if (inserted?.id) requestListingNotify(inserted.id);
      oublierBrouillonVente();
      /* Le vendeur voit sa pièce en ligne, à son adresse définitive : c'est
         ce qui rassure, et ce qu'il a envie de partager. Le message suit la
         navigation (voir annoncerPublication). */
      try { sessionStorage.setItem("athena_annonce_publiee", "1"); } catch (e) {}
      window.location.href = (inserted?.id && window.TAXONOMIE && TAXONOMIE.urlFiche)
        ? TAXONOMIE.urlFiche(inserted.id, payload.title, "fr")
        : "/militaria";
    }
  });

  // Bouton brouillon
  const draftBtn = document.getElementById("draftBtn");
  if (draftBtn) {
    draftBtn.addEventListener("click", async () => {
      if (window.__sellPhotosBusy) {
        toast(TRs("tr_js_script.photos_processing"));
        return;
      }
      const { data: userData } = await (await sbPret()).auth.getUser();
      const user = userData?.user;
      if (!user) {
        saveSellFormToSession();
        openSellGateModal();
        return;
      }

      // Bloquer si compte suspendu
      try {
        const { data: profile } = await (await sbPret())
          .from("profiles")
          .select("blocked")
          .eq("id", user.id)
          .maybeSingle();
        if (profile && profile.blocked === true) {
          (window.toastError || toast)(TRs("tr_js_script.account_suspended"));
          return;
        }
      } catch (e) { /* optionnel */ }

      // Upload photos si présentes (multi)
      const photos = window.__sellPhotos || [];
      const uploadedUrls = [];
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        // Réduction avant envoi : voir preparerPhoto plus haut.
        const { blob, ext: extForce } = await photoPourEnvoi(file);
        const ext = extForce || (file.name.split(".").pop() || "jpg").toLowerCase();
        const rand = Math.random().toString(36).slice(2, 8);
        const filePath = user.id + "/" + Date.now() + "_" + i + "_" + rand + "." + ext;
        const { error: uploadError } = await (await sbPret()).storage
          .from("product-images")
          .upload(filePath, blob, { contentType: blob.type || file.type });
        if (!uploadError) {
          const { data: urlData } = (await sbPret()).storage
            .from("product-images")
            .getPublicUrl(filePath);
          uploadedUrls.push(urlData.publicUrl);
        }
      }

      const payload = {
        user_id: user.id,
        title: document.getElementById("title").value || "Brouillon",
        period: document.getElementById("period").value,
        subcategory: document.getElementById("subcategory").value,
        condition: document.getElementById("condition").value,
        description: document.getElementById("description").value,
        price: Number(document.getElementById("price").value) || 0,
        quantity: Number(document.getElementById("quantity").value) || 1,
        location: document.getElementById("location").value,
        image_url: uploadedUrls[0] || null,
        image_urls: uploadedUrls,
        ship_pickup: form.ship_pickup?.checked || false,
        ship_post: form.ship_post?.checked || false,
        ship_relay: form.ship_relay?.checked || false,
        historically_sensitive: document.getElementById("historicallySensitive")?.checked || false,
        status: "draft",
      };

      const { error } = await (await sbPret()).from("products").insert([payload]);
      if (error) {
        toastError(ERRs(error));
      } else {
        toastSuccess(TRs("tr_js_script.draft_saved"));
      }
    });
  }
}

/* ============== CHARGEMENT ARTICLES DEPUIS SUPABASE ============== */

// Génère le HTML d'une carte article
function renderProductCard(product) {
  // En mode EN, affiche la traduction automatique du titre si disponible
  const cardTitle = (window.I18N && window.I18N.current === "en" && product.title_en)
    ? product.title_en
    : product.title;

  const vendue = product.status === "sold";
  const card = document.createElement("a");
  card.className = "item-card" + (vendue ? " is-sold" : "");
  // Une page anglaise renvoie vers des fiches anglaises (voir category.php).
  // L'adresse porte le titre français : elle se lit dans un lien partagé, et
  // reste la même dans les deux langues (taxonomie.js, inc/athena.php).
  {
    const langue = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "fr";
    card.href = window.TAXONOMIE
      ? window.TAXONOMIE.urlFiche(product.id, product.title || "", langue)
      : "/annonce/annonce-" + encodeURIComponent(product.id) + (langue === "en" ? "?lang=en" : "");
  }

  // Image (avec flou + overlay si article sensible et utilisateur non connecté)
  const imgWrap = document.createElement("div");
  imgWrap.className = "item-card-img";

  const img = document.createElement("img");
  img.src = imgUrl(product.image_url, 400) || "/hero.png";
  img.alt = "";  // le titre est déjà lu dans le h3 de la carte
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = function () { this.onerror = null; this.src = "/hero.png"; };
  imgWrap.appendChild(img);

  // Archive des ventes : même bandeau que la fiche (am_carte côté serveur).
  if (vendue) {
    const bandeau = document.createElement("div");
    bandeau.className = "sold-overlay";
    bandeau.textContent = TRs("tr_js_product.sold_overlay");
    imgWrap.appendChild(bandeau);
  }

  if (product.historically_sensitive && !window.__IS_LOGGED_IN) {
    imgWrap.classList.add("is-blurred");
    const overlay = document.createElement("div");
    overlay.className = "sensitive-overlay";
    // Même balisage que am_carte (inc/athena.php) : le cadenas et le texte
    // dans une seule étiquette ; data-i18n sur le texte seul, pour qu'une
    // traduction n'efface pas l'icône.
    overlay.innerHTML = `<span class="sensitive-pastille"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span data-i18n="product.sensitive_overlay">${TRs("tr_js_script.sensitive_overlay")}</span></span>`;
    imgWrap.appendChild(overlay);
  }
  card.appendChild(imgWrap);

  const h3 = document.createElement("h3");
  h3.textContent = cardTitle;
  card.appendChild(h3);

  const p = document.createElement("p");
  p.className = "price";
  // Le même format que la fiche (am_prix côté serveur) : « 1 200 € », « 12,5 € ».
  p.textContent = window.formatPrice ? window.formatPrice(product.price) : product.price + " €";
  card.appendChild(p);

  // Avis d'authenticité de la modération (am_carte écrit le même balisage).
  if (product.authenticated_at) {
    const avis = document.createElement("p");
    avis.className = "item-card-auth";
    avis.innerHTML = '<svg class="sceau" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 19.5 5.6v5.6c0 4.5-3.1 8.4-7.5 10-4.4-1.6-7.5-5.5-7.5-10V5.6z"/><path d="m8.7 12.1 2.3 2.3 4.4-4.6"/></svg>';
    const libelle = document.createElement("span");
    libelle.textContent = TRs("tr_js_script.card_auth");
    avis.appendChild(libelle);
    card.appendChild(avis);
  }

  if (vendue && product.sold_at) {
    const d = document.createElement("p");
    d.className = "item-card-vendu";
    const lang = (window.I18N && window.I18N.current) === "en" ? "en-GB" : "fr-FR";
    const date = new Date(product.sold_at).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
    d.textContent = TRs("archive.sold_on").replace("{date}", date);
    card.appendChild(d);
  }

  return card;
}

// Page d'accueil : derniers articles
async function loadLatestProducts() {
  const grid = document.getElementById("latest-grid");
  if (!grid) return;
  /* Annonces déjà écrites par page.php. Pour un visiteur déconnecté, les
     redemander donnerait exactement la même grille : on garde celle du
     serveur, et la page n'a plus besoin de Supabase. */
  if (grid.querySelector(".item-card") && !window.sb && !dejaConnecte()) return;

  if (typeof window.__IS_LOGGED_IN === "undefined") {
    window.__IS_LOGGED_IN = !!(await utilisateurCourant());
  }

  const { data, error } = await (await sbPret())
    .from("products")
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(32);

  if (error) {
    grid.innerHTML = "<p>" + TRs("tr_js_script.load_error") + "</p>";
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = "<p>" + TRs("tr_js_script.no_items_yet") + "</p>";
    return;
  }

  grid.innerHTML = "";
  data.forEach((product) => grid.appendChild(renderProductCard(product)));
  majBoutonDerniers();
  majRayonDerniers();
}

/* Accueil sur grand écran : au-delà de huit annonces, la grille devient un
   rayon de deux rangées qui défile de côté (le CSS s'en charge seul, par
   :has()). Ce script ne fait que montrer les flèches quand il y a de quoi
   défiler, et avancer d'une page à chaque clic. Le défilement au doigt, au
   pavé tactile et au clavier (Tab sur les cartes) marche sans lui. */
function majRayonDerniers() {
  const grid = document.getElementById("latest-grid");
  const prec = document.getElementById("latest-prec");
  const suiv = document.getElementById("latest-suiv");
  if (!grid || !prec || !suiv) return;
  const max = grid.scrollWidth - grid.clientWidth;
  const rayon = max > 4 && getComputedStyle(grid).overflowX !== "visible";
  prec.hidden = !rayon || grid.scrollLeft <= 4;
  suiv.hidden = !rayon || grid.scrollLeft >= max - 4;
}
function initRayonDerniers() {
  const grid = document.getElementById("latest-grid");
  const prec = document.getElementById("latest-prec");
  const suiv = document.getElementById("latest-suiv");
  if (!grid || !prec || !suiv) return;
  const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const avancer = (sens) => {
    // Une page = la largeur visible plus l'écart entre deux colonnes.
    const ecart = parseFloat(getComputedStyle(grid).columnGap) || 0;
    grid.scrollBy({ left: sens * (grid.clientWidth + ecart), behavior: doux ? "smooth" : "auto" });
  };
  prec.addEventListener("click", () => avancer(-1));
  suiv.addEventListener("click", () => avancer(1));
  let attente = 0;
  grid.addEventListener("scroll", () => {
    cancelAnimationFrame(attente);
    attente = requestAnimationFrame(majRayonDerniers);
  }, { passive: true });
  window.addEventListener("resize", majRayonDerniers);
  majRayonDerniers();
}
document.addEventListener("DOMContentLoaded", initRayonDerniers);

/* Mesure d'audience sans cookie (mesure.php) : une page vue, sa langue et
   le nom du site d'où l'on arrive, rien d'autre. Ni cookie, ni stockage, ni
   identifiant : il n'y a donc pas de bandeau de consentement. Les signaux
   « ne pas me suivre » du navigateur sont respectés, les espaces privés ne
   sont pas comptés, et un administrateur peut exclure son propre appareil
   depuis le tableau de bord (seule clé lue ici, qu'il pose lui-même). */
(function compterVue() {
  try {
    if (navigator.globalPrivacyControl || navigator.doNotTrack === "1") return;
    if (!/^(www\.)?athenamilitaria\.fr$/.test(location.hostname)) return;
    if (/^\/(account|admin|messages|order)(\/|\.html|$)/.test(location.pathname)) return;
    try { if (localStorage.getItem("athena_sans_mesure") === "1") return; } catch (e) {}
    let r = "";
    try { r = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
    const l = (new URLSearchParams(location.search).get("lang") || document.documentElement.lang || "fr").slice(0, 2);
    const corps = JSON.stringify({ p: location.pathname, l, r });
    if (navigator.sendBeacon) navigator.sendBeacon("/mesure.php", new Blob([corps], { type: "application/json" }));
    else fetch("/mesure.php", { method: "POST", body: corps, keepalive: true, headers: { "Content-Type": "application/json" } });
  } catch (e) { /* la mesure ne doit jamais gêner la page */ }
})();

/* Hauteur réelle du bandeau collé, pour que les ancres (sommaires, lien
   d'évitement, « Réduire » de la fiche) n'amènent pas leur cible dessous :
   style.css s'en sert dans html { scroll-padding-top }. Elle varie de 72 à
   120 px selon la largeur et le nombre d'icônes affichées. */
(function suivreBandeau() {
  const poser = () => {
    const b = document.getElementById("top-banner");
    if (b) document.documentElement.style.setProperty("--bandeau-h", Math.round(b.getBoundingClientRect().height) + "px");
  };
  const lancer = () => {
    poser();
    const b = document.getElementById("top-banner");
    if (b && "ResizeObserver" in window) new ResizeObserver(poser).observe(b);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", lancer);
  else lancer();
})();

/* Accueil sur téléphone : la grille des dernières annonces en montre six,
   un bouton déplie les suivantes (le CSS masque les cartes au-delà de la
   sixième tant que la grille ne porte pas is-deployee). Sur grand écran,
   tout est visible et le bouton reste caché. */
function majBoutonDerniers() {
  const grid = document.getElementById("latest-grid");
  const enveloppe = document.getElementById("latest-more-wrap");
  const boutique = document.getElementById("latest-boutique-wrap");
  if (!grid || !enveloppe || !boutique) return;
  const petit = window.matchMedia("(max-width: 768px)").matches;
  const cartes = grid.querySelectorAll(".item-card").length;
  const deplie = grid.classList.contains("is-deployee");
  /* Un seul dépliage, de six annonces au plus : la grille n'en charge que
     douze. Au-delà, c'est la boutique, et c'est voulu : l'accueil donne
     envie, le catalogue vend. */
  const reste = petit && !deplie ? Math.min(Math.max(cartes - 6, 0), 6) : 0;
  enveloppe.hidden = reste === 0;
  boutique.hidden = !(cartes > 0 && reste === 0);
  /* Le libellé reste « Voir les autres annonces », sans nombre : demande
     de l'exploitant du 4 octobre 2026 (« Voir les 2 autres annonces »
     soulignait le peu d'annonces). Il est écrit dans index.html et traduit
     par la clé home.latest_more_all. */
}
document.addEventListener("DOMContentLoaded", () => {
  const bouton = document.getElementById("latest-more");
  if (!bouton) return;
  bouton.addEventListener("click", () => {
    document.getElementById("latest-grid").classList.add("is-deployee");
    majBoutonDerniers();
  });
  window.addEventListener("resize", majBoutonDerniers);
  majBoutonDerniers();
});

/* ============== SEO DES PAGES CATALOGUE ==============
   Chaque page catalogue (/militaria/<période>/<type>) a son titre, sa
   description, sa canonique, ses hreflang et son fil d'Ariane, tous écrits
   par category.php dans le HTML servi. */

/* Libellés traduits d'une période ou d'un type, depuis la valeur en base
   (clés cat.* de i18n.js, table dans taxonomie.js). Utilisés par la fiche
   (fil d'Ariane, caractéristiques) ; am_libelle_periode et am_libelle_sous
   (inc/athena.php) font le même calcul côté serveur. */
const libelleDepuisTable = (valeur, cles, repli) => {
  const cle = cles && cles[valeur];
  const texte = cle && window.I18N ? window.I18N.t(cle) : "";
  return texte && texte !== cle ? texte.replace(/<[^>]+>/g, "") : ((repli && repli[valeur]) || String(valeur || ""));
};
// La fiche article affiche ses pièces voisines avec cette même carte.
window.renderProductCard = renderProductCard;

window.libellePeriode = (valeur) => {
  const T = window.TAXONOMIE || {};
  return valeur ? libelleDepuisTable(valeur, T.CLES_PERIODES, T.LIBELLES_PERIODES) : "";
};
window.libelleSous = (valeur) => valeur ? libelleDepuisTable(valeur, (window.TAXONOMIE || {}).CLES_TYPES) : "";

function applyCategorySeo(q) {
  if (!document.getElementById("category-grid")) return;
  /* Page écrite par category.php : titre, description, canonique, hreflang,
     robots, données structurées et fil d'Ariane visible sont déjà dans le
     HTML servi : rien à compléter ici, et tout ajout créerait un doublon. */
  if (document.documentElement.dataset.ssr === "1") return;
  // Repli sans rendu serveur : une recherche interne reste hors index.
  if (q) {
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    robots.setAttribute("content", "noindex, follow");
  }
}

// Page catégories : articles filtrés
async function loadCategoryProducts(filters) {
  const grid = document.getElementById("category-grid");
  if (!grid) return;
  /* Grille écrite par category.php : tant que le visiteur ne trie ni ne
     filtre, et qu'il n'est pas connecté, elle est déjà la bonne. */
  if (!filters && (grid.querySelector(".item-card") || grid.querySelector(".categorie-vide")) && !window.sb && !dejaConnecte()) {
    applyCategorySeo(new URLSearchParams(location.search).get("q"));
    return;
  }

  if (typeof window.__IS_LOGGED_IN === "undefined") {
    window.__IS_LOGGED_IN = !!(await utilisateurCourant());
  }

  /* Période et type : valeurs en base écrites par category.php sur la
     grille. Repli sur l'adresse (/militaria/<période>/<type>). */
  const T = window.TAXONOMIE;
  const segments = location.pathname.split("/").filter(Boolean);
  const cat = grid.dataset.periode ?? (T && segments[0] === "militaria" && segments[1] ? T.periodeDepuisSegment(segments[1]) : "");
  const sub = grid.dataset.type ?? (T && segments[0] === "militaria" && segments[2] ? T.typeDepuisSegment(segments[2]) : "");
  const q = new URLSearchParams(location.search).get("q");
  // Archive des ventes (/ventes) : pièces vendues, par date de vente.
  const statut = grid.dataset.statut === "sold" ? "sold" : "published";

  applyCategorySeo(q);

  // Tri
  const sort = filters?.sort || "recent";
  const orderCol = sort === "price-asc" || sort === "price-desc"
    ? "price"
    : (statut === "sold" ? "sold_at" : "created_at");
  const ascending = sort === "price-asc";

  let query = (await sbPret())
    .from("products")
    .select("*")
    .eq("status", statut)
    .order(orderCol, { ascending });

  if (cat) query = query.eq("period", cat);
  if (sub) query = query.eq("subcategory", sub);
  if (q) query = query.ilike("title", "%" + q + "%");

  // Filtres avancés
  if (filters?.priceMin) query = query.gte("price", Number(filters.priceMin));
  if (filters?.priceMax) query = query.lte("price", Number(filters.priceMax));
  if (filters?.condition) query = query.eq("condition", filters.condition);
  if (filters?.location) query = query.ilike("location", "%" + filters.location + "%");

  const { data, error } = await query;

  // Badge compteur (en-tête de page) : nombre d'annonces trouvées
  const countEl = document.getElementById("category-count");
  if (countEl) {
    countEl.removeAttribute("data-i18n"); // ne plus être écrasé par « Chargement… »
    if (error) {
      countEl.style.display = "none";
    } else {
      const n = data ? data.length : 0;
      const mots = statut === "sold"
        ? ["archive.vente_word", "archive.ventes_word"]
        : ["tr_js_script.annonce_word", "tr_js_script.annonces_word"];
      countEl.textContent = n + " " + TRs(mots[n > 1 ? 1 : 0]);
    }
  }

  if (error) {
    grid.innerHTML = "<p>" + TRs("tr_js_script.load_error") + "</p>";
    return;
  }

  /* Une page catalogue filtrée sans aucun résultat n'a rien à offrir à un
     visiteur venu de Google : c'est une page vide qui tire vers le bas la
     qualité perçue de tout le domaine. La navigation propose 4 périodes et
     6 types dont la plupart n'ont encore aucune annonce.
     On la retire de l'index tant qu'elle est vide, sans la bloquer au crawl :
     dès qu'une annonce y sera publiée, la page redeviendra indexable
     d'elle-même. Le catalogue complet, lui, reste toujours indexable. */
  // Une recherche interne (?q=) reste hors index quoi qu'il arrive : le nombre
  // d'URLs possibles est infini et aucune n'a de valeur propre. Ce bloc
  // s'exécute APRÈS applyCategorySeo, il ne doit donc pas défaire le noindex
  // que celui-ci vient de poser sur les pages de recherche.
  const filtree = !!(cat || sub) && !q;
  // Sur une page rendue par le serveur, c'est lui qui a décidé du robots.
  if (filtree && document.documentElement.dataset.ssr !== "1") {
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    const vide = !data || data.length === 0;
    robots.setAttribute(
      "content",
      vide ? "noindex, follow" : "index, follow, max-image-preview:large"
    );
  }

  if (!data || data.length === 0) {
    /* Catégorie vide : category.php y a déjà écrit un message qui invite à
       déposer une pièce. Le remplacer ici par « Aucun article trouvé » le
       faisait apparaître puis disparaître au chargement, pour un membre
       connecté comme pour un visiteur. Seul un filtre choisi par le visiteur
       justifie de changer de message. */
    if (!filters && grid.querySelector(".categorie-vide")) return;
    grid.innerHTML = "<p>" + TRs("tr_js_script.no_items_found") + "</p>";
    return;
  }

  grid.innerHTML = "";
  data.forEach((product) => grid.appendChild(renderProductCard(product)));
}

// Initialiser les filtres
function initFilters() {
  const btn = document.getElementById("applyFilters");
  if (!btn) return;

  // Anti-autofill : certains navigateurs injectent l'e-mail enregistré de
  // l'utilisateur dans le champ "Lieu" (heuristique d'autofill trop zélée).
  // Un e-mail n'est jamais une ville : on purge toute valeur de ce type.
  const locInput = document.getElementById("filter-location");
  const purgeEmail = () => {
    if (locInput && locInput.value.includes("@")) locInput.value = "";
  };
  if (locInput) {
    purgeEmail();
    setTimeout(purgeEmail, 400);   // l'autofill arrive souvent après le chargement
    setTimeout(purgeEmail, 1500);
    locInput.addEventListener("input", purgeEmail);
    locInput.addEventListener("change", purgeEmail);
    // Le champ est readonly dans le HTML : Chrome ne pré-remplit jamais un
    // champ en lecture seule (son "aperçu" d'autofill est invisible pour JS).
    // On le déverrouille au moment où l'utilisateur veut vraiment taper.
    const unlock = () => locInput.removeAttribute("readonly");
    locInput.addEventListener("pointerdown", unlock);
    locInput.addEventListener("focus", unlock);
    locInput.addEventListener("blur", () => {
      if (!locInput.value) locInput.setAttribute("readonly", "");
    });
  }

  /* Sur téléphone les filtres se replient derrière « Affiner les résultats »
     (voir category.html). Pas de focus automatique à l'ouverture : il ferait
     surgir le clavier sur un champ que le visiteur n'a pas encore choisi. */
  const basculeFiltres = document.getElementById("filters-toggle");
  const barreFiltres = document.getElementById("filters-bar");
  if (basculeFiltres && barreFiltres) {
    basculeFiltres.addEventListener("click", () => {
      const ouverte = barreFiltres.classList.toggle("is-ouverte");
      basculeFiltres.setAttribute("aria-expanded", ouverte ? "true" : "false");
    });
  }

  btn.addEventListener("click", () => {
    purgeEmail(); // filet de sécurité : jamais d'e-mail utilisé comme filtre
    loadCategoryProducts({
      priceMin: document.getElementById("filter-price-min")?.value,
      priceMax: document.getElementById("filter-price-max")?.value,
      condition: document.getElementById("filter-condition")?.value,
      location: document.getElementById("filter-location")?.value,
      sort: document.getElementById("filter-sort")?.value,
    });
  });
}

/* ============== MENU CATÉGORIES ============== */
// Desktop : hover ouvre le sous-menu (géré en CSS pur : .dropdown:hover .dropdown-content)
// Mobile  : clic sur le bouton principal → navigation directe vers la catégorie (pas de sous-menu)
// → plus besoin de JS, on laisse les <a> naviguer naturellement
function initCategoryDropdowns() {
  // (no-op, conservé pour compat : certains appels existent encore)
}

/* ============== RECHERCHE ============== */
function initSearch() {
  const searchForm = document.querySelector(".search");
  const searchInput = searchForm ? searchForm.querySelector('input[type="search"]') : null;
  if (!searchForm || !searchInput) return;

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    window.location.href = "/militaria?q=" + encodeURIComponent(query);
  });
}


/* ============== MESSAGE PAIEMENT RÉUSSI ============== */
function showPaymentSuccess() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") === "success") {
    const banner = document.createElement("div");
    banner.className = "payment-success";
    banner.innerHTML = "<strong>" + TRs("tr_js_script.payment_confirmed") + "</strong> " + TRs("tr_js_script.payment_thanks");
    document.body.insertBefore(banner, document.body.firstChild);
    // Nettoyer l'URL
    window.history.replaceState({}, "", window.location.pathname);
  }
}

/* ============== MENU HAMBURGER (drawer mobile) ============== */
function initHamburger() {
  const btn = document.getElementById("hamburgerBtn");
  if (!btn) return;

  // Créer le drawer et son backdrop s'ils n'existent pas
  let drawer = document.getElementById("mobileMenu");
  let backdrop = document.getElementById("mobileMenuBackdrop");

  /* Les icônes vivent hors du bloc de création : le pied de menu est réécrit à
     chaque ouverture selon l'état de connexion, et il lui faut les mêmes. */
  const icon = {
      home: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5z"/></svg>',
      sell: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      community: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      account: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      mail: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
      login: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
      info: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      doc: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      globe: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    logout: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  };

  if (!drawer) {
    drawer = document.createElement("nav");
    drawer.id = "mobileMenu";
    drawer.className = "mobile-menu";
    drawer.setAttribute("aria-label", TRs("tr_js_script.main_menu"));
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML = `
      <div class="mm-head">
        <div class="mm-brand">
          <img src="/logo.webp" width="98" height="96" alt="" class="mm-logo">
          <span>Athena Militaria</span>
        </div>
        <button class="mm-close" id="mobileMenuClose" aria-label="${TRs("tr_js_script.close")}">${icon.close}</button>
      </div>

      <div class="mm-section">
        <a class="mm-item" href="/"><span class="mm-ico">${icon.home}</span>${TRs("tr_js_script.home")}</a>
        <a class="mm-item" href="/militaria"><span class="mm-ico">${icon.search}</span>${TRs("tr_js_script.browse_items")}</a>
        <a class="mm-item mm-highlight" href="/sell"><span class="mm-ico">${icon.sell}</span>${TRs("tr_js_script.sell_item")}</a>
      </div>

      <div class="mm-sep"></div>
      <div class="mm-label">${TRs("tr_js_script.my_space")}</div>
      <div class="mm-section">
        <a class="mm-item" href="/account"><span class="mm-ico">${icon.account}</span>${TRs("tr_js_script.my_account")}</a>
        <a class="mm-item" href="/messages"><span class="mm-ico">${icon.mail}</span>${TRs("tr_js_script.messages")}</a>
        <a class="mm-item" href="/community"><span class="mm-ico">${icon.community}</span>${TRs("tr_js_script.community")}</a>
      </div>

      <div class="mm-sep"></div>
      <div class="mm-label">${TRs("tr_js_script.informations")}</div>
      <div class="mm-section">
        <a class="mm-item" href="/about"><span class="mm-ico">${icon.info}</span>${TRs("tr_js_script.about")}</a>
        <a class="mm-item" href="/about#how-it-works"><span class="mm-ico">${icon.info}</span>${TRs("tr_js_script.how_it_works")}</a>
        <a class="mm-item" href="/legal"><span class="mm-ico">${icon.doc}</span>${TRs("tr_js_script.legal")}</a>
      </div>

      <div class="mm-sep"></div>
      <div class="mm-footer">
        <a class="mm-login-btn" href="#" id="mobileLoginBtn"><span class="mm-ico">${icon.login}</span>${TRs("tr_js_script.login_register")}</a>
        <button type="button" class="mm-lang" id="mobileLangToggle"><span class="mm-ico">${icon.globe}</span>${TRs("tr_js_script.lang_toggle")}</button>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "mobileMenuBackdrop";
    backdrop.className = "mobile-menu-backdrop";
    document.body.appendChild(backdrop);
  }

  /* Accessibilité du tiroir (parcours du 3 oct. 2026) : ouvert, il laissait
     le focus clavier et les lecteurs d'écran parcourir la page derrière le
     voile. Même recette que la modale de connexion : le focus entre, il est
     retenu, il est rendu. Le reste de la page est rendu inerte, sauf le
     bandeau, dont la croix doit rester cliquable et dont le bouton de langue
     est actionné depuis le tiroir. */
  let focusAvantTiroir = null;
  const focusablesDuTiroir = () => [...drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  const horsTiroir = () => [...document.body.children]
    .filter((el) => el !== drawer && el !== backdrop && el.id !== "top-banner" && !/^(SCRIPT|STYLE|LINK)$/.test(el.tagName));

  const openMenu = () => {
    // Le pied de menu est rafraîchi à chaque ouverture, pas une seule fois au
    // chargement : la connexion peut avoir eu lieu entre-temps sans rechargement.
    if (typeof majPiedDeMenu === "function") majPiedDeMenu();
    focusAvantTiroir = document.activeElement;
    drawer.classList.add("open");
    backdrop.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    horsTiroir().forEach((el) => { el.inert = true; });
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    // Le premier lien, pas la croix : on ouvre pour aller quelque part.
    const cibles = focusablesDuTiroir();
    (cibles.find((el) => el.id !== "mobileMenuClose") || cibles[0])?.focus();
  };
  const closeMenu = () => {
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    horsTiroir().forEach((el) => { el.inert = false; });
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    const retour = focusAvantTiroir && document.contains(focusAvantTiroir) ? focusAvantTiroir : btn;
    focusAvantTiroir = null;
    if (retour && typeof retour.focus === "function") retour.focus({ preventScroll: true });
  };
  drawer.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const cibles = focusablesDuTiroir();
    if (!cibles.length) return;
    const premier = cibles[0], dernier = cibles[cibles.length - 1];
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
  });

  btn.addEventListener("click", () => {
    drawer.classList.contains("open") ? closeMenu() : openMenu();
  });
  backdrop.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) closeMenu();
  });
  const closeBtn = document.getElementById("mobileMenuClose");
  if (closeBtn) closeBtn.addEventListener("click", closeMenu);
  // Fermer sur clic de tout lien interne (navigation)
  drawer.querySelectorAll("a.mm-item").forEach((a) => {
    a.addEventListener("click", () => setTimeout(closeMenu, 50));
  });

  /* Pied de menu : le libellé suivait l'état de connexion nulle part.
     Le menu était construit une seule fois, au chargement, et affichait
     « Connexion / Inscription » même à un membre connecté. Le clic, lui,
     redirigeait bien vers le compte : seule l'étiquette mentait, ce qui est
     la pire des deux situations, l'utilisateur n'ayant aucune raison de
     cliquer sur un lien qui lui propose de se connecter alors qu'il l'est.

     On réécrit donc le bouton à chaque ouverture, et non une fois pour
     toutes : la connexion peut survenir sans rechargement de page.
     Connecté, le bouton devient « Se déconnecter » plutôt que « Mon compte » :
     ce dernier figure déjà dans la section Mon espace juste au-dessus. */
  function majPiedDeMenu() {
    const lien = document.getElementById("mobileLoginBtn");
    if (!lien) return;
    const loginBtn = document.getElementById("loginBtn");
    const connecte = loginBtn && loginBtn.dataset.loggedIn === "true";
    lien.classList.toggle("mm-login-btn--out", Boolean(connecte));
    lien.innerHTML = connecte
      ? `<span class="mm-ico">${icon.logout}</span>${TRs("tr_js_script.logout_title")}`
      : `<span class="mm-ico">${icon.login}</span>${TRs("tr_js_script.login_register")}`;
    lien.dataset.connecte = connecte ? "true" : "false";
  }
  window.majPiedDeMenuMobile = majPiedDeMenu;

  const mobileLogin = document.getElementById("mobileLoginBtn");
  if (mobileLogin) {
    mobileLogin.addEventListener("click", async (e) => {
      e.preventDefault();
      closeMenu();
      if (mobileLogin.dataset.connecte === "true") {
        const dec = document.getElementById("logoutBtn");
        if (dec) { dec.click(); return; }
        // Repli si le bouton du bandeau est absent de cette page.
        try { await (await sbPret()).auth.signOut(); } catch (err) { /* déjà déconnecté */ }
        window.location.href = "/";
        return;
      }
      const loginBtn = document.getElementById("loginBtn");
      if (loginBtn) loginBtn.click();
    });
  }
  // Lien Langue
  const mobileLang = document.getElementById("mobileLangToggle");
  if (mobileLang) {
    mobileLang.addEventListener("click", () => {
      const langBtn = document.getElementById("lang-toggle");
      if (langBtn) langBtn.click();
    });
  }
}

/* ============== HELPERS GLOBAUX ============== */

// Échapper le HTML pour éviter les XSS
window.escapeHtml = function (str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

// Formater un prix en € avec gestion 0
window.formatPrice = function (price) {
  const n = Number(price) || 0;
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
};

// Formater une date relative ("il y a 3 jours")
window.timeAgo = function (date) {
  if (!date) return "";
  const d = new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return TRs("tr_js_script.just_now");
  if (diff < 3600) return TRs("tr_js_script.time_min").replace("{n}", Math.floor(diff / 60));
  if (diff < 86400) return TRs("tr_js_script.time_hour").replace("{n}", Math.floor(diff / 3600));
  if (diff < 2592000) return TRs("tr_js_script.time_day").replace("{n}", Math.floor(diff / 86400));
  const locale = window.I18N && window.I18N.current === "en" ? "en-GB" : "fr-FR";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
};

/* ============== SYSTÈME TOAST ============== */
(function initToastSystem() {
  function ensureContainer() {
    let c = document.getElementById("toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "toast-container";
      c.setAttribute("role", "status");
      c.setAttribute("aria-live", "polite");
      if (document.body) document.body.appendChild(c);
      else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(c));
    }
    return c;
  }

  // La région annoncée aux lecteurs d'écran existe dès le chargement : créée
  // au moment du premier message, elle était souvent ignorée.
  if (document.readyState !== "loading") ensureContainer();
  else document.addEventListener("DOMContentLoaded", ensureContainer);

  window.toast = function (message, opts = {}) {
    const type = opts.type || "info"; // success, error, warning, info
    const duration = opts.duration ?? 3800;
    const container = ensureContainer();
    const el = document.createElement("div");
    el.className = "toast toast-" + type;
    const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || "ℹ"}</span>
      <span class="toast-msg"></span>
      <button class="toast-close" aria-label="${TRs("tr_js_script.close")}">×</button>
    `;
    el.querySelector(".toast-msg").textContent = message;
    el.querySelector(".toast-close").addEventListener("click", () => dismiss(el));
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast-show"));

    let timer = null;
    if (duration > 0) timer = setTimeout(() => dismiss(el), duration);

    function dismiss(node) {
      if (timer) clearTimeout(timer);
      node.classList.remove("toast-show");
      node.classList.add("toast-hide");
      setTimeout(() => node.remove(), 260);
    }
    return el;
  };

  // Alias pratiques
  window.toastSuccess = (m, o) => window.toast(m, { ...o, type: "success" });
  window.toastError = (m, o) => window.toast(m, { ...o, type: "error" });
  window.toastWarn = (m, o) => window.toast(m, { ...o, type: "warning" });
})();

/* ============== CONFIRM MODAL (remplace confirm()) ============== */
window.askConfirm = function (message, opts = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true">
        <div class="confirm-title">${window.escapeHtml(opts.title || TRs("tr_js_script.confirm"))}</div>
        <div class="confirm-msg"></div>
        <div class="confirm-actions">
          <button class="btn outline confirm-cancel">${window.escapeHtml(opts.cancelText || TRs("tr_js_script.cancel"))}</button>
          <button class="cta-btn confirm-ok${opts.danger ? " confirm-danger" : ""}">${window.escapeHtml(opts.okText || TRs("tr_js_script.confirm"))}</button>
        </div>
      </div>
    `;
    overlay.querySelector(".confirm-msg").textContent = message;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));

    const close = (val) => {
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), 200);
      resolve(val);
    };
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => close(false));
    overlay.querySelector(".confirm-ok").addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") { close(false); document.removeEventListener("keydown", onEsc); }
    });
  });
};

/* ============== BANDEAU AVERTISSEMENT HISTORIQUE ==============
   Le bandeau est écrit dans chaque page, sous l'en-tête. Le script en ligne
   qui le précède ne le laisse visible que sur la première page de la visite,
   et le masque avant le rendu (classe hist-lu) sur toutes les suivantes, pour
   un visiteur connecté ou qui l'a fermé. Il était auparavant créé ici et posé
   par-dessus le contenu : une fenêtre plein écran, que Google classe parmi les
   interstitiels intrusifs, puis un bandeau flottant qui masquait le bas de la
   page. Depuis le 5 octobre 2026, à la demande de l'exploitant, il est de
   nouveau en bas de l'écran, mais en carte centrée de trois lignes au plus,
   sans voile (style.css, « mot de l'équipe en bas de l'écran »). Il ne
   reste qu'à brancher le bouton. */
function initHistoryWarningBanner() {
  const ACK_KEY = "athena_history_warning_ack";
  /* Retour arrière vers la première page : le navigateur la restitue telle
     qu'elle était en mémoire, bandeau ouvert, sans relancer le script en
     ligne. On applique ici la règle qu'il aurait appliquée. */
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    try {
      if (sessionStorage.getItem("athena_note_page") === "-") document.documentElement.classList.add("hist-lu");
    } catch (err) {}
  });
  const bouton = document.getElementById("hwb-ack-btn");
  if (!bouton) return;
  bouton.addEventListener("click", () => {
    try { sessionStorage.setItem(ACK_KEY, "1"); } catch (e) {}
    document.documentElement.classList.add("hist-lu");
  });

  /* Aucun clic à faire : la carte, vue à l'arrivée, s'efface d'elle-même dès
     que le visiteur fait défiler la page (crainte de l'exploitant, 5 oct.
     2026 : « un clic en plus » qui ferait fuir). Elle reste si l'on a ouvert
     « En savoir plus », puisqu'on est en train de la lire. Ce n'est pas un
     « J'ai compris » : elle reviendra à la prochaine visite. */
  const note = document.getElementById("history-warning-banner");
  const details = note && note.querySelector(".note-details");
  if (!note || document.documentElement.classList.contains("hist-lu")) return;

  /* Et sinon, au bout de douze secondes, elle s'estompe lentement (demande de
     l'exploitant : « ça fond petit à petit »). Douze secondes, c'est trois
     fois le temps de lire sa ligne. Le compte à rebours s'arrête tant que la
     souris est dessus, qu'on la parcourt au clavier ou que « En savoir
     plus » est ouvert, et il n'avance pas dans un onglet d'arrière-plan : on
     ne retire jamais un texte à quelqu'un qui le lit. */
  const DELAI = 12000;
  let minuteur = 0;
  let partie = false;
  const partir = () => {
    if (partie || (details && details.open)) return;
    partie = true;
    clearTimeout(minuteur);
    window.removeEventListener("scroll", auDefilement);
    note.classList.add("is-partie");
    setTimeout(() => document.documentElement.classList.add("hist-lu"), 1600);
  };
  const suspendre = () => clearTimeout(minuteur);
  const relancer = (delai) => {
    clearTimeout(minuteur);
    if (partie || document.hidden || (details && details.open)) return;
    if (note.matches(":hover") || note.contains(document.activeElement)) return;
    minuteur = setTimeout(partir, delai);
  };
  const seuil = () => Math.min(240, window.innerHeight * 0.3);
  function auDefilement() {
    if (window.scrollY >= seuil()) partir();
  }
  window.addEventListener("scroll", auDefilement, { passive: true });
  note.addEventListener("pointerenter", suspendre);
  note.addEventListener("pointerleave", () => relancer(6000));
  note.addEventListener("focusin", suspendre);
  note.addEventListener("focusout", () => setTimeout(() => relancer(6000), 0));
  if (details) details.addEventListener("toggle", () => (details.open ? suspendre() : relancer(6000)));
  document.addEventListener("visibilitychange", () => (document.hidden ? suspendre() : relancer(DELAI)));
  relancer(DELAI);
}

/* Annonce publiée à l'instant : le message de succès est affiché sur la
   fiche d'arrivée, puisque la page de vente vient d'être quittée. */
function annoncerPublication() {
  try {
    if (sessionStorage.getItem("athena_annonce_publiee") !== "1") return;
    sessionStorage.removeItem("athena_annonce_publiee");
  } catch (e) { return; }
  toastSuccess(TRs("tr_js_script.listing_published"));
}

/* ============== INIT GLOBAL ============== */
document.addEventListener("DOMContentLoaded", () => {
  updateAuthUI();
  initAuthModal();
  initHeaderMessagesButton();
  initSellForm();
  initCategoryDropdowns();
  initSearch();
  initHamburger();
  initFilters();
  loadLatestProducts();
  loadCategoryProducts();
  showPaymentSuccess();
  initHistoryWarningBanner();
  annoncerPublication();
});
