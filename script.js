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
  const loginBtn = document.getElementById("loginBtn");
  if (!loginBtn) return;

  if (user) {
    loginBtn.textContent = user.email;
    loginBtn.removeAttribute("href");
    loginBtn.style.cursor = "default";

    // Ajouter un bouton déconnexion s'il n'existe pas encore
    if (!document.getElementById("logoutBtn")) {
      const logoutBtn = document.createElement("a");
      logoutBtn.id = "logoutBtn";
      logoutBtn.href = "#";
      logoutBtn.className = "btn outline";
      logoutBtn.textContent = "Déconnexion";
      logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await window.sb.auth.signOut();
        window.location.reload();
      });
      loginBtn.parentNode.insertBefore(logoutBtn, loginBtn.nextSibling);
    }
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
      const email = document.getElementById("regEmail")?.value.trim();
      const pass = document.getElementById("regPass")?.value;
      const pass2 = document.getElementById("regPass2")?.value;

      if (!email || !pass || !pass2) { alert("Remplis tous les champs."); return; }
      if (pass.length < 6) { alert("Le mot de passe doit faire au moins 6 caractères."); return; }
      if (pass !== pass2) { alert("Les mots de passe ne correspondent pas."); return; }

      try {
        await registerUser(email, pass);
        alert("Compte créé. Vérifie ton e-mail si nécessaire.");
        modal.classList.remove("open");
        updateAuthUI();
      } catch (err) {
        alert("Erreur inscription : " + err.message);
      }
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      const email = document.getElementById("logEmail")?.value.trim();
      const pass = document.getElementById("logPass")?.value;

      if (!email || !pass) { alert("Remplis tous les champs."); return; }

      try {
        await loginUser(email, pass);
        alert("Connexion réussie !");
        modal.classList.remove("open");
        updateAuthUI();
      } catch (err) {
        alert("Erreur connexion : " + err.message);
      }
    });
  }
}

/* ============== FORMULAIRE DE VENTE → Supabase ============== */
function initSellForm() {
  const form = document.getElementById("sell-form");
  if (!form) return;

  // Aperçu des photos
  const inputPhotos = document.getElementById("photos");
  const preview = document.getElementById("preview");
  if (inputPhotos && preview) {
    inputPhotos.addEventListener("change", () => {
      preview.innerHTML = "";
      const files = Array.from(inputPhotos.files).slice(0, 6);
      files.forEach((file) => {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        preview.appendChild(img);
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const price = document.getElementById("price");
    const terms = document.getElementById("terms");

    if (price && (+price.value <= 0 || isNaN(+price.value))) {
      alert("Merci d'indiquer un prix valide.");
      price.focus();
      return;
    }
    if (terms && !terms.checked) {
      alert("Merci d'accepter les règles du site.");
      return;
    }

    // Vérifier que l'utilisateur est connecté
    const { data: userData } = await window.sb.auth.getUser();
    const user = userData?.user;

    if (!user) {
      alert("Tu dois être connecté pour publier une annonce.");
      return;
    }

    // Upload des photos vers Supabase Storage
    let imageUrl = null;
    const photosInput = document.getElementById("photos");
    if (photosInput && photosInput.files.length > 0) {
      const file = photosInput.files[0];
      const ext = file.name.split(".").pop();
      const filePath = user.id + "/" + Date.now() + "." + ext;

      const { error: uploadError } = await window.sb.storage
        .from("product-images")
        .upload(filePath, file);

      if (uploadError) {
        alert("Erreur upload image : " + uploadError.message);
        return;
      }

      const { data: urlData } = window.sb.storage
        .from("product-images")
        .getPublicUrl(filePath);

      imageUrl = urlData.publicUrl;
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
      image_url: imageUrl,
      ship_pickup: form.ship_pickup.checked,
      ship_post: form.ship_post.checked,
      ship_relay: form.ship_relay.checked,
      status: "published",
    };

    const { error } = await window.sb.from("products").insert([payload]);

    if (error) {
      alert("Erreur : " + error.message);
    } else {
      alert("Annonce publiée !");
      window.location.href = "category.html";
    }
  });

  // Bouton brouillon
  const draftBtn = document.getElementById("draftBtn");
  if (draftBtn) {
    draftBtn.addEventListener("click", async () => {
      const { data: userData } = await window.sb.auth.getUser();
      const user = userData?.user;
      if (!user) { alert("Tu dois être connecté."); return; }

      // Upload image si présente
      let imageUrl = null;
      const photosInput = document.getElementById("photos");
      if (photosInput && photosInput.files.length > 0) {
        const file = photosInput.files[0];
        const ext = file.name.split(".").pop();
        const filePath = user.id + "/" + Date.now() + "." + ext;

        const { error: uploadError } = await window.sb.storage
          .from("product-images")
          .upload(filePath, file);

        if (!uploadError) {
          const { data: urlData } = window.sb.storage
            .from("product-images")
            .getPublicUrl(filePath);
          imageUrl = urlData.publicUrl;
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
        image_url: imageUrl,
        ship_pickup: form.ship_pickup?.checked || false,
        ship_post: form.ship_post?.checked || false,
        ship_relay: form.ship_relay?.checked || false,
        status: "draft",
      };

      const { error } = await window.sb.from("products").insert([payload]);
      if (error) {
        alert("Erreur : " + error.message);
      } else {
        alert("Brouillon enregistré !");
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

  const img = document.createElement("img");
  img.src = product.image_url || "hero.png";
  img.alt = product.title;
  img.onerror = function () { this.src = "hero.png"; };
  card.appendChild(img);

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
async function loadCategoryProducts() {
  const grid = document.getElementById("category-grid");
  if (!grid) return;

  const params = new URLSearchParams(location.search);
  const cat = params.get("cat");
  const sub = params.get("sub");
  const q = params.get("q");

  let query = window.sb
    .from("products")
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (cat) query = query.eq("period", cat.replace(/-/g, " "));
  if (sub) query = query.eq("subcategory", sub.replace(/-/g, " "));
  if (q) query = query.ilike("title", "%" + q + "%");

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

/* ============== MENU CATÉGORIES (dropdown clic) ============== */
function initCategoryDropdowns() {
  document.querySelectorAll(".categories .dropbtn").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      const dropdown = button.parentElement;
      document.querySelectorAll(".categories .dropdown").forEach((d) => {
        if (d !== dropdown) d.classList.remove("open");
      });
      dropdown.classList.toggle("open");
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".categories")) {
      document.querySelectorAll(".categories .dropdown").forEach((d) => d.classList.remove("open"));
    }
  });
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

/* ============== I18N : bouton EN/FR ============== */
(function () {
  const dict = {
    en: {
      login: "Log in | Sign up",
      sell: "Sell",
      community: "Community",
      search: "Search items",
      search_sell: "Search an item",
      hero_title: "Ready to sell your items?",
      cta_sell: "Start selling",
      cta_how: "How it works",
      latest: "Latest items",
      reviews: "Reviews",
      reviews_note: 'Average rating: <strong>4.8/5</strong> (320 reviews)',
      explore: "Explore",
      social: "Social media",
      about: "About",
      how: "How it works",
      categories: "Categories",
      f_h1: "List an item",
      f_title: "Listing title",
      f_period: "Period",
      f_subcategory: "Sub-category",
      f_condition: "Condition",
      f_quantity: "Quantity",
      f_description: "Description",
      f_photos: "Photos (max 6)",
      f_ship: "Shipping options",
      ship_pickup: "Hand delivery",
      ship_post: "Postal shipping",
      ship_relay: "Pickup point",
      f_agree: "I certify that I comply with applicable laws and the site rules.",
      f_submit: "List item",
      f_draft: "Save draft",
      auth_title: "Sign up and start buying or selling your historical items today",
      oauth_apple: "Continue with Apple",
      oauth_google: "Continue with Google",
      oauth_facebook: "Continue with Facebook",
      reg_title: "Sign up with email",
      reg_email: "Email address",
      reg_pass: "Password (≥ 6 characters)",
      reg_pass2: "Confirm password",
      reg_btn: "Create my account",
      login_title: "Log in",
      login_email: "Email address",
      login_pass: "Password",
      login_btn: "Log in",
      auth_alt_html:
        'Or sign up with <a href="#" id="withEmail">your email address</a><br>' +
        'Already have an account? <a href="#" id="goLogin">Log in</a><br>' +
        'Are you a business? <a href="#">Learn more.</a>',
    },
    fr: {
      login: "Connexion | S'inscrire",
      sell: "Vendre",
      community: "Communauté",
      search: "Rechercher des articles",
      search_sell: "Rechercher un objet",
      hero_title: "Prêt à vendre vos pièces ?",
      cta_sell: "Commencer à vendre",
      cta_how: "Découvrir comment ça marche",
      latest: "Derniers articles mis en ligne",
      reviews: "Avis",
      reviews_note: 'Note moyenne : <strong>4,8/5</strong> (320 avis)',
      explore: "Découvrir",
      social: "Réseaux sociaux",
      about: "À propos",
      how: "Comment ça marche",
      categories: "Catégories",
      f_h1: "Mettre un article en vente",
      f_title: "Titre de l'annonce",
      f_period: "Période",
      f_subcategory: "Sous-catégorie",
      f_condition: "État",
      f_quantity: "Quantité",
      f_description: "Description",
      f_photos: "Photos (max 6)",
      f_ship: "Options d'envoi",
      ship_pickup: "Remise en main propre",
      ship_post: "Envoi postal",
      ship_relay: "Point relais",
      f_agree: "J'atteste respecter la législation en vigueur et les règles du site.",
      f_submit: "Mettre en vente",
      f_draft: "Enregistrer en brouillon",
      auth_title: "Inscrivez-vous et commencez dès aujourd'hui à acheter ou vendre vos pièces historiques",
      oauth_apple: "Continuer avec Apple",
      oauth_google: "Continuer avec Google",
      oauth_facebook: "Continuer avec Facebook",
      reg_title: "Inscription par e-mail",
      reg_email: "Adresse e-mail",
      reg_pass: "Mot de passe (≥ 6 caractères)",
      reg_pass2: "Confirmer le mot de passe",
      reg_btn: "Créer mon compte",
      login_title: "Connexion",
      login_email: "Adresse e-mail",
      login_pass: "Mot de passe",
      login_btn: "Se connecter",
      auth_alt_html:
        'Ou inscris-toi avec <a href="#" id="withEmail">ton adresse e-mail</a><br>' +
        'Tu as déjà un compte ? <a href="#" id="goLogin">Se connecter</a><br>' +
        'Tu es une entreprise ? <a href="#">En savoir plus.</a>',
    },
  };

  function setBtnLabel(lang) {
    const btn = document.getElementById("lang-toggle");
    if (btn) btn.textContent = lang === "fr" ? "EN" : "FR";
  }

  function setLabel(forId, text) {
    const lbl = document.querySelector('label[for="' + forId + '"]');
    if (lbl) lbl.textContent = text;
  }

  function translatePage(lang) {
    const d = dict[lang];
    setBtnLabel(lang);

    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) loginBtn.textContent = d.login;

    const sellLink = document.querySelector('a.btn.white[href="sell.html"]') ||
      document.querySelector('a.btn[href="sell.html"]');
    if (sellLink) sellLink.textContent = d.sell;

    const community = document.querySelector('a.btn[href="community.html"]');
    if (community) community.textContent = d.community;

    const sInput = document.querySelector('.search input[type="search"]');
    if (sInput) {
      const page = (location.pathname.split("/").pop() || "").toLowerCase();
      sInput.placeholder = page === "sell.html" ? d.search_sell : d.search;
    }

    const heroH2 = document.querySelector(".hero-sell__card h2");
    if (heroH2) heroH2.textContent = d.hero_title;
    const ctaBtn = document.querySelector(".hero-sell .cta-btn");
    if (ctaBtn) ctaBtn.textContent = d.cta_sell;
    const ctaLink = document.querySelector(".hero-sell .cta-link");
    if (ctaLink) ctaLink.textContent = d.cta_how;

    const latestH2 = document.querySelector(".latest-items h2");
    if (latestH2) latestH2.textContent = d.latest;
    const revH2 = document.querySelector(".reviews h2");
    if (revH2) revH2.textContent = d.reviews;
    const revNote = document.querySelector(".reviews__note");
    if (revNote) revNote.innerHTML = d.reviews_note;

    document.querySelectorAll(".footer-col h3 a").forEach((a) => {
      if (/Athena Militaria/i.test(a.textContent)) return;
      if (/Découvrir|Explore/i.test(a.textContent)) a.textContent = d.explore;
      if (/Réseaux sociaux|Social media/i.test(a.textContent)) a.textContent = d.social;
    });
    document.querySelectorAll(".footer-col ul li a").forEach((a) => {
      if (/À propos|About/i.test(a.textContent)) a.textContent = d.about;
      if (/Comment ça marche|How it works/i.test(a.textContent)) a.textContent = d.how;
    });

    const sidebarTitle = document.querySelector(".sidebar h2");
    if (sidebarTitle) sidebarTitle.textContent = d.categories;

    const form = document.getElementById("sell-form");
    if (form) {
      const h1 = document.querySelector("h1");
      if (h1) h1.textContent = d.f_h1;
      setLabel("title", d.f_title);
      setLabel("period", d.f_period);
      setLabel("subcategory", d.f_subcategory);
      setLabel("condition", d.f_condition);
      setLabel("quantity", d.f_quantity);
      setLabel("description", d.f_description);
      setLabel("photos", d.f_photos);

      const legend = form.querySelector("fieldset.ship legend");
      if (legend) legend.textContent = d.f_ship;

      form.querySelectorAll("fieldset.ship label").forEach((l) => {
        const txt = l.innerText.trim();
        if (/Remise|Hand delivery/i.test(txt)) l.lastChild.textContent = " " + d.ship_pickup;
        if (/Envoi postal|Postal shipping/i.test(txt)) l.lastChild.textContent = " " + d.ship_post;
        if (/Point relais|Pickup point/i.test(txt)) l.lastChild.textContent = " " + d.ship_relay;
      });

      const agree = document.querySelector("label.agree");
      if (agree) agree.lastChild.textContent = " " + d.f_agree;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.textContent = d.f_submit;
      const draft = document.getElementById("draftBtn");
      if (draft) draft.textContent = d.f_draft;
    }

    const auth = document.getElementById("authModal");
    if (auth) {
      const title = auth.querySelector("#authTitle");
      if (title) title.textContent = d.auth_title;
      auth.querySelectorAll(".oauth-btn").forEach((btn) => {
        if (btn.textContent.includes("Apple")) btn.lastChild.textContent = " " + d.oauth_apple;
        if (btn.textContent.includes("Google")) btn.lastChild.textContent = " " + d.oauth_google;
        if (btn.textContent.includes("Facebook")) btn.lastChild.textContent = " " + d.oauth_facebook;
      });
      const alt = auth.querySelector(".auth-alt");
      if (alt) alt.innerHTML = d.auth_alt_html;

      const r = document.getElementById("panel-register");
      if (r) {
        const h3 = r.querySelector("h3");
        if (h3) h3.textContent = d.reg_title;
        const inputs = r.querySelectorAll("input");
        if (inputs[0]) inputs[0].placeholder = d.reg_email;
        if (inputs[1]) inputs[1].placeholder = d.reg_pass;
        if (inputs[2]) inputs[2].placeholder = d.reg_pass2;
        const btn = r.querySelector("button.submit-btn");
        if (btn) btn.textContent = d.reg_btn;
      }

      const l = document.getElementById("panel-login");
      if (l) {
        const h3 = l.querySelector("h3");
        if (h3) h3.textContent = d.login_title;
        const inputs = l.querySelectorAll("input");
        if (inputs[0]) inputs[0].placeholder = d.login_email;
        if (inputs[1]) inputs[1].placeholder = d.login_pass;
        const btn = l.querySelector("button.submit-btn");
        if (btn) btn.textContent = d.login_btn;
      }
    }
  }

  function initLang() {
    const saved = localStorage.getItem("lang") || "fr";
    translatePage(saved);

    const btn = document.getElementById("lang-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const curr = localStorage.getItem("lang") || "fr";
        const next = curr === "fr" ? "en" : "fr";
        localStorage.setItem("lang", next);
        translatePage(next);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", initLang);
})();

/* ============== INIT GLOBAL ============== */
document.addEventListener("DOMContentLoaded", () => {
  updateAuthUI();
  initAuthModal();
  initSellForm();
  initCategoryDropdowns();
  initSearch();
  loadLatestProducts();
  loadCategoryProducts();
});
