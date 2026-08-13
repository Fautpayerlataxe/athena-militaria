/**
 * Parcours réels contre l'API Stripe en mode TEST.
 *
 * Cette suite ne simule rien : elle crée de vraies sessions Checkout, de vrais
 * PaymentIntents, de vrais comptes connectés, de vrais remboursements et de
 * vrais transferts, sur l'environnement de test de Stripe. Aucun argent réel
 * n'est en jeu, aucune carte réelle n'est utilisée.
 *
 * ELLE NE S'EXÉCUTE QUE SI UNE CLÉ DE TEST EST FOURNIE. Deux façons, la
 * première étant préférable :
 *
 *     security add-generic-password -a "$USER" -s athena-stripe-test -w
 *     npm run test:stripe
 *
 *     STRIPE_TEST_SECRET_KEY=sk_test_… npm run test:stripe
 *
 * Le trousseau vaut mieux qu'une variable d'environnement : celle-ci se
 * retrouve dans l'historique du shell, dans les arguments de processus
 * lisibles par tout utilisateur de la machine, et dans les journaux de tout
 * outil qui recopie l'environnement.
 *
 * Sans clé, chaque test est marqué « ignoré » plutôt que réussi : un test qui
 * ne s'exécute pas ne doit jamais compter comme une preuve.
 *
 * La suite refuse de démarrer avec une clé live. Ce n'est pas une politesse :
 * elle crée des objets et déclenche des remboursements.
 */

import test, { before, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import Stripe from "stripe";

import {
  SHIPPING_CATALOG,
  buildCheckoutSessionParams,
  planWebhookEvent,
} from "../supabase/functions/_shared/payments.ts";

/** Le trousseau d'abord, la variable d'environnement en secours. */
function keychainKey(): string {
  try {
    return execFileSync("/usr/bin/security",
      ["find-generic-password", "-a", process.env.USER ?? "", "-s", "athena-stripe-test", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const KEY = process.env.STRIPE_TEST_SECRET_KEY || keychainKey();
const API_VERSION = "2023-10-16";

if (KEY && !KEY.startsWith("sk_test_") && !KEY.startsWith("rk_test_")) {
  throw new Error(
    "STRIPE_TEST_SECRET_KEY ne commence pas par sk_test_ : cette suite crée des objets " +
    "et déclenche des remboursements, elle refuse de s'exécuter hors du mode test.",
  );
}

const ENABLED = KEY.length > 0;
const skip = ENABLED
  ? false
  : "aucune clé Stripe de test : déposer athena-stripe-test dans le trousseau";

const stripe = ENABLED
  ? new Stripe(KEY, { apiVersion: API_VERSION, maxNetworkRetries: 2 })
  : (null as unknown as Stripe);

/* Montants du scénario type : article 45,00 €, envoi postal 8,90 €.
 *
 * Le barème est celui de la production : la Protection acheteurs vaut 5 % du
 * prix de l'article plus 0,70 €, elle est payée par l'acheteur, et le vendeur
 * touche l'article et le port en entier. La même règle est écrite à trois
 * endroits (buyer_protection_fee_cents en base, product.js au navigateur,
 * ici) ; un contrôle dédié compare les deux premières au centime sur toute la
 * plage de prix, celui-ci vérifie que Stripe voit bien la même chose.
 */
const PRODUCT_CENTS = 4500;
const SHIPPING_CENTS = SHIPPING_CATALOG.post.amountCents;
const PROTECTION_CENTS = Math.round((PRODUCT_CENTS * 500) / 10000) + 70;
/** Ce que l'acheteur paie. */
const TOTAL_CENTS = PRODUCT_CENTS + SHIPPING_CENTS + PROTECTION_CENTS;
/** Ce que le vendeur reçoit : tout sauf la Protection, sans aucune retenue. */
const SELLER_CENTS = PRODUCT_CENTS + SHIPPING_CENTS;

let sellerAccount = "";
let run = "";

before(async () => {
  if (!ENABLED) return;
  run = `t${Date.now().toString(36)}`;

  // Compte connecté Express de test, comme en crée connect-onboard.
  const account = await stripe.accounts.create({
    type: "express",
    country: "FR",
    email: `vendeur-${run}@example.test`,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_type: "individual",
    metadata: { user_id: `test-seller-${run}` },
  }, { idempotencyKey: `connect-account:test-seller-${run}` });

  sellerAccount = account.id;
}, { timeout: 60_000 });

/* ================================================================== *
 *  Session Checkout : les paramètres envoyés sont bien ceux voulus
 * ================================================================== */

describe("création de session Checkout", { skip }, () => {
  /* Le constructeur appelé ici est CELUI DE LA PRODUCTION, importé de
   * _shared/payments.ts et utilisé tel quel par create-checkout.
   *
   * Il avait d'abord été recopié à la main dans ce fichier. Une copie ne
   * prouve rien : réintroduire une commission dans la fonction déployée
   * aurait laissé toute cette suite au vert, puisqu'elle n'aurait vérifié que
   * sa propre copie. Ce qui est envoyé à Stripe ci-dessous est donc, aux
   * seules valeurs près, ce que reçoit un vrai acheteur. */
  function sessionParams(orderId: string): Stripe.Checkout.SessionCreateParams {
    return buildCheckoutSessionParams({
      orderId,
      productId: "1",
      productTitle: "Casque Adrian 1915",
      productAmountCents: PRODUCT_CENTS,
      protectionAmountCents: PROTECTION_CENTS,
      shippingAmountCents: SHIPPING_CENTS,
      shippingMethod: "post",
      currency: "eur",
      customerEmail: `acheteur-${run}@example.test`,
      expiresAt: Math.floor(Date.now() / 1000) + 35 * 60,
      metadata: {
        order_id: orderId, product_id: "1", seller_id: `test-seller-${run}`,
        buyer_id: `test-buyer-${run}`, shipping_method: "post", relay_postal: "",
      },
      siteOrigin: "https://www.athenamilitaria.fr",
    }) as Stripe.Checkout.SessionCreateParams;
  }

  test("le total facturé est exactement article + Protection + port", async () => {
    const orderId = `order-${run}-amount`;
    const session = await stripe.checkout.sessions.create(sessionParams(orderId));

    assert.equal(session.amount_total, TOTAL_CENTS,
      `l'acheteur doit être débité de ${TOTAL_CENTS} centimes, pas d'un autre montant`);
    assert.equal(session.amount_subtotal, PRODUCT_CENTS + PROTECTION_CENTS,
      "le sous-total couvre les deux lignes facturées, le port étant compté à part");
    assert.equal(session.currency, "eur");
    assert.equal(session.total_details?.amount_shipping, SHIPPING_CENTS);
    assert.equal(session.payment_status, "unpaid");
    assert.equal(session.status, "open");
    assert.equal(session.client_reference_id, orderId);
    assert.equal(session.metadata?.order_id, orderId);
    assert.ok(session.url, "l'acheteur doit recevoir une URL de paiement");
  });

  test("l'invariant du modèle tient chez Stripe : acheteur moins vendeur égale Protection", async () => {
    // Ce n'est pas une tautologie sur des constantes : on compare ce que
    // Stripe a réellement facturé au montant que payout-release transférera.
    const session = await stripe.checkout.sessions.create(sessionParams(`order-${run}-invariant`));
    assert.equal(session.amount_total! - SELLER_CENTS, PROTECTION_CENTS);
    assert.equal(SELLER_CENTS, PRODUCT_CENTS + SHIPPING_CENTS,
      "le vendeur reçoit le prix et le port en entier, sans retenue");
  });

  test("la Protection acheteurs est une ligne visible, pas un supplément caché", async () => {
    const session = await stripe.checkout.sessions.create(
      sessionParams(`order-${run}-lignes`), { expand: ["line_items"] });

    const lignes = session.line_items!.data;
    assert.equal(lignes.length, 2, "l'article et la Protection, chacun sur sa ligne");

    const protection = lignes.find((l) => l.description === "Protection acheteurs");
    assert.ok(protection, "l'acheteur doit lire « Protection acheteurs » sur la page de paiement");
    assert.equal(protection.amount_total, PROTECTION_CENTS);

    const article = lignes.find((l) => l.description !== "Protection acheteurs");
    assert.equal(article?.amount_total, PRODUCT_CENTS);
  });

  test("l'expiration demandée est respectée", async () => {
    const session = await stripe.checkout.sessions.create(sessionParams(`order-${run}-exp`));
    const minutes = (session.expires_at - Math.floor(Date.now() / 1000)) / 60;
    assert.ok(minutes > 30 && minutes <= 40, `expiration à ${minutes.toFixed(1)} min`);
  });

  test("une expiration à moins de trente minutes est refusée par Stripe", async () => {
    const params = sessionParams(`order-${run}-short`);
    params.expires_at = Math.floor(Date.now() / 1000) + 10 * 60;
    await assert.rejects(
      () => stripe.checkout.sessions.create(params),
      /expires_at/,
      "c'est la contrainte que la réservation de 40 minutes vient couvrir",
    );
  });

  test("la clé d'idempotence rend le double-clic inoffensif", async () => {
    const orderId = `order-${run}-idem`;
    const key = `checkout:${orderId}`;
    const params = sessionParams(orderId);

    // Dix appels simultanés, comme dix clics sur le bouton Acheter.
    const sessions = await Promise.all(
      Array.from({ length: 10 }, () => stripe.checkout.sessions.create(params, { idempotencyKey: key })),
    );
    const unique = new Set(sessions.map((s) => s.id));
    assert.equal(unique.size, 1, `dix appels ont produit ${unique.size} sessions payables`);
  });

  test("réutiliser la clé avec d'autres paramètres est rejeté, jamais silencieux", async () => {
    const orderId = `order-${run}-idem2`;
    const key = `checkout:${orderId}`;
    await stripe.checkout.sessions.create(sessionParams(orderId), { idempotencyKey: key });

    const altered = sessionParams(orderId);
    (altered.line_items as any)[0].price_data.unit_amount = 100;

    await assert.rejects(
      () => stripe.checkout.sessions.create(altered, { idempotencyKey: key }),
      /idempotent/i,
      "un montant modifié sous la même clé doit échouer, pas passer",
    );
  });

  test("aucune commission n'est prélevée au vendeur, chez Stripe non plus", async () => {
    // La décision « le vendeur ne paie rien » est inscrite en base par une
    // contrainte. Elle ne vaut que si Stripe ne prélève rien non plus : une
    // commission posée ici échapperait complètement à la base.
    const session = await stripe.checkout.sessions.create(
      sessionParams(`order-${run}-zerofee`), { expand: ["payment_intent"] });
    const intent = session.payment_intent as Stripe.PaymentIntent;
    assert.equal(intent.application_fee_amount, null,
      "aucune commission ne doit être retenue sur le paiement");
  });

  test("mode versement après réception : aucun transfert programmé à l'encaissement", async () => {
    const orderId = `order-${run}-hold`;
    const session = await stripe.checkout.sessions.create(sessionParams(orderId), {
      expand: ["payment_intent"],
    });
    const intent = session.payment_intent as Stripe.PaymentIntent;
    assert.equal(intent.transfer_data, null, "les fonds doivent rester sur le compte plateforme");
    assert.equal(intent.application_fee_amount, null);
    assert.equal(intent.transfer_group, `order_${orderId}`, "le rattachement comptable reste posé");
  });

  test("expirer une session la ferme définitivement", async () => {
    const orderId = `order-${run}-expire`;
    const session = await stripe.checkout.sessions.create(sessionParams(orderId));
    const expired = await stripe.checkout.sessions.expire(session.id);

    assert.equal(expired.status, "expired");
    assert.equal(expired.payment_status, "unpaid");

    // L'événement correspondant doit libérer la réservation.
    const plan = planWebhookEvent({ type: "checkout.session.expired", data: { object: expired } });
    assert.equal(plan.action, "release");
    if (plan.action === "release") assert.equal(plan.orderId, orderId);
  });
});

/* ================================================================== *
 *  Cycle de vie d'un paiement, avec les moyens de paiement de test
 * ================================================================== */

describe("paiements réels en mode test", { skip }, () => {
  /** Crée et confirme un PaymentIntent portant les mêmes paramètres que la
   *  session Checkout. C'est le PaymentIntent qui porte l'argent : le tester
   *  directement couvre les scénarios de refus et d'authentification que la
   *  page hébergée ne permet pas d'automatiser. */
  async function pay(paymentMethod: string, over: Partial<Stripe.PaymentIntentCreateParams> = {}) {
    return stripe.paymentIntents.create({
      amount: TOTAL_CENTS,
      currency: "eur",
      payment_method: paymentMethod,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Athena Militaria - test",
      transfer_group: `order_${run}`,
      metadata: { order_id: `order-${run}`, product_id: "1" },
      ...over,
    }).catch((err) => err);
  }

  test("carte acceptée : le paiement aboutit et la charge est rattachable", async () => {
    const intent = await pay("pm_card_visa");
    assert.equal(intent.status, "succeeded");
    assert.equal(intent.amount_received, TOTAL_CENTS);
    assert.ok(intent.latest_charge, "la charge doit exister pour permettre remboursement et transfert");
  });

  test("carte refusée : rien n'est encaissé", async () => {
    const err = await pay("pm_card_chargeDeclined");
    assert.equal(err.type, "StripeCardError");
    assert.equal(err.code, "card_declined");
    assert.notEqual(err.payment_intent?.status, "succeeded");
  });

  test("fonds insuffisants : refus explicite, nouvelle tentative possible", async () => {
    const err = await pay("pm_card_chargeDeclinedInsufficientFunds");
    assert.equal(err.code, "card_declined");
    assert.equal(err.decline_code, "insufficient_funds");

    // L'événement correspondant ne doit jamais marquer la commande payée.
    const plan = planWebhookEvent({
      type: "payment_intent.payment_failed",
      data: { object: { id: err.payment_intent?.id, last_payment_error: { code: err.code, decline_code: err.decline_code } } },
    });
    assert.equal(plan.action, "payment_failed");
  });

  test("carte expirée et CVC incorrect sont distingués", async () => {
    const expired = await pay("pm_card_chargeDeclinedExpiredCard");
    assert.equal(expired.decline_code ?? expired.code, "expired_card");

    const cvc = await pay("pm_card_chargeDeclinedIncorrectCvc");
    assert.equal(cvc.decline_code ?? cvc.code, "incorrect_cvc");
  });

  test("erreur de traitement : la commande ne devient pas payée", async () => {
    const err = await pay("pm_card_chargeDeclinedProcessingError");
    assert.notEqual(err.payment_intent?.status, "succeeded");
  });

  test("3D Secure : le paiement s'arrête sur demande d'authentification", async () => {
    const intent = await pay("pm_card_authenticationRequired");
    // Selon le moyen de test, Stripe renvoie soit requires_action, soit une
    // erreur d'authentification. Dans les deux cas, ce n'est PAS un succès.
    const status = intent.status ?? intent.payment_intent?.status;
    assert.notEqual(status, "succeeded", "un 3DS non résolu ne doit jamais valoir paiement");
    assert.ok(status === "requires_action" || intent.code === "authentication_required",
      `état obtenu : ${status ?? intent.code}`);
  });

  test("3D Secure abandonné : le paiement reste non abouti et peut être annulé", async () => {
    const intent = await pay("pm_card_authenticationRequired");
    const id = intent.id ?? intent.payment_intent?.id;
    assert.ok(id);

    const fetched = await stripe.paymentIntents.retrieve(id);
    if (fetched.status === "requires_action") {
      const canceled = await stripe.paymentIntents.cancel(id);
      assert.equal(canceled.status, "canceled");
      assert.equal(canceled.amount_received, 0, "aucun montant encaissé sur un 3DS abandonné");
    }
  });
});

/* ================================================================== *
 *  Remboursements et litiges
 * ================================================================== */

describe("remboursements", { skip }, () => {
  async function succeededIntent(tag: string) {
    return stripe.paymentIntents.create({
      amount: TOTAL_CENTS, currency: "eur", payment_method: "pm_card_visa", confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      transfer_group: `order_${run}_${tag}`,
      metadata: { order_id: `order-${run}-${tag}` },
    });
  }

  test("remboursement total : montant exact et statut cohérent", async () => {
    const intent = await succeededIntent("refund-full");
    const refund = await stripe.refunds.create(
      { payment_intent: intent.id },
      { idempotencyKey: `refund:${intent.id}` },
    );
    assert.equal(refund.status, "succeeded");
    assert.equal(refund.amount, TOTAL_CENTS);

    const charge = await stripe.charges.retrieve(intent.latest_charge as string);
    assert.equal(charge.refunded, true);
    assert.equal(charge.amount_refunded, TOTAL_CENTS);

    const plan = planWebhookEvent({ type: "charge.refunded", data: { object: charge } });
    assert.equal(plan.action, "refund");
    if (plan.action === "refund") {
      assert.equal(plan.fullyRefunded, true);
      assert.equal(plan.refundedCents, TOTAL_CENTS);
    }
  });

  test("remboursement partiel : distingué du total", async () => {
    const intent = await succeededIntent("refund-partial");
    await stripe.refunds.create({ payment_intent: intent.id, amount: 1000 });

    const charge = await stripe.charges.retrieve(intent.latest_charge as string);
    assert.equal(charge.refunded, false);
    assert.equal(charge.amount_refunded, 1000);

    const plan = planWebhookEvent({ type: "charge.refunded", data: { object: charge } });
    if (plan.action === "refund") assert.equal(plan.fullyRefunded, false);
  });

  test("la clé d'idempotence empêche un double remboursement", async () => {
    const intent = await succeededIntent("refund-idem");
    const key = `refund:${intent.id}`;
    const refunds = await Promise.all(
      Array.from({ length: 5 }, () =>
        stripe.refunds.create({ payment_intent: intent.id }, { idempotencyKey: key })),
    );
    assert.equal(new Set(refunds.map((r) => r.id)).size, 1);

    const charge = await stripe.charges.retrieve(intent.latest_charge as string);
    assert.equal(charge.amount_refunded, TOTAL_CENTS, "jamais plus que le montant encaissé");
  });

  test("rembourser au-delà du montant encaissé est refusé", async () => {
    const intent = await succeededIntent("refund-over");
    await stripe.refunds.create({ payment_intent: intent.id });
    await assert.rejects(
      () => stripe.refunds.create({ payment_intent: intent.id, amount: 100 }),
      /already been refunded|amount/i,
    );
  });
});

/* ================================================================== *
 *  Paiements séparés et transferts : le versement après réception
 * ================================================================== */

describe("versement du vendeur", { skip }, () => {
  test("le transfert n'a lieu qu'à la demande, et une seule fois", async () => {
    const orderId = `order-${run}-payout`;

    const intent = await stripe.paymentIntents.create({
      amount: TOTAL_CENTS, currency: "eur", payment_method: "pm_card_visa", confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      transfer_group: `order_${orderId}`,
      metadata: { order_id: orderId },
    });
    assert.equal(intent.status, "succeeded");

    // À ce stade, aucun euro n'est parti chez le vendeur : c'est tout l'intérêt.
    const charge = await stripe.charges.retrieve(intent.latest_charge as string);
    assert.equal(charge.transfer, null);
    assert.equal(charge.transfer_group, `order_${orderId}`);

    // L'acheteur confirme la réception : le versement part.
    const amount = SELLER_CENTS;
    const transfers = await Promise.all(
      Array.from({ length: 3 }, () => stripe.transfers.create({
        amount, currency: "eur", destination: sellerAccount,
        source_transaction: charge.id,
        transfer_group: `order_${orderId}`,
        metadata: { order_id: orderId },
      }, { idempotencyKey: `payout:${orderId}` })),
    );

    assert.equal(new Set(transfers.map((t) => t.id)).size, 1,
      "trois exécutions concurrentes du versement ne doivent produire qu'un transfert");
    assert.equal(transfers[0].amount, amount);
    assert.equal(transfers[0].destination, sellerAccount);
  });

  test("un transfert déjà versé peut être annulé après remboursement", async () => {
    const orderId = `order-${run}-reversal`;
    const intent = await stripe.paymentIntents.create({
      amount: TOTAL_CENTS, currency: "eur", payment_method: "pm_card_visa", confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      transfer_group: `order_${orderId}`,
    });
    const charge = await stripe.charges.retrieve(intent.latest_charge as string);
    const amount = SELLER_CENTS;

    const transfer = await stripe.transfers.create({
      amount, currency: "eur", destination: sellerAccount,
      source_transaction: charge.id, transfer_group: `order_${orderId}`,
    }, { idempotencyKey: `payout:${orderId}` });

    const reversal = await stripe.transfers.createReversal(transfer.id, { amount }, {
      idempotencyKey: `payout-reversal:${orderId}:${amount}`,
    });
    assert.equal(reversal.amount, amount);

    const after = await stripe.transfers.retrieve(transfer.id);
    assert.equal(after.amount_reversed, amount, "les fonds sont récupérés côté plateforme");
    assert.equal(after.reversed, true);
  });

  test("un transfert supérieur au paiement d'origine est refusé", async () => {
    const orderId = `order-${run}-overtransfer`;
    const intent = await stripe.paymentIntents.create({
      amount: TOTAL_CENTS, currency: "eur", payment_method: "pm_card_visa", confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      transfer_group: `order_${orderId}`,
    });
    const charge = await stripe.charges.retrieve(intent.latest_charge as string);

    await assert.rejects(
      () => stripe.transfers.create({
        amount: TOTAL_CENTS * 10, currency: "eur", destination: sellerAccount,
        source_transaction: charge.id,
      }),
      /insufficient|amount/i,
      "adosser le transfert à la charge empêche de verser plus que ce qui a été encaissé",
    );
  });
});

/* ================================================================== *
 *  Litiges
 * ================================================================== */

describe("litiges bancaires", { skip }, () => {
  test("un litige est ouvert, débité à la plateforme, et suit un cycle de vie", async () => {
    const orderId = `order-${run}-dispute`;
    const intent = await stripe.paymentIntents.create({
      amount: TOTAL_CENTS, currency: "eur",
      payment_method: "pm_card_createDispute", confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { order_id: orderId },
    });

    const charge = await stripe.charges.retrieve(intent.latest_charge as string, { expand: ["dispute"] });
    assert.equal(charge.disputed, true, "la carte de test doit déclencher un litige");

    const dispute = charge.dispute as Stripe.Dispute;
    assert.ok(dispute?.id);
    assert.equal(dispute.charge, charge.id);

    const plan = planWebhookEvent({ type: "charge.dispute.created", data: { object: dispute } });
    assert.equal(plan.action, "chargeback");
    if (plan.action === "chargeback") {
      assert.equal(plan.chargeId, charge.id);
      assert.ok(plan.status);
    }
  });
});

/* ================================================================== *
 *  Compte connecté
 * ================================================================== */

describe("compte vendeur Connect", { skip }, () => {
  test("un compte fraîchement créé n'est pas encore capable d'encaisser", async () => {
    const account = await stripe.accounts.retrieve(sellerAccount);
    assert.equal(account.type, "express");
    assert.equal(account.country, "FR");
    assert.equal(account.details_submitted, false, "l'onboarding n'a pas été fait");

    const plan = planWebhookEvent({ type: "account.updated", data: { object: account } });
    assert.equal(plan.action, "connect_account");
    if (plan.action === "connect_account") {
      assert.equal(plan.ready, false, "create-checkout doit refuser la vente sur ce compte");
    }
  });

  test("la clé d'idempotence évite de créer deux comptes pour le même vendeur", async () => {
    const userId = `test-seller-dup-${run}`;
    const accounts = await Promise.all(
      Array.from({ length: 3 }, () => stripe.accounts.create({
        type: "express", country: "FR", email: `dup-${run}@example.test`,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: "individual", metadata: { user_id: userId },
      }, { idempotencyKey: `connect-account:${userId}` })),
    );
    assert.equal(new Set(accounts.map((a) => a.id)).size, 1,
      "un double-clic créerait sinon deux comptes, dont un orphelin avec ses obligations d'identité");
  });

  test("un lien d'onboarding est produit et pointe vers Stripe", async () => {
    const link = await stripe.accountLinks.create({
      account: sellerAccount,
      refresh_url: "https://www.athenamilitaria.fr/account?connect=refresh",
      return_url: "https://www.athenamilitaria.fr/account?connect=done",
      type: "account_onboarding",
    });
    assert.match(link.url, /^https:\/\/connect\.stripe\.com\//);
    assert.ok(link.expires_at > Math.floor(Date.now() / 1000));
  });
});
