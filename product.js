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
        <a href="index.html" class="btn">Retour à l'accueil</a>
      </div>
    </div>
  `;
});
