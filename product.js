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
        <div class="product-actions">
          <button class="cta-btn" id="buyBtn">Acheter — ${product.price} €</button>
          <button class="btn outline fav-btn" id="favBtn" data-id="${product.id}">♡ Ajouter aux favoris</button>
          <button class="btn outline" id="contactSellerBtn">✉ Contacter le vendeur</button>
        </div>
        <a href="index.html" class="btn outline" style="margin-top:10px;display:inline-block">Retour à l'accueil</a>
      </div>
    </div>

    <!-- Avis -->
    <div class="user-reviews" id="reviews-section">
      <h2>Avis sur cet article</h2>
      <div id="reviews-list"><p>Chargement...</p></div>
      <div class="review-form" id="review-form" style="display:none">
        <h3>Laisser un avis</h3>
        <div class="star-input" id="star-input">
          <button data-star="1">★</button>
          <button data-star="2">★</button>
          <button data-star="3">★</button>
          <button data-star="4">★</button>
          <button data-star="5">★</button>
        </div>
        <textarea id="review-comment" placeholder="Votre commentaire (optionnel)"></textarea>
        <button class="cta-btn" id="submitReview">Publier l'avis</button>
      </div>
    </div>
  `;

  // Charger les avis
  loadReviews(id);

  // Bouton contacter le vendeur
  const contactBtn = document.getElementById("contactSellerBtn");
  if (contactBtn) {
    contactBtn.addEventListener("click", async () => {
      const { data: { user } } = await window.sb.auth.getUser();
      if (!user) {
        alert("Connecte-toi pour contacter le vendeur.");
        return;
      }
      if (user.id === product.user_id) {
        alert("C'est ton propre article !");
        return;
      }
      window.location.href = "messages.html?to=" + product.user_id + "&product=" + id;
    });
  }

  // Formulaire d'avis
  const { data: { user: currentUser } } = await window.sb.auth.getUser();
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
        alert("Sélectionne une note.");
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
          alert("Tu as déjà laissé un avis sur cet article.");
        } else {
          alert("Erreur : " + error.message);
        }
      } else {
        alert("Avis publié !");
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
        alert("Connecte-toi pour ajouter aux favoris.");
      });
    }
  }

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
