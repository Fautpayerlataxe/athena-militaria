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
  return IMG_FN + "?path=" + chemin + "&w=" + w;
}
window.imgUrl = imgUrl;

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
  const { data, error } = await window.sb
    .from("public_profiles").select("id").ilike("pseudo", pattern).limit(1);
  // Souci réseau : on laisse passer, l'index unique en base reste le garde-fou.
  if (error || !data || !data.length) return true;
  return exceptUserId ? data[0].id === exceptUserId : false;
}

async function registerUser(email, password, newsletterOptIn, pseudo) {
  const { data, error } = await window.sb.auth.signUp({
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
  const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/* ============== AUTH : mise à jour UI selon état connecté ============== */
async function updateAuthUI() {
  const { data: { user } } = await window.sb.auth.getUser();
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
          await window.sb.auth.signOut();
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
    const { count } = await window.sb
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
    const modal = document.getElementById("authModal");
    if (modal) {
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
    }
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

  openBtn.addEventListener("click", (e) => {
    // Si l'utilisateur est déjà connecté, on laisse le lien naviguer vers account.html
    if (openBtn.dataset.loggedIn === "true") {
      return; // laisse le comportement par défaut (href="/account")
    }
    e.preventDefault();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (panelReg) panelReg.style.display = "none";
    if (panelLog) panelLog.style.display = "none";
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    });
  }

  window.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }
  });

  if (withEmail && panelReg && panelLog) {
    withEmail.addEventListener("click", (e) => {
      e.preventDefault();
      panelLog.style.display = "none";
      panelReg.style.display = "block";
    });
  }

  if (goLogin && panelReg && panelLog) {
    goLogin.addEventListener("click", (e) => {
      e.preventDefault();
      panelReg.style.display = "none";
      panelLog.style.display = "block";
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
        modal.classList.remove("open");
        updateAuthUI();
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        toastError(TRs("tr_js_script.register_error_prefix") + err.message);
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
        modal.classList.remove("open");
        updateAuthUI();
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        toastError(TRs("tr_js_script.login_error_prefix") + err.message);
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
    const { data: { session } } = await window.sb.auth.getSession();
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
    const { data: { session } } = await window.sb.auth.getSession();
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
}

function restoreSellFormFromSession() {
  let data;
  try {
    const raw = sessionStorage.getItem(SELL_DRAFT_KEY);
    if (!raw) return false;
    data = JSON.parse(raw);
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
    const { data: { user } } = await window.sb.auth.getUser();
    if (user) {
      const { data: profile } = await window.sb
        .from("profiles")
        .select("blocked")
        .eq("id", user.id)
        .maybeSingle();
      if (profile && profile.blocked === true) {
        if (blocked) blocked.style.display = "block";
        if (content) content.style.display = "none";
        return; // on n'attache rien pour un compte bloqué
      }
      // Utilisateur connecté & non bloqué : restaurer un éventuel brouillon
      if (restoreSellFormFromSession()) {
        try { sessionStorage.removeItem(SELL_DRAFT_KEY); } catch (e) {}
        toastSuccess(TRs("tr_js_script.draft_restored"));
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
      const am = document.getElementById("authModal");
      if (am) {
        am.classList.add("open");
        am.setAttribute("aria-hidden", "false");
      }
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
      if (dropzone) dropzone.scrollIntoView({ behavior: "smooth", block: "center" });
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

    // Vérifier que l'utilisateur est connecté
    const { data: userData } = await window.sb.auth.getUser();
    const user = userData?.user;

    if (!user) {
      // Sauvegarder la fiche, ouvrir la modale d'engagement
      saveSellFormToSession();
      openSellGateModal();
      return;
    }

    // Vérifier que le compte n'est pas suspendu
    try {
      const { data: profile } = await window.sb
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
        const { error: uploadError } = await window.sb.storage
          .from("product-images")
          .upload(filePath, blob, { contentType: blob.type || file.type });
        if (uploadError) {
          if (submitBtn) submitBtn.disabled = false;
          toastError(`${TRs("tr_js_script.upload_error_prefix")} ${i + 1} : ` + uploadError.message);
          return;
        }
        const { data: urlData } = window.sb.storage
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

    const { data: inserted, error } = await window.sb.from("products").insert([payload]).select("id").single();

    if (error) {
      toastError(TRs("tr_js_script.error_prefix") + error.message);
    } else {
      // Traduction EN automatique de l'annonce (arrière-plan, n'attend pas)
      if (inserted?.id) requestListingTranslation(inserted.id);
      // Notification e-mail à l'administrateur
      if (inserted?.id) requestListingNotify(inserted.id);
      toastSuccess(TRs("tr_js_script.listing_published"));
      window.location.href = "/category";
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
      const { data: userData } = await window.sb.auth.getUser();
      const user = userData?.user;
      if (!user) {
        saveSellFormToSession();
        openSellGateModal();
        return;
      }

      // Bloquer si compte suspendu
      try {
        const { data: profile } = await window.sb
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
        const { error: uploadError } = await window.sb.storage
          .from("product-images")
          .upload(filePath, blob, { contentType: blob.type || file.type });
        if (!uploadError) {
          const { data: urlData } = window.sb.storage
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

      const { error } = await window.sb.from("products").insert([payload]);
      if (error) {
        toastError(TRs("tr_js_script.error_prefix") + error.message);
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

  const card = document.createElement("a");
  card.className = "item-card";
  card.href = "/product?id=" + product.id;

  // Image (avec flou + overlay si article sensible et utilisateur non connecté)
  const imgWrap = document.createElement("div");
  imgWrap.className = "item-card-img";

  const img = document.createElement("img");
  img.src = imgUrl(product.image_url, 400) || "hero.png";
  img.alt = cardTitle;
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = function () { this.src = "hero.png"; };
  imgWrap.appendChild(img);

  if (product.historically_sensitive && !window.__IS_LOGGED_IN) {
    imgWrap.classList.add("is-blurred");
    const overlay = document.createElement("div");
    overlay.className = "sensitive-overlay";
    overlay.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span data-i18n="product.sensitive_overlay">${TRs("tr_js_script.sensitive_overlay")}</span>
    `;
    imgWrap.appendChild(overlay);
  }
  card.appendChild(imgWrap);

  const h3 = document.createElement("h3");
  h3.textContent = cardTitle;
  card.appendChild(h3);

  const p = document.createElement("p");
  p.className = "price";
  p.textContent = product.price + " €";
  card.appendChild(p);

  return card;
}

// Page d'accueil : derniers articles
async function loadLatestProducts() {
  const grid = document.getElementById("latest-grid");
  if (!grid) return;

  // S'assurer que l'état auth est connu avant de rendre (pour le flou sensible)
  if (typeof window.__IS_LOGGED_IN === "undefined") {
    const { data: { user } } = await window.sb.auth.getUser();
    window.__IS_LOGGED_IN = !!user;
  }

  const { data, error } = await window.sb
    .from("products")
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(8);

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
}

/* ============== SEO DES PAGES CATALOGUE ==============
   Une page filtrée (?cat=…&sub=…) est une page d'atterrissage à part entière :
   titre, description, H1, canonique auto-référente, hreflang et fil d'Ariane
   structuré lui sont propres. Sans filtre, la page garde ses meta d'origine. */
const SITE_URL = "https://www.athenamilitaria.fr";

// Correspondance slug d'URL → clé de traduction (identique au script de category.html)
const CAT_I18N = {
  "Guerre-Napoléonienne": "cat.napoleon",
  "1ère-Guerre-Mondiale": "cat.ww1",
  "2nde-Guerre-Mondiale": "cat.ww2",
  "Guerre-froide": "cat.cold",
};
const SUB_I18N = {
  "Uniformes": "cat.uniforms",
  "Armes": "cat.weapons",
  "Documents": "cat.documents",
  "Médailles": "cat.medals",
  "Objets-divers": "cat.misc",
  "Équipements": "cat.equipment",
};

/* Correspondance entre le segment court des URLs et la valeur réellement
   enregistrée en base par le formulaire de vente (sell.html).
   Les deux vocabulaires avaient divergé : le catalogue filtrait sur une
   égalité stricte, si bien que ?sub=Armes et ?sub=Médailles ne remontaient
   jamais rien, et que la seule sous-catégorie contenant une annonce,
   Équipements, n'était liée depuis aucune page.
   On garde des URLs courtes et lisibles côté visiteur, et on traduit vers la
   valeur exacte au moment de la requête. */
const SUB_DB = {
  "Armes": "Armes (neutralisées/maquettes)",
  "Médailles": "Médailles & décorations",
};
const subToDb = (slug) => {
  const clair = String(slug || "").replace(/-/g, " ");
  return SUB_DB[clair] || clair;
};

/* Chemin inverse : d'une valeur stockée en base vers le segment court utilisé
   dans les URLs. Sert aux liens construits depuis une annonce (fil d'Ariane,
   « voir plus »), qui doivent pointer vers la même URL que la navigation,
   sinon on crée deux adresses pour une seule page.
   Exposé globalement car product.js s'exécute après script.js. */
window.dbToSubSlug = (valeur) => {
  const v = String(valeur || "").trim();
  for (const court in SUB_DB) if (SUB_DB[court] === v) return court.replace(/ /g, "-");
  return v.replace(/ /g, "-");
};
window.periodToSlug = (valeur) => String(valeur || "").trim().replace(/ /g, "-");

function applyCategorySeo(cat, sub, q) {
  if (!document.getElementById("category-grid")) return;

  // Nom lisible et traduit (repli sur le slug si la clé manque)
  const label = (slug, map) => {
    if (!slug) return "";
    const key = map[slug];
    if (key && window.I18N) return window.I18N.t(key);
    return String(slug).replace(/-/g, " ");
  };
  const catName = label(cat, CAT_I18N);
  const subName = label(sub, SUB_I18N);

  // Le titre visible (H1) est géré par le script de category.html : on n'y touche pas.
  // Fil d'Ariane : on reconstruit la hiérarchie complète, avec la catégorie cliquable.
  const crumb = document.getElementById("breadcrumb-current");
  if (crumb && (catName || subName)) {
    crumb.removeAttribute("data-i18n");
    if (subName && catName) {
      // Accueil / Catégorie (lien) / Sous-catégorie
      const link = document.createElement("a");
      link.href = "/category?cat=" + encodeURIComponent(cat);
      link.textContent = catName;
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "/";
      crumb.parentNode.insertBefore(link, crumb);
      crumb.parentNode.insertBefore(sep, crumb);
      crumb.textContent = subName;
    } else {
      crumb.textContent = subName || catName;
    }
  }

  // Une recherche interne ne doit pas être indexée (contenu quasi infini)
  if (q) {
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    robots.setAttribute("content", "noindex, follow");
    return;
  }
  if (!catName && !subName) return;   // catalogue complet : rien à surcharger

  // 2. Titre de l'onglet et description, pensés pour le clic dans Google.
  //    Le libellé de la période est déjà traduit ; le reste de la phrase doit
  //    l'être aussi, sinon la version anglaise indexée affiche un titre bâtard
  //    du type "Cold War : annonces de militaria".
  const themeTitle = subName && catName ? `${subName} ${catName}` : (subName || catName);
  const enAnglais = (window.I18N && window.I18N.current) === "en";

  const titre = enAnglais
    ? `${themeTitle} militaria for sale | Athena Militaria`
    : `${themeTitle} : annonces de militaria | Athena Militaria`;
  const description = enAnglais
    ? `${themeTitle} militaria listed by collectors: verified pieces, detailed condition reports, secure payment and direct contact with the seller.`
    : `Annonces de militaria ${themeTitle} entre collectionneurs : pièces vérifiées, description détaillée, paiement sécurisé et échange direct avec le vendeur.`;

  document.title = titre;
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute("content", description);
  const ogT = document.querySelector('meta[property="og:title"]');
  if (ogT) ogT.setAttribute("content", titre.replace(" | Athena Militaria", ""));
  const ogD = document.querySelector('meta[property="og:description"]');
  if (ogD && md) ogD.setAttribute("content", md.getAttribute("content"));

  // 3. Canonique auto-référente + hreflang de la page filtrée
  const params = new URLSearchParams();
  if (cat) params.set("cat", cat);
  if (sub) params.set("sub", sub);
  const urlFr = `${SITE_URL}/category?${params.toString()}`;
  const urlEn = urlFr + "&lang=en";
  // La canonical décrit l'URL demandée, pas la langue affichée : sinon la
  // version anglaise se rabat sur la française et n'est jamais indexée.
  const selfUrl = new URLSearchParams(location.search).get("lang") === "en" ? urlEn : urlFr;

  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) {
    canon = document.createElement("link");
    canon.setAttribute("rel", "canonical");
    document.head.appendChild(canon);
  }
  canon.setAttribute("href", selfUrl);
  document.querySelectorAll('link[rel="alternate"][hreflang]').forEach((l) => {
    l.setAttribute("href", l.getAttribute("hreflang") === "en" ? urlEn : urlFr);
  });
  const ogU = document.querySelector('meta[property="og:url"]');
  if (ogU) ogU.setAttribute("content", selfUrl);

  // 4. Fil d'Ariane structuré (Accueil › Catalogue › Période › Type)
  const items = [
    { name: "Accueil", item: SITE_URL + "/" },
    { name: "Toutes les annonces", item: SITE_URL + "/category" },
  ];
  if (catName) items.push({ name: catName, item: `${SITE_URL}/category?cat=${encodeURIComponent(cat)}` });
  if (subName) items.push({ name: subName, item: selfUrl });

  document.getElementById("category-breadcrumb-jsonld")?.remove();
  const ld = document.createElement("script");
  ld.type = "application/ld+json";
  ld.id = "category-breadcrumb-jsonld";
  ld.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem", position: i + 1, name: it.name, item: it.item,
    })),
  });
  document.head.appendChild(ld);
}

// Page catégories : articles filtrés
async function loadCategoryProducts(filters) {
  const grid = document.getElementById("category-grid");
  if (!grid) return;

  // S'assurer que l'état auth est connu avant de rendre
  if (typeof window.__IS_LOGGED_IN === "undefined") {
    const { data: { user } } = await window.sb.auth.getUser();
    window.__IS_LOGGED_IN = !!user;
  }

  const params = new URLSearchParams(location.search);
  const cat = params.get("cat");
  const sub = params.get("sub");
  const q = params.get("q");

  applyCategorySeo(cat, sub, q);

  // Tri
  const sort = filters?.sort || "recent";
  const orderCol = sort === "price-asc" || sort === "price-desc" ? "price" : "created_at";
  const ascending = sort === "price-asc";

  let query = window.sb
    .from("products")
    .select("*")
    .eq("status", "published")
    .order(orderCol, { ascending });

  if (cat) query = query.eq("period", cat.replace(/-/g, " "));
  if (sub) query = query.eq("subcategory", subToDb(sub));
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
      countEl.textContent = n + " " + (n > 1 ? TRs("tr_js_script.annonces_word") : TRs("tr_js_script.annonce_word"));
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
  if (filtree) {
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
    window.location.href = "/category?q=" + encodeURIComponent(query);
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

  if (!drawer) {
    drawer = document.createElement("nav");
    drawer.id = "mobileMenu";
    drawer.className = "mobile-menu";
    drawer.setAttribute("aria-label", TRs("tr_js_script.main_menu"));
    drawer.setAttribute("aria-hidden", "true");
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
    };
    drawer.innerHTML = `
      <div class="mm-head">
        <div class="mm-brand">
          <img src="logo.png" alt="" class="mm-logo">
          <span>Athena Militaria</span>
        </div>
        <button class="mm-close" id="mobileMenuClose" aria-label="${TRs("tr_js_script.close")}">${icon.close}</button>
      </div>

      <div class="mm-section">
        <a class="mm-item" href="/"><span class="mm-ico">${icon.home}</span>${TRs("tr_js_script.home")}</a>
        <a class="mm-item" href="/category"><span class="mm-ico">${icon.search}</span>${TRs("tr_js_script.browse_items")}</a>
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

  const openMenu = () => {
    drawer.classList.add("open");
    backdrop.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  };
  const closeMenu = () => {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  };

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

  // Lien Connexion → déclenche le modal existant, ou va directement sur le compte si connecté
  const mobileLogin = document.getElementById("mobileLoginBtn");
  if (mobileLogin) {
    mobileLogin.addEventListener("click", (e) => {
      e.preventDefault();
      closeMenu();
      const loginBtn = document.getElementById("loginBtn");
      if (loginBtn) {
        if (loginBtn.dataset.loggedIn === "true") {
          window.location.href = "/account";
        } else {
          loginBtn.click();
        }
      }
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
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
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

/* ============== BANDEAU AVERTISSEMENT HISTORIQUE ============== */
async function initHistoryWarningBanner() {
  // Clé dans sessionStorage → se reset à chaque nouvelle visite (fermeture d'onglet)
  // → bannière réapparaît à chaque nouvelle session pour les visiteurs non connectés.
  const ACK_KEY = "athena_history_warning_ack";

  // Si l'utilisateur est connecté, on ne montre pas la bannière
  // (il a déjà accepté à l'inscription / connaît déjà le contexte)
  try {
    const { data: { user } } = await window.sb.auth.getUser();
    if (user) return;
  } catch (e) { /* pas de supabase, on continue */ }

  try {
    if (sessionStorage.getItem(ACK_KEY) === "1") return;
  } catch (e) {}

  const banner = document.createElement("div");
  banner.id = "history-warning-banner";
  banner.className = "history-warning-banner";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", TRs("tr_js_script.welcome_banner_aria"));
  banner.innerHTML = `
    <div class="hwb-inner">
      <div class="hwb-text">
        <strong data-i18n="hwb.title">Bienvenue sur Athena Militaria</strong>
        <p data-i18n="hwb.body">Notre plateforme est dédiée aux collectionneurs et passionnés d'histoire militaire. Certaines pièces peuvent porter des insignes de régimes historiques aujourd'hui dissous : elles sont exposées dans un strict cadre de collection et de mémoire, sans aucune valeur idéologique.</p>
      </div>
      <button type="button" class="hwb-ack" id="hwb-ack-btn" data-i18n="hwb.ack">Entrer sur le site</button>
    </div>
  `;
  document.body.appendChild(banner);
  // Re-appliquer i18n si disponible
  if (window.I18N && typeof window.I18N.apply === "function") {
    window.I18N.apply(banner);
  }
  document.getElementById("hwb-ack-btn")?.addEventListener("click", () => {
    try { sessionStorage.setItem(ACK_KEY, "1"); } catch (e) {}
    banner.classList.add("is-closing");
    setTimeout(() => banner.remove(), 300);
  });
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
});
