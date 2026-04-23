document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("product-container");
  if (!root) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    root.innerHTML = "<p>Produit introuvable.</p>";
    return;
  }

  const { data: product, error } = await window.sb
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !product) {
    root.innerHTML = "<p>Produit introuvable.</p>";
    return;
  }

  // Mettre à jour les meta dynamiquement (SEO + partage)
  const esc = window.escapeHtml || ((s) => s);
  const price = window.formatPrice ? window.formatPrice(product.price) : (product.price + " €");
  document.title = (product.title || "Article") + " : Athena Militaria";
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", (product.description || "").slice(0, 155));
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", product.title || "Article");
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute("content", (product.description || "").slice(0, 200));
  let ogImg = document.querySelector('meta[property="og:image"]');
  if (!ogImg) {
    ogImg = document.createElement("meta");
    ogImg.setAttribute("property", "og:image");
    document.head.appendChild(ogImg);
  }
  ogImg.setAttribute("content", product.image_url || (location.origin + "/hero.png"));

  // Canonical dynamique
  const canon = document.getElementById("canonical-link");
  if (canon) canon.setAttribute("href", "https://www.athenamilitaria.fr/product.html?id=" + product.id);

  // og:url dynamique
  let ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute("content", "https://www.athenamilitaria.fr/product.html?id=" + product.id);

  // JSON-LD Product (rich snippets Google) + BreadcrumbList
  const oldLd = document.getElementById("product-jsonld");
  if (oldLd) oldLd.remove();
  const ld = document.createElement("script");
  ld.type = "application/ld+json";
  ld.id = "product-jsonld";
  const productUrl = "https://www.athenamilitaria.fr/product.html?id=" + product.id;
  const productJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "name": product.title || "Article militaria",
        "description": (product.description || "").slice(0, 500),
        "image": product.image_url || "https://www.athenamilitaria.fr/hero.png",
        "url": productUrl,
        "sku": String(product.id),
        "category": product.subcategory || "Militaria",
        "brand": { "@type": "Brand", "name": "Athena Militaria" },
        "offers": {
          "@type": "Offer",
          "url": productUrl,
          "priceCurrency": "EUR",
          "price": Number(product.price) || 0,
          "itemCondition": product.condition === "Neuf"
            ? "https://schema.org/NewCondition"
            : "https://schema.org/UsedCondition",
          "availability": product.status === "sold"
            ? "https://schema.org/SoldOut"
            : "https://schema.org/InStock",
          "seller": { "@type": "Organization", "name": "Athena Militaria" }
        }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Accueil", "item": "https://www.athenamilitaria.fr/" },
          { "@type": "ListItem", "position": 2, "name": product.subcategory || "Articles", "item": "https://www.athenamilitaria.fr/category.html?subcategory=" + encodeURIComponent(product.subcategory || "") },
          { "@type": "ListItem", "position": 3, "name": product.title || "Article" }
        ]
      }
    ]
  };
  ld.textContent = JSON.stringify(productJsonLd);
  document.head.appendChild(ld);

  const isSold = product.status === "sold";
  const soldOverlay = isSold ? '<div class="sold-overlay">VENDU</div>' : '';

  // Vérifier si l'utilisateur est connecté (pour gérer le flou des objets sensibles)
  const { data: { user: currentUser } } = await window.sb.auth.getUser();
  const isSensitive = !!product.historically_sensitive;
  const shouldBlur = isSensitive && !currentUser;

  // Galerie multi-photos : utilise image_urls[] si présent, sinon fallback sur image_url
  const photosList = (Array.isArray(product.image_urls) && product.image_urls.length > 0)
    ? product.image_urls
    : (product.image_url ? [product.image_url] : ['hero.png']);
  const hasGallery = photosList.length > 1;

  const sensitiveOverlayHtml = shouldBlur ? `
    <div class="sensitive-overlay sensitive-overlay-large">
      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <strong>Pièce historiquement sensible</strong>
      <span>Connectez-vous pour afficher les photos</span>
    </div>
  ` : '';

  const sensitiveBadgeHtml = isSensitive ? `
    <div class="sensitive-badge-bar">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>Cet article porte un insigne ou symbole historique dissous. Présenté dans un strict cadre de collection.</span>
    </div>
  ` : '';

  const mainImgHtml = `
    <img id="product-main-img" src="${esc(photosList[0])}" alt="${esc(product.title || '')}" class="product-img${shouldBlur ? ' is-blurred' : ''}"
         fetchpriority="high" decoding="async" onerror="this.src='hero.png'">
    ${sensitiveOverlayHtml}
  `;
  const thumbsHtml = hasGallery ? `
    <div class="product-thumbs" role="tablist" aria-label="Photos de l'article">
      ${photosList.map((url, i) => `
        <button type="button" class="product-thumb${i === 0 ? ' is-active' : ''}${shouldBlur ? ' is-blurred' : ''}" data-img="${esc(url)}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" aria-label="Photo ${i + 1}">
          <img src="${esc(url)}" alt="" loading="lazy" decoding="async" onerror="this.src='hero.png'">
        </button>
      `).join('')}
    </div>
  ` : '';

  root.innerHTML = `
    <nav class="breadcrumb" aria-label="Fil d'Ariane">
      <a href="index.html">Accueil</a>
      <span>›</span>
      <a href="category.html?subcategory=${encodeURIComponent(product.subcategory || '')}">${esc(product.subcategory || 'Articles')}</a>
      <span>›</span>
      <span class="crumb-current">${esc(product.title || '')}</span>
    </nav>

    ${sensitiveBadgeHtml}

    <div class="product-grid">
      <div class="product-image ${isSold ? 'is-sold' : ''}${shouldBlur ? ' has-sensitive' : ''}">
        ${soldOverlay}
        ${mainImgHtml}
        ${thumbsHtml}
      </div>
      <div class="info">
        <div class="p-price-row">
          <div class="p-price">${price}</div>
          ${isSold ? '<span class="p-sold-badge">Vendu</span>' : ''}
        </div>
        <h1 class="p-title">${esc(product.title || '')}</h1>
        ${product.condition ? `<span class="p-badge">${esc(product.condition)}</span>` : ''}
        <p class="p-short">${esc(product.description || '')}</p>
        <ul class="p-vendor">
          ${product.period ? `<li><strong>Période</strong> <span>${esc(product.period)}</span></li>` : ''}
          ${product.subcategory ? `<li><strong>Sous-catégorie</strong> <span>${esc(product.subcategory)}</span></li>` : ''}
          ${product.location ? `<li><strong>Lieu</strong> <span>${esc(product.location)}</span></li>` : ''}
          ${product.quantity ? `<li><strong>Stock</strong> <span>${esc(product.quantity)}</span></li>` : ''}
          <li><strong>Publié</strong> <span>${window.timeAgo ? window.timeAgo(product.created_at) : ''}</span></li>
        </ul>
        <div class="product-actions">
          ${isSold
            ? '<button class="cta-btn" disabled style="opacity:.5;cursor:not-allowed">Article vendu</button>'
            : `<button class="cta-btn" id="buyBtn">Acheter — ${price}</button>`
          }
          <button class="btn outline fav-btn" id="favBtn" data-id="${product.id}">♡ Ajouter aux favoris</button>
          <button class="btn outline" id="contactSellerBtn">✉ Contacter le vendeur</button>
        </div>

        <!-- Signalement -->
        <button class="report-link" id="reportBtn" title="Signaler cet article">⚠ Signaler cet article</button>

        <!-- Partage social -->
        <div class="share-row" role="group" aria-label="Partager cet article">
          <span class="share-label">Partager :</span>
          <button class="share-btn" data-share="copy" title="Copier le lien" aria-label="Copier le lien">🔗</button>
          <a class="share-btn" data-share="facebook" title="Facebook" aria-label="Partager sur Facebook" target="_blank" rel="noopener">f</a>
          <a class="share-btn" data-share="twitter" title="X / Twitter" aria-label="Partager sur X" target="_blank" rel="noopener">𝕏</a>
          <a class="share-btn" data-share="whatsapp" title="WhatsApp" aria-label="Partager sur WhatsApp" target="_blank" rel="noopener">✆</a>
          <a class="share-btn" data-share="email" title="E-mail" aria-label="Partager par e-mail">✉</a>
        </div>
      </div>
    </div>

    <!-- Bloc vendeur -->
    <section class="seller-card" id="seller-card" aria-label="Informations vendeur">
      <div class="seller-loading">Chargement des infos vendeur…</div>
    </section>

    <!-- Produits similaires -->
    <section class="similar-products" id="similar-products" aria-label="Articles similaires">
      <div class="similar-header">
        <h2>Articles similaires</h2>
        <a href="category.html?subcategory=${encodeURIComponent(product.subcategory || '')}" class="similar-link">Voir plus →</a>
      </div>
      <div class="similar-grid" id="similar-grid">
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
        <div class="skeleton-card"><div class="skeleton-block"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
      </div>
    </section>

    <!-- Avis -->
    <div class="user-reviews" id="reviews-section">
      <h2>Avis sur cet article</h2>
      <div id="reviews-list"><p class="empty-muted">Chargement…</p></div>
      <div class="review-form" id="review-form" style="display:none">
        <h3>Laisser un avis</h3>
        <div class="star-input" id="star-input">
          <button type="button" data-star="1" aria-label="1 étoile">★</button>
          <button type="button" data-star="2" aria-label="2 étoiles">★</button>
          <button type="button" data-star="3" aria-label="3 étoiles">★</button>
          <button type="button" data-star="4" aria-label="4 étoiles">★</button>
          <button type="button" data-star="5" aria-label="5 étoiles">★</button>
        </div>
        <textarea id="review-comment" placeholder="Votre commentaire (optionnel)"></textarea>
        <button class="cta-btn" id="submitReview" type="button">Publier l'avis</button>
      </div>
    </div>
  `;

  // Interaction galerie : clic sur une miniature → change l'image principale
  if (hasGallery) {
    const mainImg = document.getElementById("product-main-img");
    document.querySelectorAll(".product-thumb").forEach((thumb) => {
      thumb.addEventListener("click", () => {
        const url = thumb.dataset.img;
        if (url && mainImg) {
          mainImg.src = url;
          document.querySelectorAll(".product-thumb").forEach((t) => {
            t.classList.remove("is-active");
            t.setAttribute("aria-selected", "false");
          });
          thumb.classList.add("is-active");
          thumb.setAttribute("aria-selected", "true");
        }
      });
    });
  }

  // --- Partage social ---
  const shareUrl = window.location.href;
  const shareText = (product.title || "Article") + " : Athena Militaria";
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
          window.toastSuccess ? toastSuccess("Lien copié !") : null;
        } catch {
          window.toastError ? toastError("Impossible de copier le lien") : null;
        }
      });
    } else if (shareMap[kind]) {
      el.setAttribute("href", shareMap[kind]);
    }
  });

  // --- Charger le vendeur ---
  loadSellerInfo(product.user_id);

  // Charger les avis
  loadReviews(id);

  // Charger les produits similaires
  loadSimilarProducts(product);

  // Bouton contacter le vendeur
  const contactBtn = document.getElementById("contactSellerBtn");
  if (contactBtn) {
    contactBtn.addEventListener("click", async () => {
      const { data: { user } } = await window.sb.auth.getUser();
      if (!user) {
        toast("Connecte-toi pour contacter le vendeur.");
        return;
      }
      if (user.id === product.user_id) {
        toast("C'est ton propre article !");
        return;
      }
      window.location.href = "messages.html?to=" + product.user_id + "&product=" + id;
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
        document.querySelectorAll("#star-input button").forEach((b, i) => {
          b.classList.toggle("active", i < selectedRating);
        });
      });
    });

    document.getElementById("submitReview")?.addEventListener("click", async () => {
      if (selectedRating === 0) {
        toast("Sélectionne une note.");
        return;
      }
      const comment = document.getElementById("review-comment")?.value || "";
      const { error } = await window.sb.from("reviews").insert([{
        product_id: Number(id),
        reviewer_id: currentUser.id,
        rating: selectedRating,
        comment,
      }]);
      if (error) {
        if (error.code === "23505") {
          toast("Tu as déjà laissé un avis sur cet article.");
        } else {
          toastError("Erreur : " + error.message);
        }
      } else {
        toastSuccess("Avis publié !");
        loadReviews(id);
        reviewForm.style.display = "none";
      }
    });
  }

  // Bouton Favori
  const favBtn = document.getElementById("favBtn");
  if (favBtn) {
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
        favBtn.innerHTML = "♥ Dans vos favoris";
        favBtn.classList.add("fav-active");
      }

      favBtn.addEventListener("click", async () => {
        if (favBtn.classList.contains("fav-active")) {
          await window.sb.from("favorites").delete().eq("user_id", user.id).eq("product_id", id);
          favBtn.innerHTML = "♡ Ajouter aux favoris";
          favBtn.classList.remove("fav-active");
        } else {
          await window.sb.from("favorites").insert([{ user_id: user.id, product_id: Number(id) }]);
          favBtn.innerHTML = "♥ Dans vos favoris";
          favBtn.classList.add("fav-active");
        }
      });
    } else {
      favBtn.addEventListener("click", () => {
        toast("Connecte-toi pour ajouter aux favoris.");
      });
    }
  }

  // Bouton Acheter → Stripe Checkout
  document.getElementById("buyBtn").addEventListener("click", async () => {
    const btn = document.getElementById("buyBtn");
    btn.textContent = "Redirection vers le paiement...";
    btn.disabled = true;

    try {
      // Récupère la clé anon (partagée via window.sb), + éventuel token user si connecté
      const { data: { session } } = await window.sb.auth.getSession();
      const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdGF4Z2ZxZG94dGNpZGxseWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzQ0NzgsImV4cCI6MjA5MTQ1MDQ3OH0.AEFktTgMmccF0UiKcCiJBTej0Px5q6_jqi7l7hgePVA";
      const authToken = session?.access_token || ANON_KEY;

      const res = await fetch(
        "https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/create-checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": ANON_KEY,
            "Authorization": "Bearer " + authToken,
          },
          body: JSON.stringify({ productId: id }),
        }
      );

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        toastError("Erreur : " + (data.error || "Impossible de créer le paiement"));
        btn.textContent = "Acheter — " + product.price + " €";
        btn.disabled = false;
      }
    } catch (err) {
      toastError("Erreur : " + err.message);
      btn.textContent = "Acheter — " + product.price + " €";
      btn.disabled = false;
    }
  });

  // Bouton Signaler
  const reportBtn = document.getElementById("reportBtn");
  if (reportBtn) {
    reportBtn.addEventListener("click", () => openReportModal(product));
  }
});

/* ============== Modale de signalement ============== */
function openReportModal(product) {
  const existing = document.getElementById("reportModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "reportModal";
  modal.className = "report-modal-overlay";
  modal.innerHTML = `
    <div class="report-modal-box" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
      <button class="report-close" type="button" aria-label="Fermer">×</button>
      <h2 id="reportTitle">Signaler cet article</h2>
      <p class="report-sub">Aidez-nous à garder Athena Militaria sûr. Les articles signalés sont examinés par notre équipe.</p>

      <label class="report-label">Raison du signalement *</label>
      <select id="reportReason" required>
        <option value="">-- Choisir --</option>
        <option value="Contrefaçon / faux">Contrefaçon / faux</option>
        <option value="Objet illégal">Objet illégal (arme non neutralisée, etc.)</option>
        <option value="Contenu haineux ou illégal">Contenu haineux ou illégal</option>
        <option value="Arnaque / fraude">Arnaque ou fraude suspectée</option>
        <option value="Description trompeuse">Description trompeuse</option>
        <option value="Doublon">Doublon (article déjà en ligne)</option>
        <option value="Autre">Autre</option>
      </select>

      <label class="report-label">Description (optionnel)</label>
      <textarea id="reportDesc" rows="4" placeholder="Précise ce qui te semble suspect…"></textarea>

      <div class="report-actions">
        <button type="button" class="btn outline" id="reportCancel">Annuler</button>
        <button type="button" class="cta-btn" id="reportSend">Envoyer le signalement</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = "hidden";

  const close = () => {
    modal.remove();
    document.body.style.overflow = "";
  };
  modal.querySelector(".report-close").addEventListener("click", close);
  document.getElementById("reportCancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  document.getElementById("reportSend").addEventListener("click", async () => {
    const reason = document.getElementById("reportReason").value;
    const description = document.getElementById("reportDesc").value.trim();
    if (!reason) {
      (window.toastWarn || window.toast)("Choisis une raison.");
      return;
    }
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
      (window.toastError || window.toast)("Erreur : " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)("Merci ! Le signalement a été envoyé à l'équipe.");
    close();
  });
}

/* Charger les produits similaires (même sous-catégorie ou catégorie) */
async function loadSimilarProducts(currentProduct) {
  const grid = document.getElementById("similar-grid");
  if (!grid) return;

  let query = window.sb
    .from("products")
    .select("id, title, price, image_url, condition, subcategory, category, historically_sensitive")
    .neq("id", currentProduct.id)
    .limit(5);

  // Priorité : même sous-catégorie, sinon même catégorie, sinon tout
  if (currentProduct.subcategory) {
    query = query.eq("subcategory", currentProduct.subcategory);
  } else if (currentProduct.category) {
    query = query.eq("category", currentProduct.category);
  }

  let { data, error } = await query;

  // Si pas assez de produits dans la sous-catégorie, compléter avec la catégorie
  if (!error && data && data.length < 4 && currentProduct.category) {
    const { data: extra } = await window.sb
      .from("products")
      .select("id, title, price, image_url, condition, subcategory, category, historically_sensitive")
      .eq("category", currentProduct.category)
      .neq("id", currentProduct.id)
      .limit(5);
    if (extra) {
      const ids = new Set(data.map(d => d.id));
      extra.forEach(p => { if (!ids.has(p.id)) data.push(p); });
      data = data.slice(0, 5);
    }
  }

  // Fallback : n'importe quels produits récents
  if (!data || data.length === 0) {
    const { data: fallback } = await window.sb
      .from("products")
      .select("id, title, price, image_url, condition, subcategory, category, historically_sensitive")
      .neq("id", currentProduct.id)
      .order("created_at", { ascending: false })
      .limit(5);
    data = fallback || [];
  }

  if (!data || data.length === 0) {
    grid.innerHTML = '<p class="similar-empty">Aucun article similaire pour le moment.</p>';
    return;
  }

  // État auth pour flou sensible
  const { data: { user: currentUserSim } } = await window.sb.auth.getUser();

  grid.innerHTML = data.map(p => {
    const blur = !!p.historically_sensitive && !currentUserSim;
    return `
    <a href="product.html?id=${p.id}" class="similar-card" aria-label="${p.title}">
      <div class="similar-img-wrap${blur ? ' is-blurred' : ''}">
        <img src="${p.image_url || 'hero.png'}" alt="${p.title}" loading="lazy" decoding="async" onerror="this.src='hero.png'">
        ${blur ? '<div class="sensitive-overlay"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Connectez-vous</span></div>' : ''}
      </div>
      <div class="similar-info">
        <div class="similar-price">${p.price} €</div>
        <div class="similar-title">${p.title}</div>
        ${p.condition ? `<div class="similar-badge">${p.condition}</div>` : ''}
      </div>
    </a>
  `;}).join('');
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
    const { data } = await window.sb
      .from("profiles")
      .select("id, pseudo, avatar_url, created_at, location")
      .eq("id", sellerId)
      .maybeSingle();
    profile = data;
  } catch (e) { /* table peut ne pas exister */ }

  // Statistiques : nb annonces actives + nb ventes
  const [activeRes, soldRes] = await Promise.all([
    window.sb.from("products").select("id", { count: "exact", head: true }).eq("user_id", sellerId).neq("status", "sold"),
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

  const pseudo = profile?.pseudo || "Vendeur";
  const avatarLetter = (pseudo[0] || "V").toUpperCase();
  const avatarHtml = profile?.avatar_url
    ? `<img src="${esc(profile.avatar_url)}" alt="${esc(pseudo)}" class="seller-avatar-img">`
    : `<div class="seller-avatar">${esc(avatarLetter)}</div>`;

  const sinceTxt = profile?.created_at
    ? `Membre depuis ${new Date(profile.created_at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`
    : "";

  const starsHtml = avgRating != null
    ? `<span class="seller-stars">${"★".repeat(Math.round(avgRating))}${"☆".repeat(5 - Math.round(avgRating))}</span>
       <span class="seller-rating-num">${avgRating.toFixed(1)} (${nbReviews})</span>`
    : `<span class="seller-rating-empty">Pas encore d'avis</span>`;

  card.innerHTML = `
    <div class="seller-left">
      ${avatarHtml}
      <div class="seller-meta">
        <div class="seller-name">${esc(pseudo)}</div>
        ${sinceTxt ? `<div class="seller-since">${esc(sinceTxt)}</div>` : ''}
        ${profile?.location ? `<div class="seller-loc">📍 ${esc(profile.location)}</div>` : ''}
      </div>
    </div>
    <div class="seller-stats">
      <div class="seller-stat"><strong>${nbActive}</strong><span>annonces actives</span></div>
      <div class="seller-stat"><strong>${nbSold}</strong><span>ventes réalisées</span></div>
      <div class="seller-stat seller-rating">${starsHtml}</div>
    </div>
  `;
}

/* Charger les avis d'un produit */
async function loadReviews(productId) {
  const list = document.getElementById("reviews-list");
  if (!list) return;

  const { data, error } = await window.sb
    .from("reviews")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) {
    list.innerHTML = "<p>Aucun avis pour le moment.</p>";
    return;
  }

  list.innerHTML = "";
  data.forEach((review) => {
    const card = document.createElement("div");
    card.className = "user-review-card";

    const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    const date = new Date(review.created_at).toLocaleDateString("fr-FR", {
      day: "numeric", month: "long", year: "numeric"
    });

    card.innerHTML = `
      <span class="review-stars">${stars}</span>
      <span class="review-date">${date}</span>
      ${review.comment ? "<p>" + review.comment + "</p>" : ""}
    `;
    list.appendChild(card);
  });
}
