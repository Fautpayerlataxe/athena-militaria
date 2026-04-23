/* ============== AUTH : inscription & connexion ============== */
async function registerUser(email, password) {
  const { data, error } = await window.sb.auth.signUp({ email, password });
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

  // Nettoyer un éventuel ancien bouton logout
  const oldLogout = document.getElementById("logoutBtn");
  if (oldLogout) oldLogout.remove();

  if (user) {
    // Connecté → transforme le bouton en "Mon compte"
    loginBtn.textContent = "Mon compte";
    loginBtn.setAttribute("href", "account.html");
    loginBtn.classList.remove("outline");
    loginBtn.classList.add("btn-account");
    loginBtn.dataset.loggedIn = "true";
    loginBtn.style.cursor = "";

    // Bouton déconnexion compact à côté
    const logoutBtn = document.createElement("a");
    logoutBtn.id = "logoutBtn";
    logoutBtn.href = "#";
    logoutBtn.className = "btn-logout";
    logoutBtn.title = "Se déconnecter (" + user.email + ")";
    logoutBtn.setAttribute("aria-label", "Se déconnecter");
    logoutBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await window.sb.auth.signOut();
      window.location.reload();
    });
    loginBtn.parentNode.insertBefore(logoutBtn, loginBtn.nextSibling);
  } else {
    // Déconnecté → bouton standard
    loginBtn.dataset.loggedIn = "false";
    loginBtn.classList.remove("btn-account");
    if (!loginBtn.classList.contains("outline")) loginBtn.classList.add("outline");
  }
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
      return; // laisse le comportement par défaut (href="account.html")
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

  // Boutons OAuth
  const oauthButtons = modal.querySelectorAll(".oauth-btn");
  const providers = ["apple", "google", "facebook"];
  oauthButtons.forEach((btn, i) => {
    btn.addEventListener("click", async () => {
      const provider = providers[i];
      const { error } = await window.sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + "/index.html" },
      });
      if (error) toastError("Erreur OAuth : " + error.message);
    });
  });

  // Boutons inscription / connexion
  const btnRegister = document.getElementById("btnRegister");
  const btnLogin = document.getElementById("btnLogin");

  if (btnRegister) {
    btnRegister.addEventListener("click", async () => {
      const email = document.getElementById("regEmail")?.value.trim();
      const pass = document.getElementById("regPass")?.value;
      const pass2 = document.getElementById("regPass2")?.value;

      if (!email || !pass || !pass2) { toast("Remplis tous les champs."); return; }
      if (pass.length < 6) { toast("Le mot de passe doit faire au moins 6 caractères."); return; }
      if (pass !== pass2) { toast("Les mots de passe ne correspondent pas."); return; }

      try {
        await registerUser(email, pass);
        toastSuccess("Compte créé. Vérifie ton e-mail si nécessaire.");
        modal.classList.remove("open");
        updateAuthUI();
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        toastError("Erreur inscription : " + err.message);
      }
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      const email = document.getElementById("logEmail")?.value.trim();
      const pass = document.getElementById("logPass")?.value;

      if (!email || !pass) { toast("Remplis tous les champs."); return; }

      try {
        await loginUser(email, pass);
        toastSuccess("Connexion réussie !");
        modal.classList.remove("open");
        updateAuthUI();
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        toastError("Erreur connexion : " + err.message);
      }
    });
  }
}

/* ============== FORMULAIRE DE VENTE → Supabase ============== */
const SELL_DRAFT_KEY = "athena_pending_sale";

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

  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
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
        toastSuccess("Votre fiche est de retour — il ne reste qu'à publier !");
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
  const MAX_SIZE_MB = 5;
  // État interne : les fichiers sélectionnés (au-delà de input.files qui est écrasé à chaque clic)
  window.__sellPhotos = [];

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
        badge.textContent = "Principale";
        wrap.appendChild(badge);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "photo-thumb-remove";
      btn.setAttribute("aria-label", "Retirer cette photo");
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
      if (count > 0) {
        dropHint.textContent = `${count}/${MAX_PHOTOS} photos · cliquez pour en ajouter d'autres`;
      } else {
        dropHint.textContent = `JPG, PNG ou HEIC · ${MAX_SIZE_MB} Mo max par fichier`;
      }
    }
  }

  if (inputPhotos && preview) {
    inputPhotos.addEventListener("change", () => {
      const newFiles = Array.from(inputPhotos.files);
      const valid = [];
      for (const f of newFiles) {
        if (!f.type.startsWith("image/")) continue;
        if (f.size > MAX_SIZE_MB * 1024 * 1024) {
          toastWarn(`${f.name} fait plus de ${MAX_SIZE_MB} Mo, ignoré.`);
          continue;
        }
        valid.push(f);
      }
      const total = window.__sellPhotos.concat(valid);
      if (total.length > MAX_PHOTOS) {
        toastWarn(`Maximum ${MAX_PHOTOS} photos — les dernières ont été ignorées.`);
      }
      window.__sellPhotos = total.slice(0, MAX_PHOTOS);
      renderPhotosPreview();
      // Reset pour permettre re-sélection du même fichier
      inputPhotos.value = "";
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const price = document.getElementById("price");
    const terms = document.getElementById("terms");

    if (price && (+price.value <= 0 || isNaN(+price.value))) {
      toast("Merci d'indiquer un prix valide.");
      price.focus();
      return;
    }
    if (terms && !terms.checked) {
      toast("Merci d'accepter les règles du site.");
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
        toastError("Votre compte est suspendu. Publication impossible.");
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
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const rand = Math.random().toString(36).slice(2, 8);
        const filePath = user.id + "/" + Date.now() + "_" + i + "_" + rand + "." + ext;
        const { error: uploadError } = await window.sb.storage
          .from("product-images")
          .upload(filePath, file);
        if (uploadError) {
          if (submitBtn) submitBtn.disabled = false;
          toastError(`Erreur upload photo ${i + 1} : ` + uploadError.message);
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

    const { error } = await window.sb.from("products").insert([payload]);

    if (error) {
      toastError("Erreur : " + error.message);
    } else {
      toastSuccess("Annonce publiée !");
      window.location.href = "category.html";
    }
  });

  // Bouton brouillon
  const draftBtn = document.getElementById("draftBtn");
  if (draftBtn) {
    draftBtn.addEventListener("click", async () => {
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
          (window.toastError || toast)("Votre compte est suspendu.");
          return;
        }
      } catch (e) { /* optionnel */ }

      // Upload photos si présentes (multi)
      const photos = window.__sellPhotos || [];
      const uploadedUrls = [];
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const rand = Math.random().toString(36).slice(2, 8);
        const filePath = user.id + "/" + Date.now() + "_" + i + "_" + rand + "." + ext;
        const { error: uploadError } = await window.sb.storage
          .from("product-images")
          .upload(filePath, file);
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
        toastError("Erreur : " + error.message);
      } else {
        toastSuccess("Brouillon enregistré !");
      }
    });
  }
}

/* ============== CHARGEMENT ARTICLES DEPUIS SUPABASE ============== */

// Génère le HTML d'une carte article
function renderProductCard(product) {
  const card = document.createElement("a");
  card.className = "item-card";
  card.href = "product.html?id=" + product.id;

  // Image (avec flou + overlay si article sensible et utilisateur non connecté)
  const imgWrap = document.createElement("div");
  imgWrap.className = "item-card-img";

  const img = document.createElement("img");
  img.src = product.image_url || "hero.png";
  img.alt = product.title;
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
      <span data-i18n="product.sensitive_overlay">Connectez-vous pour afficher</span>
    `;
    imgWrap.appendChild(overlay);
  }
  card.appendChild(imgWrap);

  const h3 = document.createElement("h3");
  h3.textContent = product.title;
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
    grid.innerHTML = "<p>Impossible de charger les articles.</p>";
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = "<p>Aucun article pour le moment.</p>";
    return;
  }

  grid.innerHTML = "";
  data.forEach((product) => grid.appendChild(renderProductCard(product)));
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
  if (sub) query = query.eq("subcategory", sub.replace(/-/g, " "));
  if (q) query = query.ilike("title", "%" + q + "%");

  // Filtres avancés
  if (filters?.priceMin) query = query.gte("price", Number(filters.priceMin));
  if (filters?.priceMax) query = query.lte("price", Number(filters.priceMax));
  if (filters?.condition) query = query.eq("condition", filters.condition);
  if (filters?.location) query = query.ilike("location", "%" + filters.location + "%");

  const { data, error } = await query;

  if (error) {
    grid.innerHTML = "<p>Impossible de charger les articles.</p>";
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = "<p>Aucun article trouvé.</p>";
    return;
  }

  grid.innerHTML = "";
  data.forEach((product) => grid.appendChild(renderProductCard(product)));
}

// Initialiser les filtres
function initFilters() {
  const btn = document.getElementById("applyFilters");
  if (!btn) return;

  btn.addEventListener("click", () => {
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
    window.location.href = "category.html?q=" + encodeURIComponent(query);
  });
}


/* ============== MESSAGE PAIEMENT RÉUSSI ============== */
function showPaymentSuccess() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") === "success") {
    const banner = document.createElement("div");
    banner.className = "payment-success";
    banner.innerHTML = '<strong>Paiement confirmé !</strong> Merci pour votre achat. Vous recevrez un e-mail de confirmation.';
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
    drawer.setAttribute("aria-label", "Menu principal");
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
        <button class="mm-close" id="mobileMenuClose" aria-label="Fermer">${icon.close}</button>
      </div>

      <div class="mm-section">
        <a class="mm-item" href="index.html"><span class="mm-ico">${icon.home}</span>Accueil</a>
        <a class="mm-item" href="category.html"><span class="mm-ico">${icon.search}</span>Parcourir les articles</a>
        <a class="mm-item mm-highlight" href="sell.html"><span class="mm-ico">${icon.sell}</span>Vendre un article</a>
      </div>

      <div class="mm-sep"></div>
      <div class="mm-label">Mon espace</div>
      <div class="mm-section">
        <a class="mm-item" href="account.html"><span class="mm-ico">${icon.account}</span>Mon compte</a>
        <a class="mm-item" href="messages.html"><span class="mm-ico">${icon.mail}</span>Messages</a>
        <a class="mm-item" href="community.html"><span class="mm-ico">${icon.community}</span>Communauté</a>
      </div>

      <div class="mm-sep"></div>
      <div class="mm-label">Informations</div>
      <div class="mm-section">
        <a class="mm-item" href="about.html"><span class="mm-ico">${icon.info}</span>À propos</a>
        <a class="mm-item" href="about.html#how-it-works"><span class="mm-ico">${icon.info}</span>Comment ça marche</a>
        <a class="mm-item" href="legal.html"><span class="mm-ico">${icon.doc}</span>Mentions légales</a>
      </div>

      <div class="mm-sep"></div>
      <div class="mm-footer">
        <a class="mm-login-btn" href="#" id="mobileLoginBtn"><span class="mm-ico">${icon.login}</span>Connexion / Inscription</a>
        <button type="button" class="mm-lang" id="mobileLangToggle"><span class="mm-ico">${icon.globe}</span>English</button>
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
          window.location.href = "account.html";
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
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 2592000) return `il y a ${Math.floor(diff / 86400)} j`;
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
      <button class="toast-close" aria-label="Fermer">×</button>
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
        <div class="confirm-title">${window.escapeHtml(opts.title || "Confirmer")}</div>
        <div class="confirm-msg"></div>
        <div class="confirm-actions">
          <button class="btn outline confirm-cancel">${window.escapeHtml(opts.cancelText || "Annuler")}</button>
          <button class="cta-btn confirm-ok${opts.danger ? " confirm-danger" : ""}">${window.escapeHtml(opts.okText || "Confirmer")}</button>
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
  banner.setAttribute("aria-label", "Bienvenue sur Athena Militaria");
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
