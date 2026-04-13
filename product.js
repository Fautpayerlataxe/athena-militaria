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

  root.innerHTML = `
    <div class="product-grid">
      <div class="product-image">
        <img src="${product.image_url || 'hero.png'}" alt="${product.title}" class="product-img"
             onerror="this.src='hero.png'">
      </div>
      <div class="info">
        <h1 class="p-title">${product.title}</h1>
        <span class="p-badge">${product.condition}</span>
        <div class="p-price">${product.price} €</div>
        <p class="p-short">${product.description}</p>
        <ul class="p-vendor">
          <li><strong>Période :</strong> ${product.period}</li>
          <li><strong>Sous-catégorie :</strong> ${product.subcategory}</li>
          <li><strong>Lieu :</strong> ${product.location}</li>
          <li><strong>Stock :</strong> ${product.quantity}</li>
        </ul>
        <button class="cta-btn" id="buyBtn">Acheter — ${product.price} €</button>
        <a href="index.html" class="btn outline" style="margin-top:10px;display:inline-block">Retour à l'accueil</a>
      </div>
    </div>
  `;

  // Bouton Acheter → Stripe Checkout
  document.getElementById("buyBtn").addEventListener("click", async () => {
    const btn = document.getElementById("buyBtn");
    btn.textContent = "Redirection vers le paiement...";
    btn.disabled = true;

    try {
      const res = await fetch(
        "https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/create-checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdGF4Z2ZxZG94dGNpZGxseWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzQ0NzgsImV4cCI6MjA5MTQ1MDQ3OH0.AEFktTgMmccF0UiKcCiJBTej0Px5q6_jqi7l7hgePVA",
          },
          body: JSON.stringify({ productId: id }),
        }
      );

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Erreur : " + (data.error || "Impossible de créer le paiement"));
        btn.textContent = "Acheter — " + product.price + " €";
        btn.disabled = false;
      }
    } catch (err) {
      alert("Erreur : " + err.message);
      btn.textContent = "Acheter — " + product.price + " €";
      btn.disabled = false;
    }
  });
});
