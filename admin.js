/* ============== PAGE ADMIN ============== */

// Liste des emails admin autorisés
const ADMIN_EMAILS = ["sayrox.ar@gmail.com", "renduambroise@gmail.com"];

const esc = (s) => (window.escapeHtml ? window.escapeHtml(s || "") : (s || ""));
let currentReportFilter = "pending";

document.addEventListener("DOMContentLoaded", async () => {
  const denied = document.getElementById("admin-denied");
  const panel = document.getElementById("admin-panel");
  if (!denied || !panel) return;

  const { data: { user } } = await window.sb.auth.getUser();

  if (!user || !ADMIN_EMAILS.includes(user.email)) {
    denied.style.display = "block";
    return;
  }

  panel.style.display = "block";

  // Onglets
  const tabs = document.querySelectorAll(".tab-btn");
  const contents = document.querySelectorAll(".tab-content");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      contents.forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab)?.classList.add("active");
    });
  });

  // Filtres de signalements
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentReportFilter = btn.dataset.filter;
      loadAdminReports();
    });
  });

  // Recherche + filtres + tri des articles
  const searchInput = document.getElementById("admin-product-search");
  if (searchInput) {
    let debounce;
    searchInput.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => loadAdminProducts(), 200);
    });
  }
  document.querySelectorAll("#admin-product-status-filter .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#admin-product-status-filter .filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadAdminProducts();
    });
  });
  document.getElementById("admin-product-sort")?.addEventListener("change", () => loadAdminProducts());

  // Recherche + filtres + tri des utilisateurs
  const userSearchInput = document.getElementById("admin-user-search");
  if (userSearchInput) {
    let debounce2;
    userSearchInput.addEventListener("input", () => {
      clearTimeout(debounce2);
      debounce2 = setTimeout(() => loadAdminUsers(), 200);
    });
  }
  document.querySelectorAll("#admin-user-status-filter .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#admin-user-status-filter .filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadAdminUsers();
    });
  });
  document.getElementById("admin-user-sort")?.addEventListener("change", () => loadAdminUsers());

  // Charger les données
  loadAdminStats();
  loadAdminReports();
  loadAdminOrders();
  loadAdminProducts();
  loadAdminUsers();
  loadReportsBadge();
  loadBlockedUsersBadge();
});

/* ============== STATS ============== */
async function loadAdminStats() {
  const { data: orders } = await window.sb.from("orders").select("amount");
  const totalOrders = orders ? orders.length : 0;
  const revenue = orders ? orders.reduce((s, o) => s + Number(o.amount), 0) : 0;
  document.getElementById("stat-orders").textContent = totalOrders;
  document.getElementById("stat-revenue").textContent = revenue.toFixed(2) + " €";

  const { count: productCount } = await window.sb
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");
  document.getElementById("stat-products").textContent = productCount || 0;

  const { data: sellers } = await window.sb.from("products").select("user_id");
  const uniqueUsers = new Set(sellers?.map((s) => s.user_id) || []);
  document.getElementById("stat-users").textContent = uniqueUsers.size;
}

/* ============== BADGE "À TRAITER" ============== */
async function loadReportsBadge() {
  const { count } = await window.sb
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  const badge = document.getElementById("reports-badge");
  if (badge) {
    if (count && count > 0) {
      badge.textContent = count;
      badge.style.display = "inline-flex";
    } else {
      badge.style.display = "none";
    }
  }
}

/* ============== SIGNALEMENTS ============== */
async function loadAdminReports() {
  const list = document.getElementById("admin-reports-list");
  if (!list) return;
  list.innerHTML = '<p class="admin-loading">Chargement...</p>';

  let query = window.sb
    .from("reports")
    .select("*, products(id, title, image_url, price, user_id, description)")
    .order("created_at", { ascending: false });

  if (currentReportFilter !== "all") {
    query = query.eq("status", currentReportFilter);
  }

  const { data, error } = await query;

  if (error) {
    list.innerHTML = `<p class="admin-error">Erreur : ${esc(error.message)}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `
      <div class="admin-empty">
        <div class="admin-empty-icon">✓</div>
        <h3>Aucun signalement ${currentReportFilter === 'pending' ? 'à traiter' : ''}</h3>
        <p>${currentReportFilter === 'pending' ? 'Tout est clean pour le moment !' : 'La liste est vide.'}</p>
      </div>`;
    return;
  }

  list.innerHTML = "";
  data.forEach((r) => {
    const card = document.createElement("div");
    card.className = "report-card report-status-" + r.status;

    const product = r.products;
    const productHtml = product
      ? `
        <a href="product.html?id=${product.id}" target="_blank" class="report-product">
          <img src="${esc(product.image_url || 'hero.png')}" alt="" onerror="this.src='hero.png'">
          <div class="report-product-info">
            <strong>${esc(product.title)}</strong>
            <span class="report-product-price">${product.price} €</span>
          </div>
        </a>`
      : `<div class="report-product-deleted">⚠ Article déjà supprimé</div>`;

    const date = new Date(r.created_at).toLocaleString("fr-FR", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });

    card.innerHTML = `
      <div class="report-head">
        <span class="report-reason">${esc(r.reason)}</span>
        <span class="report-status-badge ${r.status}">${statusLabel(r.status)}</span>
      </div>
      ${productHtml}
      ${r.description ? `<div class="report-desc">"${esc(r.description)}"</div>` : ''}
      <div class="report-meta">
        <span>👤 ${esc(r.reporter_email || 'Anonyme')}</span>
        <span>🕐 ${date}</span>
      </div>
      ${r.status === 'pending' ? `
        <div class="report-actions-bar">
          ${product ? `<button class="btn danger" data-action="delete-product" data-pid="${product.id}" data-rid="${r.id}">🗑 Supprimer l'article</button>` : ''}
          <button class="btn outline" data-action="dismiss" data-rid="${r.id}">Ignorer</button>
          <button class="btn outline" data-action="resolve" data-rid="${r.id}">Marquer traité</button>
        </div>
      ` : ''}
    `;

    list.appendChild(card);
  });

  // Brancher les actions
  list.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener("click", () => handleReportAction(btn));
  });
}

function statusLabel(s) {
  return s === "pending" ? "À traiter" : s === "resolved" ? "Traité" : "Ignoré";
}

async function handleReportAction(btn) {
  const action = btn.dataset.action;
  const rid = btn.dataset.rid;
  const pid = btn.dataset.pid;

  if (action === "delete-product") {
    const ok = await (window.askConfirm
      ? window.askConfirm("Supprimer définitivement l'article signalé ? Cette action est irréversible et le marquera comme traité.",
          { title: "Supprimer l'article", okText: "Supprimer", danger: true })
      : Promise.resolve(confirm("Supprimer l'article ?")));
    if (!ok) return;

    const { error: delErr } = await window.sb.from("products").delete().eq("id", pid);
    if (delErr) {
      (window.toastError || window.toast)("Suppression impossible : " + delErr.message);
      return;
    }
    // Marquer comme résolu
    const { data: { user } } = await window.sb.auth.getUser();
    await window.sb.from("reports").update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    }).eq("id", rid);

    (window.toastSuccess || window.toast)("Article supprimé et signalement clôturé.");
  }

  else if (action === "dismiss" || action === "resolve") {
    const { data: { user } } = await window.sb.auth.getUser();
    const { error } = await window.sb.from("reports").update({
      status: action === "dismiss" ? "dismissed" : "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    }).eq("id", rid);
    if (error) {
      (window.toastError || window.toast)("Erreur : " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)(action === "dismiss" ? "Signalement ignoré." : "Signalement marqué comme traité.");
  }

  loadAdminReports();
  loadReportsBadge();
  loadAdminStats();
}

/* ============== COMMANDES ============== */
async function loadAdminOrders() {
  const list = document.getElementById("admin-orders-list");
  if (!list) return;

  const { data, error } = await window.sb
    .from("orders")
    .select("*, products(title, image_url)")
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) {
    list.innerHTML = "<p>Aucune commande.</p>";
    return;
  }

  list.innerHTML = "";
  data.forEach((order) => {
    const row = document.createElement("div");
    row.className = "order-row";
    row.innerHTML = `
      <img src="${esc(order.products?.image_url || 'hero.png')}" alt="" onerror="this.src='hero.png'">
      <div class="order-info">
        <h3>${esc(order.products?.title || 'Article #' + order.product_id)}</h3>
        <p>${esc(order.customer_email || 'Email inconnu')} — ${new Date(order.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}</p>
      </div>
      <div class="order-amount">${order.amount} €</div>
      <span class="order-status paid">Payé</span>
    `;
    list.appendChild(row);
  });
}

/* ============== ARTICLES (avec filtres, tri, détection suspects) ============== */

// Mots-clés déclenchant la détection automatique de contenu suspect
// (symboles/termes interdits en France : loi Gayssot, art. R645-1 Code pénal)
const SUSPECT_KEYWORDS = [
  "nazi", "nazie", "nazis",
  "ss ", " ss", "waffen", "waffen-ss", "totenkopf",
  "hitler", "himmler", "goering", "goebbels",
  "swastika", "croix gammée", "croix gammees", "gammée", "gammee",
  "reich", "iiie reich", "iii reich", "3e reich", "3eme reich", "troisième reich",
  "führer", "fuhrer",
  "hakenkreuz", "sonnenrad",
  "ns-", "nsdap", "n.s.d.a.p",
  "gestapo",
  "judenstern", "étoile jaune juive",
  "kz ", "konzentrationslager",
];

function detectSuspect(product) {
  const haystack = ((product.title || "") + " " + (product.description || "") + " " + (product.subcategory || "")).toLowerCase();
  const hits = SUSPECT_KEYWORDS.filter((kw) => haystack.includes(kw));
  return hits;
}

async function loadAdminProducts() {
  const grid = document.getElementById("admin-products-grid");
  const countEl = document.getElementById("admin-product-count");
  if (!grid) return;
  grid.innerHTML = '<p class="admin-loading">Chargement...</p>';

  const search = (document.getElementById("admin-product-search")?.value || "").trim().toLowerCase();
  const statusBtn = document.querySelector("#admin-product-status-filter .filter-btn.active");
  const statusFilter = statusBtn?.dataset.status || "all";
  const sort = document.getElementById("admin-product-sort")?.value || "new";

  // Construction de la requête
  let query = window.sb.from("products").select("*").limit(500);

  if (statusFilter !== "all" && statusFilter !== "suspect") {
    query = query.eq("status", statusFilter);
  }
  if (sort === "new") query = query.order("created_at", { ascending: false });
  else if (sort === "old") query = query.order("created_at", { ascending: true });
  else if (sort === "price-high") query = query.order("price", { ascending: false });
  else if (sort === "price-low") query = query.order("price", { ascending: true });
  else query = query.order("created_at", { ascending: false });

  const { data: products, error } = await query;
  if (error) {
    grid.innerHTML = `<p class="admin-error">Erreur : ${esc(error.message)}</p>`;
    return;
  }

  // Charger les signalements ouverts pour calculer le compteur par article
  const { data: pendingReports } = await window.sb
    .from("reports")
    .select("product_id")
    .eq("status", "pending");
  const reportCount = {};
  (pendingReports || []).forEach((r) => {
    reportCount[r.product_id] = (reportCount[r.product_id] || 0) + 1;
  });

  // Filtrage côté client : recherche texte + suspects
  let filtered = (products || []).filter((p) => {
    // Recherche texte
    if (search) {
      const hay = (p.title + " " + (p.description || "") + " " + (p.user_id || "")).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Filtre "suspect" : articles avec mot-clé problématique OU signalés
  if (statusFilter === "suspect") {
    filtered = filtered.filter((p) => {
      const hits = detectSuspect(p);
      return hits.length > 0 || (reportCount[p.id] || 0) > 0;
    });
  }

  // Tri "plus signalés"
  if (sort === "reports") {
    filtered.sort((a, b) => (reportCount[b.id] || 0) - (reportCount[a.id] || 0));
  }

  // Mise à jour du compteur
  if (countEl) {
    countEl.textContent = filtered.length === 0
      ? "Aucun article"
      : `${filtered.length} article${filtered.length > 1 ? 's' : ''}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="admin-empty">
        <div class="admin-empty-icon">${statusFilter === 'suspect' ? '✓' : '📭'}</div>
        <h3>${statusFilter === 'suspect' ? 'Aucun article suspect' : 'Aucun article'}</h3>
        <p>${statusFilter === 'suspect' ? 'Rien de louche détecté pour le moment.' : 'Ajuste tes filtres pour voir plus de résultats.'}</p>
      </div>`;
    return;
  }

  // Charger les emails des vendeurs (batch via profiles si dispo)
  const sellerIds = [...new Set(filtered.map((p) => p.user_id).filter(Boolean))];
  const sellerEmails = {};
  if (sellerIds.length) {
    try {
      const { data: profs } = await window.sb
        .from("profiles")
        .select("id, pseudo, email")
        .in("id", sellerIds);
      (profs || []).forEach((p) => { sellerEmails[p.id] = p.email || p.pseudo || null; });
    } catch (e) { /* table profiles optionnelle */ }
  }

  grid.innerHTML = "";
  filtered.forEach((product) => {
    const suspectHits = detectSuspect(product);
    const isSuspect = suspectHits.length > 0;
    const nbReports = reportCount[product.id] || 0;

    const card = document.createElement("div");
    card.className = "item-card listing-card admin-product-card";
    if (isSuspect) card.classList.add("is-suspect");
    if (nbReports > 0) card.classList.add("is-reported");

    const statusLbl = product.status === "published" ? "En ligne"
      : product.status === "draft" ? "Brouillon"
      : product.status === "sold" ? "Vendu" : product.status;

    const sellerInfo = sellerEmails[product.user_id] || (product.user_id ? `ID: ${String(product.user_id).slice(0, 8)}…` : "—");

    // Highlight les mots suspects dans le titre
    let displayTitle = esc(product.title || "");
    if (isSuspect) {
      suspectHits.forEach((kw) => {
        const re = new RegExp(kw.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        displayTitle = displayTitle.replace(re, (m) => `<mark class="suspect-hit">${m}</mark>`);
      });
    }

    const badges = [];
    if (nbReports > 0) badges.push(`<span class="alert-badge alert-reports">⚠ ${nbReports} signalement${nbReports > 1 ? 's' : ''}</span>`);
    if (isSuspect) badges.push(`<span class="alert-badge alert-suspect">🚨 Mots suspects : ${suspectHits.slice(0, 3).join(", ")}</span>`);

    card.innerHTML = `
      <span class="listing-badge ${esc(product.status)}">${esc(statusLbl)}</span>
      <img src="${esc(product.image_url || 'hero.png')}" alt="${esc(product.title)}" onerror="this.src='hero.png'">
      ${badges.length ? `<div class="alert-badges">${badges.join('')}</div>` : ''}
      <h3>${displayTitle}</h3>
      <p class="price">${product.price} €</p>
      <p class="listing-meta">
        <span title="Vendeur">👤 ${esc(sellerInfo)}</span><br>
        <span title="Date">📅 ${new Date(product.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</span>
      </p>
      <div class="admin-card-actions">
        <a href="product.html?id=${product.id}" target="_blank" class="btn outline">Voir</a>
        <button class="btn danger" data-del-pid="${product.id}" data-del-title="${esc(product.title || '')}">🗑 Supprimer</button>
      </div>
    `;
    grid.appendChild(card);
  });

  // Brancher la suppression
  grid.querySelectorAll("[data-del-pid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.delPid;
      const title = btn.dataset.delTitle;
      const ok = await (window.askConfirm
        ? window.askConfirm(`Supprimer définitivement « ${title} » ?`,
            { title: "Confirmer la suppression", okText: "Supprimer", danger: true })
        : Promise.resolve(confirm("Supprimer cet article ?")));
      if (!ok) return;

      const { error } = await window.sb.from("products").delete().eq("id", pid);
      if (error) {
        (window.toastError || window.toast)("Suppression impossible : " + error.message);
        return;
      }
      (window.toastSuccess || window.toast)("Article supprimé.");
      loadAdminProducts();
      loadAdminStats();
    });
  });
}

/* ============== UTILISATEURS ============== */

async function loadBlockedUsersBadge() {
  try {
    const { count } = await window.sb
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("blocked", true);
    const badge = document.getElementById("users-blocked-badge");
    if (badge) {
      if (count && count > 0) {
        badge.textContent = count;
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
  } catch (e) { /* table absente, ignore */ }
}

async function loadAdminUsers() {
  const list = document.getElementById("admin-users-list");
  const countEl = document.getElementById("admin-user-count");
  if (!list) return;
  list.innerHTML = '<p class="admin-loading">Chargement...</p>';

  const search = (document.getElementById("admin-user-search")?.value || "").trim().toLowerCase();
  const statusBtn = document.querySelector("#admin-user-status-filter .filter-btn.active");
  const statusFilter = statusBtn?.dataset.status || "all";
  const sort = document.getElementById("admin-user-sort")?.value || "new";

  // 1. Récupérer tous les profils
  const { data: profiles, error } = await window.sb
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    list.innerHTML = `<p class="admin-error">Erreur : ${esc(error.message)}<br><br>
      ⚠ Assure-toi d'avoir exécuté <code>USERS_SETUP.sql</code> dans Supabase.</p>`;
    return;
  }

  if (!profiles || profiles.length === 0) {
    list.innerHTML = `
      <div class="admin-empty">
        <div class="admin-empty-icon">👤</div>
        <h3>Aucun utilisateur</h3>
        <p>Aucun compte n'a encore été créé.</p>
      </div>`;
    return;
  }

  // 2. Compter les annonces par utilisateur
  const { data: products } = await window.sb.from("products").select("user_id, status");
  const productCount = {};
  const publishedCount = {};
  (products || []).forEach((p) => {
    if (!p.user_id) return;
    productCount[p.user_id] = (productCount[p.user_id] || 0) + 1;
    if (p.status === "published") publishedCount[p.user_id] = (publishedCount[p.user_id] || 0) + 1;
  });

  // 3. Compter les signalements par vendeur (via product → user_id)
  const { data: reports } = await window.sb
    .from("reports")
    .select("product_id, products(user_id)");
  const reportCount = {};
  (reports || []).forEach((r) => {
    const uid = r.products?.user_id;
    if (uid) reportCount[uid] = (reportCount[uid] || 0) + 1;
  });

  // 4. Filtrage
  let filtered = profiles.filter((p) => {
    if (search) {
      const hay = ((p.email || "") + " " + (p.pseudo || "") + " " + (p.id || "")).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (statusFilter === "active" && p.blocked) return false;
    if (statusFilter === "blocked" && !p.blocked) return false;
    if (statusFilter === "reported" && !(reportCount[p.id] > 0)) return false;
    return true;
  });

  // 5. Tri
  if (sort === "new") filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === "old") filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sort === "products") filtered.sort((a, b) => (productCount[b.id] || 0) - (productCount[a.id] || 0));
  else if (sort === "reports") filtered.sort((a, b) => (reportCount[b.id] || 0) - (reportCount[a.id] || 0));

  // 6. Compteur
  if (countEl) {
    countEl.textContent = filtered.length === 0
      ? "Aucun utilisateur"
      : `${filtered.length} utilisateur${filtered.length > 1 ? 's' : ''}`;
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="admin-empty">
        <div class="admin-empty-icon">🔍</div>
        <h3>Aucun résultat</h3>
        <p>Ajuste les filtres ou la recherche.</p>
      </div>`;
    return;
  }

  // 7. Render
  list.innerHTML = "";
  filtered.forEach((u) => {
    const isAdmin = ADMIN_EMAILS.includes(u.email);
    const isBlocked = !!u.blocked;
    const nbProducts = productCount[u.id] || 0;
    const nbPublished = publishedCount[u.id] || 0;
    const nbReports = reportCount[u.id] || 0;
    const initial = (u.email || u.pseudo || "?")[0].toUpperCase();

    const row = document.createElement("div");
    row.className = "admin-user-row" + (isBlocked ? " is-blocked" : "") + (isAdmin ? " is-admin-row" : "");

    const created = u.created_at
      ? new Date(u.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
      : "—";

    const badges = [];
    if (isAdmin) badges.push('<span class="admin-user-badge admin-tag">Admin</span>');
    if (isBlocked) badges.push('<span class="admin-user-badge blocked">Bloqué</span>');
    else badges.push('<span class="admin-user-badge active">Actif</span>');

    let actions = "";
    if (isAdmin) {
      actions = '<span style="color:#888;font-size:12px;font-style:italic">Compte admin protégé</span>';
    } else if (isBlocked) {
      actions = `
        <button class="btn outline" data-action="unblock" data-uid="${esc(u.id)}" data-email="${esc(u.email || '')}">Débloquer</button>
        <button class="btn danger" data-action="delete" data-uid="${esc(u.id)}" data-email="${esc(u.email || '')}">🗑 Supprimer</button>
      `;
    } else {
      actions = `
        <button class="btn danger" data-action="block" data-uid="${esc(u.id)}" data-email="${esc(u.email || '')}">⛔ Bloquer</button>
        <button class="btn outline" data-action="delete" data-uid="${esc(u.id)}" data-email="${esc(u.email || '')}">🗑 Supprimer</button>
      `;
    }

    row.innerHTML = `
      <div class="admin-user-avatar">${esc(initial)}</div>
      <div class="admin-user-info">
        <div class="admin-user-email">${esc(u.email || u.pseudo || u.id)} ${badges.join(" ")}</div>
        <div class="admin-user-meta">
          <span>📅 Inscrit le ${created}</span>
          ${u.blocked_at ? `<span>⛔ Bloqué le ${new Date(u.blocked_at).toLocaleDateString("fr-FR")}</span>` : ""}
          ${u.block_reason ? `<span>Raison : ${esc(u.block_reason)}</span>` : ""}
        </div>
      </div>
      <div class="admin-user-stats-wrap" style="display:contents">
        <div class="admin-user-stat">
          <span class="admin-user-stat-num">${nbProducts}</span>
          <span class="admin-user-stat-lbl">Annonces</span>
        </div>
        <div class="admin-user-stat">
          <span class="admin-user-stat-num ${nbReports > 0 ? 'alert' : ''}">${nbReports}</span>
          <span class="admin-user-stat-lbl">Signalements</span>
        </div>
      </div>
      <div class="admin-user-actions">${actions}</div>
    `;
    list.appendChild(row);
  });

  // Brancher les actions
  list.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleUserAction(btn));
  });
}

async function handleUserAction(btn) {
  const action = btn.dataset.action;
  const uid = btn.dataset.uid;
  const email = btn.dataset.email || uid;

  if (action === "block") {
    const reason = prompt(`Bloquer "${email}" ?\n\nRaison du blocage (optionnel, visible uniquement par les admins) :`, "");
    if (reason === null) return; // annulé
    const { data: { user: admin } } = await window.sb.auth.getUser();
    const { error } = await window.sb.from("profiles").update({
      blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_by: admin.id,
      block_reason: reason || null,
    }).eq("id", uid);
    if (error) {
      (window.toastError || window.toast)("Erreur : " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)(`Compte "${email}" bloqué.`);
  }

  else if (action === "unblock") {
    const ok = await (window.askConfirm
      ? window.askConfirm(`Débloquer "${email}" ? L'utilisateur pourra de nouveau publier des annonces.`,
          { title: "Débloquer le compte", okText: "Débloquer" })
      : Promise.resolve(confirm(`Débloquer "${email}" ?`)));
    if (!ok) return;

    const { error } = await window.sb.from("profiles").update({
      blocked: false,
      blocked_at: null,
      blocked_by: null,
      block_reason: null,
    }).eq("id", uid);
    if (error) {
      (window.toastError || window.toast)("Erreur : " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)(`Compte "${email}" débloqué.`);
  }

  else if (action === "delete") {
    const ok = await (window.askConfirm
      ? window.askConfirm(
          `Supprimer définitivement le profil "${email}" ?\n\n` +
          `⚠ Toutes ses annonces seront supprimées en cascade.\n` +
          `⚠ Le compte auth (auth.users) restera : pour le supprimer complètement, ` +
          `va dans le dashboard Supabase → Authentication → Users.`,
          { title: "Supprimer le profil", okText: "Supprimer", danger: true })
      : Promise.resolve(confirm(`Supprimer "${email}" et toutes ses annonces ?`)));
    if (!ok) return;

    // Supprimer d'abord les annonces (au cas où il n'y ait pas de cascade côté DB)
    await window.sb.from("products").delete().eq("user_id", uid);
    const { error } = await window.sb.from("profiles").delete().eq("id", uid);
    if (error) {
      (window.toastError || window.toast)("Erreur : " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)(`Profil "${email}" supprimé.`);
  }

  loadAdminUsers();
  loadBlockedUsersBadge();
  loadAdminStats();
  loadAdminProducts();
}
