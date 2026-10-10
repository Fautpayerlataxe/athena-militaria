/* ============== PAGE MON COMPTE ============== */

const TRa = (key) => (window.TR ? window.TR(key) : key);
/* Libellé ajouté après la dernière version des dictionnaires : i18n-fr.js et
   i18n-en.js sont servis « immutable », et un visiteur peut garder l'ancien.
   TRa rendrait alors la clé elle-même ; on écrit la phrase de secours. */
const TRaOu = (key, fr, en) => {
  const val = TRa(key);
  if (val !== key) return val;
  return (window.I18N && window.I18N.current === "en") ? en : fr;
};
const ERRa = (e) => (window.messageErreur ? window.messageErreur(e) : TRa("err.generique"));

/* --- Vente conclue chez un vendeur qui n'a pas fini son inscription -------
 *
 * Décision du 10 oct. 2026 (migration 20261010000000_vendeur_pas_pret.sql) :
 * l'achat est accepté même si le vendeur n'a pas terminé son inscription au
 * paiement (Stripe). L'argent reste sur le compte d'Athena Militaria ; le
 * vendeur a jusqu'à seller_ready_deadline_at (7 jours après le paiement)
 * pour finaliser, sinon la commande est annulée et l'acheteur remboursé.
 *
 * Avant la migration, les colonnes seller_ready_* n'existent pas : select("*")
 * ne les renvoie pas, venteVendeurPasPret répond « rien de tout cela », et
 * Mes achats comme Mes ventes s'affichent exactement comme avant.
 */
function venteVendeurPasPret(o) {
  const etat = { attente: false, echue: false, annulee: false };
  if (!o) return etat;
  etat.annulee = !!o.seller_ready_cancel_at || (o.status === "refunded" && !!o.seller_ready_refunded_at);
  const echeance = o.seller_ready_deadline_at;
  const vpp = !!echeance && Number.isFinite(new Date(echeance).getTime())
    && !o.seller_ready_at && !o.seller_ready_cancel_at && !o.seller_ready_refunded_at
    && (o.status === "paid" || o.status === "disputed");
  if (vpp) {
    etat.echue = new Date(echeance) <= new Date();
    etat.attente = !etat.echue;
  }
  return etat;
}

/* Échéance à l'heure de Paris, au format des courriels (formatEcheance de
   supabase/functions/_shared/vendeur-pas-pret.ts) : « samedi 17 octobre 2026
   à 14 h 05 », espaces insécables autour du « h ». L'heure compte :
   l'échéance tombe à l'heure exacte du paiement, sept jours plus tard. En
   anglais : « Saturday 17 October 2026, 14:05 (Paris time) ». Chaîne vide
   si la date est illisible. */
function partiesDateParis(iso, langue) {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parties = {};
  try {
    new Intl.DateTimeFormat(langue, {
      timeZone: "Europe/Paris",
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).forEach((p) => { parties[p.type] = p.value; });
  } catch (e) {
    return null;
  }
  return parties;
}
function fmtEcheance(iso) {
  const p = partiesDateParis(iso, "fr-FR");
  return p ? `${p.weekday} ${p.day} ${p.month} ${p.year} à ${p.hour}\u00a0h\u00a0${p.minute}` : "";
}
function fmtEN(iso) {
  const p = partiesDateParis(iso, "en-GB");
  return p ? `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} (Paris time)` : "";
}
function fmtEcheanceLangue(iso) {
  return (window.I18N && window.I18N.current === "en") ? fmtEN(iso) : fmtEcheance(iso);
}

/* Libellés de ces ventes, avec leur texte de secours pour un dictionnaire
   resté en cache (voir TRaOu). Les deux langues doivent rester identiques à
   i18n.js : tests/vendeur-pas-pret-front.test.ts compare. */
const TEXTES_VENDEUR_PAS_PRET = {
  sale_stripe_required: [
    "Pour recevoir l'argent de cette vente, finalisez votre inscription au paiement (Stripe) avant le {date}. D'ici là, vous ne pouvez pas déclarer l'expédition : n'expédiez pas encore l'article. À défaut, la commande sera annulée et l'acheteur intégralement remboursé.",
    "To receive the money from this sale, finish your payment setup (Stripe) before {date}. Until then you cannot mark the order as shipped: do not ship the item yet. Otherwise the order will be cancelled and the buyer refunded in full.",
  ],
  sale_stripe_finish_btn: ["Finaliser mon inscription", "Finish my setup"],
  sale_deadline_passed: [
    "L'échéance est passée sans que votre inscription au paiement soit terminée : cette vente va être annulée et l'acheteur intégralement remboursé. N'expédiez pas l'article.",
    "The deadline has passed without your payment setup being complete: this sale will be cancelled and the buyer refunded in full. Do not ship the item.",
  ],
  payout_waiting_stripe: [
    "Versement impossible tant que votre inscription au paiement n'est pas terminée",
    "No payout until your payment setup is complete",
  ],
  payout_not_applicable: [
    "Aucun versement : commande annulée et remboursée",
    "No payout: order cancelled and refunded",
  ],
  sale_canceled_seller_not_ready: [
    "Vente annulée : votre inscription au paiement n'était pas terminée à l'échéance. L'acheteur est intégralement remboursé. N'expédiez pas l'article.",
    "Sale cancelled: your payment setup was not complete by the deadline. The buyer is refunded in full. Do not ship the item.",
  ],
  ship_blocked_stripe: [
    "Finalisez d'abord votre inscription au paiement (Mon compte, rubrique Paramètres) : sans elle, vous ne pouvez pas déclarer l'expédition.",
    "First finish your payment setup (My account, Settings): until then you cannot mark the order as shipped.",
  ],
  ship_blocked_canceled: [
    "Cette commande est annulée, ou va l'être, et l'acheteur remboursé : n'expédiez pas l'article.",
    "This order is cancelled, or about to be, and the buyer refunded: do not ship the item.",
  ],
  stripe_pending_sales: [
    "{n} ventes attendent votre inscription. Première échéance : {date}. Passé ce délai, la commande est annulée et l'acheteur remboursé.",
    "{n} sales are waiting for your setup. First deadline: {date}. After that, the order is cancelled and the buyer refunded.",
  ],
  stripe_pending_sales_one: [
    "Une vente attend votre inscription. Échéance : {date}. Passé ce délai, la commande est annulée et l'acheteur remboursé.",
    "One sale is waiting for your setup. Deadline: {date}. After that, the order is cancelled and the buyer refunded.",
  ],
  purchase_seller_pending: [
    "Le vendeur finalise son inscription au paiement. À défaut le {date}, votre commande sera annulée et intégralement remboursée, automatiquement. D'ici là, votre paiement reste sur le compte d'Athena Militaria.",
    "The seller is completing their payment setup. If it is not done by {date}, your order will be cancelled and refunded in full, automatically. Until then your payment stays in Athena Militaria's account.",
  ],
  purchase_refund_in_progress: [
    "Le vendeur n'a pas finalisé son inscription au paiement à temps : votre commande est annulée et votre remboursement intégral est en cours, automatiquement.",
    "The seller did not complete their payment setup in time: your order is cancelled and your full refund is under way, automatically.",
  ],
  purchase_canceled_seller_not_ready: [
    "Commande annulée et intégralement remboursée : le vendeur n'a pas finalisé son inscription au paiement à temps.",
    "Order cancelled and refunded in full: the seller did not complete their payment setup in time.",
  ],
};
/* Libellé traduit, {date} et {n} remplacés tels quels (split/join : aucun
   « $ » d'une valeur n'est lu comme un motif de remplacement). */
function TRvpp(cle, valeurs) {
  const [fr, en] = TEXTES_VENDEUR_PAS_PRET[cle];
  let texte = TRaOu("tr_js_account." + cle, fr, en);
  for (const [nom, valeur] of Object.entries(valeurs || {})) {
    texte = texte.split("{" + nom + "}").join(String(valeur));
  }
  return texte;
}

/* Ouvre un onglet de Mon compte comme un clic sur son bouton, et amène au
   besoin un élément à l'écran (lien des courriels, bouton « Finaliser mon
   inscription »). Le focus suit le défilement pour le clavier et les
   lecteurs d'écran. */
function ouvrirOnglet(nom, cibleId, focusId) {
  const bouton = document.querySelector('.tab-btn[data-tab="' + nom + '"]');
  if (!bouton) return;
  bouton.click();
  const cible = cibleId ? document.getElementById(cibleId) : null;
  if (!cible) return;
  const doux = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  cible.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
  const focus = focusId ? document.getElementById(focusId) : null;
  if (focus && typeof focus.focus === "function") {
    try { focus.focus({ preventScroll: true }); } catch (e) { focus.focus(); }
  }
}

/* Profil de paiement du vendeur connecté : lu une seule fois, par la carte
   Stripe (après la synchronisation au retour de Stripe), et attendu par Mes
   ventes quand une vente attend son inscription. */
let PROFIL_PAIEMENT = null;

/* --- Retour du lien de réinitialisation ---------------------------------
 *
 * Supabase renvoie ici avec un jeton de récupération dans l'adresse. Son
 * client l'échange contre une session et émet PASSWORD_RECOVERY. Sans écran
 * dédié, l'utilisateur atterrissait sur son compte, connecté, sans comprendre
 * qu'il devait maintenant choisir un mot de passe : le lien semblait n'avoir
 * servi à rien.
 *
 * On intercepte donc avant tout le reste, et on ne laisse repartir qu'une fois
 * le nouveau mot de passe posé.
 */
function ecranNouveauMotDePasse() {
  if (document.getElementById("recovery-overlay")) return;

  const ecran = document.createElement("div");
  ecran.id = "recovery-overlay";
  ecran.className = "recovery-overlay";
  ecran.innerHTML = `
    <div class="recovery-card" role="dialog" aria-modal="true" aria-labelledby="recoveryTitle">
      <h2 id="recoveryTitle">${TRa("tr_js_account.recovery_title")}</h2>
      <p>${TRa("tr_js_account.recovery_intro")}</p>
      <input type="password" id="recoveryPass" autocomplete="new-password"
             placeholder="${TRa("tr_js_account.recovery_new")}" aria-label="${TRa("tr_js_account.recovery_new")}">
      <input type="password" id="recoveryPass2" autocomplete="new-password"
             placeholder="${TRa("tr_js_account.recovery_confirm")}" aria-label="${TRa("tr_js_account.recovery_confirm")}">
      <p class="recovery-error" id="recoveryError" hidden></p>
      <button class="cta-btn" id="recoverySave">${TRa("tr_js_account.recovery_save")}</button>
    </div>`;
  document.body.appendChild(ecran);
  // Même verrou que les autres fenêtres (script.js) : overflow: hidden
  // n'empêchait pas la page de défiler dessous.
  window.figerLaPage?.("recuperation");

  const champ = document.getElementById("recoveryPass");
  champ?.focus();

  const erreur = (texte) => {
    const el = document.getElementById("recoveryError");
    if (!el) return;
    el.textContent = texte;
    el.hidden = !texte;
  };

  document.getElementById("recoverySave").addEventListener("click", async () => {
    const a = document.getElementById("recoveryPass").value;
    const b = document.getElementById("recoveryPass2").value;
    if (!a || a.length < 6) return erreur(TRa("tr_js_account.password_min"));
    if (a !== b) return erreur(TRa("tr_js_account.recovery_mismatch"));

    const bouton = document.getElementById("recoverySave");
    bouton.disabled = true;
    erreur("");

    const { error } = await window.sb.auth.updateUser({ password: a });
    if (error) {
      bouton.disabled = false;
      // Un lien expiré ou déjà utilisé n'ouvre pas de session : le dire.
      return erreur(/session|jwt|token|expired/i.test(error.message || "")
        ? TRa("tr_js_account.recovery_expired")
        : ERRa(error));
    }

    ecran.remove();
    window.rendreLaPage?.("recuperation");
    history.replaceState(null, "", location.pathname);
    (window.toastSuccess || window.toast)(TRa("tr_js_account.password_updated"));
  });
}

window.sb.auth.onAuthStateChange((evenement) => {
  if (evenement === "PASSWORD_RECOVERY") ecranNouveauMotDePasse();
});

document.addEventListener("DOMContentLoaded", async () => {
  /* Le paramètre survit à l'échange du jeton : il sert de second déclencheur
     si l'événement est passé avant que ce script ne soit chargé. */
  if (new URLSearchParams(location.search).get("recovery") === "1") {
    const { data } = await window.sb.auth.getSession();
    if (data?.session) ecranNouveauMotDePasse();
  }

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
        if (window.ouvrirModaleAuth) window.ouvrirModaleAuth();
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

  /* Liens des courriels : /account?tab=my-settings ouvre Paramètres sur la
     carte de paiement (inscription Stripe à finaliser) ; ?tab=my-sales et
     ?tab=my-orders ouvrent Mes ventes et Mes achats. */
  const ongletDemande = new URLSearchParams(location.search).get("tab");
  if (ongletDemande === "my-settings") {
    ouvrirOnglet("my-settings", "stripeConnectCard");
  } else if (ongletDemande === "my-sales" || ongletDemande === "my-orders") {
    ouvrirOnglet(ongletDemande);
  }

  // Charger mes annonces
  loadMyListings(user.id);

  /* Configuration des paiements vendeur (Stripe Connect). Lancée avant Mes
     ventes : le profil qu'elle lit (PROFIL_PAIEMENT) dit si une vente qui
     attend l'inscription du vendeur peut déjà être expédiée. */
  PROFIL_PAIEMENT = initStripeConnect(user);

  // Charger mes achats et mes ventes.
  // On passe l'identifiant, plus l'email : les politiques RLS filtrent sur
  // buyer_id / seller_id, alors que la requête filtrait sur customer_email.
  // Une adresse différente saisie chez Stripe faisait disparaître la commande
  // de « Mes achats », et une adresse partagée aurait pu en montrer d'autres.
  loadMyOrders(user.id);
  loadMySales(user.id);

  // Charger mes favoris
  loadMyFavorites(user.id);

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
        toastError(ERRa(error));
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
          : ERRa(error)
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

/* Demande à connect-onboard de relire chez Stripe le compte du vendeur
   connecté (voir initStripeConnect). Session courante et clé publique de
   supabaseClient.js, comme le bouton « Configurer mes paiements ». Ne lève
   jamais : dix secondes au plus, puis la page continue avec ce qu'elle lit
   en base. */
async function synchroniserCompteStripe() {
  let minuterie = null;
  try {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) return;
    const arret = typeof AbortController === "function" ? new AbortController() : null;
    if (arret) minuterie = setTimeout(() => arret.abort(), 10000);
    await fetch(SUPABASE_URL + "/functions/v1/connect-onboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + session.access_token,
      },
      body: JSON.stringify({ action: "synchroniser" }),
      signal: arret ? arret.signal : undefined,
    });
  } catch (e) {
    /* muet : réseau, délai dépassé ou fonction indisponible */
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

async function initStripeConnect(user) {
  const card = document.getElementById("stripeConnectCard");
  if (!card) return null;
  const btn = document.getElementById("stripeConnectBtn");
  const statusEl = document.getElementById("stripeConnectStatus");
  const textEl = document.getElementById("stripeConnectText");

  // Message au retour de Stripe (redirige vers ?connect=done / ?connect=refresh)
  const params = new URLSearchParams(window.location.search);
  const retourStripe = params.get("connect");
  if (retourStripe === "done") {
    toastSuccess(TRa("tr_js_account.stripe_done"));
  } else if (retourStripe === "refresh") {
    toast(TRa("tr_js_account.stripe_refresh"));
  }

  /* Libellé que le statut, lu plus bas, donne au bouton. Le clic est branché
     avant la synchronisation (jusqu'à dix secondes) : au retour ?connect=refresh,
     le vendeur doit justement recliquer pour obtenir un nouveau lien, et le
     bouton ne doit pas rester inerte pendant ce temps. Si le statut arrive
     pendant une redirection, il n'écrase pas « Redirection vers Stripe... » ;
     il sert seulement de libellé si la redirection échoue. */
  let libelleStatut = null;
  function libellerBouton(texte) {
    libelleStatut = texte;
    if (btn && !btn.disabled) btn.textContent = texte;
  }

  if (btn) {
    btn.addEventListener("click", async () => {
      const original = btn.textContent;
      const remettre = () => {
        btn.disabled = false;
        btn.textContent = libelleStatut || original;
      };
      btn.disabled = true;
      btn.textContent = TRa("tr_js_account.stripe_redirecting");
      try {
        const { data: { session } } = await window.sb.auth.getSession();
        if (!session) {
          toastError(TRa("tr_js_account.session_expired"));
          remettre();
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
          remettre();
        }
      } catch (err) {
        toastError(ERRa(err));
        remettre();
      }
    });
  }

  /* Au retour d'inscription, on fait relire le compte chez Stripe avant de
     lire le statut. Sans cela, profiles.stripe_onboarded ne changeait qu'au
     passage du webhook Connect ou de la surveillance horaire : le vendeur qui
     venait de tout remplir lisait encore « Configuration incomplète », et une
     commande payée chez lui attendait d'autant. connect-onboard, appelé avec
     { action: "synchroniser" }, relit le compte et met le profil à jour sans
     rien créer (son propre compteur : 30 appels par heure).
     Échec muet : l'appel ne fait que devancer ces deux chemins, qui restent
     en place ; le statut lu ensuite est au pire en retard, jamais faux.
     « refresh » aussi : Stripe y renvoie quand le lien a expiré, parfois
     après que le vendeur a tout rempli. */
  if (retourStripe === "done" || retourStripe === "refresh") {
    await synchroniserCompteStripe();
    // Un rechargement de la page ne relance ni l'appel ni le message.
    try {
      const propre = new URL(window.location.href);
      propre.searchParams.delete("connect");
      history.replaceState(history.state, "", propre.pathname + propre.search + propre.hash);
    } catch (e) { /* adresse laissée telle quelle */ }
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
    libellerBouton(TRa("tr_js_account.stripe_manage_btn"));
  } else if (profile && profile.stripe_account_id) {
    showStatus("pending", TRa("tr_js_account.stripe_status_pending"));
    libellerBouton(TRa("tr_js_account.stripe_finish_btn"));
  }

  /* Ventes conclues avant la fin de l'inscription : le vendeur arrive ici
     par le lien des courriels (?tab=my-settings). On lui rappelle combien de
     ventes attendent, et la première échéance. Toute erreur est ignorée :
     avant la migration 20261010000000, ces colonnes n'existent pas et la
     requête échoue ; la carte reste alors celle d'aujourd'hui. Lancée sans
     être attendue : Mes ventes, qui attend ce profil, n'a pas à patienter. */
  async function signalerVentesEnAttente() {
    try {
      const { data: ventes, error } = await window.sb
        .from("orders")
        .select("seller_ready_deadline_at")
        .eq("seller_id", user.id)
        .not("seller_ready_deadline_at", "is", null)
        .is("seller_ready_at", null)
        .is("seller_ready_cancel_at", null)
        .in("status", ["paid", "disputed"])
        .gt("seller_ready_deadline_at", new Date().toISOString())
        .order("seller_ready_deadline_at");
      if (error || !Array.isArray(ventes) || ventes.length === 0 || !textEl) return;
      const date = fmtEcheanceLangue(ventes[0].seller_ready_deadline_at);
      if (!date) return;
      const note = document.getElementById("stripePendingSales") || document.createElement("p");
      note.id = "stripePendingSales";
      note.className = "order-window-note";
      note.textContent = ventes.length === 1
        ? TRvpp("stripe_pending_sales_one", { date })
        : TRvpp("stripe_pending_sales", { n: ventes.length, date });
      textEl.insertAdjacentElement("afterend", note);
    } catch (e) {
      /* colonnes absentes, réseau : rien à signaler */
    }
  }
  if (!(profile && profile.stripe_onboarded)) signalerVentesEnAttente();

  return profile || null;
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
    /* « removed » (retirée par la modération) retombait sur « En ligne » :
       le vendeur croyait sa pièce visible. Un statut inconnu n'est plus
       présenté comme en ligne. */
    const libellesStatut = {
      published: "tr_js_account.status_online",
      draft: "tr_js_account.status_draft",
      sold: "tr_js_account.status_sold",
      removed: "tr_js_account.status_removed",
    };
    badge.textContent = libellesStatut[product.status] ? TRa(libellesStatut[product.status]) : (product.status || TRa("tr_js_account.status_online"));
    card.appendChild(badge);

    const img = document.createElement("img");
    img.src = window.imgUrl ? (window.imgUrl(product.image_url, 400) || "hero.png") : (product.image_url || "hero.png");
    img.alt = product.title || "";
    img.onerror = function () { this.src = "/hero.png"; };
    card.appendChild(img);

    const h3 = document.createElement("h3");
    h3.textContent = product.title || TRa("tr_js_account.untitled");
    card.appendChild(h3);

    const p = document.createElement("p");
    p.className = "price";
    p.textContent = (product.price || 0) + " \u20ac";
    card.appendChild(p);

    // L'avis de la modération, tel que les visiteurs le voient sur la fiche.
    if (product.authenticated_at) {
      const avis = document.createElement("p");
      avis.className = "listing-auth";
      avis.textContent = "✓ " + TRa("tr_js_product.auth_title");
      card.appendChild(avis);
    }

    // Actions : Voir / Modifier / Supprimer
    const actions = document.createElement("div");
    actions.className = "listing-actions";

    const viewLink = document.createElement("a");
    viewLink.href = window.urlFiche(product.id, product.title);
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
    toastError(ERRa(error));
    return;
  }

  /* Toutes les photos de l'annonce, et non la seule image_url : depuis la
     galerie, les suivantes restaient dans le stockage. Puis le serveur
     oublie l'annonce et efface ses copies WebP de /media/, qu'Apache
     continuait de servir. Au mieux : un échec n'empêche rien. */
  const photos = window.photosAnnonce ? window.photosAnnonce(product) : [product.image_url].filter(Boolean);
  const chemins = photos.map((u) => String(u).split("/product-images/")[1]).filter(Boolean).map((c) => decodeURIComponent(c.split("?")[0]));
  if (chemins.length) {
    try { await window.sb.storage.from("product-images").remove(chemins); } catch (_) {}
  }
  if (window.purgerServeur) window.purgerServeur({ annonce: product.id, photos });

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

  /* Période, type et état : listes réécrites pour chaque annonce, avec la
     valeur enregistrée déjà choisie (TAXONOMIE.options). Elles étaient
     écrites une fois pour toutes dans buildEditListingModal, qui lisait
     product.period sans recevoir l'annonce : depuis le 14 août 2026, le
     bouton « Modifier » levait « product is not defined » et la fenêtre ne
     s'ouvrait jamais (constaté en ligne le 6 oct. 2026). La fenêtre sert
     d'une annonce à l'autre : il faut de toute façon les réécrire ici. */
  const choisir = TRa("tr_js_account.choose");
  modal.querySelector("#edit-period").innerHTML = TAXONOMIE.options(TAXONOMIE.PERIODES, product.period, choisir);
  modal.querySelector("#edit-subcategory").innerHTML = TAXONOMIE.options(TAXONOMIE.SOUS_CATEGORIES, product.subcategory, choisir);
  modal.querySelector("#edit-condition").innerHTML = TAXONOMIE.options(TAXONOMIE.ETATS, product.condition, choisir);

  // Préremplir
  modal.querySelector("#edit-title").value = product.title || "";
  modal.querySelector("#edit-description").value = product.description || "";
  modal.querySelector("#edit-price").value = product.price || "";
  // Période, type et état sont déjà sélectionnés par TAXONOMIE.options :
  // écrire .value ici effacerait une valeur ancienne absente de la liste.
  modal.querySelector("#edit-quantity").value = product.quantity || 1;
  modal.querySelector("#edit-location").value = product.location || "";
  /* Annonce retirée par la modération : la liste n'avait pas cette option,
     rien n'était sélectionné et l'enregistrement envoyait status: "", que
     la base refusait. Le statut est alors affiché et figé : la republier
     relève de la modération (garde à poser aussi en base, voir le compte
     rendu de l'audit). */
  const statut = modal.querySelector("#edit-status");
  statut.querySelector('option[value="removed"]')?.remove();
  statut.disabled = product.status === "removed";
  if (product.status === "removed") {
    const retiree = document.createElement("option");
    retiree.value = "removed";
    retiree.textContent = TRa("tr_js_account.status_removed");
    statut.appendChild(retiree);
  }
  statut.value = product.status || "published";
  modal.dataset.productId = product.id;
  /* Photos actuelles, dans l'ordre de la galerie : la fiche, le plan du
     site et le flux Shopping lisent image_urls en premier. */
  modal.__photosActuelles = Array.isArray(product.image_urls) && product.image_urls.length
    ? [...product.image_urls]
    : (product.image_url ? [product.image_url] : []);
  // Une annonce authentifiée perd la mention si le vendeur change ce que la
  // modération a examiné : il doit le savoir avant d'enregistrer.
  modal.querySelector("#edit-auth-warning").hidden = !product.authenticated_at;

  // Aperçu image actuelle
  const preview = modal.querySelector("#edit-image-preview");
  const premiere = modal.__photosActuelles[0] || product.image_url;
  preview.src = window.imgUrl ? (window.imgUrl(premiere, 400) || "hero.png") : (premiere || "hero.png");
  modal.querySelector("#edit-image-file").value = "";
  // La modale est réutilisée d'une annonce à l'autre : sans cette remise à
  // zéro, la photo préparée pour la précédente serait envoyée ici.
  modal.__photoPreparee = null;
  modal.__photoEnCours = false;

  // Affichage
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  // Même verrou que les autres fenêtres (script.js) : overflow: hidden
  // n'empêchait pas la page de défiler dessous.
  window.figerLaPage?.("edition");
}

function closeEditListingModal() {
  const modal = document.getElementById("editListingModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  window.rendreLaPage?.("edition");
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
      <p class="edit-auth-warning" id="edit-auth-warning" hidden>${TRa("tr_js_account.edit_auth_warning")}</p>

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
            <select id="edit-period" required></select>
          </label>
          <label>${TRa("tr_js_account.subcategory_label")}
            <select id="edit-subcategory" required></select>
          </label>
        </div>

        <div class="edit-row">
          <label>${TRa("tr_js_account.condition_label")}
            <select id="edit-condition" required></select>
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
      toastError(ERRa(upErr));
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 " + TRa("tr_js_account.save");
      return;
    }
    const { data: pub } = window.sb.storage.from("product-images").getPublicUrl(path);
    image_url = pub?.publicUrl || null;
  }

  /* Construire l'update. La photo remplacée est la première de la galerie :
     n'écrire qu'image_url changeait la carte du catalogue, mais la fiche,
     l'aperçu de partage, les données structurées, le plan du site et le
     flux Shopping, qui lisent image_urls, gardaient l'ancienne. */
  const update = { title, description, price, quantity, period, subcategory, condition, status, location };
  const anciennes = modal.__photosActuelles || [];
  const remplacee = image_url ? anciennes[0] : null;
  if (image_url) {
    update.image_url = image_url;
    update.image_urls = [image_url, ...anciennes.slice(1)];
  }

  const { error } = await window.sb
    .from("products")
    .update(update)
    .eq("id", productId)
    .eq("user_id", MY_USER_ID); // sécurité RLS

  saveBtn.disabled = false;
  saveBtn.textContent = "💾 " + TRa("tr_js_account.save");

  if (error) {
    toastError(ERRa(error));
    return;
  }

  /* L'ancienne photo quitte le stockage, ses copies WebP quittent /media/,
     et le serveur oublie la version en cache de l'annonce (prix, titre,
     statut) : sans cela, la fiche servie annonçait encore l'ancien prix. */
  if (remplacee && !update.image_urls.includes(remplacee)) {
    const chemin = String(remplacee).split("/product-images/")[1];
    if (chemin) {
      try { await window.sb.storage.from("product-images").remove([decodeURIComponent(chemin.split("?")[0])]); } catch (_) {}
    }
  }
  if (window.purgerServeur) window.purgerServeur({ annonce: productId, photos: remplacee ? [remplacee] : [] });

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
    grid.innerHTML = `<p>${TRa("tr_js_account.no_favorites")} <a href="/militaria">${TRa("tr_js_account.favorites_link")}</a></p>`;
    return;
  }

  grid.innerHTML = "";
  data.forEach((fav) => {
    const product = fav.products;
    if (!product) return;

    const card = document.createElement("a");
    card.className = "item-card";
    card.href = window.urlFiche(product.id, product.title);

    const img = document.createElement("img");
    img.src = window.imgUrl ? (window.imgUrl(product.image_url, 400) || "hero.png") : (product.image_url || "hero.png");
    img.alt = product.title;
    img.onerror = function () { this.src = "/hero.png"; };
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

/* ============================================================
   Commandes : achats et ventes
   ============================================================ */

/* Libell\u00e9 et couleur d'un statut. L'ancienne version affichait \u00ab Pay\u00e9 \u00bb sur
   toutes les lignes, quel que soit l'\u00e9tat r\u00e9el de la commande, y compris sur
   une commande rembours\u00e9e ou jamais encaiss\u00e9e. */
const ORDER_STATUS_META = {
  pending:            { key: "tr_js_account.st_pending",   cls: "wait" },
  payment_pending:    { key: "tr_js_account.st_pending",   cls: "wait" },
  payment_failed:     { key: "tr_js_account.st_failed",    cls: "fail" },
  expired:            { key: "tr_js_account.st_expired",   cls: "fail" },
  canceled:           { key: "tr_js_account.st_canceled",  cls: "fail" },
  paid:               { key: "tr_js_account.st_paid",      cls: "paid" },
  shipped:            { key: "tr_js_account.st_shipped",   cls: "ship" },
  delivered:          { key: "tr_js_account.st_delivered", cls: "ship" },
  completed:          { key: "tr_js_account.st_completed", cls: "done" },
  disputed:           { key: "tr_js_account.st_disputed",  cls: "fail" },
  refunded:           { key: "tr_js_account.st_refunded",  cls: "fail" },
  partially_refunded: { key: "tr_js_account.st_refunded_partial", cls: "fail" },
};

function orderAmountText(order) {
  const cents = order.amount_total_cents != null
    ? Number(order.amount_total_cents)
    : Math.round(Number(order.amount || 0) * 100);
  return (cents / 100).toFixed(2).replace(".", ",") + " \u20ac";
}

function orderStatusBadge(order) {
  const meta = ORDER_STATUS_META[order.status] || { key: "tr_js_account.st_paid", cls: "paid" };
  const span = document.createElement("span");
  span.className = "order-status " + meta.cls;
  span.textContent = TRa(meta.key);
  return span;
}

function orderRowSkeleton(order) {
  const row = document.createElement("div");
  row.className = "order-row";

  const img = document.createElement("img");
  img.src = window.imgUrl ? (window.imgUrl(order.products?.image_url, 400) || "hero.png") : (order.products?.image_url || "hero.png");
  img.alt = order.products?.title || TRa("tr_js_account.article");
  img.loading = "lazy";
  img.onerror = function () { this.src = "/hero.png"; };
  row.appendChild(img);

  const info = document.createElement("div");
  info.className = "order-info";

  const title = document.createElement("h3");
  title.textContent = order.products?.title || TRa("tr_js_account.article") + " #" + order.product_id;
  info.appendChild(title);

  const date = document.createElement("p");
  const reference = String(order.id || "").slice(0, 8).toUpperCase();
  date.textContent = reference + " \u00b7 " + new Date(order.created_at).toLocaleDateString(
    (window.I18N && window.I18N.current === "en") ? "en-GB" : "fr-FR",
    { day: "numeric", month: "long", year: "numeric" }
  );
  info.appendChild(date);

  if (order.tracking_number) {
    const tracking = document.createElement("p");
    tracking.className = "order-tracking";
    // Remise en main propre : le champ porte la date et le lieu de la
    // remise, pas un numéro de suivi (voir loadMySales).
    const libelle = order.shipping_method === "pickup"
      ? TRaOu("tr_js_account.handover_label", "Remise :", "Hand-over:")
      : TRa("tr_js_account.tracking");
    tracking.textContent = libelle + " " + order.tracking_number +
      (order.tracking_carrier ? " (" + order.tracking_carrier + ")" : "");
    info.appendChild(tracking);
  }

  row.appendChild(info);

  const amount = document.createElement("div");
  amount.className = "order-amount";
  amount.textContent = orderAmountText(order);
  row.appendChild(amount);

  row.appendChild(orderStatusBadge(order));
  return row;
}

/* Appelle order-notify sans jamais bloquer l'utilisateur : l'\u00e9tat m\u00e9tier est
   d\u00e9j\u00e0 \u00e9crit par la fonction SQL, l'email n'est qu'une notification. */
async function notifyOrderEvent(orderId, event) {
  try {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) return;
    await fetch((window.SUPABASE_URL || "") + "/functions/v1/order-notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.SUPABASE_ANON_KEY || "",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ orderId, event }),
    });
  } catch (_) { /* la notification \u00e9choue en silence, l'\u00e9tat reste juste */ }
}

/* Mes achats */
async function loadMyOrders(userId) {
  const list = document.getElementById("my-orders-list");
  if (!list) return;

  const { data, error } = await window.sb
    .from("orders")
    .select("*, products(title, image_url)")
    .eq("buyer_id", userId)
    // Une r\u00e9servation non pay\u00e9e n'est pas un achat : l'afficher ferait croire
    // \u00e0 une commande qui n'existe pas.
    .not("status", "in", "(pending,expired,canceled)")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<p>${TRa("tr_js_account.loading_error")}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `<p>${TRa("tr_js_account.no_orders")} <a href="/militaria">${TRa("tr_js_account.orders_link")}</a></p>`;
    return;
  }

  list.innerHTML = "";
  data.forEach((order) => {
    const row = orderRowSkeleton(order);

    // Confirmer la r\u00e9ception, ou signaler un probl\u00e8me. Les deux passent par des
    // fonctions SQL qui rev\u00e9rifient que l'appelant est bien l'acheteur : le
    // bouton n'est qu'un raccourci, pas l'autorisation.
    /* Trois situations donnent à l'acheteur quelque chose à faire, et le code
     * n'en couvrait qu'une :
     *
     *   expédiée  → confirmer la réception, ou signaler un problème ;
     *   payée     → le vendeur n'expédie pas, il faut pouvoir le signaler.
     *               La base l'autorisait déjà, aucun bouton ne l'offrait ;
     *   terminée  → les 48 heures promises pour revenir sur sa confirmation.
     *               Sans ce bouton, la promesse affichée sur le site n'avait
     *               aucun moyen d'être exercée.
     */
    const fenetreOuverte = order.status === "completed"
      && order.report_window_ends_at
      && new Date(order.report_window_ends_at) > new Date();
    const peutConfirmer = order.status === "shipped" || order.status === "delivered";
    const peutSignaler = peutConfirmer || order.status === "paid" || fenetreOuverte;

    /* Vendeur qui n'avait pas fini son inscription au paiement : la note dit
       l'échéance, puis l'annulation et le remboursement automatiques. */
    const vpp = venteVendeurPasPret(order);
    let noteVendeur = null;
    if (vpp.attente) {
      noteVendeur = TRvpp("purchase_seller_pending", { date: fmtEcheanceLangue(order.seller_ready_deadline_at) });
    } else if (vpp.echue || (order.seller_ready_cancel_at && order.status !== "refunded")) {
      noteVendeur = TRvpp("purchase_refund_in_progress");
    } else if (order.status === "refunded" && (order.seller_ready_refunded_at || order.seller_ready_cancel_at)) {
      noteVendeur = TRvpp("purchase_canceled_seller_not_ready");
    }

    if (peutSignaler || noteVendeur) {
      const actions = document.createElement("div");
      actions.className = "order-actions";

      if (fenetreOuverte) {
        const restant = document.createElement("p");
        restant.className = "order-window-note";
        const heures = Math.max(1, Math.round(
          (new Date(order.report_window_ends_at) - new Date()) / 3600000));
        restant.textContent = TRa("tr_js_account.report_window_left").replace("{h}", String(heures));
        actions.appendChild(restant);
      }

      if (noteVendeur) {
        const note = document.createElement("p");
        note.className = "order-window-note";
        note.textContent = noteVendeur;
        actions.appendChild(note);
      } else if (order.status === "paid") {
        const attente = document.createElement("p");
        attente.className = "order-window-note";
        attente.textContent = TRa("tr_js_account.awaiting_shipment");
        actions.appendChild(attente);
      }

      const confirm = document.createElement("button");
      confirm.className = "btn small";
      confirm.textContent = TRa("tr_js_account.confirm_receipt");
      confirm.addEventListener("click", async () => {
        confirm.disabled = true;
        const { error: err } = await window.sb.rpc("order_confirm_receipt", { p_order_id: order.id });
        if (err) {
          (window.toastError || window.toast)(TRa("tr_js_account.action_failed"));
          confirm.disabled = false;
          return;
        }
        (window.toastSuccess || window.toast)(TRa("tr_js_account.receipt_confirmed"));
        notifyOrderEvent(order.id, "completed");
        loadMyOrders(userId);
      });
      if (peutConfirmer) actions.appendChild(confirm);

      const dispute = document.createElement("button");
      dispute.className = "btn small outline";
      dispute.textContent = TRa("tr_js_account.report_problem");
      dispute.addEventListener("click", async () => {
        const reason = window.prompt(TRa("tr_js_account.dispute_prompt"));
        if (!reason || reason.trim().length < 10) return;
        const { error: err } = await window.sb.rpc("order_report_dispute", {
          p_order_id: order.id, p_reason: reason.trim(),
        });
        if (err) {
          (window.toastError || window.toast)(TRa("tr_js_account.action_failed"));
          return;
        }
        (window.toastSuccess || window.toast)(TRa("tr_js_account.dispute_opened"));
        notifyOrderEvent(order.id, "disputed");
        loadMyOrders(userId);
      });
      if (peutSignaler) actions.appendChild(dispute);

      row.appendChild(actions);
    }

    list.appendChild(row);
  });
}

/* Mes ventes */
async function loadMySales(userId) {
  const list = document.getElementById("my-sales-list");
  if (!list) return;

  const { data, error } = await window.sb
    .from("orders")
    .select("*, products(title, image_url)")
    .eq("seller_id", userId)
    .not("status", "in", "(pending,expired,canceled)")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<p>${TRa("tr_js_account.loading_error")}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `<p>${TRa("tr_js_account.no_sales")}</p>`;
    return;
  }

  /* Une vente attend l'inscription du vendeur : son profil de paiement dit
     s'il peut déjà expédier (inscription terminée, reprise pas encore
     constatée : order_mark_shipped la constate d'elle-même). Le profil n'est
     attendu que dans ce cas ; sinon rien ne change ni ne patiente. */
  let monProfilPret = false;
  if (data.some((o) => venteVendeurPasPret(o).attente)) {
    const profil = await Promise.resolve(PROFIL_PAIEMENT).catch(() => null);
    monProfilPret = !!(profil && profil.stripe_account_id && profil.stripe_onboarded);
  }

  list.innerHTML = "";
  data.forEach((order) => {
    const row = orderRowSkeleton(order);
    const vpp = venteVendeurPasPret(order);
    const attenteInscription = vpp.attente && !monProfilPret;

    // Le vendeur doit voir exactement ce qu'il touchera, et constater qu'aucun
    // frais ne lui est prélevé. Le montant vient de la commande, pas d'un
    // recalcul : c'est la valeur figée qui sera réellement transférée.
    if (order.seller_amount_cents != null) {
      const cts = (c) => (Number(c) / 100).toFixed(2).replace(".", ",") + " €";
      const payout = document.createElement("p");
      payout.className = "order-payout";
      payout.innerHTML =
        `<strong>${TRa("tr_js_account.you_receive")} ${cts(order.seller_amount_cents)}</strong> ` +
        `<span>(${TRa("tr_js_account.item")} ${cts(order.product_amount_cents)} · ` +
        `${TRa("tr_js_account.shipping")} ${cts(order.shipping_amount_cents)})</span><br>` +
        `<span class="order-payout-free">${TRa("tr_js_account.zero_fees")}</span>`;
      /* Vente échue ou annulée faute d'inscription : rien ne sera versé.
         « Vous recevrez » la contredirait, comme « En attente de la
         confirmation de réception » ; la note de la vente dit ce qui se passe. */
      if (!(vpp.echue || vpp.annulee)) row.querySelector(".order-info")?.appendChild(payout);

      const state = attenteInscription
        ? TRvpp("payout_waiting_stripe")
        : (vpp.echue || vpp.annulee) && order.payout_state === "pending"
          ? null
          : {
            pending: TRa("tr_js_account.payout_pending"),
            released: TRa("tr_js_account.payout_released"),
            blocked: TRa("tr_js_account.payout_blocked"),
            manual_review: TRa("tr_js_account.payout_review"),
            reversed: TRa("tr_js_account.payout_reversed"),
            not_applicable: TRvpp("payout_not_applicable"),
          }[order.payout_state];
      if (state) {
        const st = document.createElement("p");
        st.className = "order-payout-state";
        st.textContent = state;
        row.querySelector(".order-info")?.appendChild(st);
      }
    }

    // Vente échue ou annulée : l'article ne doit pas partir, l'adresse n'a plus d'usage.
    const address = order.shipping_address;
    if (address && order.status !== "refunded" && !vpp.echue && !vpp.annulee) {
      const block = document.createElement("p");
      block.className = "order-address";
      block.textContent = [
        address.name, address.line1, address.line2,
        [address.postal_code, address.city].filter(Boolean).join(" "),
        address.country,
      ].filter(Boolean).join(" \u00b7 ");
      row.querySelector(".order-info")?.appendChild(block);
    }

    /* Vente échue ou annulée faute d'inscription : plus rien à expédier.
       Inscription à finaliser : pas de champ de suivi (order_mark_shipped
       refuserait), mais le chemin vers la carte de paiement. Les notes vont
       dans .order-actions, comme celles de Mes achats : dans .order-info,
       « .order-info p » leur donnerait un gris trop pâle. */
    if (vpp.annulee || vpp.echue) {
      const actions = document.createElement("div");
      actions.className = "order-actions";
      const note = document.createElement("p");
      note.className = "order-window-note";
      note.textContent = TRvpp(vpp.annulee ? "sale_canceled_seller_not_ready" : "sale_deadline_passed");
      actions.appendChild(note);
      row.appendChild(actions);
    } else if (attenteInscription) {
      const actions = document.createElement("div");
      actions.className = "order-actions";
      const note = document.createElement("p");
      note.className = "order-window-note";
      note.textContent = TRvpp("sale_stripe_required", { date: fmtEcheanceLangue(order.seller_ready_deadline_at) });
      actions.appendChild(note);
      const finir = document.createElement("button");
      finir.type = "button";
      finir.className = "btn small";
      finir.textContent = TRvpp("sale_stripe_finish_btn");
      finir.addEventListener("click", () => ouvrirOnglet("my-settings", "stripeConnectCard", "stripeConnectBtn"));
      actions.appendChild(finir);
      row.appendChild(actions);
    } else if (order.status === "paid") {
      const actions = document.createElement("div");
      actions.className = "order-actions";

      /* Remise en main propre : rien n'est expédié, il n'y a pas de numéro
         de suivi. Or order_mark_shipped exige un texte non vide, et
         l'acheteur ne peut confirmer la réception qu'après cette étape : le
         vendeur, face à un champ « Numéro de suivi », restait bloqué, et
         son versement avec. Le même champ demande donc la date et le lieu
         de la remise, que l'acheteur lit dans Mes achats. Une remise sans
         texte demanderait une migration (order_mark_shipped), à appliquer
         dans le tableau de bord Supabase. */
      const enMain = order.shipping_method === "pickup";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "order-tracking-input";
      input.placeholder = enMain
        ? TRaOu("tr_js_account.handover_placeholder", "Date et lieu de la remise", "Date and place of hand-over")
        : TRa("tr_js_account.tracking_placeholder");
      input.setAttribute("aria-label", input.placeholder);
      input.maxLength = 60;
      actions.appendChild(input);

      const ship = document.createElement("button");
      ship.className = "btn small";
      ship.textContent = enMain
        ? TRaOu("tr_js_account.mark_handed_over", "Confirmer la remise en main propre", "Confirm hand delivery")
        : TRa("tr_js_account.mark_shipped");
      ship.addEventListener("click", async () => {
        const tracking = input.value.trim();
        if (!tracking) {
          (window.toastWarn || window.toast)(enMain
            ? TRaOu("tr_js_account.handover_required", "Indiquez la date et le lieu de la remise avant de la confirmer.", "Enter the date and place of the hand-over before confirming it.")
            : TRa("tr_js_account.tracking_required"));
          return;
        }
        ship.disabled = true;
        const { error: err } = await window.sb.rpc("order_mark_shipped", {
          p_order_id: order.id,
          p_tracking_number: tracking,
          p_tracking_carrier: null,
        });
        if (err) {
          /* Refus de la vente sans inscription Stripe : le code stable arrive
             dans error.hint (order_mark_shipped, migration 20261010000000). */
          if (err.hint === "ORDER_CANCELED_SELLER_NOT_READY") {
            (window.toastError || window.toast)(TRvpp("ship_blocked_canceled"));
            loadMySales(userId);
            return;
          }
          (window.toastError || window.toast)(err.hint === "SELLER_STRIPE_NOT_READY"
            ? TRvpp("ship_blocked_stripe")
            : TRa("tr_js_account.action_failed"));
          ship.disabled = false;
          return;
        }
        (window.toastSuccess || window.toast)(enMain
          ? TRaOu("tr_js_account.handed_over_ok", "Remise enregistrée. L’acheteur est prévenu et peut confirmer la réception.", "Hand-over recorded. The buyer has been notified and can confirm receipt.")
          : TRa("tr_js_account.shipped_ok"));
        notifyOrderEvent(order.id, "shipped");
        loadMySales(userId);
      });
      actions.appendChild(ship);

      row.appendChild(actions);
    }

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
      if (target === "audience" && !AUDIENCE_STATE.loaded) {
        loadAudience();
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
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }
}

/* Après une décision de modération, le serveur doit relire la base : sans
   cela, ses pages (fiche, catalogue, accueil) servaient encore une fois
   l'ancienne version depuis leur cache, et un défloutage semblait sans
   effet. rafraichir-cache.php vérifie la session auprès de Supabase et
   n'obéit qu'aux administrateurs. */
async function viderCacheServeur() {
  try {
    const { data } = await window.sb.auth.getSession();
    const jeton = data?.session?.access_token;
    if (!jeton) return false;
    const rep = await fetch("/rafraichir-cache.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jeton }),
      cache: "no-store",
    });
    return rep.ok;
  } catch (e) {
    return false;
  }
}

/* Prévient le vendeur qu'une de ses annonces vient d'être authentifiée.
   La fonction revérifie tout côté serveur (administrateur, annonce
   effectivement authentifiée, e-mail pas déjà envoyé pour cet avis) : ce
   navigateur ne fait que lui signaler l'annonce. */
async function prevenirVendeurAuthentifie(productId) {
  try {
    const { data } = await window.sb.auth.getSession();
    const jeton = data?.session?.access_token;
    if (!jeton) return "echec";
    const rep = await fetch((window.SUPABASE_URL || "https://uctaxgfqdoxtcidllyjv.supabase.co") + "/functions/v1/authenticity-notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.SUPABASE_ANON_KEY || "",
        Authorization: "Bearer " + jeton,
      },
      body: JSON.stringify({ productId: Number(productId) }),
    });
    const corps = await rep.json().catch(() => ({}));
    if (!rep.ok || !corps.ok) return "echec";
    return corps.skipped ? "deja" : "envoye";
  } catch (e) {
    return "echec";
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
    if (list) list.innerHTML = '<p class="mod-empty">' + TRa("tr_js_account.loading_error_prefix") + " " + modEsc(ERRa(pErr)) + "</p>";
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
  // Pièces sensibles : le vendeur coche (ou oublie de cocher) la case au
  // dépôt ; ces deux filtres permettent de repasser sur son choix.
  else if (filter === "sensitive") rows = rows.filter((p) => !!p.historically_sensitive);
  else if (filter === "not_sensitive") rows = rows.filter((p) => !p.historically_sensitive);
  // Avis d'authenticité de la modération (authenticated_at, posé ci-dessous).
  else if (filter === "authentic") rows = rows.filter((p) => !!p.authenticated_at);
  else if (filter === "not_authentic") rows = rows.filter((p) => !p.authenticated_at && p.status !== "draft");

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
    const floutee = !!p.historically_sensitive;
    if (floutee) {
      badges += `<span class="mod-badge mod-badge-floutee">🔒 ${TRa("tr_js_account.mod_blurred_badge")}</span>`;
    }
    const authentique = !!p.authenticated_at;
    if (authentique) {
      badges += `<span class="mod-badge mod-badge-authentique">✓ ${TRa("tr_js_account.mod_auth_badge")}</span>`;
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
            <a href="${window.urlFiche(p.id, p.title)}" target="_blank" class="mod-btn mod-btn-view">👁 ${TRa("tr_js_account.view")}</a>
            <button type="button" class="mod-btn mod-btn-flou${floutee ? " is-on" : ""}" data-action="sensitive" data-id="${modEsc(p.id)}" aria-pressed="${floutee ? "true" : "false"}">${floutee ? "👁 " + TRa("tr_js_account.mod_unblur") : "🔒 " + TRa("tr_js_account.mod_blur")}</button>
            <button type="button" class="mod-btn mod-btn-authentique${authentique ? " is-on" : ""}" data-action="authentic" data-id="${modEsc(p.id)}" aria-pressed="${authentique ? "true" : "false"}">${authentique ? TRa("tr_js_account.mod_unauth") : "✓ " + TRa("tr_js_account.mod_auth")}</button>
            <button class="mod-btn mod-btn-delete" data-action="delete" data-id="${modEsc(p.id)}" data-title="${modEsc(p.title || "")}">🗑 ${TRa("tr_js_account.delete")}</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  /* Flouter / déflouter : la modération repasse sur la case « pièce
     historiquement sensible » cochée (ou non) par le vendeur. La politique
     « Admin can update any product » (ADD_ADMIN.sql) autorise l'écriture ;
     si elle manque, Supabase ne renvoie aucune ligne au lieu d'une erreur,
     d'où la vérification du retour. */
  list.querySelectorAll('[data-action="sensitive"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const produit = MOD_STATE.products.find((x) => String(x.id) === String(id));
      if (!produit) return;
      const cible = !produit.historically_sensitive;
      btn.disabled = true;
      const { data, error } = await window.sb
        .from("products")
        .update({ historically_sensitive: cible })
        .eq("id", id)
        .select("id, historically_sensitive");
      if (error || !data || data.length === 0) {
        btn.disabled = false;
        (window.toastError || window.toast)(error ? ERRa(error) : TRa("tr_js_account.mod_blur_denied"));
        return;
      }
      produit.historically_sensitive = !!data[0].historically_sensitive;
      renderModerationList();
      // Le site public doit le montrer tout de suite, pas au second passage.
      await viderCacheServeur();
      if (window.toastSuccess) toastSuccess(TRa(produit.historically_sensitive ? "tr_js_account.mod_blur_done" : "tr_js_account.mod_unblur_done"));
    });
  });

  /* Authentifier : l'équipe juge la pièce authentique sur photos et
     description. La base fixe elle-même la date et l'auteur, refuse la
     mention à tout autre qu'un administrateur, et la retire si le vendeur
     change ensuite photos, titre ou description
     (20261005000000_authenticite.sql). Le vendeur est prévenu par e-mail
     (fonction authenticity-notify), une seule fois par avis. */
  list.querySelectorAll('[data-action="authentic"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const produit = MOD_STATE.products.find((x) => String(x.id) === String(id));
      if (!produit) return;
      const donner = !produit.authenticated_at;
      const question = TRa(donner ? "tr_js_account.mod_auth_confirm" : "tr_js_account.mod_unauth_confirm")
        .replace("{titre}", produit.title || TRa("tr_js_account.this_article"));
      if (!confirm(question)) return;
      btn.disabled = true;
      const { data, error } = await window.sb
        .from("products")
        .update({ authenticated_at: donner ? new Date().toISOString() : null })
        .eq("id", id)
        .select("id, authenticated_at, authenticated_by");
      if (error || !data || data.length === 0) {
        btn.disabled = false;
        // Colonne absente : la migration n'est pas encore passée en base.
        const absente = error && (error.code === "42703" || error.code === "PGRST204");
        (window.toastError || window.toast)(error && !absente ? ERRa(error) : TRa("tr_js_account.mod_auth_denied"));
        return;
      }
      produit.authenticated_at = data[0].authenticated_at;
      produit.authenticated_by = data[0].authenticated_by;
      renderModerationList();
      await viderCacheServeur();
      if (!donner) {
        if (window.toastSuccess) toastSuccess(TRa("tr_js_account.mod_unauth_done"));
        return;
      }
      const envoi = await prevenirVendeurAuthentifie(id);
      const message = envoi === "envoye" ? "tr_js_account.mod_auth_done_mail"
        : envoi === "deja" ? "tr_js_account.mod_auth_done_deja"
        : "tr_js_account.mod_auth_done_sans_mail";
      (envoi === "echec" ? (window.toastError || window.toast) : (window.toastSuccess || window.toast))(TRa(message));
    });
  });

  // Bind delete buttons
  list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const title = btn.dataset.title || TRa("tr_js_account.this_article");
      if (!confirm("⚠ " + TRa("tr_js_account.mod_delete_confirm_1") + " « " + title + " » ?\n\n" + TRa("tr_js_account.mod_delete_confirm_2"))) return;
      btn.disabled = true;
      btn.textContent = TRa("tr_js_account.deleting");
      /* .select() : PostgREST ne signale pas une suppression refusée par
         RLS, il répond simplement sans ligne. Sans ce contrôle, « Article
         supprimé » s'affichait pour une annonce toujours en ligne. */
      const { data: supprimees, error } = await window.sb.from("products").delete().eq("id", id).select("id, image_url, image_urls");
      if (error || !supprimees || supprimees.length === 0) {
        (window.toastError || window.toast)(error ? ERRa(error) : TRa("err.generique"));
        btn.disabled = false;
        btn.textContent = "🗑 " + TRa("tr_js_account.delete");
        return;
      }
      // Retire de l'état local, du cache des pages publiques, et les copies
      // WebP de ses photos (une photo retirée pour un insigne réglementé
      // restait publique sous /media/).
      viderCacheServeur();
      if (window.purgerServeur) window.purgerServeur({ photos: window.photosAnnonce ? window.photosAnnonce(supprimees[0]) : [] });
      // btn.dataset.id est une chaîne, p.id un nombre : la comparaison
      // stricte ne retirait jamais rien de la liste.
      MOD_STATE.products = MOD_STATE.products.filter((p) => String(p.id) !== String(id));
      updateModerationStats();
      renderModerationList();
      if (window.toastSuccess) toastSuccess(TRa("tr_js_account.article_deleted"));
    });
  });
}

/* ============== MODÉRATION : AUDIENCE ==============
   Pages vues et visites comptées sans cookie par mesure.php, agrégées par
   jour ; audience.php ne les rend qu'aux administrateurs. Une visite est
   une arrivée sur le site depuis l'extérieur (moteur, lien, accès direct). */

const AUDIENCE_STATE = { loaded: false };

async function loadAudience() {
  const zone = document.getElementById("audiencePanel");
  if (!zone) return;
  AUDIENCE_STATE.loaded = true;
  let d = null;
  try {
    const { data } = await window.sb.auth.getSession();
    const jeton = data?.session?.access_token;
    const rep = await fetch("/audience.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jeton }),
      cache: "no-store",
    });
    d = await rep.json();
  } catch (e) { d = null; }
  if (!d || !d.ok) {
    AUDIENCE_STATE.loaded = false;
    zone.innerHTML = `<p class="mod-empty">${TRa("tr_js_account.aud_error")}</p>`;
    return;
  }
  renderAudience(zone, d);
}

function renderAudience(zone, d) {
  const nf = (n) => Number(n || 0).toLocaleString(I18N_LOCALE_A());
  const ecart = (maintenant, avant) => {
    if (!avant) return "";
    const p = Math.round(((maintenant - avant) / avant) * 100);
    const signe = p > 0 ? "+" : "";
    return `<span class="audience-ecart ${p >= 0 ? "is-hausse" : "is-baisse"}">${signe}${p} % ${TRa("tr_js_account.aud_vs_week")}</span>`;
  };
  const t = d.totaux;
  const max = Math.max(1, ...d.jours.map((j) => j.vues));
  const premierJourMesure = d.jours.findIndex((j) => j.mesure);
  const barres = d.jours.map((j, i) => {
    const date = new Date(j.date + "T12:00:00");
    const lib = date.toLocaleDateString(I18N_LOCALE_A(), { day: "numeric", month: "short" });
    const h = Math.round((j.vues / max) * 100);
    const avant = premierJourMesure === -1 || i < premierJourMesure;
    return `<div class="audience-barre${avant ? " is-avant" : ""}" title="${modEsc(lib)} : ${nf(j.vues)} ${TRa("tr_js_account.aud_views_short")}, ${nf(j.visites)} ${TRa("tr_js_account.aud_visits_short")}">
      <span class="audience-barre__v" style="height:${h}%"></span>
      ${i % 5 === 4 || i === d.jours.length - 1 ? `<span class="audience-barre__d">${modEsc(lib)}</span>` : ""}
    </div>`;
  }).join("");
  /* Une valeur déjà mise en forme (« 58 % ») passe telle quelle ; un nombre
     est formaté. Les adresses de pages deviennent des libellés lisibles,
     l'adresse restant dans l'infobulle. */
  const valeur = (n) => (typeof n === "number" ? nf(n) : modEsc(n));
  const libellePage = (k) => {
    const [chemin, langue] = k.split(" [");
    const suffixe = langue ? " (" + langue.replace("]", "").toUpperCase() + ")" : "";
    const mots = (s) => decodeURIComponent(s).replace(/-/g, " ");
    if (chemin === "/") return TRa("tr_js_account.aud_home") + suffixe;
    if (chemin === "/militaria") return TRa("tr_js_account.aud_catalogue") + suffixe;
    if (chemin === "/guides") return TRa("tr_js_account.aud_guides") + suffixe;
    let m = chemin.match(/^\/guides\/(?:(?:en|de)\/)?([^/]+)$/);
    if (m) return TRa("tr_js_account.aud_guide") + "\u00a0: " + mots(m[1]) + suffixe;
    m = chemin.match(/^\/annonce\/([^/]+)$/);
    if (m) return TRa("tr_js_account.aud_listing") + "\u00a0: " + mots(m[1].replace(/-\d+$/, "")) + suffixe;
    m = chemin.match(/^\/militaria\/(.+)$/);
    if (m) return TRa("tr_js_account.aud_catalogue") + "\u00a0: " + mots(m[1].replace("/", " › ")) + suffixe;
    return chemin + suffixe;
  };
  const liste = (rangs, vide, pages) => rangs.length
    ? `<ol class="audience-liste">${rangs.map(([k, n]) => `<li><span class="audience-liste__k"${pages ? ` title="${modEsc(k)}"` : ""}>${modEsc(pages ? libellePage(k) : k)}</span><span class="audience-liste__n">${valeur(n)}</span></li>`).join("")}</ol>`
    : `<p class="audience-vide">${vide}</p>`;
  const totalApp = Object.values(d.appareils || {}).reduce((a, b) => a + b, 0);
  const appareils = Object.entries(d.appareils || {}).map(([k, n]) => [k.charAt(0).toUpperCase() + k.slice(1), totalApp ? Math.round((n / totalApp) * 100) + "\u00a0%" : "0\u00a0%"]);
  let exclu = false;
  try { exclu = localStorage.getItem("athena_sans_mesure") === "1"; } catch (e) {}

  zone.innerHTML = `
    <div class="audience-chiffres">
      <div class="audience-chiffre"><span class="audience-chiffre__lbl">${TRa("tr_js_account.aud_views7")}</span><strong>${nf(t.vues7)}</strong>${ecart(t.vues7, t.vues7avant)}</div>
      <div class="audience-chiffre"><span class="audience-chiffre__lbl">${TRa("tr_js_account.aud_visits7")}</span><strong>${nf(t.visites7)}</strong>${ecart(t.visites7, t.visites7avant)}</div>
      <div class="audience-chiffre"><span class="audience-chiffre__lbl">${TRa("tr_js_account.aud_views30")}</span><strong>${nf(t.vues30)}</strong></div>
      <div class="audience-chiffre"><span class="audience-chiffre__lbl">${TRa("tr_js_account.aud_visits30")}</span><strong>${nf(t.visites30)}</strong></div>
    </div>
    <section class="audience-bloc">
      <h3 class="audience-titre">${TRa("tr_js_account.aud_chart_title")}</h3>
      <div class="audience-courbe" role="img" aria-label="${TRa("tr_js_account.aud_chart_title")}">${barres}</div>
    </section>
    <div class="audience-colonnes">
      <section class="audience-bloc"><h3 class="audience-titre">${TRa("tr_js_account.aud_pages")}</h3>${liste(d.pages, TRa("tr_js_account.aud_empty"), true)}</section>
      <section class="audience-bloc"><h3 class="audience-titre">${TRa("tr_js_account.aud_sources")}</h3>${liste(d.sources, TRa("tr_js_account.aud_empty"))}
        <h3 class="audience-titre audience-titre--suite">${TRa("tr_js_account.aud_devices")}</h3>${liste(appareils, TRa("tr_js_account.aud_empty"))}</section>
    </div>
    <p class="audience-note">${TRa("tr_js_account.aud_note")}</p>
    <label class="audience-exclure"><input type="checkbox" id="audienceExclure"${exclu ? " checked" : ""}> ${TRa("tr_js_account.aud_exclude")}</label>
  `;
  document.getElementById("audienceExclure")?.addEventListener("change", (e) => {
    try {
      if (e.target.checked) localStorage.setItem("athena_sans_mesure", "1");
      else localStorage.removeItem("athena_sans_mesure");
    } catch (err) {}
  });
}

/* Langue d'affichage des nombres et des dates du tableau de bord. */
function I18N_LOCALE_A() {
  return (window.I18N && window.I18N.current === "en") ? "en-GB" : "fr-FR";
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
    list.innerHTML = `<p class="mod-empty">${TRa("tr_js_account.error_prefix")} ${modEsc(ERRa(error))}<br><br>
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
      (window.toastError || window.toast)(ERRa(error));
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
      (window.toastError || window.toast)(ERRa(error));
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
      (window.toastError || window.toast)(ERRa(error));
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
