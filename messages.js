/* ============== PAGE MESSAGERIE ============== */

let currentUserId = null;
let currentPartnerId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const { data: { user } } = await window.sb.auth.getUser();
  if (!user) {
    document.querySelector(".messages-page").innerHTML =
      '<h1>Messages</h1><p>Connecte-toi pour voir tes messages.</p><a href="index.html" class="cta-btn">Retour à l\'accueil</a>';
    return;
  }

  currentUserId = user.id;

  // Si on arrive avec ?to=xxx&product=yyy, ouvrir directement la conversation
  const params = new URLSearchParams(location.search);
  const to = params.get("to");
  const productId = params.get("product");

  if (to && to !== currentUserId) {
    // Envoyer un premier message automatique si c'est un nouveau contact
    currentPartnerId = to;
    await openChat(to);

    // Si c'est un contact depuis une page produit, pré-remplir
    if (productId) {
      const input = document.getElementById("chat-input-text");
      if (input) {
        const { data: prod } = await window.sb
          .from("products")
          .select("title")
          .eq("id", productId)
          .single();
        if (prod) {
          input.value = "Bonjour, je suis intéressé par \"" + prod.title + "\". Est-il toujours disponible ?";
          input.focus();
        }
      }
    }
    return;
  }

  loadConversations();
});

/* Liste des conversations */
async function loadConversations() {
  const list = document.getElementById("conversations-list");
  if (!list) return;

  // Récupérer tous les messages de l'utilisateur
  const { data: msgs, error } = await window.sb
    .from("messages")
    .select("*")
    .or("sender_id.eq." + currentUserId + ",receiver_id.eq." + currentUserId)
    .order("created_at", { ascending: false });

  if (error || !msgs || msgs.length === 0) {
    list.innerHTML = '<li style="padding:20px;color:#888">Aucune conversation.</li>';
    return;
  }

  // Grouper par partenaire
  const convos = {};
  msgs.forEach((msg) => {
    const partnerId = msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
    if (!convos[partnerId]) {
      convos[partnerId] = { partnerId, lastMsg: msg };
    }
  });

  list.innerHTML = "";
  for (const conv of Object.values(convos)) {
    const li = document.createElement("li");
    li.className = "conversation-item";

    const avatar = document.createElement("div");
    avatar.className = "conv-avatar";
    avatar.textContent = "U";
    li.appendChild(avatar);

    const info = document.createElement("div");
    info.className = "conv-info";
    const name = document.createElement("div");
    name.className = "conv-name";
    name.textContent = conv.lastMsg.sender_id === currentUserId ? "Envoyé" : "Reçu";
    info.appendChild(name);
    const preview = document.createElement("div");
    preview.className = "conv-preview";
    preview.textContent = conv.lastMsg.content.substring(0, 60) + (conv.lastMsg.content.length > 60 ? "..." : "");
    info.appendChild(preview);
    li.appendChild(info);

    const time = document.createElement("div");
    time.className = "conv-time";
    time.textContent = new Date(conv.lastMsg.created_at).toLocaleDateString("fr-FR", {
      day: "numeric", month: "short"
    });
    li.appendChild(time);

    li.addEventListener("click", () => {
      currentPartnerId = conv.partnerId;
      openChat(conv.partnerId);
    });

    list.appendChild(li);
  }
}

/* Ouvrir une conversation */
async function openChat(partnerId) {
  document.getElementById("conversations-view").style.display = "none";
  document.getElementById("chat-view").style.display = "block";

  const partnerName = document.getElementById("chat-partner-name");
  if (partnerName) partnerName.textContent = "Conversation";

  // Bouton retour
  document.getElementById("backToConvos")?.addEventListener("click", () => {
    document.getElementById("chat-view").style.display = "none";
    document.getElementById("conversations-view").style.display = "block";
    loadConversations();
  });

  // Charger les messages
  await loadMessages(partnerId);

  // Envoyer un message
  const sendBtn = document.getElementById("chat-send-btn");
  const input = document.getElementById("chat-input-text");

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;

    await window.sb.from("messages").insert([{
      sender_id: currentUserId,
      receiver_id: partnerId,
      content: text,
    }]);

    input.value = "";
    await loadMessages(partnerId);
  };

  // Remplacer les listeners pour éviter les doublons
  const newSendBtn = sendBtn.cloneNode(true);
  sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
  newSendBtn.addEventListener("click", sendMessage);

  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  newInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });
  // Restore value if pre-filled
  if (input.value) newInput.value = input.value;
}

/* Charger les messages d'une conversation */
async function loadMessages(partnerId) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  const { data, error } = await window.sb
    .from("messages")
    .select("*")
    .or(
      "and(sender_id.eq." + currentUserId + ",receiver_id.eq." + partnerId + ")," +
      "and(sender_id.eq." + partnerId + ",receiver_id.eq." + currentUserId + ")"
    )
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#888;padding:40px">Aucun message. Envoyez le premier !</p>';
    return;
  }

  container.innerHTML = "";
  data.forEach((msg) => {
    const div = document.createElement("div");
    div.className = "chat-msg " + (msg.sender_id === currentUserId ? "sent" : "received");
    div.innerHTML = msg.content + '<div class="msg-time">' +
      new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) +
      "</div>";
    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;

  // Marquer comme lu
  await window.sb
    .from("messages")
    .update({ read: true })
    .eq("receiver_id", currentUserId)
    .eq("sender_id", partnerId)
    .eq("read", false);
}
