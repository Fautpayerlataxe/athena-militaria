/* ============== PAGE ADMIN ============== */

// Liste des emails admin autorisés
const ADMIN_EMAILS = ["augustinrendu@gmail.com"];

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

  // Charger les données
  loadAdminStats();
  loadAdminOrders();
  loadAdminProducts();
});

async function loadAdminStats() {
  // Commandes
  const { data: orders } = await window.sb.from("orders").select("amount");
  const totalOrders = orders ? orders.length : 0;
  const revenue = orders ? orders.reduce((s, o) => s + Number(o.amount), 0) : 0;
  document.getElementById("stat-orders").textContent = totalOrders;
  document.getElementById("stat-revenue").textContent = revenue.toFixed(2) + " \u20ac";

  // Produits en ligne
  const { count: productCount } = await window.sb
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");
  document.getElementById("stat-products").textContent = productCount || 0;

  // Utilisateurs (approximation via produits uniques)
  const { data: sellers } = await window.sb.from("products").select("user_id");
  const uniqueUsers = new Set(sellers?.map((s) => s.user_id) || []);
  document.getElementById("stat-users").textContent = uniqueUsers.size;
}

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

    const img = document.createElement("img");
    img.src = order.products?.image_url || "hero.png";
    img.alt = order.products?.title || "Article";
    img.onerror = function () { this.src = "hero.png"; };
    row.appendChild(img);

    const info = document.createElement("div");
    info.className = "order-info";
    const title = document.createElement("h3");
    title.textContent = order.products?.title || "Article #" + order.product_id;
    info.appendChild(title);
    const meta = document.createElement("p");
    meta.textContent = (order.customer_email || "Email inconnu") + " — " +
      new Date(order.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    info.appendChild(meta);
    row.appendChild(info);

    const amount = document.createElement("div");
    amount.className = "order-amount";
    amount.textContent = order.amount + " \u20ac";
    row.appendChild(amount);

    const status = document.createElement("span");
    status.className = "order-status paid";
    status.textContent = "Payé";
    row.appendChild(status);

    list.appendChild(row);
  });
}

async function loadAdminProducts() {
  const grid = document.getElementById("admin-products-grid");
  if (!grid) return;

  const { data, error } = await window.sb
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) {
    grid.innerHTML = "<p>Aucun article.</p>";
    return;
  }

  grid.innerHTML = "";
  data.forEach((product) => {
    const card = document.createElement("div");
    card.className = "item-card listing-card";

    const badge = document.createElement("span");
    badge.className = "listing-badge " + product.status;
    badge.textContent = product.status === "published" ? "En ligne" : product.status === "draft" ? "Brouillon" : "Vendu";
    card.appendChild(badge);

    const img = document.createElement("img");
    img.src = product.image_url || "hero.png";
    img.alt = product.title;
    img.onerror = function () { this.src = "hero.png"; };
    card.appendChild(img);

    const h3 = document.createElement("h3");
    h3.textContent = product.title;
    card.appendChild(h3);

    const price = document.createElement("p");
    price.className = "price";
    price.textContent = product.price + " \u20ac";
    card.appendChild(price);

    const info = document.createElement("p");
    info.className = "listing-meta";
    info.textContent = "Stock : " + product.quantity + " | " +
      new Date(product.created_at).toLocaleDateString("fr-FR");
    card.appendChild(info);

    grid.appendChild(card);
  });
}
