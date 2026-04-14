/* ============== PAGE MON COMPTE ============== */

document.addEventListener("DOMContentLoaded", async () => {
  const guestBlock = document.getElementById("account-guest");
  const userBlock = document.getElementById("account-user");
  if (!guestBlock || !userBlock) return;

  const { data: { user } } = await window.sb.auth.getUser();

  if (!user) {
    guestBlock.style.display = "block";
    // Ouvrir la modale auth si clic sur le bouton
    const loginBtn = document.getElementById("accountLoginBtn");
    if (loginBtn) {
      loginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const modal = document.getElementById("authModal");
        if (modal) {
          modal.classList.add("open");
          modal.setAttribute("aria-hidden", "false");
        }
      });
    }
    return;
  }

  // Utilisateur connecté
  userBlock.style.display = "block";

  const avatar = document.getElementById("account-avatar");
  const emailEl = document.getElementById("account-email");
  const sinceEl = document.getElementById("account-since");

  if (emailEl) emailEl.textContent = user.email;
  if (avatar) avatar.textContent = (user.email || "U")[0].toUpperCase();
  if (sinceEl) {
    const date = new Date(user.created_at);
    sinceEl.textContent = "Membre depuis " + date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }

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

  // Charger mes annonces
  loadMyListings(user.id);

  // Charger mes achats
  loadMyOrders(user.email);

  // Modifier mot de passe
  const updateBtn = document.getElementById("updatePasswordBtn");
  if (updateBtn) {
    updateBtn.addEventListener("click", async () => {
      const pw = document.getElementById("newPassword")?.value;
      if (!pw || pw.length < 6) {
        alert("Le mot de passe doit faire au moins 6 caractères.");
        return;
      }
      const { error } = await window.sb.auth.updateUser({ password: pw });
      if (error) {
        alert("Erreur : " + error.message);
      } else {
        alert("Mot de passe mis à jour !");
        document.getElementById("newPassword").value = "";
      }
    });
  }

  // Déconnexion
  const signOut = document.getElementById("signOutBtn");
  if (signOut) {
    signOut.addEventListener("click", async () => {
      await window.sb.auth.signOut();
      window.location.href = "index.html";
    });
  }
});

/* Mes annonces */
async function loadMyListings(userId) {
  const grid = document.getElementById("my-listings-grid");
  if (!grid) return;

  const { data, error } = await window.sb
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    grid.innerHTML = "<p>Erreur de chargement.</p>";
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = '<p>Tu n\'as pas encore d\'annonces. <a href="sell.html">Publie ta première annonce</a></p>';
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

    const p = document.createElement("p");
    p.className = "price";
    p.textContent = product.price + " \u20ac";
    card.appendChild(p);

    const link = document.createElement("a");
    link.href = "product.html?id=" + product.id;
    link.className = "btn outline listing-link";
    link.textContent = "Voir";
    card.appendChild(link);

    grid.appendChild(card);
  });
}

/* Mes achats */
async function loadMyOrders(email) {
  const list = document.getElementById("my-orders-list");
  if (!list) return;

  const { data, error } = await window.sb
    .from("orders")
    .select("*, products(title, image_url)")
    .eq("customer_email", email)
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = "<p>Erreur de chargement.</p>";
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<p>Aucun achat pour le moment. <a href="category.html">Découvre les articles disponibles</a></p>';
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

    const date = document.createElement("p");
    date.textContent = new Date(order.created_at).toLocaleDateString("fr-FR", {
      day: "numeric", month: "long", year: "numeric"
    });
    info.appendChild(date);

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
