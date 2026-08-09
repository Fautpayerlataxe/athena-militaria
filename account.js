/* ============== PAGE MON COMPTE ============== */

const TRa = (key) => (window.TR ? window.TR(key) : key);

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
    sinceEl.textContent = TRa("tr_js_account.member_since") + " " + date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }

  // Bouton Admin visible UNIQUEMENT pour les administrateurs
  const ADMIN_EMAILS = ["sayrox.ar@gmail.com", "renduambroise@gmail.com"];
  window.__IS_ADMIN = ADMIN_EMAILS.includes(user.email);
  if (window.__IS_ADMIN) {
    // Onglet modération dans les tabs
    const adminTab = document.getElementById("adminTabBtn");
    if (adminTab) adminTab.style.display = "";
    const adminSection = document.getElementById("tab-admin-moderation");
    if (adminSection) adminSection.style.display = "";

    // Badge admin dans le header
    const header = document.querySelector(".account-header");
    if (header && !document.getElementById("adminBadgeHeader")) {
      const badge = document.createElement("div");
      badge.id = "adminBadgeHeader";
      badge.className = "admin-role-badge";
      badge.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        ${TRa("tr_js_account.admin_badge")}
      `;
      header.appendChild(badge);
    }

    // Initialise le panneau de modération
    initModerationPanel();
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

  // Charger mes favoris
  loadMyFavorites(user.id);

  // Configuration des paiements vendeur (Stripe Connect)
  initStripeConnect(user);

  // Modifier le pseudo
  initPseudoSetting(user);

  // Modifier mot de passe
  const updateBtn = document.getElementById("updatePasswordBtn");
  if (updateBtn) {
    updateBtn.addEventListener("click", async () => {
      const pw = document.getElementById("newPassword")?.value;
      if (!pw || pw.length < 6) {
        toast(TRa("tr_js_account.password_min"));
        return;
      }
      const { error } = await window.sb.auth.updateUser({ password: pw });
      if (error) {
        toastError(TRa("tr_js_account.error_prefix") + " " + error.message);
      } else {
        toastSuccess(TRa("tr_js_account.password_updated"));
        document.getElementById("newPassword").value = "";
      }
    });
  }

  // Déconnexion
  const signOut = document.getElementById("signOutBtn");
  if (signOut) {
    signOut.addEventListener("click", async () => {
      await window.sb.auth.signOut();
      window.location.href = "/";
    });
  }
});

/* ============== STRIPE CONNECT (paiements vendeur) ============== */
/* ============== PSEUDO (onglet Paramètres) ==============
   Les comptes créés avant l'ajout du champ à l'inscription ont reçu un pseudo
   dérivé de leur e-mail : cet écran leur permet de le remplacer, une fois
   tous les 2 mois. Le délai est imposé par un trigger en base ; ce qui suit
   ne fait qu'éviter à l'utilisateur de se heurter à un refus. */

/* Reproduit "date + interval '2 months'" de Postgres, y compris son
   rabotage de fin de mois (31 décembre + 2 mois = 28 ou 29 février).
   Une addition naïve afficherait une date décalée de quelques jours par
   rapport à celle réellement appliquée par la base. */
function addTwoMonths(d) {
  const day = d.getDate();
  const t = new Date(d);
  t.setDate(1);
  t.setMonth(t.getMonth() + 2);
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, lastDay));
  return t;
}

const fmtDate = (d) =>
  d.toLocaleDateString(document.documentElement.lang === "en" ? "en-GB" : "fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

async function initPseudoSetting(user) {
  const input = document.getElementById("pseudoInput");
  const btn = document.getElementById("updatePseudoBtn");
  const note = document.getElementById("pseudoLockNote");
  if (!input || !btn) return;

  // Pré-remplir avec le pseudo actuel et verrouiller si le délai court encore
  try {
    const { data } = await window.sb
      .from("profiles").select("pseudo, pseudo_changed_at").eq("id", user.id).maybeSingle();
    if (data?.pseudo) input.value = data.pseudo;

    if (data?.pseudo_changed_at) {
      const next = addTwoMonths(new Date(data.pseudo_changed_at));
      if (next > new Date()) {
        input.disabled = true;
        btn.disabled = true;
        if (note) {
          note.textContent = TRa("tr_js_account.pseudo_locked") + " " + fmtDate(next) + ".";
          note.hidden = false;
        }
        return; // inutile de brancher le clic : le bouton est désactivé
      }
    }
  } catch (e) {}

  btn.addEventListener("click", async () => {
    const pseudo = input.value.trim();
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(pseudo)) {
      toast(TRa("tr_js_account.pseudo_format"));
      return;
    }

    // Comparaison insensible à la casse, comme l'index unique en base :
    // sans ça, changer "Jean" en "jean" se ferait refuser comme déjà pris.
    const pattern = pseudo.replace(/([\\%_])/g, "\\$1");
    const { data: taken } = await window.sb
      .from("public_profiles").select("id").ilike("pseudo", pattern).limit(1);
    if (taken && taken.length && taken[0].id !== user.id) {
      toast(TRa("tr_js_account.pseudo_taken"));
      return;
    }

    const { error } = await window.sb
      .from("profiles").update({ pseudo }).eq("id", user.id);
    if (error) {
      // Le trigger refuse un changement trop rapproché et renvoie la date à
      // laquelle il redeviendra possible. Cas atteignable si l'onglet est
      // resté ouvert depuis un changement fait ailleurs.
      const cooldown = /PSEUDO_COOLDOWN (\d{4}-\d{2}-\d{2})/.exec(error.message || "");
      if (cooldown) {
        toastError(TRa("tr_js_account.pseudo_cooldown") + " " + fmtDate(new Date(cooldown[1])) + ".");
        return;
      }
      // 23505 = violation d'unicité : quelqu'un a pris le pseudo entre-temps.
      toastError(
        error.code === "23505"
          ? TRa("tr_js_account.pseudo_taken")
          : TRa("tr_js_account.error_prefix") + " " + error.message
      );
      return;
    }

    toastSuccess(TRa("tr_js_account.pseudo_updated"));

    // Le délai vient de repartir : on verrouille sans attendre un rechargement.
    const next = addTwoMonths(new Date());
    input.disabled = true;
    btn.disabled = true;
    if (note) {
      note.textContent = TRa("tr_js_account.pseudo_locked") + " " + fmtDate(next) + ".";
      note.hidden = false;
    }
  });
}

async function initStripeConnect(user) {
  const card = document.getElementById("stripeConnectCard");
  if (!card) return;
  const btn = document.getElementById("stripeConnectBtn");
  const statusEl = document.getElementById("stripeConnectStatus");
  const textEl = document.getElementById("stripeConnectText");

  // Message au retour de Stripe (redirige vers ?connect=done / ?connect=refresh)
  const params = new URLSearchParams(window.location.search);
  if (params.get("connect") === "done") {
    toastSuccess(TRa("tr_js_account.stripe_done"));
  } else if (params.get("connect") === "refresh") {
    toast(TRa("tr_js_account.stripe_refresh"));
  }

  // Statut actuel du vendeur
  const { data: profile } = await window.sb
    .from("profiles")
    .select("stripe_account_id, stripe_onboarded")
    .eq("id", user.id)
    .maybeSingle();

  function showStatus(kind, label) {
    if (!statusEl) return;
    statusEl.style.display = "inline-flex";
    statusEl.className = "stripe-connect-status stripe-connect-status--" + kind;
    statusEl.textContent = label;
  }

  if (profile && profile.stripe_onboarded) {
    showStatus("ok", TRa("tr_js_account.stripe_status_ok"));
    if (textEl) textEl.textContent = TRa("tr_js_account.stripe_connected_text");
    if (btn) btn.textContent = TRa("tr_js_account.stripe_manage_btn");
  } else if (profile && profile.stripe_account_id) {
    showStatus("pending", TRa("tr_js_account.stripe_status_pending"));
    if (btn) btn.textContent = TRa("tr_js_account.stripe_finish_btn");
  }

  if (btn) {
    btn.addEventListener("click", async () => {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = TRa("tr_js_account.stripe_redirecting");
      try {
        const { data: { session } } = await window.sb.auth.getSession();
        if (!session) {
          toastError(TRa("tr_js_account.session_expired"));
          btn.disabled = false;
          btn.textContent = original;
          return;
        }
        const res = await fetch(SUPABASE_URL + "/functions/v1/connect-onboard", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + session.access_token,
          },
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          toastError(TRa("tr_js_account.error_prefix") + " " + (data.error || TRa("tr_js_account.stripe_start_failed")));
          btn.disabled = false;
          btn.textContent = original;
        }
      } catch (err) {
        toastError(TRa("tr_js_account.error_prefix") + " " + err.message);
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }
}

/* Mes annonces */
let MY_USER_ID = null;

async function loadMyListings(userId) {
  MY_USER_ID = userId;
  const grid = document.getElementById("my-listings-grid");
  if (!grid) return;

  const { data, error } = await window.sb
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    grid.innerHTML = `<p>${TRa("tr_js_account.loading_error")}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = `<p>${TRa("tr_js_account.no_listings")} <a href="/sell">${TRa("tr_js_account.no_listings_link")}</a></p>`;
    return;
  }

  grid.innerHTML = "";
  data.forEach((product) => {
    const card = document.createElement("div");
    card.className = "item-card listing-card";

    const badge = document.createElement("span");
    badge.className = "listing-badge " + (product.status || "published");
    badge.textContent = product.status === "published" ? TRa("tr_js_account.status_online")
                      : product.status === "draft" ? TRa("tr_js_account.status_draft")
                      : product.status === "sold" ? TRa("tr_js_account.status_sold") : TRa("tr_js_account.status_online");
    card.appendChild(badge);

    const img = document.createElement("img");
    img.src = window.imgUrl ? (window.imgUrl(product.image_url, 400) || "hero.png") : (product.image_url || "hero.png");
    img.alt = product.title || "";
    img.onerror = function () { this.src = "hero.png"; };
    card.appendChild(img);

    const h3 = document.createElement("h3");
    h3.textContent = product.title || TRa("tr_js_account.untitled");
    card.appendChild(h3);

    const p = document.createElement("p");
    p.className = "price";
    p.textContent = (product.price || 0) + " \u20ac";
    card.appendChild(p);

    // Actions : Voir / Modifier / Supprimer
    const actions = document.createElement("div");
    actions.className = "listing-actions";

    const viewLink = document.createElement("a");
    viewLink.href = "/product?id=" + product.id;
    viewLink.className = "btn outline listing-btn";
    viewLink.textContent = "👁 " + TRa("tr_js_account.view");
    actions.appendChild(viewLink);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn listing-btn";
    editBtn.textContent = "✏️ " + TRa("tr_js_account.edit");
    editBtn.addEventListener("click", () => openEditListingModal(product));
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn outline listing-btn listing-btn-danger";
    delBtn.textContent = "🗑 " + TRa("tr_js_account.delete");
    delBtn.addEventListener("click", () => deleteListing(product));
    actions.appendChild(delBtn);

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

/* === Supprimer une annonce === */
async function deleteListing(product) {
  const ok = await window.askConfirm(
    `${TRa("tr_js_account.delete_listing_confirm_1")} « ${product.title} » ? ${TRa("tr_js_account.delete_listing_confirm_2")}`,
    { title: TRa("tr_js_account.delete_listing_title"), okText: TRa("tr_js_account.delete"), danger: true }
  );
  if (!ok) return;

  const { error } = await window.sb
    .from("products")
    .delete()
    .eq("id", product.id)
    .eq("user_id", MY_USER_ID); // double sécurité

  if (error) {
    toastError(TRa("tr_js_account.delete_error_prefix") + " " + error.message);
    return;
  }

  // Supprime aussi la photo du storage si existante (best-effort, ignore l'échec)
  if (product.image_url && product.image_url.includes("/storage/")) {
    try {
      const parts = product.image_url.split("/product-images/");
      if (parts[1]) {
        await window.sb.storage.from("product-images").remove([parts[1]]);
      }
    } catch (_) {}
  }

  loadMyListings(MY_USER_ID);
}

/* === Ouvrir modale de modification === */
function openEditListingModal(product) {
  // S'assurer que la modale existe
  let modal = document.getElementById("editListingModal");
  if (!modal) {
    modal = buildEditListingModal();
    document.body.appendChild(modal);
  }

  // Préremplir
  modal.querySelector("#edit-title").value = product.title || "";
  modal.querySelector("#edit-description").value = product.description || "";
  modal.querySelector("#edit-price").value = product.price || "";
  modal.querySelector("#edit-period").value = product.period || "";
  modal.querySelector("#edit-subcategory").value = product.subcategory || "";
  modal.querySelector("#edit-condition").value = product.condition || "";
  modal.querySelector("#edit-quantity").value = product.quantity || 1;
  modal.querySelector("#edit-location").value = product.location || "";
  modal.querySelector("#edit-status").value = product.status || "published";
  modal.dataset.productId = product.id;

  // Aperçu image actuelle
  const preview = modal.querySelector("#edit-image-preview");
  preview.src = window.imgUrl ? (window.imgUrl(product.image_url, 400) || "hero.png") : (product.image_url || "hero.png");
  modal.querySelector("#edit-image-file").value = "";
  // La modale est réutilisée d'une annonce à l'autre : sans cette remise à
  // zéro, la photo préparée pour la précédente serait envoyée ici.
  modal.__photoPreparee = null;
  modal.__photoEnCours = false;

  // Affichage
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeEditListingModal() {
  const modal = document.getElementById("editListingModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function buildEditListingModal() {
  const wrap = document.createElement("div");
  wrap.id = "editListingModal";
  wrap.className = "modal edit-modal";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = `
    <div class="modal-content edit-modal-content" role="dialog" aria-modal="true" aria-labelledby="editTitle">
      <button class="close" type="button" aria-label="${TRa("tr_js_account.close")}" id="editCancelX">×</button>
      <h2 id="editTitle">${TRa("tr_js_account.edit_listing_title")}</h2>

      <div class="edit-image-block">
        <img id="edit-image-preview" src="hero.png" alt="${TRa("tr_js_account.photo_preview")}">
        <label class="btn outline" style="margin-top:8px;cursor:pointer">
          ${TRa("tr_js_account.replace_photo")}
          <input type="file" id="edit-image-file" accept="image/*,.heic,.heif,image/heic,image/heif" style="display:none">
        </label>
        <p class="edit-hint">${TRa("tr_js_account.keep_photo_hint")}</p>
      </div>

      <div class="edit-form">
        <label>${TRa("tr_js_account.title_label")}
          <input type="text" id="edit-title" required>
        </label>

        <label>${TRa("tr_js_account.description_label")}
          <textarea id="edit-description" rows="5" required></textarea>
        </label>

        <div class="edit-row">
          <label>${TRa("tr_js_account.price_label")}
            <input type="number" id="edit-price" min="0" step="1" required>
          </label>
          <label>${TRa("tr_js_account.quantity_label")}
            <input type="number" id="edit-quantity" min="1" value="1" required>
          </label>
        </div>

        <div class="edit-row">
          <label>${TRa("tr_js_account.period_label")}
            <select id="edit-period" required>
              <option value="">${TRa("tr_js_account.choose")}</option>
              <option>Avant 1914</option>
              <option>Première Guerre mondiale (1914-1918)</option>
              <option>Entre-deux-guerres (1918-1939)</option>
              <option>Seconde Guerre mondiale (1939-1945)</option>
              <option>Guerre froide</option>
              <option>Contemporain</option>
            </select>
          </label>
          <label>${TRa("tr_js_account.subcategory_label")}
            <select id="edit-subcategory" required>
              <option value="">${TRa("tr_js_account.choose")}</option>
              <option>Casques</option>
              <option>Uniformes</option>
              <option>Équipements</option>
              <option>Décorations & Médailles</option>
              <option>Documents & Papiers</option>
              <option>Photographies</option>
              <option>Armes neutralisées</option>
              <option>Munitions inertes</option>
              <option>Insignes</option>
              <option>Autre</option>
            </select>
          </label>
        </div>

        <div class="edit-row">
          <label>${TRa("tr_js_account.condition_label")}
            <select id="edit-condition" required>
              <option value="">${TRa("tr_js_account.choose")}</option>
              <option>Neuf</option>
              <option>Très bon état</option>
              <option>Bon état</option>
              <option>État correct</option>
              <option>À restaurer</option>
            </select>
          </label>
          <label>${TRa("tr_js_account.status_label")}
            <select id="edit-status">
              <option value="published">${TRa("tr_js_account.status_online")}</option>
              <option value="draft">${TRa("tr_js_account.status_draft")}</option>
              <option value="sold">${TRa("tr_js_account.status_sold")}</option>
            </select>
          </label>
        </div>

        <label>${TRa("tr_js_account.location_label")}
          <input type="text" id="edit-location" placeholder="${TRa("tr_js_account.location_placeholder")}" required>
        </label>

        <div class="edit-actions">
          <button class="btn outline" type="button" id="editCancelBtn">${TRa("tr_js_account.cancel")}</button>
          <button class="cta-btn" type="button" id="editSaveBtn">💾 ${TRa("tr_js_account.save")}</button>
        </div>
      </div>
    </div>
  `;

  // Listeners
  wrap.querySelector("#editCancelX").addEventListener("click", closeEditListingModal);
  wrap.querySelector("#editCancelBtn").addEventListener("click", closeEditListingModal);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeEditListingModal(); });

  /* Aperçu dynamique de la nouvelle photo.
     La photo est préparée dès la sélection (conversion HEIC + compression,
     voir preparerFichierPhoto dans script.js) : sans cela, un HEIC d'iPhone
     ne s'affichait pas en aperçu hors Safari, et repartait tel quel dans le
     stockage, donc invisible pour les visiteurs. Le résultat est conservé
     dans wrap.__photoPreparee, que l'enregistrement utilise à la place du
     fichier brut. */
  wrap.querySelector("#edit-image-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    wrap.__photoPreparee = null;

    /* La conversion dure plusieurs secondes sur un HEIC. Deux protections
       sont indispensables pendant ce temps :

       1. Bloquer l'enregistrement. Sans ça, un clic sur « Enregistrer » dans
          la seconde lisait __photoPreparee encore à null et retombait sur le
          fichier brut : le HEIC original partait au stockage, invisible pour
          tout le monde sauf Safari. Exactement le défaut que la conversion
          était censée supprimer.
       2. Ignorer un résultat devenu obsolète. La modale est unique et
          réutilisée d'une annonce à l'autre : si le vendeur la referme et en
          ouvre une autre pendant la conversion, la photo de la précédente
          venait s'installer dans la nouvelle et écrasait son image. */
    const pourProduit = wrap.dataset.productId;
    const boutonSave = wrap.querySelector("#editSaveBtn");
    wrap.__photoEnCours = true;
    if (boutonSave) boutonSave.disabled = true;

    let pret = file;
    try {
      if (window.preparerFichierPhoto) pret = await window.preparerFichierPhoto(file);
    } catch (err) {
      pret = file;   // préparation impossible : on garde le fichier d'origine
    } finally {
      wrap.__photoEnCours = false;
      if (boutonSave) boutonSave.disabled = false;
    }

    if (wrap.dataset.productId !== pourProduit) return;   // annonce changée entre-temps

    wrap.__photoPreparee = pret;
    const apercu = wrap.querySelector("#edit-image-preview");
    if (apercu) {
      const url = URL.createObjectURL(pret);
      apercu.onload = () => URL.revokeObjectURL(url);
      apercu.src = url;
    }
  });

  wrap.querySelector("#editSaveBtn").addEventListener("click", () => saveEditedListing(wrap));
  return wrap;
}

async function saveEditedListing(modal) {
  const productId = modal.dataset.productId;
  if (!productId) return;

  /* Enregistrer maintenant enverrait le fichier d'origine, non converti :
     on attend la fin de la préparation. Le bouton est déjà désactivé pendant
     ce temps, ce test couvre le cas où l'enregistrement est déclenché
     autrement (touche Entrée, script). */
  if (modal.__photoEnCours) {
    toast(TRa("tr_js_account.photo_processing"));
    return;
  }

  const saveBtn = modal.querySelector("#editSaveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = TRa("tr_js_account.saving");

  const title = modal.querySelector("#edit-title").value.trim();
  const description = modal.querySelector("#edit-description").value.trim();
  const price = Number(modal.querySelector("#edit-price").value);
  const quantity = Number(modal.querySelector("#edit-quantity").value);
  const period = modal.querySelector("#edit-period").value;
  const subcategory = modal.querySelector("#edit-subcategory").value;
  const condition = modal.querySelector("#edit-condition").value;
  const status = modal.querySelector("#edit-status").value;
  const location = modal.querySelector("#edit-location").value.trim();

  if (!title || !description || !price || !period || !subcategory || !condition || !location) {
    toast(TRa("tr_js_account.fill_all_fields"));
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 " + TRa("tr_js_account.save");
    return;
  }

  // Upload nouvelle image si fournie
  let image_url = null;
  const fileInput = modal.querySelector("#edit-image-file");
  // Photo convertie et compressée à la sélection ; on retombe sur le fichier
  // brut si la préparation n'a pas pu aboutir.
  const file = modal.__photoPreparee || fileInput?.files?.[0];
  if (file) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${MY_USER_ID}/${Date.now()}.${ext}`;
    const { error: upErr } = await window.sb.storage
      .from("product-images")
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
    if (upErr) {
      toastError(TRa("tr_js_account.upload_error_prefix") + " " + upErr.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 " + TRa("tr_js_account.save");
      return;
    }
    const { data: pub } = window.sb.storage.from("product-images").getPublicUrl(path);
    image_url = pub?.publicUrl || null;
  }

  // Construire l'update
  const update = { title, description, price, quantity, period, subcategory, condition, status, location };
  if (image_url) update.image_url = image_url;

  const { error } = await window.sb
    .from("products")
    .update(update)
    .eq("id", productId)
    .eq("user_id", MY_USER_ID); // sécurité RLS

  saveBtn.disabled = false;
  saveBtn.textContent = "💾 " + TRa("tr_js_account.save");

  if (error) {
    toastError(TRa("tr_js_account.error_prefix") + " " + error.message);
    return;
  }

  closeEditListingModal();
  loadMyListings(MY_USER_ID);
}

/* Mes favoris */
async function loadMyFavorites(userId) {
  const grid = document.getElementById("my-favorites-grid");
  if (!grid) return;

  const { data, error } = await window.sb
    .from("favorites")
    .select("*, products(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) {
    grid.innerHTML = `<p>${TRa("tr_js_account.no_favorites")} <a href="/category">${TRa("tr_js_account.favorites_link")}</a></p>`;
    return;
  }

  grid.innerHTML = "";
  data.forEach((fav) => {
    const product = fav.products;
    if (!product) return;

    const card = document.createElement("a");
    card.className = "item-card";
    card.href = "/product?id=" + product.id;

    const img = document.createElement("img");
    img.src = window.imgUrl ? (window.imgUrl(product.image_url, 400) || "hero.png") : (product.image_url || "hero.png");
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
    list.innerHTML = `<p>${TRa("tr_js_account.loading_error")}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `<p>${TRa("tr_js_account.no_orders")} <a href="/category">${TRa("tr_js_account.orders_link")}</a></p>`;
    return;
  }

  list.innerHTML = "";
  data.forEach((order) => {
    const row = document.createElement("div");
    row.className = "order-row";

    const img = document.createElement("img");
    img.src = window.imgUrl ? (window.imgUrl(order.products?.image_url, 400) || "hero.png") : (order.products?.image_url || "hero.png");
    img.alt = order.products?.title || TRa("tr_js_account.article");
    img.onerror = function () { this.src = "hero.png"; };
    row.appendChild(img);

    const info = document.createElement("div");
    info.className = "order-info";

    const title = document.createElement("h3");
    title.textContent = order.products?.title || TRa("tr_js_account.article") + " #" + order.product_id;
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
    status.textContent = TRa("tr_js_account.paid");
    row.appendChild(status);

    list.appendChild(row);
  });
}

/* ============================================================
   🛡 PANNEAU DE MODÉRATION ADMIN (intégré à Mon Compte)
   ============================================================ */

const MOD_SUSPECT_KEYWORDS = [
  "nazi", "nazisme", "hitler", "ss", "waffen", "waffen-ss", "reich", "iii reich", "3eme reich", "3e reich",
  "troisième reich", "swastika", "croix gammée", "gammée", "hakenkreuz",
  "gestapo", "totenkopf", "sieg heil", "heil hitler", "führer", "fuhrer",
  "mein kampf", "rassenschande", "goebbels", "himmler", "göring", "goering",
  "nsdap", "hj ", "hitlerjugend", "judenrein", "endlösung", "aryan",
  "kkk", "lynch"
];

const MOD_STATE = {
  products: [],
  reports: [],
  profiles: {},
  filter: "all",
  sort: "new",
  search: "",
  loaded: false,
};

function modDetectSuspect(p) {
  const hay = ((p.title || "") + " " + (p.description || "") + " " + (p.subcategory || "")).toLowerCase();
  const hits = [];
  for (const kw of MOD_SUSPECT_KEYWORDS) {
    const needle = kw.toLowerCase();
    // Match par mot délimité quand possible, sinon inclusion
    const pattern = new RegExp("(^|[^a-z0-9])" + needle.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "([^a-z0-9]|$)", "i");
    if (pattern.test(hay)) hits.push(kw);
  }
  return hits;
}

function modEsc(s) {
  return (window.escapeHtml || ((x) => String(x).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))))(s || "");
}

function modHighlight(text, hits) {
  if (!hits || hits.length === 0) return modEsc(text);
  let out = modEsc(text);
  for (const h of hits) {
    const re = new RegExp("(" + h.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + ")", "gi");
    out = out.replace(re, '<mark class="mod-hit">$1</mark>');
  }
  return out;
}

async function initModerationPanel() {
  // Branche les filtres
  document.querySelectorAll(".mod-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mod-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      MOD_STATE.filter = btn.dataset.filter;
      renderModerationList();
    });
  });

  const sortEl = document.getElementById("modSort");
  if (sortEl) sortEl.addEventListener("change", (e) => {
    MOD_STATE.sort = e.target.value;
    renderModerationList();
  });

  const searchEl = document.getElementById("modSearch");
  if (searchEl) {
    let t = null;
    searchEl.addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        MOD_STATE.search = (e.target.value || "").toLowerCase().trim();
        renderModerationList();
      }, 180);
    });
  }

  // Charge quand on clique sur l'onglet (économise les requêtes si jamais visité)
  const adminTabBtn = document.getElementById("adminTabBtn");
  if (adminTabBtn) {
    adminTabBtn.addEventListener("click", () => {
      if (!MOD_STATE.loaded) loadModerationData();
      // Charger aussi le badge utilisateurs bloqués
      loadModBlockedBadge();
    });
  }

  // Sous-onglets Articles / Utilisateurs
  document.querySelectorAll(".mod-subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.subtab;
      document.querySelectorAll(".mod-subtab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".mod-subpanel").forEach((p) => {
        p.classList.remove("active");
        p.style.display = "none";
      });
      const panel = document.getElementById("mod-subpanel-" + target);
      if (panel) {
        panel.classList.add("active");
        panel.style.display = "block";
      }
      // Charger les utilisateurs au premier clic
      if (target === "users" && !MOD_USERS_STATE.loaded) {
        loadModUsers();
      }
    });
  });

  // Branche les filtres / tri / recherche utilisateurs
  document.querySelectorAll(".mod-user-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mod-user-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      MOD_USERS_STATE.statusFilter = btn.dataset.status;
      renderModUsers();
    });
  });
  document.getElementById("modUserSort")?.addEventListener("change", (e) => {
    MOD_USERS_STATE.sort = e.target.value;
    renderModUsers();
  });
  const modUserSearch = document.getElementById("modUserSearch");
  if (modUserSearch) {
    let t;
    modUserSearch.addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        MOD_USERS_STATE.search = (e.target.value || "").toLowerCase().trim();
        renderModUsers();
      }, 180);
    });
  }

  // Bouton retour en haut — visible seulement quand on scroll dans la modération
  const backTop = document.getElementById("modBackTop");
  if (backTop) {
    const onScroll = () => {
      const adminSection = document.getElementById("tab-admin-moderation");
      // Afficher seulement si l'onglet modération est actif ET qu'on a scrollé
      const isAdminActive = adminSection && adminSection.classList.contains("active");
      if (isAdminActive && window.scrollY > 400) {
        backTop.classList.add("show");
      } else {
        backTop.classList.remove("show");
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    backTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
}

async function loadModerationData() {
  const list = document.getElementById("modList");
  if (list) list.innerHTML = `<p class="mod-loading">${TRa("tr_js_account.mod_loading_articles")}</p>`;

  // 1) Articles
  const { data: products, error: pErr } = await window.sb
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (pErr) {
    if (list) list.innerHTML = '<p class="mod-empty">' + TRa("tr_js_account.loading_error_prefix") + " " + modEsc(pErr.message) + "</p>";
    return;
  }

  // 2) Signalements en attente
  let reports = [];
  try {
    const { data } = await window.sb.from("reports").select("*").eq("status", "pending");
    reports = data || [];
  } catch (e) {
    reports = [];
  }

  // 3) Profils (map user_id → pseudo/email)
  const ids = [...new Set((products || []).map((p) => p.user_id).filter(Boolean))];
  const profiles = {};
  if (ids.length > 0) {
    try {
      const { data: profs } = await window.sb.from("profiles").select("id,pseudo,email").in("id", ids);
      (profs || []).forEach((p) => { profiles[p.id] = p; });
    } catch (e) { /* table peut-être absente */ }
  }

  MOD_STATE.products = products || [];
  MOD_STATE.reports = reports;
  MOD_STATE.profiles = profiles;
  MOD_STATE.loaded = true;

  updateModerationStats();
  renderModerationList();
}

function updateModerationStats() {
  const products = MOD_STATE.products;
  const total = products.filter((p) => p.status === "published").length;
  const suspects = products.filter((p) => modDetectSuspect(p).length > 0).length;
  const reportedIds = new Set(MOD_STATE.reports.map((r) => r.product_id));
  const reported = products.filter((p) => reportedIds.has(p.id)).length;

  const setNum = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  setNum("modStatTotal", total);
  setNum("modStatSuspect", suspects);
  setNum("modStatReports", reported);

  // Badge sur l'onglet
  const alerts = suspects + reported;
  const badge = document.getElementById("adminTabBadge");
  if (badge) {
    if (alerts > 0) {
      badge.textContent = alerts;
      badge.style.display = "";
    } else {
      badge.style.display = "none";
    }
  }
}

function renderModerationList() {
  const list = document.getElementById("modList");
  if (!list) return;

  const { products, reports, profiles, filter, sort, search } = MOD_STATE;
  const reportedMap = new Map();
  reports.forEach((r) => {
    reportedMap.set(r.product_id, (reportedMap.get(r.product_id) || 0) + 1);
  });

  let rows = products.map((p) => ({
    ...p,
    _hits: modDetectSuspect(p),
    _reports: reportedMap.get(p.id) || 0,
    _seller: profiles[p.user_id] || null,
  }));

  // Filtres
  if (filter === "published") rows = rows.filter((p) => p.status === "published");
  else if (filter === "draft") rows = rows.filter((p) => p.status === "draft");
  else if (filter === "sold") rows = rows.filter((p) => p.status === "sold");
  else if (filter === "suspect") rows = rows.filter((p) => p._hits.length > 0);
  else if (filter === "reported") rows = rows.filter((p) => p._reports > 0);

  // Recherche texte
  if (search) {
    rows = rows.filter((p) => {
      const sellerStr = ((p._seller?.pseudo || "") + " " + (p._seller?.email || "")).toLowerCase();
      return (
        (p.title || "").toLowerCase().includes(search) ||
        (p.description || "").toLowerCase().includes(search) ||
        (p.subcategory || "").toLowerCase().includes(search) ||
        sellerStr.includes(search)
      );
    });
  }

  // Tri
  if (sort === "new") rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === "old") rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sort === "price-high") rows.sort((a, b) => (b.price || 0) - (a.price || 0));
  else if (sort === "price-low") rows.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (sort === "reports") rows.sort((a, b) => b._reports - a._reports);
  else if (sort === "suspect") rows.sort((a, b) => b._hits.length - a._hits.length);

  // Compte
  const cntEl = document.getElementById("modCount");
  if (cntEl) cntEl.textContent = rows.length + " " + TRa("tr_js_account.article_word") + (rows.length > 1 ? "s" : "");

  if (rows.length === 0) {
    list.innerHTML = `<p class="mod-empty">${TRa("tr_js_account.mod_no_articles")}</p>`;
    return;
  }

  list.innerHTML = rows.map((p) => {
    const hits = p._hits;
    const isSuspect = hits.length > 0;
    const isReported = p._reports > 0;
    const classes = ["mod-card"];
    if (isSuspect) classes.push("is-suspect");
    if (isReported && !isSuspect) classes.push("is-reported");

    const sellerLabel = p._seller?.pseudo
      ? modEsc(p._seller.pseudo)
      : p._seller?.email
        ? modEsc(p._seller.email)
        : (p.user_id ? modEsc(p.user_id.slice(0, 8)) + "…" : TRa("tr_js_account.unknown"));

    const price = window.formatPrice ? window.formatPrice(p.price) : (p.price + " €");
    const when = window.timeAgo ? window.timeAgo(p.created_at) : "";

    let badges = "";
    if (isSuspect) {
      badges += `<span class="mod-badge mod-badge-suspect">⚠ ${TRa("tr_js_account.mod_suspect")} ${modEsc(hits.slice(0, 3).join(", "))}${hits.length > 3 ? "…" : ""}</span>`;
    }
    if (isReported) {
      badges += `<span class="mod-badge mod-badge-reports">🚨 ${p._reports} ${TRa("tr_js_account.report_word")}${p._reports > 1 ? "s" : ""}</span>`;
    }
    const statusLabel = {
      published: `<span class="mod-status mod-status-on">● ${TRa("tr_js_account.status_online")}</span>`,
      draft: `<span class="mod-status mod-status-draft">○ ${TRa("tr_js_account.status_draft")}</span>`,
      sold: `<span class="mod-status mod-status-sold">✓ ${TRa("tr_js_account.status_sold")}</span>`,
    }[p.status] || '<span class="mod-status">' + modEsc(p.status || "?") + "</span>";

    return `
      <article class="${classes.join(" ")}" data-id="${modEsc(p.id)}">
        <div class="mod-card-img">
          <img src="${modEsc((window.imgUrl ? window.imgUrl(p.image_url, 400) : p.image_url) || "hero.png")}" alt="" loading="lazy" decoding="async" onerror="this.src='hero.png'">
        </div>
        <div class="mod-card-main">
          <div class="mod-card-top">
            <h3 class="mod-card-title">${modHighlight(p.title || TRa("tr_js_account.untitled_parens"), hits)}</h3>
            <div class="mod-card-price">${modEsc(price)}</div>
          </div>
          <div class="mod-card-meta">
            ${statusLabel}
            <span class="mod-meta-dot">•</span>
            <span class="mod-meta">👤 ${sellerLabel}</span>
            <span class="mod-meta-dot">•</span>
            <span class="mod-meta">🕒 ${modEsc(when)}</span>
            ${p.subcategory ? `<span class="mod-meta-dot">•</span><span class="mod-meta">📦 ${modEsc(p.subcategory)}</span>` : ""}
          </div>
          ${badges ? `<div class="mod-card-alerts">${badges}</div>` : ""}
          <p class="mod-card-desc">${modHighlight((p.description || "").slice(0, 180), hits)}${(p.description || "").length > 180 ? "…" : ""}</p>
          <div class="mod-card-actions">
            <a href="/product?id=${encodeURIComponent(p.id)}" target="_blank" class="mod-btn mod-btn-view">👁 ${TRa("tr_js_account.view")}</a>
            <button class="mod-btn mod-btn-delete" data-action="delete" data-id="${modEsc(p.id)}" data-title="${modEsc(p.title || "")}">🗑 ${TRa("tr_js_account.delete")}</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  // Bind delete buttons
  list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const title = btn.dataset.title || TRa("tr_js_account.this_article");
      if (!confirm("⚠ " + TRa("tr_js_account.mod_delete_confirm_1") + " « " + title + " » ?\n\n" + TRa("tr_js_account.mod_delete_confirm_2"))) return;
      btn.disabled = true;
      btn.textContent = TRa("tr_js_account.deleting");
      const { error } = await window.sb.from("products").delete().eq("id", id);
      if (error) {
        alert(TRa("tr_js_account.error_prefix") + " " + error.message);
        btn.disabled = false;
        btn.textContent = "🗑 " + TRa("tr_js_account.delete");
        return;
      }
      // Retire de l'état local
      MOD_STATE.products = MOD_STATE.products.filter((p) => p.id !== id);
      updateModerationStats();
      renderModerationList();
      if (window.toastSuccess) toastSuccess(TRa("tr_js_account.article_deleted"));
    });
  });
}

/* ============== MODÉRATION : UTILISATEURS ============== */

const MOD_USERS_STATE = {
  loaded: false,
  profiles: [],
  productCount: {},
  reportCount: {},
  search: "",
  statusFilter: "all",
  sort: "new",
};

const MOD_ADMIN_EMAILS = ["sayrox.ar@gmail.com", "renduambroise@gmail.com"];

async function loadModBlockedBadge() {
  try {
    const { count } = await window.sb
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("blocked", true);
    const badge = document.getElementById("modUsersBlockedBadge");
    if (badge) {
      if (count && count > 0) {
        badge.textContent = count;
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
  } catch (e) { /* table absente */ }
}

async function loadModUsers() {
  const list = document.getElementById("modUsersList");
  if (!list) return;
  list.innerHTML = `<p class="mod-loading">${TRa("tr_js_account.loading")}</p>`;

  // 1. Profils
  const { data: profiles, error } = await window.sb
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    list.innerHTML = `<p class="mod-empty">${TRa("tr_js_account.error_prefix")} ${modEsc(error.message)}<br><br>
      ⚠ ${TRa("tr_js_account.mod_users_setup_1")} <code>USERS_SETUP.sql</code> ${TRa("tr_js_account.mod_users_setup_2")}</p>`;
    return;
  }

  // 2. Compteurs annonces
  const { data: products } = await window.sb.from("products").select("user_id, status");
  const productCount = {};
  (products || []).forEach((p) => {
    if (!p.user_id) return;
    productCount[p.user_id] = (productCount[p.user_id] || 0) + 1;
  });

  // 3. Compteurs signalements
  const { data: reports } = await window.sb
    .from("reports")
    .select("product_id, products(user_id)");
  const reportCount = {};
  (reports || []).forEach((r) => {
    const uid = r.products?.user_id;
    if (uid) reportCount[uid] = (reportCount[uid] || 0) + 1;
  });

  MOD_USERS_STATE.profiles = profiles || [];
  MOD_USERS_STATE.productCount = productCount;
  MOD_USERS_STATE.reportCount = reportCount;
  MOD_USERS_STATE.loaded = true;

  // Stats globales
  const total = profiles?.length || 0;
  const blockedNb = (profiles || []).filter((p) => p.blocked).length;
  const reportedNb = Object.keys(reportCount).length;
  const elT = document.getElementById("modUsersTotal");
  const elB = document.getElementById("modUsersBlocked");
  const elR = document.getElementById("modUsersReported");
  if (elT) elT.textContent = total;
  if (elB) elB.textContent = blockedNb;
  if (elR) elR.textContent = reportedNb;

  renderModUsers();
}

function renderModUsers() {
  const list = document.getElementById("modUsersList");
  const countEl = document.getElementById("modUserCount");
  if (!list) return;

  let filtered = (MOD_USERS_STATE.profiles || []).filter((p) => {
    if (MOD_USERS_STATE.search) {
      const hay = ((p.email || "") + " " + (p.pseudo || "") + " " + (p.id || "")).toLowerCase();
      if (!hay.includes(MOD_USERS_STATE.search)) return false;
    }
    if (MOD_USERS_STATE.statusFilter === "active" && p.blocked) return false;
    if (MOD_USERS_STATE.statusFilter === "blocked" && !p.blocked) return false;
    if (MOD_USERS_STATE.statusFilter === "reported" && !(MOD_USERS_STATE.reportCount[p.id] > 0)) return false;
    return true;
  });

  const sort = MOD_USERS_STATE.sort;
  if (sort === "new") filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === "old") filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sort === "products") filtered.sort((a, b) => (MOD_USERS_STATE.productCount[b.id] || 0) - (MOD_USERS_STATE.productCount[a.id] || 0));
  else if (sort === "reports") filtered.sort((a, b) => (MOD_USERS_STATE.reportCount[b.id] || 0) - (MOD_USERS_STATE.reportCount[a.id] || 0));

  if (countEl) {
    countEl.textContent = filtered.length === 0
      ? TRa("tr_js_account.no_users")
      : `${filtered.length} ${TRa("tr_js_account.user_word")}${filtered.length > 1 ? 's' : ''}`;
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="mod-empty">
        <p>🔍 ${TRa("tr_js_account.mod_no_users_filter")}</p>
      </div>`;
    return;
  }

  list.innerHTML = "";
  filtered.forEach((u) => {
    const isAdmin = MOD_ADMIN_EMAILS.includes(u.email);
    const isBlocked = !!u.blocked;
    const nbProducts = MOD_USERS_STATE.productCount[u.id] || 0;
    const nbReports = MOD_USERS_STATE.reportCount[u.id] || 0;
    const initial = (u.email || u.pseudo || "?")[0].toUpperCase();

    const row = document.createElement("div");
    row.className = "admin-user-row" + (isBlocked ? " is-blocked" : "") + (isAdmin ? " is-admin-row" : "");

    const created = u.created_at
      ? new Date(u.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
      : "-";

    const badges = [];
    if (isAdmin) badges.push(`<span class="admin-user-badge admin-tag">${TRa("tr_js_account.admin_tag")}</span>`);
    if (isBlocked) badges.push(`<span class="admin-user-badge blocked">${TRa("tr_js_account.blocked_tag")}</span>`);
    else badges.push(`<span class="admin-user-badge active">${TRa("tr_js_account.active_tag")}</span>`);

    let actions = "";
    if (isAdmin) {
      actions = `<span style="color:#888;font-size:12px;font-style:italic">${TRa("tr_js_account.admin_protected")}</span>`;
    } else if (isBlocked) {
      actions = `
        <button class="btn outline" data-mod-action="unblock" data-uid="${modEsc(u.id)}" data-email="${modEsc(u.email || '')}">${TRa("tr_js_account.unblock_btn")}</button>
        <button class="btn danger" data-mod-action="delete" data-uid="${modEsc(u.id)}" data-email="${modEsc(u.email || '')}">🗑 ${TRa("tr_js_account.delete")}</button>
      `;
    } else {
      actions = `
        <button class="btn danger" data-mod-action="block" data-uid="${modEsc(u.id)}" data-email="${modEsc(u.email || '')}">⛔ ${TRa("tr_js_account.block_btn")}</button>
        <button class="btn outline" data-mod-action="delete" data-uid="${modEsc(u.id)}" data-email="${modEsc(u.email || '')}">🗑 ${TRa("tr_js_account.delete")}</button>
      `;
    }

    row.innerHTML = `
      <div class="admin-user-avatar">${modEsc(initial)}</div>
      <div class="admin-user-info">
        <div class="admin-user-email">${modEsc(u.email || u.pseudo || u.id)} ${badges.join(" ")}</div>
        <div class="admin-user-meta">
          <span>📅 ${TRa("tr_js_account.registered_on")} ${created}</span>
          ${u.blocked_at ? `<span>⛔ ${TRa("tr_js_account.blocked_on")} ${new Date(u.blocked_at).toLocaleDateString("fr-FR")}</span>` : ""}
          ${u.block_reason ? `<span>${TRa("tr_js_account.reason")} ${modEsc(u.block_reason)}</span>` : ""}
        </div>
      </div>
      <div class="admin-user-stats-wrap" style="display:contents">
        <div class="admin-user-stat">
          <span class="admin-user-stat-num">${nbProducts}</span>
          <span class="admin-user-stat-lbl">${TRa("tr_js_account.listings_label")}</span>
        </div>
        <div class="admin-user-stat">
          <span class="admin-user-stat-num ${nbReports > 0 ? 'alert' : ''}">${nbReports}</span>
          <span class="admin-user-stat-lbl">${TRa("tr_js_account.reports_label")}</span>
        </div>
      </div>
      <div class="admin-user-actions">${actions}</div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("[data-mod-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleModUserAction(btn));
  });
}

async function handleModUserAction(btn) {
  const action = btn.dataset.modAction;
  const uid = btn.dataset.uid;
  const email = btn.dataset.email || uid;

  if (action === "block") {
    const reason = prompt(`${TRa("tr_js_account.block_btn")} "${email}" ?\n\n${TRa("tr_js_account.block_prompt_2")}`, "");
    if (reason === null) return;
    const { data: { user: admin } } = await window.sb.auth.getUser();
    const { error } = await window.sb.from("profiles").update({
      blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_by: admin.id,
      block_reason: reason || null,
    }).eq("id", uid);
    if (error) {
      (window.toastError || window.toast)(TRa("tr_js_account.error_prefix") + " " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)(`${TRa("tr_js_account.account_prefix")} "${email}" ${TRa("tr_js_account.blocked_suffix")}`);
  }

  else if (action === "unblock") {
    const ok = await (window.askConfirm
      ? window.askConfirm(`${TRa("tr_js_account.unblock_btn")} "${email}" ? ${TRa("tr_js_account.unblock_confirm_2")}`,
          { title: TRa("tr_js_account.unblock_title"), okText: TRa("tr_js_account.unblock_btn") })
      : Promise.resolve(confirm(`${TRa("tr_js_account.unblock_btn")} "${email}" ?`)));
    if (!ok) return;
    const { error } = await window.sb.from("profiles").update({
      blocked: false,
      blocked_at: null,
      blocked_by: null,
      block_reason: null,
    }).eq("id", uid);
    if (error) {
      (window.toastError || window.toast)(TRa("tr_js_account.error_prefix") + " " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)(`${TRa("tr_js_account.account_prefix")} "${email}" ${TRa("tr_js_account.unblocked_suffix")}`);
  }

  else if (action === "delete") {
    const ok = await (window.askConfirm
      ? window.askConfirm(
          `${TRa("tr_js_account.delete_profile_1")} "${email}" ?\n\n` +
          `⚠ ${TRa("tr_js_account.delete_profile_2")}\n` +
          `⚠ ${TRa("tr_js_account.delete_profile_3")}`,
          { title: TRa("tr_js_account.delete_profile_title"), okText: TRa("tr_js_account.delete"), danger: true })
      : Promise.resolve(confirm(`${TRa("tr_js_account.delete")} "${email}" ${TRa("tr_js_account.delete_profile_fallback")}`)));
    if (!ok) return;
    await window.sb.from("products").delete().eq("user_id", uid);
    const { error } = await window.sb.from("profiles").delete().eq("id", uid);
    if (error) {
      (window.toastError || window.toast)(TRa("tr_js_account.error_prefix") + " " + error.message);
      return;
    }
    (window.toastSuccess || window.toast)(`${TRa("tr_js_account.profile_prefix")} "${email}" ${TRa("tr_js_account.deleted_suffix")}`);
  }

  // Recharger
  MOD_USERS_STATE.loaded = false;
  await loadModUsers();
  loadModBlockedBadge();
}

/* Le badge de non-lus vivait sur l'onglet Messages du compte, retiré au profit
   de l'icône de messagerie du bandeau, qui porte déjà son propre compteur
   (updateHeaderMessages dans script.js). */
