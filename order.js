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
      pending_text: "Votre moyen de paiement demande un délai de confirmation. Vous recevrez un e-mail dès que le paiement sera validé. Aucune action n'est nécessaire de votre part.",
      error_text: "Avant de refaire un achat, vérifiez vos achats dans Mon compte et votre relevé bancaire. En cas de doute, écrivez-nous à contact@athenamilitaria.fr en indiquant l'heure de votre achat.",
      none_title: "Aucune commande à afficher",
      none_text: "Cette page confirme un paiement au retour de Stripe. Vos achats restent consultables dans Mon compte.",
      ref: "Référence",
      amount: "Montant",
      shipping: "Livraison",
      next_title: "Et maintenant ?",
      next_1: "Le vendeur a été prévenu et prépare l'expédition.",
      next_2: "Vous recevrez un e-mail dès que l'article sera expédié.",
      next_1_pickup: "Le vendeur a été prévenu. Convenez avec lui de la remise en main propre depuis la messagerie.",
      next_3: "Le suivi de votre commande est disponible dans Mon compte.",
      account_btn: "Voir mes achats",
      browse_btn: "Continuer mes découvertes",
      retry: "Réessayer",
      seller_pending_title: "Le vendeur finalise son inscription au paiement",
      seller_pending_text: "Votre paiement est bien reçu et reste sur le compte d'Athena Militaria. Le vendeur doit encore finaliser son inscription auprès de Stripe, notre prestataire de paiement, pour pouvoir expédier et être payé. À défaut le {date}, votre commande sera annulée et intégralement remboursée (article, livraison et Protection acheteurs), automatiquement, sans démarche de votre part.",
      seller_pending_next_1: "Dès que le vendeur aura finalisé son inscription, il disposera de 5 jours ouvrés pour expédier, et nous vous écrirons.",
    },
    en: {
      checking: "Checking your payment…",
      title_ok: "Thank you, your order is confirmed",
      title_pending: "Payment awaiting confirmation",
      title_error: "We could not verify this payment",
      login: "Sign in to retrieve this order.",
      login_btn: "Sign in",
      pending_text: "Your payment method needs a little time to clear. You will get an email as soon as it is confirmed. Nothing else is required from you.",
      error_text: "Before buying again, check your purchases in My account and your bank statement. If in doubt, write to contact@athenamilitaria.fr mentioning the time of your purchase.",
      none_title: "No order to show",
      none_text: "This page confirms a payment on your return from Stripe. Your purchases remain available in My account.",
      ref: "Reference",
      amount: "Amount",
      shipping: "Delivery",
      next_title: "What happens next?",
      next_1: "The seller has been notified and is preparing the shipment.",
      next_2: "You will receive an email as soon as the item ships.",
      next_1_pickup: "The seller has been notified. Arrange the hand delivery with them through the messaging.",
      next_3: "You can follow this order from My account.",
      account_btn: "View my purchases",
      browse_btn: "Keep browsing",
      retry: "Try again",
      seller_pending_title: "The seller is completing their payment setup",
      seller_pending_text: "Your payment has been received and stays in Athena Militaria's account. The seller still needs to finish signing up with Stripe, our payment provider, before they can ship and be paid. If they have not done so by {date}, your order will be cancelled and refunded in full (item, delivery and Buyer Protection), automatically, with nothing for you to do.",
      seller_pending_next_1: "As soon as the seller has finished signing up, they will have 5 working days to ship, and we will email you.",
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

  /* Adresse interne dans la langue affichée (I18N.lien, i18n.js). */
  function lien(chemin) {
    return window.I18N && window.I18N.lien ? window.I18N.lien(chemin) : chemin;
  }

  /* Libellés des modes de livraison renvoyés par checkout-status (texte
     français du catalogue SHIPPING_CATALOG) : traduits pour la page
     anglaise, et seul moyen ici de reconnaître une remise en main propre,
     la réponse ne portant pas le code du mode. */
  const REMISE_EN_MAIN_PROPRE = "Remise en main propre";
  const MODES_EN = {
    "Remise en main propre": "Hand delivery",
    "Point relais (Mondial Relay)": "Pickup point (Mondial Relay)",
    "Envoi postal (Colissimo suivi)": "Postal shipping (tracked Colissimo)",
  };

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
        '<a class="cta-btn" href="' + esc(lien("/account")) + '">' + esc(t("account_btn")) + "</a>" +
        '<a class="btn outline" href="' + esc(lien("/militaria")) + '">' + esc(t("browse_btn")) + "</a>" +
      "</div>"
    );
  }

  /* /order sans commande : un état neutre, sans icône d'alerte. La page
     annonçait « Nous n'avons pas pu vérifier ce paiement » à qui l'ouvrait
     sans paramètre, comme après un échec de paiement. */
  function renderAucune() {
    render(
      "<h1>" + esc(t("none_title")) + "</h1>" +
      "<p>" + esc(t("none_text")) + "</p>" +
      '<div class="order-confirm-actions">' +
        '<a class="cta-btn" href="' + esc(lien("/account")) + '">' + esc(t("account_btn")) + "</a>" +
        '<a class="btn outline" href="' + esc(lien("/militaria")) + '">' + esc(t("browse_btn")) + "</a>" +
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
        '<a class="cta-btn" href="' + esc(lien("/account")) + '">' + esc(t("account_btn")) + "</a>" +
      "</div>"
    );
  }

  function summary(order) {
    if (!order || !order.reference) return "";
    const rows = [];
    rows.push("<li><span>" + esc(t("ref")) + "</span><strong>" + esc(order.reference) + "</strong></li>");
    if (order.amount) rows.push("<li><span>" + esc(t("amount")) + "</span><strong>" + esc(order.amount) + "</strong></li>");
    if (order.shipping) {
      const mode = lang() === "en" ? (MODES_EN[order.shipping] || order.shipping) : order.shipping;
      rows.push("<li><span>" + esc(t("shipping")) + "</span><strong>" + esc(mode) + "</strong></li>");
    }
    const title = order.productTitle
      ? "<h2 class=\"order-confirm-item\">" + esc(order.productTitle) + "</h2>"
      : "";
    return title + '<ul class="order-confirm-summary">' + rows.join("") + "</ul>";
  }

  /* Échéance en anglais, à l'heure de Paris, comme dans account.js :
     « Saturday 17 October 2026, 14:05 (Paris time) ». Le français vient
     tout écrit du serveur (sellerDeadlineText, format des courriels). */
  function fmtEN(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "";
    const p = {};
    try {
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris",
        weekday: "long", day: "numeric", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    } catch (err) {
      return "";
    }
    return p.weekday + " " + p.day + " " + p.month + " " + p.year + ", " + p.hour + ":" + p.minute + " (Paris time)";
  }

  /* Vendeur qui n'a pas fini son inscription au paiement (checkout-status :
     sellerPending). Sans ce champ, la page dit ce qu'elle disait avant. */
  function blocVendeurEnAttente(order) {
    if (!order || !order.sellerPending) return "";
    const date = (lang() === "en" ? fmtEN(order.sellerDeadline) : "") || order.sellerDeadlineText || "";
    return '<div class="order-confirm-next">' +
        "<h3>" + esc(t("seller_pending_title")) + "</h3>" +
        "<p>" + esc(t("seller_pending_text").split("{date}").join(date)) + "</p>" +
      "</div>";
  }

  function renderSuccess(order) {
    const attente = !!(order && order.sellerPending);
    /* Remise en main propre : rien n'est expédié. La page annonçait quand
       même « prépare l'expédition » et un e-mail « dès que l'article sera
       expédié », alors que order-notify écrit « Remise en main propre
       enregistrée ». */
    const enMain = !!(order && order.shipping === REMISE_EN_MAIN_PROPRE);
    const premier = attente ? "seller_pending_next_1" : (enMain ? "next_1_pickup" : "next_1");
    render(
      '<div class="order-confirm-icon order-confirm-icon--ok" aria-hidden="true">✓</div>' +
      "<h1>" + esc(t("title_ok")) + "</h1>" +
      summary(order) +
      blocVendeurEnAttente(order) +
      '<div class="order-confirm-next">' +
        "<h3>" + esc(t("next_title")) + "</h3>" +
        "<ul>" +
          "<li>" + esc(t(premier)) + "</li>" +
          (enMain ? "" : "<li>" + esc(t("next_2")) + "</li>") +
          "<li>" + esc(t("next_3")) + "</li>" +
        "</ul>" +
      "</div>" +
      '<div class="order-confirm-actions">' +
        '<a class="cta-btn" href="' + esc(lien("/account")) + '">' + esc(t("account_btn")) + "</a>" +
        '<a class="btn outline" href="' + esc(lien("/militaria")) + '">' + esc(t("browse_btn")) + "</a>" +
      "</div>"
    );
  }

  /* -------------------------------------------------------------------
     Enquête Google Avis clients.

     Le serveur ne fournit les champs que pour un paiement confirmé, et le
     script Google n'est chargé qu'à ce moment-là : une visite ordinaire de
     la page ne parle jamais à Google. La boîte de dialogue qui s'affiche
     est elle-même la demande de consentement : rien n'est transmis si
     l'acheteur décline, et un échec de chargement (bloqueur de publicité,
     réseau) est simplement silencieux, la confirmation restant intacte.
     ------------------------------------------------------------------- */
  function proposerEnqueteGoogle(review) {
    if (!review || !review.orderId || !review.email || !review.estimatedDeliveryDate) return;
    window.renderOptIn = function () {
      try {
        window.gapi.load("surveyoptin", function () {
          window.gapi.surveyoptin.render({
            merchant_id: 5838825955,
            order_id: review.orderId,
            email: review.email,
            delivery_country: review.deliveryCountry || "FR",
            estimated_delivery_date: review.estimatedDeliveryDate,
          });
        });
      } catch (err) {
        /* L'enquête est un bonus, jamais une gêne. */
      }
    };
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/platform.js?onload=renderOptIn";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  /* Identifiant de session : dans l'adresse au retour de Stripe, puis dans
     l'état de l'historique, qui survit au rechargement dans le même onglet.
     L'adresse en est nettoyée après la confirmation ; recharger la page
     affichait alors « Aucune commande ». */
  function sessionDemandee() {
    const dansAdresse = new URLSearchParams(location.search).get("session_id");
    if (dansAdresse) return dansAdresse;
    const etat = window.history && window.history.state;
    return etat && typeof etat.sessionId === "string" ? etat.sessionId : null;
  }

  /* Paiement « en attente » au retour de Stripe : le plus souvent, le
     webhook n'a pas encore été traité et la commande passe à « payée »
     quelques secondes plus tard. On revérifie donc seul, quatre fois, sans
     toucher à l'adresse : la confirmation et l'enquête Google Avis clients
     ne s'affichent qu'à l'état payé, et l'acheteur repartait sans elles. */
  const ESSAIS_EN_ATTENTE = 4;
  const DELAI_EN_ATTENTE = 5000;

  async function run(essai) {
    essai = essai || 0;
    const sessionId = sessionDemandee();
    if (!sessionId) {
      renderAucune();
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
      /* La connexion s'ouvre sur place : l'identifiant de session reste
         dans l'adresse, et la page se recharge après la connexion
         (script.js), ce qui relance la vérification. Le lien vers
         /account perdait la commande, et avec elle la confirmation et
         l'enquête Google Avis clients. */
      render(
        '<div class="order-confirm-icon order-confirm-icon--wait" aria-hidden="true">🔒</div>' +
        "<h1>" + esc(t("title_pending")) + "</h1>" +
        "<p>" + esc(t("login")) + "</p>" +
        '<div class="order-confirm-actions">' +
          '<a class="cta-btn" id="orderLogin" href="' + esc(lien("/account")) + '">' + esc(t("login_btn")) + "</a>" +
        "</div>"
      );
      const bouton = document.getElementById("orderLogin");
      if (bouton) {
        bouton.addEventListener("click", function (e) {
          if (!window.ouvrirModaleAuth) return;
          e.preventDefault();
          window.ouvrirModaleAuth("login", t("login"));
        });
      }
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

      /* INTERNAL : le texte du serveur (« Aucun montant n'a été débité »)
         est écrit pour l'ouverture du paiement. Ici, l'acheteur revient de
         Stripe : sa carte a pu être débitée, et une exception peut survenir
         après l'encaissement. On garde donc le texte de cette page, qui ne
         préjuge de rien. */
      if (!res.ok) {
        // Une revérification qui échoue laisse l'attente affichée.
        if (essai > 0) return;
        renderError(data.code === "INTERNAL" ? "" : data.error);
        return;
      }

      if (data.status !== "fulfilled") {
        renderPending(data.order);
        if (essai < ESSAIS_EN_ATTENTE) setTimeout(function () { run(essai + 1); }, DELAI_EN_ATTENTE);
        return;
      }
      renderSuccess(data.order);
      proposerEnqueteGoogle(data.review);

      // On retire session_id de la barre d'adresse : ce n'est pas un secret,
      // mais un lien partagé ou recopié dans un historique n'a aucune raison
      // de le trimballer. Il reste dans l'état de l'historique, pour qu'un
      // rechargement retrouve la commande.
      if (window.history && window.history.replaceState) {
        window.history.replaceState({ sessionId: sessionId }, "", "/order" + (lang() === "en" ? "?lang=en" : ""));
      }
    } catch (err) {
      if (essai > 0) return;
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
