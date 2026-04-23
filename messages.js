/* ============== PAGE MESSAGERIE (temps réel) ============== */

let currentUserId = null;
let currentPartnerId = null;
let currentProductId = null;
let realtimeChannel = null;

const esc = (s) => (window.escapeHtml ? window.escapeHtml(s || "") : (s || ""));

/* Cache des profils partenaires pour éviter les requêtes répétées */
const profileCache = {};
async function getPartnerProfile(userId) {
  if (!userId) return { pseudo: "Utilisateur", avatar_url: null };
  if (profileCache[userId]) return profileCache[userId];
  let profile = { pseudo: "Utilisateur", avatar_url: null };
  try {
    const { data } = await window.sb
      .from("profiles")
      .select("pseudo, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (data) profile = { pseudo: data.pseudo || "Utilisateur", avatar_url: data.avatar_url };
  } catch (e) {}
  profileCache[userId] = profile;
  return profile;
}

/* Cache produits */
const productCache = {};
async function getProductInfo(productId) {
  if (!productId) return null;
  if (productCache[productId]) return productCache[productId];
  try {
    const { data } = await window.sb
      .from("products")
      .select("id, title, price, image_url")
      .eq("id", productId)
      .maybeSingle();
    if (data) productCache[productId] = data;
    return data;
  } catch (e) { return null; }
}

document.addEventListener("DOMContentLoaded", async () => {
  const { data: { user } } = await window.sb.auth.getUser();
  if (!user) {
    document.querySelector(".messages-page").innerHTML =
      '<h1>Messages</h1><p>Connecte-toi pour voir tes messages.</p><a href="index.html" class="cta-btn">Retour à l\'accueil</a>';
    return;
  }

  currentUserId = user.id;

  const params = new URLSearchParams(location.search);
  const to = params.get("to");
  const productId = params.get("product");
  currentProductId = productId;

  if (to && to !== currentUserId) {
    currentPartnerId = to;
    await openChat(to, productId);

    if (productId) {
      const input = document.getElementById("chat-input-text");
      const prod = await getProductInfo(productId);
      if (input && prod) {
        input.value = `Bonjour, je suis intéressé par « ${prod.title} ». Est-il toujours disponible ?`;
        input.focus();
      }
    }
    return;
  }

  loadConversations();
});

/* ============== Liste des conversations ============== */
async function loadConversations() {
  const list = document.getElementById("conversations-list");
  if (!list) return;

  list.innerHTML = `
    <li class="conv-skeleton"><div class="skeleton-block" style="width:46px;height:46px;border-radius:50%"></div>
      <div style="flex:1"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></li>
    <li class="conv-skeleton"><div class="skeleton-block" style="width:46px;height:46px;border-radius:50%"></div>
      <div style="flex:1"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></li>
    <li class="conv-skeleton"><div class="skeleton-block" style="width:46px;height:46px;border-radius:50%"></div>
      <div style="flex:1"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></li>
  `;

  const { data: msgs, error } = await window.sb
    .from("messages")
    .select("*")
    .or("sender_id.eq." + currentUserId + ",receiver_id.eq." + currentUserId)
    .order("created_at", { ascending: false });

  if (error || !msgs || msgs.length === 0) {
    list.innerHTML = `
      <li class="conv-empty">
        <div class="conv-empty-icon">💬</div>
        <h3>Aucune conversation</h3>
        <p>Contacte un vendeur depuis une fiche produit pour démarrer une discussion.</p>
        <a href="category.html" class="cta-btn">Parcourir les articles</a>
      </li>`;
    return;
  }

  // Grouper par partenaire, compter les non-lus
  const convos = {};
  msgs.forEach((msg) => {
    const partnerId = msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
    if (!convos[partnerId]) {
      convos[partnerId] = { partnerId, lastMsg: msg, unread: 0 };
    }
    if (msg.receiver_id === currentUserId && !msg.read) {
      convos[partnerId].unread += 1;
    }
  });

  list.innerHTML = "";
  for (const conv of Object.values(convos)) {
    const prof = await getPartnerProfile(conv.partnerId);
    const li = document.createElement("li");
    li.className = "conversation-item";
    const avatarLetter = (prof.pseudo[0] || "U").toUpperCase();
    const avatarHtml = prof.avatar_url
      ? `<img class="conv-avatar-img" src="${esc(prof.avatar_url)}" alt="">`
      : `<div class="conv-avatar">${esc(avatarLetter)}</div>`;

    const preview = conv.lastMsg.content.substring(0, 70) + (conv.lastMsg.content.length > 70 ? "…" : "");
    const prefix = conv.lastMsg.sender_id === currentUserId ? "Vous : " : "";
    const timeAgo = window.timeAgo ? window.timeAgo(conv.lastMsg.created_at)
      : new Date(conv.lastMsg.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

    li.innerHTML = `
      ${avatarHtml}
      <div class="conv-info">
        <div class="conv-top-row">
          <span class="conv-name">${esc(prof.pseudo)}</span>
          <span class="conv-time">${timeAgo}</span>
        </div>
        <div class="conv-preview">${esc(prefix + preview)}</div>
      </div>
      ${conv.unread > 0 ? `<span class="conv-badge">${conv.unread}</span>` : ''}
    `;

    li.addEventListener("click", () => {
      currentPartnerId = conv.partnerId;
      openChat(conv.partnerId);
    });
    list.appendChild(li);
  }
}

/* ============== Ouvrir un chat ============== */
async function openChat(partnerId, productId) {
  document.getElementById("conversations-view").style.display = "none";
  document.getElementById("chat-view").style.display = "block";

  const prof = await getPartnerProfile(partnerId);
  const partnerName = document.getElementById("chat-partner-name");
  if (partnerName) partnerName.textContent = prof.pseudo;

  // Vignette produit si on vient d'une fiche produit
  const chatBox = document.querySelector(".chat-box");
  let productBanner = document.getElementById("chat-product-banner");
  if (productBanner) productBanner.remove();
  if (productId) {
    const prod = await getProductInfo(productId);
    if (prod) {
      productBanner = document.createElement("a");
      productBanner.id = "chat-product-banner";
      productBanner.className = "chat-product-banner";
      productBanner.href = `product.html?id=${prod.id}`;
      productBanner.innerHTML = `
        <img src="${esc(prod.image_url || 'hero.png')}" alt="" onerror="this.src='hero.png'">
        <div class="cpb-info">
          <div class="cpb-label">À propos de</div>
          <div class="cpb-title">${esc(prod.title)}</div>
          <div class="cpb-price">${window.formatPrice ? window.formatPrice(prod.price) : prod.price + ' €'}</div>
        </div>
      `;
      const header = chatBox.querySelector(".chat-header");
      header.insertAdjacentElement("afterend", productBanner);
    }
  }

  // Bouton retour
  document.getElementById("backToConvos")?.addEventListener("click", onBack, { once: true });

  await loadMessages(partnerId);

  // Abonnement temps réel
  subscribeRealtime(partnerId);

  // Send message
  const sendBtn = document.getElementById("chat-send-btn");
  const input = document.getElementById("chat-input-text");

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;
    const pendingText = text;
    input.value = "";

    // Optimistic UI : ajouter le message immédiatement
    appendMessage({
      sender_id: currentUserId,
      content: pendingText,
      created_at: new Date().toISOString(),
      _pending: true,
    });

    const { error } = await window.sb.from("messages").insert([{
      sender_id: currentUserId,
      receiver_id: partnerId,
      content: pendingText,
    }]);

    if (error && window.toastError) {
      toastError("Erreur d'envoi : " + error.message);
    }
  };

  const newSendBtn = sendBtn.cloneNode(true);
  sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
  newSendBtn.addEventListener("click", sendMessage);

  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  newInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
  });
  if (input.value) newInput.value = input.value;
}

function onBack() {
  document.getElementById("chat-view").style.display = "none";
  document.getElementById("conversations-view").style.display = "block";
  if (realtimeChannel) {
    window.sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  loadConversations();
}

/* ============== Charger et afficher les messages ============== */
async function loadMessages(partnerId) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  container.innerHTML = '<p class="chat-loading">Chargement des messages…</p>';

  const { data, error } = await window.sb
    .from("messages")
    .select("*")
    .or(
      "and(sender_id.eq." + currentUserId + ",receiver_id.eq." + partnerId + ")," +
      "and(sender_id.eq." + partnerId + ",receiver_id.eq." + currentUserId + ")"
    )
    .order("created_at", { ascending: true });

  container.innerHTML = "";
  if (error || !data || data.length === 0) {
    container.innerHTML = '<p class="chat-empty">Aucun message. Envoyez le premier !</p>';
  } else {
    data.forEach(appendMessage);
  }
  container.scrollTop = container.scrollHeight;

  // Marquer comme lu
  await window.sb
    .from("messages")
    .update({ read: true })
    .eq("receiver_id", currentUserId)
    .eq("sender_id", partnerId)
    .eq("read", false);
}

function appendMessage(msg) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  // Enlever le placeholder si présent
  const empty = container.querySelector(".chat-empty, .chat-loading");
  if (empty) empty.remove();

  const div = document.createElement("div");
  div.className = "chat-msg " + (msg.sender_id === currentUserId ? "sent" : "received");
  if (msg._pending) div.classList.add("pending");
  const time = new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `<div class="msg-text">${esc(msg.content)}</div><div class="msg-time">${time}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/* ============== Temps réel ============== */
function subscribeRealtime(partnerId) {
  if (realtimeChannel) {
    window.sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = window.sb
    .channel("messages-" + currentUserId + "-" + partnerId)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const m = payload.new;
        const isForThisChat =
          (m.sender_id === currentUserId && m.receiver_id === partnerId) ||
          (m.sender_id === partnerId && m.receiver_id === currentUserId);
        if (!isForThisChat) return;
        // Éviter les doublons optimistes
        if (m.sender_id === currentUserId) {
          const pending = document.querySelector(".chat-msg.sent.pending:last-child");
          if (pending) { pending.classList.remove("pending"); return; }
        }
        appendMessage(m);
        // Marquer comme lu si c'est reçu
        if (m.receiver_id === currentUserId) {
          window.sb.from("messages").update({ read: true }).eq("id", m.id).then();
        }
      }
    )
    .subscribe();
}
