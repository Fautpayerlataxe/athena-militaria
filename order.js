/* =====================================================================
   Page de confirmation de commande
   =====================================================================
   Cette page n'affirme rien par elle-même. Elle lit l'identifiant de session
   dans l'URL, le fait vérifier par le serveur, et affiche ce que le serveur
   répond. Ouvrir /order?session_id=... à la main, ou recevoir le lien de
   quelqu'un d'autre, ne débloque donc rien : la fonction checkout-status
   relit la session chez Stripe et refuse si elle n'appartient pas au visiteur
   connecté.

   L'ancienne success_url renvoyait vers /?payment=success : l'acheteur
   atterrissait sur la page d'accueil, sans confirmation, sans référence de
   commande, et sans moyen de savoir si son paiement avait abouti.
   ===================================================================== */

(function () {
  "use strict";

  const SUPABASE_URL = "https://uctaxgfqdoxtcidllyjv.supabase.co";

  // Textes portés par la page plutôt que par i18n.js : deux chaînes de
  // confirmation ne justifient pas de toucher au dictionnaire global.
  const T = {
    fr: {
      checking: "Vérification de votre paiement…",
      title_ok: "Merci, votre commande est confirmée",
      title_pending: "Paiement en cours de confirmation",
      title_error: "Nous n'avons pas pu vérifier ce paiement",
      login: "Connectez-vous pour retrouver cette commande.",
      login_btn: "Se connecter",
      pending_text: "Votre moyen de paiement demande un délai de confirmation. Vous recevrez un email dès que le paiement sera validé. Aucune action n'est nécessaire de votre part.",
      error_text: "Si un montant a été débité, il sera automatiquement remboursé. Vous pouvez nous écrire à contact@athenamilitaria.fr en indiquant l'heure de votre achat.",
      missing: "Aucune commande à afficher.",
      ref: "Référence",
      amount: "Montant",
      shipping: "Livraison",
      next_title: "Et maintenant ?",
      next_1: "Le vendeur a été prévenu et prépare l'expédition.",
      next_2: "Vous recevrez un email dès que l'article sera expédié.",
      next_3: "Le suivi de votre commande est disponible dans Mon compte.",
      account_btn: "Voir mes achats",
      browse_btn: "Continuer mes découvertes",
      retry: "Réessayer",
    },
    en: {
      checking: "Checking your payment…",
      title_ok: "Thank you, your order is confirmed",
      title_pending: "Payment awaiting confirmation",
      title_error: "We could not verify this payment",
      login: "Sign in to retrieve this order.",
      login_btn: "Sign in",
      pending_text: "Your payment method needs a little time to clear. You will get an email as soon as it is confirmed. Nothing else is required from you.",
      error_text: "If an amount was charged, it will be refunded automatically. You can write to contact@athenamilitaria.fr mentioning the time of your purchase.",
      missing: "No order to display.",
      ref: "Reference",
      amount: "Amount",
      shipping: "Delivery",
      next_title: "What happens next?",
      next_1: "The seller has been notified and is preparing the shipment.",
      next_2: "You will receive an email as soon as the item ships.",
      next_3: "You can follow this order from My account.",
      account_btn: "View my purchases",
      browse_btn: "Keep browsing",
      retry: "Try again",
    },
  };

  function lang() {
    if (window.I18N && window.I18N.current === "en") return "en";
    return new URLSearchParams(location.search).get("lang") === "en" ? "en" : "fr";
  }
  function t(key) {
    const dict = T[lang()] || T.fr;
    return dict[key] || T.fr[key] || key;
  }

  const esc = window.escapeHtml || function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  function render(html) {
    const card = document.getElementById("orderCard");
    if (card) card.innerHTML = html;
  }

  function renderError(message) {
    render(
      '<div class="order-confirm-icon order-confirm-icon--warn" aria-hidden="true">!</div>' +
      "<h1>" + esc(t("title_error")) + "</h1>" +
      "<p>" + esc(message || t("error_text")) + "</p>" +
      '<div class="order-confirm-actions">' +
        '<a class="cta-btn" href="/account">' + esc(t("account_btn")) + "</a>" +
        '<a class="btn outline" href="/category">' + esc(t("browse_btn")) + "</a>" +
      "</div>"
    );
  }

  function renderPending(order) {
    render(
      '<div class="order-confirm-icon order-confirm-icon--wait" aria-hidden="true">⏳</div>' +
      "<h1>" + esc(t("title_pending")) + "</h1>" +
      "<p>" + esc(t("pending_text")) + "</p>" +
      summary(order) +
      '<div class="order-confirm-actions">' +
        '<a class="cta-btn" href="/account">' + esc(t("account_btn")) + "</a>" +
      "</div>"
    );
  }

  function summary(order) {
    if (!order || !order.reference) return "";
    const rows = [];
    rows.push("<li><span>" + esc(t("ref")) + "</span><strong>" + esc(order.reference) + "</strong></li>");
    if (order.amount) rows.push("<li><span>" + esc(t("amount")) + "</span><strong>" + esc(order.amount) + "</strong></li>");
    if (order.shipping) rows.push("<li><span>" + esc(t("shipping")) + "</span><strong>" + esc(order.shipping) + "</strong></li>");
    const title = order.productTitle
      ? "<h2 class=\"order-confirm-item\">" + esc(order.productTitle) + "</h2>"
      : "";
    return title + '<ul class="order-confirm-summary">' + rows.join("") + "</ul>";
  }

  function renderSuccess(order) {
    render(
      '<div class="order-confirm-icon order-confirm-icon--ok" aria-hidden="true">✓</div>' +
      "<h1>" + esc(t("title_ok")) + "</h1>" +
      summary(order) +
      '<div class="order-confirm-next">' +
        "<h3>" + esc(t("next_title")) + "</h3>" +
        "<ul>" +
          "<li>" + esc(t("next_1")) + "</li>" +
          "<li>" + esc(t("next_2")) + "</li>" +
          "<li>" + esc(t("next_3")) + "</li>" +
        "</ul>" +
      "</div>" +
      '<div class="order-confirm-actions">' +
        '<a class="cta-btn" href="/account">' + esc(t("account_btn")) + "</a>" +
        '<a class="btn outline" href="/category">' + esc(t("browse_btn")) + "</a>" +
      "</div>"
    );
  }

  async function run() {
    const sessionId = new URLSearchParams(location.search).get("session_id");
    if (!sessionId) {
      renderError(t("missing"));
      return;
    }

    if (!window.sb) {
      renderError();
      return;
    }

    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      // Le paiement n'est pas perdu pour autant : le webhook l'enregistre de
      // son côté. On demande simplement à l'acheteur de se reconnecter pour
      // qu'on puisse lui montrer sa commande sans la montrer à d'autres.
      render(
        '<div class="order-confirm-icon order-confirm-icon--wait" aria-hidden="true">🔒</div>' +
        "<h1>" + esc(t("title_pending")) + "</h1>" +
        "<p>" + esc(t("login")) + "</p>" +
        '<div class="order-confirm-actions">' +
          '<a class="cta-btn" href="/account">' + esc(t("login_btn")) + "</a>" +
        "</div>"
      );
      return;
    }

    try {
      const res = await fetch(SUPABASE_URL + "/functions/v1/checkout-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: window.SUPABASE_ANON_KEY || "",
          Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        renderError(data.error);
        return;
      }

      if (data.status === "fulfilled") renderSuccess(data.order);
      else renderPending(data.order);

      // On retire session_id de la barre d'adresse : ce n'est pas un secret,
      // mais un lien partagé ou recopié dans un historique n'a aucune raison
      // de le trimballer.
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, "", "/order");
      }
    } catch (err) {
      renderError();
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const card = document.getElementById("orderCard");
    if (!card) return;
    card.innerHTML = '<p class="order-confirm-loading">' + esc(t("checking")) + "</p>";
    run();
  });
})();
