/* ============== PAGE MESSAGERIE (temps réel) ============== */

const TRm = (key) => (window.TR ? window.TR(key) : key);

let currentUserId = null;
let currentPartnerId = null;
let currentProductId = null;
let realtimeChannel = null;

const esc = (s) => (window.escapeHtml ? window.escapeHtml(s || "") : (s || ""));

/* Cache des profils partenaires pour éviter les requêtes répétées */
const profileCache = {};
async function getPartnerProfile(userId) {
  if (!userId) return { pseudo: TRm("tr_js_messages.utilisateur"), avatar_url: null };
  if (profileCache[userId]) return profileCache[userId];
  let profile = { pseudo: TRm("tr_js_messages.utilisateur"), avatar_url: null };
  try {
    // public_profiles et non profiles : la table est réservée à son
    // propriétaire, d'où l'ancien repli systématique sur « Utilisateur ».
    // L'e-mail ne fait volontairement pas partie de la vue publique : tout
    // compte a désormais un pseudo, le repli ne sert plus qu'aux imprévus.
    const { data } = await window.sb
      .from("public_profiles")
      .select("pseudo, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (data) {
      profile = {
        pseudo: data.pseudo || TRm("tr_js_messages.utilisateur"),
        avatar_url: data.avatar_url,
      };
    }
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

/* La messagerie sert deux contextes : la page dédiée messages.html et
   l'onglet "Messages" de account.html (markup identique, embarqué).
   En mode embarqué, c'est account.js qui gère l'écran "non connecté" :
   on ne touche pas au markup pour ne pas le détruire. */
const isEmbeddedInAccount = () => !!document.getElementById("account-user");

document.addEventListener("DOMContentLoaded", async () => {
  const messagesRoot = document.querySelector(".messages-page");
  if (!messagesRoot) return;

  const { data: { user } } = await window.sb.auth.getUser();
  if (!user) {
    if (isEmbeddedInAccount()) return;
    messagesRoot.innerHTML =
      '<section class="auth-required-card">' +
        '<div class="auth-required-icon">' +
          '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '</div>' +
        '<h1>' + TRm("tr_js_messages.messagerie") + '</h1>' +
        '<p>' + TRm("tr_js_messages.connectez_vous_desc") + '</p>' +
        '<div class="auth-required-actions">' +
          '<a href="#" class="cta-btn" id="auth-required-login">' + TRm("tr_js_messages.se_connecter") + '</a>' +
          '<a href="/" class="btn outline">' + TRm("tr_js_messages.retour_accueil") + '</a>' +
        '</div>' +
      '</section>';
    // Attach login modal opener
    const loginBtn = document.getElementById('auth-required-login');
    if (loginBtn) {
      loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = document.getElementById('authModal');
        if (modal) modal.setAttribute('aria-hidden', 'false');
      });
    }
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
        input.value = `${TRm("tr_js_messages.interesse_prefix")} « ${prod.title} ». ${TRm("tr_js_messages.interesse_suffix")}`;
        input.focus();
      }
    }
    return;
  }

  loadConversations();
});

/* ============== Notification e-mail du destinataire ============== */
// Envoie un e-mail "vous avez un nouveau message" au destinataire via la
// fonction serveur message-notify (anti-spam : max 1 e-mail / 10 min / conversation).
async function notifyReceiverByEmail(receiverId, content, productId) {
  try {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) return;
    fetch("https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/message-notify", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + session.access_token,
      },
      body: JSON.stringify({ receiverId, content, productId: productId || null }),
    }).catch(() => {});
  } catch (e) { /* l'e-mail est un bonus : jamais bloquant */ }
}

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
        <h3>${TRm("tr_js_messages.aucune_conversation")}</h3>
        <p>${TRm("tr_js_messages.contacte_vendeur")}</p>
        <a href="/category" class="cta-btn">${TRm("tr_js_messages.parcourir_articles")}</a>
      </li>`;
    return;
  }

  // Grouper par partenaire, compter les non-lus
  const convos = {};
  msgs.forEach((msg) => {
    const partnerId = msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
    if (!convos[partnerId]) {
      convos[partnerId] = { partnerId, lastMsg: msg, unread: 0, productId: null };
    }
    // msgs est trié du plus récent au plus ancien : la première annonce
    // rencontrée est la plus récente de la conversation.
    if (!convos[partnerId].productId && msg.product_id) {
      convos[partnerId].productId = msg.product_id;
    }
    if (msg.receiver_id === currentUserId && !msg.read) {
      convos[partnerId].unread += 1;
    }
  });

  // Titres + photos des annonces liées (une seule requête pour toutes les conversations)
  const productTitles = {};
  const productImages = {};
  const productIds = [...new Set(Object.values(convos).map((c) => c.productId).filter(Boolean))];
  if (productIds.length > 0) {
    const { data: prods } = await window.sb
      .from("products")
      .select("id, title, image_url, image_urls")
      .in("id", productIds);
    (prods || []).forEach((p) => {
      productTitles[p.id] = p.title;
      productImages[p.id] = p.image_url || (Array.isArray(p.image_urls) && p.image_urls[0]) || null;
    });
  }

  list.innerHTML = "";
  for (const conv of Object.values(convos)) {
    const prof = await getPartnerProfile(conv.partnerId);
    // Titre de conversation : le nom de l'annonce si connue, sinon le pseudo
    const convTitle = (conv.productId && productTitles[conv.productId]) || prof.pseudo;
    const li = document.createElement("li");
    li.className = "conversation-item";
    // Avatar : photo de l'annonce si disponible, sinon avatar du membre,
    // sinon l'initiale du titre de la conversation
    const productImg = conv.productId ? productImages[conv.productId] : null;
    const avatarLetter = (convTitle[0] || "U").toUpperCase();
    const avatarHtml = productImg
      ? `<img class="conv-avatar-img" src="${esc(productImg)}" alt="" onerror="this.outerHTML='<div class=\\'conv-avatar\\'>${esc(avatarLetter)}</div>'">`
      : (prof.avatar_url
        ? `<img class="conv-avatar-img" src="${esc(prof.avatar_url)}" alt="">`
        : `<div class="conv-avatar">${esc(avatarLetter)}</div>`);

    const preview = conv.lastMsg.content.substring(0, 70) + (conv.lastMsg.content.length > 70 ? "…" : "");
    const prefix = conv.lastMsg.sender_id === currentUserId ? TRm("tr_js_messages.vous_prefix") + " " : "";
    const timeAgo = window.timeAgo ? window.timeAgo(conv.lastMsg.created_at)
      : new Date(conv.lastMsg.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

    li.innerHTML = `
      ${avatarHtml}
      <div class="conv-info">
        <div class="conv-top-row">
          <span class="conv-name">${esc(convTitle)}</span>
          <span class="conv-time">${timeAgo}</span>
        </div>
        <div class="conv-preview">${esc(prefix + preview)}</div>
      </div>
      ${conv.unread > 0 ? `<span class="conv-badge">${conv.unread}</span>` : ''}
    `;

    li.addEventListener("click", () => {
      currentPartnerId = conv.partnerId;
      openChat(conv.partnerId, conv.productId);
    });
    list.appendChild(li);
  }
}

/* ============== Ouvrir un chat ============== */
async function openChat(partnerId, productId) {
  document.getElementById("conversations-view").style.display = "none";
  document.getElementById("chat-view").style.display = "block";

  // Les prochains messages de cette discussion restent liés à l'annonce
  currentProductId = productId || null;

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
      productBanner.href = `/product?id=${prod.id}`;
      productBanner.innerHTML = `
        <img src="${esc((window.imgUrl ? window.imgUrl(prod.image_url, 400) : prod.image_url) || 'hero.png')}" alt="" loading="lazy" decoding="async" onerror="this.src='hero.png'">
        <div class="cpb-info">
          <div class="cpb-label">${TRm("tr_js_messages.a_propos_de")}</div>
          <div class="cpb-title">${esc(prod.title)}</div>
          <div class="cpb-price">${window.formatPrice ? window.formatPrice(prod.price) : prod.price + ' €'}</div>
        </div>
      `;
      const header = chatBox.querySelector(".chat-header");
      header.insertAdjacentElement("afterend", productBanner);
      // L'en-tête de la discussion affiche le nom de l'annonce
      if (partnerName) partnerName.textContent = prod.title;
    }
  }

  // Bouton retour
  const backBtn = document.getElementById("backToConvos");
  if (backBtn) backBtn.onclick = onBack;

  await loadMessages(partnerId);

  // Abonnement temps réel
  subscribeRealtime(partnerId);

  // Send message
  const sendBtn = document.getElementById("chat-send-btn");
  const input = document.getElementById("chat-input-text");

  const sendMessage = async () => {
    // Toujours lire le champ ACTUEL du DOM (l'original est remplacé par un
    // clone plus bas : la référence `input` devient obsolète et vide).
    const inputEl = document.getElementById("chat-input-text");
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    const pendingText = text;
    inputEl.value = "";

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
      product_id: currentProductId ? Number(currentProductId) : null,
    }]);

    if (error && window.toastError) {
      toastError(TRm("tr_js_messages.erreur_envoi") + " " + error.message);
    } else if (!error) {
      // Notification e-mail au destinataire (arrière-plan, jamais bloquant)
      notifyReceiverByEmail(partnerId, pendingText, currentProductId);
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

  container.innerHTML = '<p class="chat-loading">' + TRm("tr_js_messages.chargement_messages") + '</p>';

  const { data, error } = await window.sb
    .from("messages")
    .select("*")
    .or(
      "and(sender_id.eq." + currentUserId + ",receiver_id.eq." + partnerId + ")," +
      "and(sender_id.eq." + partnerId + ",receiver_id.eq." + currentUserId + ")"
    )
    .order("created_at", { ascending: true });

  container.innerHTML = "";
  delete container.dataset.lastDay;   // réinitialise les séparateurs de jour
  if (error || !data || data.length === 0) {
    container.innerHTML = '<p class="chat-empty">' + TRm("tr_js_messages.aucun_message") + '</p>';
  } else {
    data.forEach(appendMessage);
    // Réactions de tous les messages affichés (une seule requête)
    loadReactions(data.map((m) => m.id).filter(Boolean));
  }
  scrollChatToBottom();

  // Marquer comme lu
  await window.sb
    .from("messages")
    .update({ read: true })
    .eq("receiver_id", currentUserId)
    .eq("sender_id", partnerId)
    .eq("read", false);
}

const EDIT_WINDOW_MS = 2 * 60 * 1000;

function appendMessage(msg) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  // Enlever le placeholder si présent
  const empty = container.querySelector(".chat-empty, .chat-loading");
  if (empty) empty.remove();

  const isMine = msg.sender_id === currentUserId;
  const div = document.createElement("div");
  div.className = "chat-msg " + (isMine ? "sent" : "received");
  if (msg._pending) div.classList.add("pending");
  if (msg.id) div.dataset.msgId = msg.id;
  div.dataset.createdAt = msg.created_at;

  const time = new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const editedTag = msg.edited ? ` <span class="msg-edited">${TRm("tr_js_messages.modifie")}</span>` : "";
  const readAt = msg.read && msg.read_at
    ? " " + new Date(msg.read_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "";
  const readTag = isMine && !msg._pending
    ? ` <span class="msg-status${msg.read ? " is-read" : ""}">${msg.read ? "✓✓ " + TRm("tr_js_messages.lu") + readAt : "✓"}</span>`
    : "";

  div.innerHTML = `
    <div class="msg-text">${esc(msg.content)}</div>
    <div class="msg-meta">${time}${editedTag}${readTag}</div>
    <div class="msg-reactions"></div>`;

  // Bouton Modifier : sur mes messages, pendant 2 minutes
  if (isMine && msg.id && Date.now() - new Date(msg.created_at).getTime() < EDIT_WINDOW_MS) {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-edit-btn";
    editBtn.title = TRm("tr_js_messages.modifier");
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    editBtn.addEventListener("click", () => startEditMessage(div, msg));
    div.appendChild(editBtn);
    // Le bouton disparaît à la fin de la fenêtre d'édition
    setTimeout(() => editBtn.remove(), EDIT_WINDOW_MS - (Date.now() - new Date(msg.created_at).getTime()));
  }

  // Bouton « réagir » (messages enregistrés uniquement)
  if (msg.id) attachReactionButton(div, msg.id);

  // Séparateur de jour si le message ouvre une nouvelle journée
  insertDaySeparator(container, msg.created_at);

  container.appendChild(div);
  scrollChatToBottom();
}

/* ============== Réactions emoji ============== */
const REACTION_CHOICES = ["👍", "❤️", "😂", "😮", "🙏", "🔥"];
const reactionsByMessage = {};   // { messageId: [{user_id, emoji}] }

function attachReactionButton(div, messageId) {
  const btn = document.createElement("button");
  btn.className = "msg-react-btn";
  btn.type = "button";
  btn.title = TRm("tr_js_messages.reagir");
  btn.setAttribute("aria-label", TRm("tr_js_messages.reagir"));
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openReactionPicker(div, messageId, btn);
  });
  div.appendChild(btn);
}

function openReactionPicker(div, messageId, anchorBtn) {
  document.querySelectorAll(".reaction-picker").forEach((p) => p.remove());
  const picker = document.createElement("div");
  picker.className = "reaction-picker";
  REACTION_CHOICES.forEach((emoji) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "reaction-choice";
    b.textContent = emoji;
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      picker.remove();
      await toggleReaction(messageId, emoji);
    });
    picker.appendChild(b);
  });
  div.appendChild(picker);
  // Fermeture au clic extérieur / Échap
  const close = (ev) => {
    if (ev.type === "keydown" && ev.key !== "Escape") return;
    picker.remove();
    document.removeEventListener("click", close);
    document.removeEventListener("keydown", close);
  };
  setTimeout(() => {
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
  }, 0);
}

async function toggleReaction(messageId, emoji) {
  const list = reactionsByMessage[messageId] || [];
  const mine = list.find((r) => r.user_id === currentUserId && r.emoji === emoji);
  try {
    if (mine) {
      await window.sb.from("message_reactions").delete()
        .eq("message_id", messageId).eq("user_id", currentUserId).eq("emoji", emoji);
      reactionsByMessage[messageId] = list.filter((r) => !(r.user_id === currentUserId && r.emoji === emoji));
    } else {
      await window.sb.from("message_reactions")
        .insert([{ message_id: messageId, user_id: currentUserId, emoji }]);
      reactionsByMessage[messageId] = list.concat([{ user_id: currentUserId, emoji }]);
    }
    renderReactions(messageId);
  } catch (e) {
    if (window.toastError) toastError(TRm("tr_js_messages.erreur_reaction"));
  }
}

function renderReactions(messageId) {
  const div = document.querySelector(`.chat-msg[data-msg-id="${messageId}"]`);
  if (!div) return;
  const zone = div.querySelector(".msg-reactions");
  if (!zone) return;

  const list = reactionsByMessage[messageId] || [];
  if (list.length === 0) { zone.innerHTML = ""; zone.style.display = "none"; return; }

  // Regroupe par emoji, en marquant ceux que j'ai posés
  const groups = {};
  list.forEach((r) => {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, mine: false };
    groups[r.emoji].count += 1;
    if (r.user_id === currentUserId) groups[r.emoji].mine = true;
  });

  zone.innerHTML = "";
  zone.style.display = "flex";
  Object.entries(groups).forEach(([emoji, g]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "reaction-chip" + (g.mine ? " is-mine" : "");
    chip.innerHTML = `<span class="re-emoji">${emoji}</span>${g.count > 1 ? `<span class="re-count">${g.count}</span>` : ""}`;
    chip.addEventListener("click", (e) => { e.stopPropagation(); toggleReaction(messageId, emoji); });
    zone.appendChild(chip);
  });
}

/* Charge toutes les réactions des messages affichés */
async function loadReactions(messageIds) {
  if (!messageIds || messageIds.length === 0) return;
  try {
    const { data } = await window.sb
      .from("message_reactions")
      .select("message_id, user_id, emoji")
      .in("message_id", messageIds);
    (data || []).forEach((r) => {
      if (!reactionsByMessage[r.message_id]) reactionsByMessage[r.message_id] = [];
      reactionsByMessage[r.message_id].push({ user_id: r.user_id, emoji: r.emoji });
    });
    messageIds.forEach(renderReactions);
  } catch (e) { /* les réactions sont un bonus */ }
}

/* ============== Confort de lecture ============== */
function scrollChatToBottom(smooth) {
  const c = document.getElementById("chat-messages");
  if (!c) return;
  c.scrollTo({ top: c.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

/* Insère « Aujourd'hui / Hier / 12 juin » quand on change de journée */
function insertDaySeparator(container, createdAt) {
  const d = new Date(createdAt);
  const key = d.toDateString();
  if (container.dataset.lastDay === key) return;
  container.dataset.lastDay = key;

  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  let label;
  if (d.toDateString() === today.toDateString()) label = TRm("tr_js_messages.aujourdhui");
  else if (d.toDateString() === yesterday.toDateString()) label = TRm("tr_js_messages.hier");
  else label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  const sep = document.createElement("div");
  sep.className = "chat-day-sep";
  sep.innerHTML = `<span>${esc(label)}</span>`;
  container.appendChild(sep);
}

/* Édition en place d'un de mes messages (fenêtre de 2 minutes) */
function startEditMessage(div, msg) {
  if (Date.now() - new Date(msg.created_at).getTime() >= EDIT_WINDOW_MS) {
    if (window.toast) toast(TRm("tr_js_messages.edit_expiree"));
    div.querySelector(".msg-edit-btn")?.remove();
    return;
  }
  const textEl = div.querySelector(".msg-text");
  if (!textEl || div.querySelector(".msg-edit-input")) return;

  const original = msg.content;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "msg-edit-input";
  input.value = original;
  textEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const finish = (newText) => {
    const restored = document.createElement("div");
    restored.className = "msg-text";
    restored.textContent = newText;
    input.replaceWith(restored);
  };

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") { finish(original); return; }
    if (e.key !== "Enter") return;
    const newText = input.value.trim();
    if (!newText || newText === original) { finish(original); return; }
    finish(newText);
    const { error } = await window.sb
      .from("messages")
      .update({ content: newText })
      .eq("id", msg.id);
    if (error) {
      finish(original);
      if (window.toastError) toastError(TRm("tr_js_messages.erreur_modif") + " " + error.message);
    } else {
      msg.content = newText;
      msg.edited = true;
      const meta = div.querySelector(".msg-meta");
      if (meta && !meta.querySelector(".msg-edited")) {
        meta.insertAdjacentHTML("beforeend", ` <span class="msg-edited">${TRm("tr_js_messages.modifie")}</span>`);
      }
    }
  });
  // Perte de focus = annulation (Entrée pour enregistrer, Échap pour annuler)
  input.addEventListener("blur", () => { if (div.querySelector(".msg-edit-input")) finish(original); });
}

/* ============== Temps réel ============== */
function subscribeRealtime(partnerId) {
  if (realtimeChannel) {
    window.sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  const isForThisChat = (m) =>
    (m.sender_id === currentUserId && m.receiver_id === partnerId) ||
    (m.sender_id === partnerId && m.receiver_id === currentUserId);

  realtimeChannel = window.sb
    .channel("messages-" + currentUserId + "-" + partnerId)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const m = payload.new;
        if (!isForThisChat(m)) return;
        // Remplacer la bulle optimiste par le message réel (avec id → Lu/édition)
        if (m.sender_id === currentUserId) {
          const pending = document.querySelector(".chat-msg.sent.pending:last-child");
          if (pending) pending.remove();
        }
        appendMessage(m);
        // Marquer comme lu si c'est reçu
        if (m.receiver_id === currentUserId) {
          window.sb.from("messages").update({ read: true }).eq("id", m.id).then();
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      (payload) => {
        const m = payload.new;
        if (!isForThisChat(m)) return;
        const div = document.querySelector(`.chat-msg[data-msg-id="${m.id}"]`);
        if (!div) return;
        // Contenu modifié par l'autre (ou autre onglet)
        const textEl = div.querySelector(".msg-text");
        if (textEl && textEl.textContent !== m.content) textEl.textContent = m.content;
        const meta = div.querySelector(".msg-meta");
        if (meta) {
          if (m.edited && !meta.querySelector(".msg-edited")) {
            meta.insertAdjacentHTML("beforeend", ` <span class="msg-edited">${TRm("tr_js_messages.modifie")}</span>`);
          }
          // Accusé de lecture en direct sur mes messages
          if (m.sender_id === currentUserId && m.read) {
            const st = meta.querySelector(".msg-status");
            if (st) {
              st.classList.add("is-read");
              const at = m.read_at
                ? " " + new Date(m.read_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                : "";
              st.textContent = "✓✓ " + TRm("tr_js_messages.lu") + at;
            }
          }
        }
      }
    )
    // Réactions ajoutées/retirées par l'autre personne (ou un autre onglet)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_reactions" },
      (payload) => {
        const r = payload.new;
        if (!document.querySelector(`.chat-msg[data-msg-id="${r.message_id}"]`)) return;
        const list = reactionsByMessage[r.message_id] || (reactionsByMessage[r.message_id] = []);
        if (!list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) {
          list.push({ user_id: r.user_id, emoji: r.emoji });
        }
        renderReactions(r.message_id);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "message_reactions" },
      (payload) => {
        const r = payload.old;
        if (!r || !reactionsByMessage[r.message_id]) return;
        reactionsByMessage[r.message_id] = reactionsByMessage[r.message_id]
          .filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji));
        renderReactions(r.message_id);
      }
    )
    .subscribe();
}
