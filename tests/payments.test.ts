/**
 * Logique de paiement pure.
 *
 * Ces tests jouent le rôle d'un client hostile : ils envoient à la validation
 * ce qu'un navigateur modifié enverrait, et vérifient qu'aucun montant, aucune
 * devise et aucun identifiant de vendeur ne peut entrer par cette porte.
 *
 * Lancement : npm test
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Stripe from "stripe";

import {
  appliquerSynchroConnect,
  enregistrerCompteConnect,
  type EnregistrementDbLike,
  lireCompteConnect,
  profilsConnect,
  type SupabaseLike,
  synchroniserProfilConnect,
  type ConnectDeps,
} from "../supabase/functions/_shared/connect.ts";
import {
  analyserEndpointsWebhook,
  compteConnectIntrouvable,
  compteEffacable,
  CONNECT_WEBHOOK_EVENTS,
  connectAccountReady,
  effacementsSuspects,
  estEndpointConnect,
  planSynchroConnect,
  PLATFORM_WEBHOOK_EVENTS,
  SEUIL_EFFACEMENTS_SUSPECTS,
  type EndpointStripe,
} from "../supabase/functions/_shared/payments.ts";
import {
  ALLOWED_ORIGINS,
  ALLOWED_SHIPPING_COUNTRIES,
  CONSUMED_WEBHOOK_EVENTS,
  buildCheckoutSessionParams,
  SHIPPING_CATALOG,
  buildShippingAddress,
  clientError,
  codeFromDbError,
  corsHeaders,
  environmentMatches,
  formatEuroCents,
  isShippingMethod,
  normaliseRelayPostal,
  parseCheckoutRequest,
  planWebhookEvent,
  redactSecrets,
  resolveOrigin,
  shippingLabel,
  stripeKeyMode,
} from "../supabase/functions/_shared/payments.ts";

/* ================================================================== *
 *  Validation de la requête d'achat
 * ================================================================== */

test("une requête normale est acceptée et réduite aux champs connus", () => {
  const result = parseCheckoutRequest({ productId: 42, shippingMethod: "post", relayPostal: "75001" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { productId: 42, shippingMethod: "post", relayPostal: null });
});

test("aucun montant envoyé par le navigateur ne franchit la validation", () => {
  const result = parseCheckoutRequest({
    productId: 42,
    shippingMethod: "pickup",
    // Tout ce qu'un attaquant ajouterait dans le corps de la requête :
    amount: 1,
    unit_amount: 1,
    price: 0.01,
    currency: "usd",
    application_fee_amount: 0,
    priceId: "price_evil",
    sellerId: "00000000-0000-0000-0000-000000000000",
    quantity: 99,
    coupon: "GRATUIT",
    transfer_data: { destination: "acct_attaquant" },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // La valeur retenue ne contient que trois champs : rien d'autre ne peut
  // atteindre Stripe ni la base.
  assert.deepEqual(Object.keys(result.value).sort(), ["productId", "relayPostal", "shippingMethod"].sort());
});

test("identifiants d'article aberrants refusés", () => {
  for (const productId of [-1, 0, 1.5, NaN, Infinity, "abc", null, undefined, "1; DROP TABLE orders", 1e21]) {
    const result = parseCheckoutRequest({ productId, shippingMethod: "pickup" });
    assert.equal(result.ok, false, `productId=${String(productId)} aurait dû être refusé`);
    if (!result.ok) assert.equal(result.code, "PRODUCT_INVALID");
  }
});

test("un identifiant numérique en chaîne reste accepté (le formulaire envoie l'id de l'URL)", () => {
  const result = parseCheckoutRequest({ productId: "42", shippingMethod: "pickup" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.productId, 42);
});

test("modes de livraison inventés refusés", () => {
  for (const shippingMethod of ["gratuit", "PICKUP", "", null, 0, { pickup: true }, ["pickup"]]) {
    const result = parseCheckoutRequest({ productId: 1, shippingMethod });
    assert.equal(result.ok, false, `shippingMethod=${JSON.stringify(shippingMethod)} aurait dû être refusé`);
  }
});

test("point relais : le code postal est exigé et strictement à cinq chiffres", () => {
  const bad = ["", "750", "7500a", "75001 ", "ab#$%", "750012", null, 75001];
  for (const relayPostal of bad) {
    const result = parseCheckoutRequest({ productId: 1, shippingMethod: "relay", relayPostal });
    // « 75001 » entouré d'espaces est nettoyé, pas rejeté : on teste la valeur brute.
    if (typeof relayPostal === "string" && /^[0-9]{5}$/.test(relayPostal.trim())) continue;
    assert.equal(result.ok, false, `relayPostal=${JSON.stringify(relayPostal)} aurait dû être refusé`);
    if (!result.ok) assert.equal(result.code, "RELAY_POSTAL_INVALID");
  }

  const ok = parseCheckoutRequest({ productId: 1, shippingMethod: "relay", relayPostal: " 75001 " });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.relayPostal, "75001");
});

test("un corps non objet est refusé plutôt que d'être deviné", () => {
  for (const body of [null, undefined, "productId=1", 42, []]) {
    const result = parseCheckoutRequest(body);
    if (Array.isArray(body)) {
      assert.equal(result.ok, false);
      continue;
    }
    assert.equal(result.ok, false, `corps=${JSON.stringify(body)} aurait dû être refusé`);
  }
});

test("normaliseRelayPostal ne tronque plus : elle valide", () => {
  assert.equal(normaliseRelayPostal("75001"), "75001");
  // L'ancienne implémentation faisait String(x).slice(0,5) et laissait donc
  // passer n'importe quoi de cinq caractères.
  assert.equal(normaliseRelayPostal("ab#$%"), null);
  assert.equal(normaliseRelayPostal("750019"), null);
  assert.equal(normaliseRelayPostal(75001), null);
});

test("isShippingMethod n'accepte que les trois modes réels", () => {
  assert.equal(isShippingMethod("pickup"), true);
  assert.equal(isShippingMethod("relay"), true);
  assert.equal(isShippingMethod("post"), true);
  assert.equal(isShippingMethod("Pickup"), false);
  assert.equal(isShippingMethod(undefined), false);
});

/* ================================================================== *
 *  Erreurs présentées à l'acheteur
 * ================================================================== */

test("aucun message technique ne remonte au navigateur", () => {
  const messages = [
    "StripeInvalidRequestError: No such price: 'price_123'",
    'duplicate key value violates unique constraint "orders_payment_intent_uniq"',
    "connect ECONNREFUSED 10.0.0.1:5432",
    "sk_test_51ABCdefGHIjkl",
  ];
  for (const message of messages) {
    const code = codeFromDbError(message);
    const out = clientError(code);
    assert.equal(out.code, "INTERNAL");
    assert.equal(out.status, 500);
    for (const message2 of messages) {
      assert.equal(out.error.includes(message2), false, "le message technique a fuité");
    }
  }
});

test("les codes levés par les fonctions SQL sont reconnus et traduits", () => {
  const cases: Array<[string, string, number]> = [
    ['erreur: PRODUCT_RESERVED', "PRODUCT_RESERVED", 409],
    ["PRODUCT_NOT_AVAILABLE", "PRODUCT_NOT_AVAILABLE", 409],
    ["SELF_PURCHASE", "SELF_PURCHASE", 400],
    ["AMOUNT_TOO_LOW", "AMOUNT_TOO_LOW", 400],
    ["TOO_MANY_RESERVATIONS", "TOO_MANY_RESERVATIONS", 429],
    ["SHIPPING_NOT_OFFERED", "SHIPPING_NOT_OFFERED", 400],
  ];
  for (const [raw, expectedCode, expectedStatus] of cases) {
    const code = codeFromDbError(raw);
    assert.equal(code, expectedCode);
    assert.equal(clientError(code).status, expectedStatus);
  }
});

test("un code inconnu ne devient jamais un 200", () => {
  const out = clientError("N_IMPORTE_QUOI");
  assert.equal(out.status, 500);
  assert.equal(out.code, "INTERNAL");
});

/* ================================================================== *
 *  CORS
 * ================================================================== */

test("CORS : seules nos origines sont renvoyées, jamais l'étoile", () => {
  assert.equal(resolveOrigin("https://www.athenamilitaria.fr"), "https://www.athenamilitaria.fr");
  assert.equal(resolveOrigin("https://site-attaquant.example"), ALLOWED_ORIGINS[0]);
  assert.equal(resolveOrigin(null), ALLOWED_ORIGINS[0]);

  const headers = corsHeaders("https://site-attaquant.example");
  assert.equal(headers["Access-Control-Allow-Origin"], ALLOWED_ORIGINS[0]);
  assert.notEqual(headers["Access-Control-Allow-Origin"], "*");
  assert.equal(headers["Vary"], "Origin");
});

/* ================================================================== *
 *  Séparation test / production
 * ================================================================== */

test("le mode de la clé est déduit sans jamais exposer la clé", () => {
  assert.equal(stripeKeyMode("sk_live_abc"), "live");
  assert.equal(stripeKeyMode("sk_test_abc"), "test");
  assert.equal(stripeKeyMode("rk_live_abc"), "live");
  assert.equal(stripeKeyMode(undefined), "unknown");
});

test("un événement de test frappant un backend live est rejeté", () => {
  assert.equal(environmentMatches("live", true), true);
  assert.equal(environmentMatches("test", false), true);
  assert.equal(environmentMatches("live", false), false, "webhook test sur backend live : à rejeter");
  assert.equal(environmentMatches("test", true), false, "webhook live sur backend test : à rejeter");
  // Clé illisible : on ne bloque pas le service sur une supposition.
  assert.equal(environmentMatches("unknown", true), true);
});

/* ================================================================== *
 *  Routage des événements webhook
 * ================================================================== */

test("checkout.session.completed déclenche un traitement, jamais un encaissement direct", () => {
  const plan = planWebhookEvent({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", client_reference_id: "order-1", payment_status: "paid" } },
  });
  assert.equal(plan.action, "fulfill");
  if (plan.action !== "fulfill") return;
  assert.equal(plan.sessionId, "cs_test_1");
  assert.equal(plan.orderId, "order-1");
  // Le plan ne porte pas de statut de paiement : la décision revient à la
  // fonction de traitement, qui relit la session chez Stripe.
  assert.equal("paymentStatus" in plan, false);
});

test("l'identifiant de commande est retrouvé dans metadata si client_reference_id manque", () => {
  const plan = planWebhookEvent({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_2", metadata: { order_id: "order-2" } } },
  });
  assert.equal(plan.action, "fulfill");
  if (plan.action === "fulfill") assert.equal(plan.orderId, "order-2");
});

test("le paiement asynchrone réussi passe par le même traitement", () => {
  const plan = planWebhookEvent({
    type: "checkout.session.async_payment_succeeded",
    data: { object: { id: "cs_test_3" } },
  });
  assert.equal(plan.action, "fulfill");
});

test("session expirée : libération du stock", () => {
  const plan = planWebhookEvent({
    type: "checkout.session.expired",
    data: { object: { id: "cs_test_4", client_reference_id: "order-4" } },
  });
  assert.equal(plan.action, "release");
  if (plan.action === "release") assert.equal(plan.orderId, "order-4");
});

test("échec de paiement : le code de refus est conservé pour le diagnostic", () => {
  const plan = planWebhookEvent({
    type: "payment_intent.payment_failed",
    data: { object: { id: "pi_1", last_payment_error: { code: "card_declined", decline_code: "insufficient_funds" } } },
  });
  assert.equal(plan.action, "payment_failed");
  if (plan.action !== "payment_failed") return;
  assert.equal(plan.intentId, "pi_1");
  assert.equal(plan.code, "card_declined");
});

test("remboursement total et partiel sont distingués", () => {
  const full = planWebhookEvent({
    type: "charge.refunded",
    data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 5000, amount_refunded: 5000, refunded: true } },
  });
  assert.equal(full.action, "refund");
  if (full.action === "refund") {
    assert.equal(full.fullyRefunded, true);
    assert.equal(full.refundedCents, 5000);
    assert.equal(full.intentId, "pi_1");
  }

  const partial = planWebhookEvent({
    type: "charge.refunded",
    data: { object: { id: "ch_2", payment_intent: { id: "pi_2" }, amount: 5000, amount_refunded: 1000, refunded: false } },
  });
  assert.equal(partial.action, "refund");
  if (partial.action === "refund") {
    assert.equal(partial.fullyRefunded, false);
    assert.equal(partial.refundedCents, 1000);
    // PaymentIntent développé en objet : l'identifiant doit quand même sortir.
    assert.equal(partial.intentId, "pi_2");
  }
});

test("remboursement sans drapeau refunded : les montants tranchent", () => {
  const plan = planWebhookEvent({
    type: "charge.refunded",
    data: { object: { id: "ch_3", amount: 2000, amount_refunded: 2000 } },
  });
  assert.equal(plan.action, "refund");
  if (plan.action === "refund") assert.equal(plan.fullyRefunded, true);
});

test("litige bancaire : les trois événements sont couverts", () => {
  for (const type of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) {
    const plan = planWebhookEvent({
      type,
      data: { object: { id: "dp_1", charge: "ch_9", payment_intent: "pi_9", status: "needs_response", reason: "fraudulent" } },
    });
    assert.equal(plan.action, "chargeback", type);
    if (plan.action !== "chargeback") continue;
    assert.equal(plan.chargeId, "ch_9");
    assert.equal(plan.intentId, "pi_9");
    assert.equal(plan.reason, "fraudulent");
  }
});

test("compte Connect : prêt seulement si les trois capacités sont réunies", () => {
  const ready = planWebhookEvent({
    type: "account.updated",
    data: { object: { id: "acct_1", charges_enabled: true, details_submitted: true, payouts_enabled: true } },
  });
  assert.equal(ready.action, "connect_account");
  if (ready.action === "connect_account") assert.equal(ready.ready, true);

  // Un seul manquant suffit à repasser le vendeur en « non prêt » : sinon on
  // continuerait à envoyer des paiements vers un compte qui ne peut pas les
  // recevoir.
  for (const missing of ["charges_enabled", "details_submitted", "payouts_enabled"]) {
    const object: Record<string, unknown> = {
      id: "acct_1", charges_enabled: true, details_submitted: true, payouts_enabled: true,
    };
    object[missing] = false;
    const plan = planWebhookEvent({ type: "account.updated", data: { object } });
    assert.equal(plan.action, "connect_account");
    if (plan.action === "connect_account") assert.equal(plan.ready, false, `${missing} manquant`);
  }
});

test("un type d'événement inconnu est ignoré, pas interprété", () => {
  for (const type of ["invoice.paid", "customer.created", "", "checkout.session.completed.v2"]) {
    const plan = planWebhookEvent({ type, data: { object: { id: "x" } } });
    assert.equal(plan.action, "ignore", type);
  }
  assert.equal(planWebhookEvent({}).action, "ignore");
});

test("un événement mal formé ne fait pas tomber le routage", () => {
  const plan = planWebhookEvent({ type: "checkout.session.completed", data: {} });
  assert.equal(plan.action, "ignore");
});

/* ================================================================== *
 *  Adresse de livraison
 * ================================================================== */

test("adresse de livraison : le point relais garde le code postal demandé", () => {
  const address = buildShippingAddress(
    { customer_details: { name: "Jean Test", address: { line1: "1 rue X", postal_code: "69001", city: "Lyon" } } },
    "relay",
    "75001",
  );
  assert.equal(address?.postal_code, "75001", "le code postal du relais prime sur l'adresse de facturation");
  assert.equal(address?.name, "Jean Test");
});

test("adresse de livraison : shipping_details prioritaire, repli sur customer_details", () => {
  const shipped = buildShippingAddress(
    {
      shipping_details: { name: "Livraison", address: { line1: "2 rue Y", postal_code: "31000", city: "Toulouse", country: "FR" } },
      customer_details: { name: "Facturation", address: { line1: "3 rue Z" } },
    },
    "post",
    null,
  );
  assert.equal(shipped?.line1, "2 rue Y");
  assert.equal(shipped?.country, "FR");

  const billed = buildShippingAddress(
    { customer_details: { name: "Facturation", address: { line1: "3 rue Z", city: "Nice" } } },
    "post",
    null,
  );
  assert.equal(billed?.line1, "3 rue Z");

  assert.equal(buildShippingAddress({}, "pickup", null), null);
});

/* ================================================================== *
 *  Formatage et journalisation
 * ================================================================== */

test("les montants s'affichent en euros à partir des centimes, sans flottant", () => {
  assert.equal(formatEuroCents(1099), "10,99 €");
  assert.equal(formatEuroCents(0), "0,00 €");
  assert.equal(formatEuroCents(5), "0,05 €");
  assert.equal(formatEuroCents(100000), "1000,00 €");
  assert.equal(formatEuroCents(null), "0,00 €");
  assert.equal(formatEuroCents(NaN), "0,00 €");
});

test("aucun secret ne peut être écrit dans les logs", () => {
  // Les motifs sont assemblés à l'exécution plutôt qu'écrits en clair. Ils ne
  // valent rien — ce sont des suites de caractères inventées — mais un
  // analyseur de secrets les signalerait comme des fuites, et une alerte qui
  // crie au loup finit par être ignorée le jour où elle a raison.
  const prefix = (p: string) => p; // empêche la concaténation d'être repliée à la lecture
  const samples = [
    `clé ${prefix("sk_") + "live_"}51AbCdEfGhIjKlMnOp refusée`,
    `${prefix("whsec_")}1234567890abcdef invalide`,
    `cs_test_a1b2${prefix("_secret_")}c3d4e5f6 expiré`,
    `jeton ${prefix("eyJ")}hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123`,
  ];
  for (const sample of samples) {
    const clean = redactSecrets(sample);
    assert.equal(/sk_live_[A-Za-z0-9]/.test(clean), false, sample);
    assert.equal(/whsec_[A-Za-z0-9]/.test(clean), false, sample);
    assert.equal(/_secret_[A-Za-z0-9]/.test(clean), false, sample);
    assert.equal(/eyJ[A-Za-z0-9_-]{10,}\./.test(clean), false, sample);
    assert.equal(clean.includes("[redacted]"), true, sample);
  }
});

test("le libellé de livraison ne prétend rien quand le mode est inconnu", () => {
  assert.equal(shippingLabel("post"), SHIPPING_CATALOG.post.label);
  assert.equal(shippingLabel(null), "Non précisé");
  assert.equal(shippingLabel("teleportation"), "Non précisé");
});

/* ================================================================== *
 *  Événements du webhook : la liste déclarée et le code qui traite
 * ================================================================== */

describe("la liste des événements consommés", () => {
  test("chaque événement déclaré est effectivement traité", () => {
    for (const type of CONSUMED_WEBHOOK_EVENTS) {
      const plan = planWebhookEvent({ type, data: { object: { id: "x", payment_intent: "pi_x" } } });
      assert.notEqual(plan.action, "ignore",
        `${type} est annoncé à Stripe mais retombe sur « ignorer » : ` +
        `on ferait écouter à Stripe un événement dont on ne fait rien`);
    }
  });

  test("aucun événement traité ne manque à la liste", () => {
    // L'inverse du contrôle précédent, et le plus coûteux des deux : un
    // événement que le code sait traiter mais qui n'est pas coché chez Stripe
    // n'arrive jamais, et la commande reste bloquée sans erreur.
    const source = readFileSync(
      new URL("../supabase/functions/_shared/payments.ts", import.meta.url), "utf8");
    const corps = source.slice(source.indexOf("export function planWebhookEvent"));
    const traites = [...corps.matchAll(/case "([a-z_]+\.[a-z_.]+)":/g)].map((m) => m[1]);

    assert.ok(traites.length >= 10, `répartiteur illisible : ${traites.length} cas trouvés`);
    for (const type of traites) {
      assert.ok((CONSUMED_WEBHOOK_EVENTS as readonly string[]).includes(type),
        `${type} est traité par le code mais absent de CONSUMED_WEBHOOK_EVENTS : ` +
        `il ne sera jamais coché chez Stripe`);
    }
  });

  test("dix événements, ni plus ni moins, et sans doublon", () => {
    assert.equal(CONSUMED_WEBHOOK_EVENTS.length, 10);
    assert.equal(new Set(CONSUMED_WEBHOOK_EVENTS).size, 10);
  });
});

/* ================================================================== *
 *  Le constructeur de session Checkout
 *
 *  Ces contrôles tournent sans clé Stripe, donc à chaque `npm test`.
 *  C'est délibéré : la suite sandbox est facultative, et un garde-fou
 *  qui ne s'exécute qu'avec une clé ne garde rien la plupart du temps.
 * ================================================================== */

describe("les paramètres envoyés à Stripe pour ouvrir un paiement", () => {
  const base = {
    orderId: "11111111-2222-3333-4444-555555555555",
    productId: "42",
    productTitle: "Casque Adrian 1915",
    productAmountCents: 4500,
    protectionAmountCents: 295,
    shippingAmountCents: 890,
    shippingMethod: "post" as const,
    currency: "eur",
    customerEmail: "acheteur@example.test",
    expiresAt: 1_800_000_000,
    metadata: { order_id: "11111111", product_id: "42" },
    siteOrigin: "https://www.athenamilitaria.fr",
  };

  test("aucune commission n'est prélevée au vendeur", () => {
    // La décision « le vendeur ne paie rien » est tenue par une contrainte en
    // base sur application_fee_cents. Cette contrainte ne voit rien de ce qui
    // est envoyé à Stripe : une commission posée ici serait prélevée pour de
    // bon pendant que la base afficherait zéro.
    const p = buildCheckoutSessionParams(base) as Record<string, any>;
    assert.equal(p.payment_intent_data.application_fee_amount, undefined);
    assert.ok(!("application_fee_amount" in p.payment_intent_data));
  });

  test("rien n'est versé au vendeur à l'encaissement", () => {
    // transfer_data.destination verserait dès le paiement, ce qui annulerait
    // la retenue jusqu'à confirmation de réception. payout-release créerait
    // ensuite un second mouvement sur la même commande.
    const p = buildCheckoutSessionParams(base) as Record<string, any>;
    assert.equal(p.payment_intent_data.transfer_data, undefined);
    assert.ok(!("transfer_data" in p.payment_intent_data));
    assert.equal(p.payment_intent_data.transfer_group, `order_${base.orderId}`,
      "le rattachement comptable, lui, doit être posé dès l'encaissement");
  });

  test("l'acheteur voit deux lignes, dont la Protection nommée", () => {
    const p = buildCheckoutSessionParams(base) as Record<string, any>;
    assert.equal(p.line_items.length, 2);
    assert.equal(p.line_items[0].price_data.unit_amount, 4500);
    assert.equal(p.line_items[1].price_data.product_data.name, "Protection acheteurs");
    assert.equal(p.line_items[1].price_data.unit_amount, 295);
  });

  test("les montants sont ceux fournis, jamais recalculés", () => {
    // Deux calculs du même montant finissent toujours par diverger. Le
    // constructeur ne doit qu'obéir.
    const p = buildCheckoutSessionParams({
      ...base, productAmountCents: 999, protectionAmountCents: 7, shippingAmountCents: 1,
    }) as Record<string, any>;
    assert.equal(p.line_items[0].price_data.unit_amount, 999);
    assert.equal(p.line_items[1].price_data.unit_amount, 7);
    assert.equal(p.shipping_options[0].shipping_rate_data.fixed_amount.amount, 1);
  });

  test("la remise en main propre ne demande ni adresse ni délai", () => {
    const p = buildCheckoutSessionParams({
      ...base, shippingMethod: "pickup", shippingAmountCents: 0,
    }) as Record<string, any>;
    assert.ok(!("shipping_address_collection" in p),
      "réclamer une adresse de livraison pour une remise en main propre est une fuite inutile");
    assert.equal(p.shipping_options[0].shipping_rate_data.delivery_estimate, undefined,
      "annoncer « 0 jour ouvré » à Stripe n'a pas de sens");
  });

  test("un envoi demande l'adresse, dans les pays desservis seulement", () => {
    const p = buildCheckoutSessionParams(base) as Record<string, any>;
    assert.deepEqual(p.shipping_address_collection.allowed_countries, [...ALLOWED_SHIPPING_COUNTRIES]);
    assert.ok(p.shipping_options[0].shipping_rate_data.delivery_estimate);
  });

  test("le retour de paiement passe par une vérification serveur", () => {
    const p = buildCheckoutSessionParams(base) as Record<string, any>;
    assert.match(p.success_url, /\/order\?session_id=\{CHECKOUT_SESSION_ID\}$/,
      "la page de confirmation doit faire vérifier le paiement, l'URL seule ne prouve rien");
    assert.match(p.cancel_url, /\/product\?id=42&checkout=canceled$/);
  });

  test("create-checkout appelle ce constructeur au lieu d'en recopier un", () => {
    // Le contrôle qui compte vraiment. Tout ce qui précède ne protège la
    // production que si la production passe bien par ici.
    const source = readFileSync(
      new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
    const sansCommentaires = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    assert.match(sansCommentaires, /buildCheckoutSessionParams\(/,
      "create-checkout doit construire sa session avec la fonction partagée");
    for (const interdit of ["application_fee_amount", "transfer_data", "line_items"]) {
      assert.doesNotMatch(sansCommentaires, new RegExp(interdit),
        `${interdit} ne doit plus apparaître dans create-checkout : ` +
        `un second constructeur échapperait à tous les contrôles ci-dessus`);
    }
  });
});

/* ================================================================== *
 *  Comptes vendeurs Connect
 *
 *  Depuis le passage à la clé live, les comptes créés pendant les essais
 *  n'existent plus pour Stripe. Ces tests vérifient qu'on le détecte sans
 *  confondre une absence avec une panne, et qu'on n'efface rien hors live.
 * ================================================================== */

/** Les erreurs exactes du SDK chargé par les fonctions edge (14.21.0). */
const erreurStripe = {
  introuvable: () => new Stripe.errors.StripeInvalidRequestError({
    message: "No such account: 'acct_test_ancien'", code: "resource_missing", statusCode: 404,
    type: "invalid_request_error",
  } as never),
  accountInvalid: () => new Stripe.errors.StripeInvalidRequestError({
    message: "The account is invalid", code: "account_invalid", statusCode: 400, type: "invalid_request_error",
  } as never),
  sansAcces: () => new Stripe.errors.StripePermissionError({
    message: "The provided key 'sk_live_****1234' does not have access to account 'acct_test_ancien' " +
             "(or that account does not exist). Application access may have been revoked.",
    statusCode: 403, type: "invalid_request_error",
  } as never),
  cleRestreinte: () => new Stripe.errors.StripePermissionError({
    message: "The provided key 'rk_live_****1234' does not have the required permissions for this " +
             "endpoint on account 'acct_plateforme'.",
    statusCode: 403, type: "invalid_request_error",
  } as never),
  reseau: () => new Stripe.errors.StripeConnectionError({
    message: "An error occurred with our connection to Stripe.",
  } as never),
  panne: () => new Stripe.errors.StripeAPIError({ message: "Something went wrong", statusCode: 500 } as never),
  debit: () => new Stripe.errors.StripeRateLimitError({
    message: "Too many requests", statusCode: 429, code: "rate_limit",
  } as never),
};

describe("un compte vendeur prêt", () => {
  test("prêt seulement si dossier, encaissements et virements sont réunis", () => {
    assert.equal(connectAccountReady({ details_submitted: true, charges_enabled: true, payouts_enabled: true }), true);
    for (const manquant of ["details_submitted", "charges_enabled", "payouts_enabled"]) {
      const compte: Record<string, unknown> = { details_submitted: true, charges_enabled: true, payouts_enabled: true };
      compte[manquant] = false;
      assert.equal(connectAccountReady(compte), false, manquant);
      delete compte[manquant];
      assert.equal(connectAccountReady(compte), false, `${manquant} absent`);
    }
    // « true » en texte n'est pas true : on ne devine pas.
    assert.equal(connectAccountReady({ details_submitted: "true", charges_enabled: true, payouts_enabled: true }), false);
    assert.equal(connectAccountReady(null), false);
    assert.equal(connectAccountReady(undefined), false);
  });

  test("le webhook applique la même règle que les autres chemins", () => {
    const objet = { id: "acct_1", details_submitted: true, charges_enabled: true, payouts_enabled: false };
    const plan = planWebhookEvent({ type: "account.updated", data: { object: objet } });
    assert.equal(plan.action, "connect_account");
    if (plan.action === "connect_account") assert.equal(plan.ready, connectAccountReady(objet));
  });
});

describe("compte introuvable chez Stripe", () => {
  test("les trois façons dont Stripe dit « ce compte n'existe pas pour cette clé »", () => {
    assert.equal(compteConnectIntrouvable(erreurStripe.introuvable()), true, "resource_missing");
    assert.equal(compteConnectIntrouvable(erreurStripe.accountInvalid()), true, "account_invalid");
    assert.equal(compteConnectIntrouvable(erreurStripe.sansAcces()), true, "403 sans accès au compte");
    // Forme brute, sans classe du SDK : un objet d'erreur sérialisé.
    assert.equal(compteConnectIntrouvable({ raw: { code: "resource_missing" } }), true);
    assert.equal(compteConnectIntrouvable({ statusCode: 404, message: "Not Found" }), true);
  });

  test("une panne n'est jamais prise pour une absence", () => {
    // Effacer un identifiant sur une panne passagère couperait un vendeur réel
    // de ses versements.
    assert.equal(compteConnectIntrouvable(erreurStripe.reseau()), false, "réseau");
    assert.equal(compteConnectIntrouvable(erreurStripe.panne()), false, "panne Stripe");
    assert.equal(compteConnectIntrouvable(erreurStripe.debit()), false, "limite de débit");
    assert.equal(compteConnectIntrouvable(erreurStripe.cleRestreinte()), false, "clé restreinte sans droit de lecture");
    assert.equal(compteConnectIntrouvable(new Error("timeout")), false);
    for (const rien of [null, undefined, "No such account", 404]) {
      assert.equal(compteConnectIntrouvable(rien), false, String(rien));
    }
  });

  test("seule la clé live autorise à effacer un compte introuvable", () => {
    const introuvable = { etat: "introuvable", motif: "No such account" } as const;
    assert.equal(compteEffacable("live", introuvable), true);
    // Une clé de test remise par erreur en production verrait tous les comptes
    // live comme introuvables : rien ne doit être effacé.
    assert.equal(compteEffacable("test", introuvable), false);
    assert.equal(compteEffacable("unknown", introuvable), false);
    assert.equal(compteEffacable("live", { etat: "present", pret: false }), false);
  });
});

describe("synchronisation d'un profil vendeur", () => {
  const MAINTENANT = "2026-10-09T12:00:00.000Z";

  test("introuvable en live : identifiant effacé et vendeur repassé non prêt", () => {
    const r = planSynchroConnect(
      { stripe_onboarded: true }, { etat: "introuvable", motif: "No such account" }, "live", MAINTENANT);
    assert.equal(r.issue, "introuvable_efface");
    assert.deepEqual(r.patch, { stripe_account_id: null, stripe_onboarded: false, stripe_onboarded_at: null });
  });

  test("introuvable en live mais effacement retenu : rien n'est écrit", () => {
    const r = planSynchroConnect(
      { stripe_onboarded: true }, { etat: "introuvable", motif: "No such account" }, "live", MAINTENANT,
      { effacer: false });
    assert.equal(r.issue, "introuvable_conserve");
    assert.equal(r.patch, null);
  });

  test("introuvable hors live : rien n'est écrit", () => {
    const r = planSynchroConnect(
      { stripe_onboarded: true }, { etat: "introuvable", motif: "No such account" }, "test", MAINTENANT);
    assert.equal(r.issue, "introuvable_conserve");
    assert.equal(r.patch, null);
  });

  test("inscription terminée : prêt, daté", () => {
    const r = planSynchroConnect({ stripe_onboarded: false }, { etat: "present", pret: true }, "live", MAINTENANT);
    assert.equal(r.issue, "devenu_pret");
    assert.deepEqual(r.patch, { stripe_onboarded: true, stripe_onboarded_at: MAINTENANT });
  });

  test("déjà prêt et toujours prêt : aucune écriture, la date d'origine survit", () => {
    const r = planSynchroConnect({ stripe_onboarded: true }, { etat: "present", pret: true }, "live", MAINTENANT);
    assert.equal(r.issue, "inchange");
    assert.equal(r.patch, null);
  });

  test("plus prêt chez Stripe : ventes suspendues", () => {
    const r = planSynchroConnect({ stripe_onboarded: true }, { etat: "present", pret: false }, "live", MAINTENANT);
    assert.equal(r.issue, "plus_pret");
    assert.deepEqual(r.patch, { stripe_onboarded: false, stripe_onboarded_at: null });
  });

  test("inscription en cours : rien à écrire", () => {
    for (const avant of [false, null, undefined]) {
      const r = planSynchroConnect({ stripe_onboarded: avant }, { etat: "present", pret: false }, "live", MAINTENANT);
      assert.equal(r.issue, "inchange", String(avant));
      assert.equal(r.patch, null);
    }
  });
});

describe("relecture d'un compte chez Stripe, base simulée", () => {
  type Appel = { id: string; compteLu: string; patch: Record<string, unknown> };

  function deps(options: {
    compte?: Record<string, unknown>;
    erreur?: unknown;
    keyMode?: "live" | "test" | "unknown";
    echecBase?: boolean;
    /** Faux : l'identifiant a changé entre la lecture et l'écriture. */
    ligneTouchee?: boolean;
  }) {
    const lus: string[] = [];
    const ecrits: Appel[] = [];
    const journal: Array<{ scope: string; fields: Record<string, unknown> }> = [];
    const d: ConnectDeps = {
      stripe: {
        accounts: {
          retrieve(id: string) {
            lus.push(id);
            return options.erreur ? Promise.reject(options.erreur) : Promise.resolve(options.compte ?? {});
          },
        },
      },
      db: {
        majProfil(id, compteLu, patch) {
          ecrits.push({ id, compteLu, patch });
          return Promise.resolve({
            error: options.echecBase ? { message: "connexion perdue" } : null,
            modifie: !options.echecBase && options.ligneTouchee !== false,
          });
        },
      },
      keyMode: options.keyMode ?? "live",
      now: () => new Date("2026-10-09T12:00:00.000Z"),
      journal: (scope, fields) => journal.push({ scope, fields }),
    };
    return { d, lus, ecrits, journal };
  }

  const profil = { id: "vendeur-1", stripe_account_id: "acct_test_ancien", stripe_onboarded: true };

  test("compte de test vu par la clé live : détecté, effacé, sous condition de l'identifiant lu", async () => {
    const { d, lus, ecrits, journal } = deps({ erreur: erreurStripe.introuvable() });
    const r = await synchroniserProfilConnect(d, profil);
    assert.equal(r.issue, "introuvable_efface");
    assert.equal(r.ecrit, true);
    assert.equal(r.lecture?.etat, "introuvable");
    // L'identifiant effacé est journalisé en entier : c'est la seule trace
    // qui permette de le remettre.
    assert.deepEqual(journal.map((j) => j.scope), ["connect_account_erased"]);
    assert.equal(journal[0].fields.account_id, "acct_test_ancien");
    assert.equal(journal[0].fields.profile_id, "vendeur-1");
    assert.equal(journal[0].fields.etait_pret, true);
    assert.deepEqual(lus, ["acct_test_ancien"]);
    assert.equal(ecrits.length, 1);
    // L'écriture porte l'identifiant lu : si le vendeur a obtenu un compte
    // neuf entre-temps, elle ne touche rien.
    assert.equal(ecrits[0].compteLu, "acct_test_ancien");
    assert.equal(ecrits[0].patch.stripe_account_id, null);
    assert.equal(ecrits[0].patch.stripe_onboarded, false);
  });

  test("la 403 « or that account does not exist » vaut absence", async () => {
    const { d, ecrits } = deps({ erreur: erreurStripe.sansAcces() });
    const r = await synchroniserProfilConnect(d, profil);
    assert.equal(r.issue, "introuvable_efface");
    assert.equal(ecrits.length, 1);
  });

  test("compte supprimé chez Stripe : traité comme introuvable", async () => {
    const lecture = await lireCompteConnect(
      { accounts: { retrieve: () => Promise.resolve({ id: "acct_1", deleted: true }) } }, "acct_1");
    assert.equal(lecture.etat, "introuvable");
  });

  test("compte prêt : le drapeau est posé", async () => {
    const { d, ecrits } = deps({
      compte: { id: "acct_live", details_submitted: true, charges_enabled: true, payouts_enabled: true },
    });
    const r = await synchroniserProfilConnect(d, { ...profil, stripe_account_id: "acct_live", stripe_onboarded: false });
    assert.equal(r.issue, "devenu_pret");
    assert.deepEqual(ecrits, [{
      id: "vendeur-1", compteLu: "acct_live",
      patch: { stripe_onboarded: true, stripe_onboarded_at: "2026-10-09T12:00:00.000Z" },
    }]);
  });

  test("une panne Stripe remonte, et rien n'est écrit", async () => {
    for (const erreur of [erreurStripe.reseau(), erreurStripe.panne(), erreurStripe.cleRestreinte()]) {
      const { d, ecrits } = deps({ erreur });
      await assert.rejects(() => synchroniserProfilConnect(d, profil));
      assert.equal(ecrits.length, 0, (erreur as Error).message);
    }
  });

  test("clé de test : un compte introuvable n'est pas effacé", async () => {
    const { d, ecrits } = deps({ erreur: erreurStripe.introuvable(), keyMode: "test" });
    const r = await synchroniserProfilConnect(d, profil);
    assert.equal(r.issue, "introuvable_conserve");
    assert.equal(ecrits.length, 0);
  });

  test("une écriture en échec remonte : le webhook répondra 500 et Stripe relivrera", async () => {
    const { d } = deps({ erreur: erreurStripe.introuvable(), echecBase: true });
    await assert.rejects(() => synchroniserProfilConnect(d, profil), /profiles\.update: connexion perdue/);
  });

  test("un profil sans compte n'interroge pas Stripe", async () => {
    const { d, lus, ecrits } = deps({});
    const r = await synchroniserProfilConnect(d, { id: "vendeur-2", stripe_account_id: null });
    assert.equal(r.issue, "sans_compte");
    assert.equal(lus.length, 0);
    assert.equal(ecrits.length, 0);
  });

  test("identifiant changé entre lecture et écriture : rien d'effacé, rien de journalisé", async () => {
    const { d, journal } = deps({ erreur: erreurStripe.introuvable(), ligneTouchee: false });
    const r = await synchroniserProfilConnect(d, profil);
    assert.equal(r.issue, "introuvable_efface");
    assert.equal(r.ecrit, false);
    assert.deepEqual(journal, []);
  });

  test("effacement retenu (garde-fou de la surveillance) : aucune écriture, même en live", async () => {
    const { d, ecrits, journal } = deps({});
    const r = await appliquerSynchroConnect(d, profil, { etat: "introuvable", motif: "No such account" }, {
      effacer: false,
    });
    assert.equal(r.issue, "introuvable_conserve");
    assert.equal(ecrits.length, 0);
    assert.deepEqual(journal, []);
  });

  test("appliquer une lecture déjà faite n'interroge pas Stripe", async () => {
    const { d, lus, ecrits } = deps({});
    const r = await appliquerSynchroConnect(d, { ...profil, stripe_onboarded: false }, { etat: "present", pret: true });
    assert.equal(r.issue, "devenu_pret");
    assert.equal(lus.length, 0);
    assert.equal(ecrits.length, 1);
  });

  test("le motif journalisé ne contient aucune clé", async () => {
    const fuite = new Stripe.errors.StripeInvalidRequestError({
      message: "No such account: 'acct_x'; key sk_live_" + "A1b2C3d4E5f6", code: "resource_missing", statusCode: 404,
    } as never);
    const lecture = await lireCompteConnect({ accounts: { retrieve: () => Promise.reject(fuite) } }, "acct_x");
    assert.equal(lecture.etat, "introuvable");
    if (lecture.etat === "introuvable") assert.doesNotMatch(lecture.motif, /sk_live_[A-Za-z0-9]/);
  });
});

/* ================================================================== *
 *  Configuration des endpoints vue par la surveillance
 * ================================================================== */

describe("configuration des endpoints chez Stripe", () => {
  const URL_WEBHOOK = "https://exemple.supabase.co/functions/v1/stripe-webhook";
  const plateforme = (extra: Partial<EndpointStripe> = {}): EndpointStripe => ({
    id: "we_plateforme", url: URL_WEBHOOK, status: "enabled", livemode: true, application: null,
    // Les dix cases cochées le 6 oct., account.updated compris : inutile ici,
    // mais sans danger.
    enabled_events: [...PLATFORM_WEBHOOK_EVENTS, "account.updated"],
    ...extra,
  });
  const connect = (extra: Partial<EndpointStripe> = {}): EndpointStripe => ({
    id: "we_connect", url: URL_WEBHOOK, status: "enabled", livemode: true, application: "ca_plateforme",
    enabled_events: [...CONNECT_WEBHOOK_EVENTS],
    ...extra,
  });
  const live = { keyMode: "live" as const, secretConnectDefini: true };
  const critiques = (a: ReturnType<typeof analyserEndpointsWebhook>) =>
    a.anomalies.filter((x) => x.severity === "critique");

  test("les deux listes couvrent exactement ce que le code consomme, sans recouvrement", () => {
    const tout = [...PLATFORM_WEBHOOK_EVENTS, ...CONNECT_WEBHOOK_EVENTS];
    assert.deepEqual([...tout].sort(), [...CONSUMED_WEBHOOK_EVENTS].sort());
    assert.equal(new Set(tout).size, tout.length);
    assert.deepEqual([...CONNECT_WEBHOOK_EVENTS], ["account.updated"]);
  });

  test("configuration cible : plateforme complète et destination Connect sur account.updated", () => {
    const a = analyserEndpointsWebhook([plateforme(), connect()], URL_WEBHOOK, live);
    assert.deepEqual(a.anomalies, []);
    assert.deepEqual(a.vus.map((v) => v.type), ["plateforme", "comptes connectés"]);
  });

  test("une destination Connect qui n'écoute que account.updated n'est jamais critique", () => {
    // Même sans le champ application : ses neuf événements « manquants » ne
    // la concernent pas.
    const sansApplication = connect({ application: null });
    assert.equal(estEndpointConnect(sansApplication), true);
    const a = analyserEndpointsWebhook([plateforme(), sansApplication], URL_WEBHOOK, live);
    assert.deepEqual(critiques(a), []);
    assert.deepEqual(a.anomalies, []);
  });

  test("destination Connect sans champ application, avec un événement Connect de plus : toujours Connect", () => {
    // La documentation ne garantit pas que Stripe remplisse application.
    const elargie = connect({ application: null, enabled_events: ["account.updated", "account.external_account.updated"] });
    assert.equal(estEndpointConnect(elargie), true);
    const a = analyserEndpointsWebhook([plateforme(), elargie], URL_WEBHOOK, live);
    assert.deepEqual(critiques(a), []);
    assert.deepEqual(a.anomalies, []);
  });

  test("ce qui touche à l'argent n'est jamais pris pour une destination Connect", () => {
    // Sans champ application : « tous les événements », un seul événement
    // d'argent, ou aucun événement du tout restent du côté de la plateforme.
    assert.equal(estEndpointConnect({ application: null, enabled_events: ["*"] }), false);
    assert.equal(estEndpointConnect({ application: null, enabled_events: ["account.updated", "charge.refunded"] }), false);
    assert.equal(estEndpointConnect({ application: null, enabled_events: [] }), false);
    assert.equal(estEndpointConnect({ application: null, enabled_events: [...PLATFORM_WEBHOOK_EVENTS] }), false);
    // Une plateforme où l'on n'aurait laissé qu'account.updated passe côté
    // Connect, et c'est bien l'absence de plateforme qui sonne, en critique.
    const a = analyserEndpointsWebhook(
      [plateforme({ application: null, enabled_events: ["account.updated"] })], URL_WEBHOOK, live);
    assert.equal(critiques(a).length, 1);
    assert.match(critiques(a)[0].line, /Votre compte/);
  });

  test("la situation du 9 oct. : pas de destination Connect en live, signalée sans être critique", () => {
    const a = analyserEndpointsWebhook([plateforme()], URL_WEBHOOK, { keyMode: "live", secretConnectDefini: false });
    assert.deepEqual(critiques(a), []);
    assert.equal(a.anomalies.length, 1);
    assert.equal(a.anomalies[0].severity, "attention");
    assert.match(a.anomalies[0].line, /comptes connectés/);
  });

  test("en mode test, l'absence de destination Connect n'est pas signalée", () => {
    const a = analyserEndpointsWebhook([plateforme({ livemode: false })], URL_WEBHOOK, {
      keyMode: "test", secretConnectDefini: false,
    });
    assert.deepEqual(a.anomalies, []);
  });

  test("la plateforme n'a plus besoin d'account.updated", () => {
    const a = analyserEndpointsWebhook(
      [plateforme({ enabled_events: [...PLATFORM_WEBHOOK_EVENTS] }), connect()], URL_WEBHOOK, live);
    assert.deepEqual(a.anomalies, []);
  });

  test("un événement d'argent décoché sur la plateforme reste critique", () => {
    const a = analyserEndpointsWebhook([
      plateforme({ enabled_events: PLATFORM_WEBHOOK_EVENTS.filter((e) => e !== "checkout.session.completed") }),
      connect(),
    ], URL_WEBHOOK, live);
    assert.equal(critiques(a).length, 1);
    assert.match(critiques(a)[0].line, /checkout\.session\.completed/);
  });

  test("sans endpoint plateforme, c'est critique, même si la destination Connect existe", () => {
    const a = analyserEndpointsWebhook([connect()], URL_WEBHOOK, live);
    assert.equal(critiques(a).length, 1);
    assert.match(critiques(a)[0].line, /Votre compte/);
  });

  test("plateforme désactivée : critique ; destination Connect désactivée : à surveiller", () => {
    const a = analyserEndpointsWebhook(
      [plateforme({ status: "disabled" }), connect({ status: "disabled" })], URL_WEBHOOK, live);
    assert.equal(critiques(a).length, 1);
    assert.match(critiques(a)[0].line, /we_plateforme/);
    assert.ok(a.anomalies.some((x) => x.severity === "attention" && /we_connect/.test(x.line)));
  });

  test("destination Connect sans account.updated : à surveiller", () => {
    const a = analyserEndpointsWebhook(
      [plateforme(), connect({ enabled_events: ["capability.updated"] })], URL_WEBHOOK, live);
    assert.deepEqual(critiques(a), []);
    assert.ok(a.anomalies.some((x) => /account\.updated/.test(x.line)));
  });

  test("destination Connect sans secret côté Supabase : signalée", () => {
    const a = analyserEndpointsWebhook([plateforme(), connect()], URL_WEBHOOK, {
      keyMode: "live", secretConnectDefini: false,
    });
    assert.deepEqual(critiques(a), []);
    assert.equal(a.anomalies.length, 1);
    assert.match(a.anomalies[0].line, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  });

  test("« tous les événements » couvre tout, et les autres URL sont ignorées", () => {
    const a = analyserEndpointsWebhook([
      plateforme({ enabled_events: ["*"] }),
      connect({ enabled_events: ["*"] }),
      plateforme({ id: "we_ailleurs", url: "https://ailleurs.example/hook", enabled_events: [] }),
    ], URL_WEBHOOK, live);
    assert.deepEqual(a.anomalies, []);
    assert.equal(a.vus.length, 2);
  });

  test("aucun message visible n'utilise de tiret cadratin", () => {
    const cas = [
      analyserEndpointsWebhook([], URL_WEBHOOK, live),
      analyserEndpointsWebhook([plateforme({ status: "disabled", enabled_events: [] })], URL_WEBHOOK,
        { keyMode: "live", secretConnectDefini: false }),
      analyserEndpointsWebhook([plateforme(), connect({ status: "disabled", enabled_events: ["x.y"] })], URL_WEBHOOK,
        { keyMode: "live", secretConnectDefini: false }),
    ];
    for (const a of cas) for (const x of a.anomalies) assert.doesNotMatch(x.line, /—/);
  });
});

/* ================================================================== *
 *  Garde-fou contre l'effacement en masse
 *
 *  Une clé live d'un autre compte Stripe voit tous les comptes vendeurs
 *  comme introuvables. La surveillance ne doit pas les effacer d'un coup.
 * ================================================================== */

describe("garde-fou de la surveillance", () => {
  const introuvable = { etat: "introuvable", motif: "does not have access to account" } as const;
  const present = { etat: "present", pret: true } as const;

  test("un vendeur prêt disparu : effacement normal", () => {
    assert.equal(effacementsSuspects([
      { pretEnBase: true, lecture: introuvable },
      { pretEnBase: true, lecture: present },
    ], "live"), false);
  });

  test(`${SEUIL_EFFACEMENTS_SUSPECTS} vendeurs prêts disparus d'un coup : rien n'est effacé`, () => {
    const lectures = Array.from({ length: SEUIL_EFFACEMENTS_SUSPECTS }, () => ({ pretEnBase: true, lecture: introuvable }));
    assert.equal(effacementsSuspects(lectures, "live"), true);
  });

  test("le nettoyage des comptes de test jamais terminés se fait d'un coup", () => {
    // Au passage en live, tous les comptes de test sont introuvables, mais
    // aucun n'était prêt : rien de suspect.
    const lectures = Array.from({ length: 30 }, () => ({ pretEnBase: false, lecture: introuvable }));
    assert.equal(effacementsSuspects(lectures, "live"), false);
  });

  test("hors live, la question ne se pose pas : rien n'est jamais effacé", () => {
    const lectures = Array.from({ length: 5 }, () => ({ pretEnBase: true, lecture: introuvable }));
    assert.equal(effacementsSuspects(lectures, "test"), false);
  });

  test("la surveillance lit d'abord, sous un budget, puis applique le garde-fou", () => {
    const source = readFileSync(
      new URL("../supabase/functions/payments-monitor/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const section = source.slice(source.indexOf("const debut = Date.now()"), source.indexOf("monitor_connect_accounts"));
    assert.ok(section.length > 0, "section des comptes vendeurs introuvable");
    // Lecture avec le client à délai court, sous budget et avec arrêt sur pannes.
    assert.match(section, /lireCompteConnect\(stripeLecture/);
    assert.match(section, /Date\.now\(\) - debut > BUDGET_VENDEURS_MS/);
    assert.match(section, /pannesDeSuite >= PANNES_DE_SUITE_MAX/);
    assert.match(source, /BUDGET_VENDEURS_MS = 45_000/);
    assert.match(source, /maxNetworkRetries: 1, timeout: 8000/);
    // Garde-fou évalué avant toute écriture, et transmis à chaque écriture.
    const garde = section.indexOf("effacementsSuspects(");
    const ecriture = section.indexOf("appliquerSynchroConnect(");
    assert.ok(garde > 0 && ecriture > garde, "le garde-fou doit précéder les écritures");
    assert.match(section, /appliquerSynchroConnect\(connectDeps, profil, lecture, \{ effacer: !suspect \}\)/);
    assert.match(section, /severity: "critique"/);
    // Aucune lecture Stripe dans la boucle d'écriture.
    assert.doesNotMatch(section.slice(ecriture), /lireCompteConnect\(|synchroniserProfilConnect\(/);
  });
});

/* ================================================================== *
 *  Enregistrer un compte neuf sans écraser celui qu'on n'a pas vu
 * ================================================================== */

describe("enregistrement d'un compte vendeur neuf", () => {
  function base(options: { modifie?: boolean; erreur?: boolean; actuel?: string | null; erreurLecture?: boolean }) {
    const poses: Array<{ id: string; ancien: string | null; nouveau: string }> = [];
    const db: EnregistrementDbLike = {
      poserCompte(id, ancien, nouveau) {
        poses.push({ id, ancien, nouveau });
        return Promise.resolve({
          error: options.erreur ? { message: "connexion perdue" } : null,
          modifie: options.modifie ?? true,
        });
      },
      compteActuel() {
        return Promise.resolve({
          error: options.erreurLecture ? { message: "lecture impossible" } : null,
          compte: options.actuel ?? null,
        });
      },
    };
    return { db, poses };
  }

  test("remplacement : le neuf est posé à la place de l'ancien, en une seule écriture", async () => {
    const { db, poses } = base({});
    assert.equal(await enregistrerCompteConnect(db, "u1", "acct_ancien", "acct_neuf"), "enregistre");
    assert.deepEqual(poses, [{ id: "u1", ancien: "acct_ancien", nouveau: "acct_neuf" }]);
  });

  test("écriture en échec : l'erreur remonte, l'ancien reste en base pour le prochain essai", async () => {
    const { db } = base({ erreur: true });
    await assert.rejects(() => enregistrerCompteConnect(db, "u1", "acct_ancien", "acct_neuf"), /connexion perdue/);
  });

  test("double clic : le même compte déjà posé par la requête jumelle", async () => {
    const { db } = base({ modifie: false, actuel: "acct_neuf" });
    assert.equal(await enregistrerCompteConnect(db, "u1", null, "acct_neuf"), "deja_enregistre");
  });

  test("un autre compte posé entre-temps : conflit signalé, rien n'est écrasé", async () => {
    const { db, poses } = base({ modifie: false, actuel: "acct_autre" });
    assert.deepEqual(await enregistrerCompteConnect(db, "u1", "acct_ancien", "acct_neuf"), { conflit: "acct_autre" });
    assert.equal(poses.length, 1);
  });

  test("relecture impossible après une écriture sans effet : l'erreur remonte", async () => {
    const { db } = base({ modifie: false, erreurLecture: true });
    await assert.rejects(() => enregistrerCompteConnect(db, "u1", null, "acct_neuf"), /lecture impossible/);
  });
});

describe("adaptateur Supabase des profils vendeurs", () => {
  /** Enregistre la chaîne d'appels faite sur le constructeur de requêtes. */
  function client(lignes: unknown[] = [{ id: "u1" }]) {
    const appels: string[] = [];
    const requete = {
      eq(c: string, v: unknown) { appels.push(`eq(${c},${v})`); return requete; },
      is(c: string, v: unknown) { appels.push(`is(${c},${v})`); return requete; },
      or(f: string) { appels.push(`or(${f})`); return requete; },
      select(c: string) { appels.push(`select(${c})`); return requete; },
      maybeSingle() { appels.push("maybeSingle"); return Promise.resolve({ data: { stripe_account_id: "acct_x" }, error: null }); },
      then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
        return Promise.resolve({ data: lignes, error: null }).then(ok, ko);
      },
    };
    const c = {
      from(table: string) {
        appels.push(`from(${table})`);
        return {
          update(patch: Record<string, unknown>) { appels.push(`update(${JSON.stringify(patch)})`); return requete; },
          select(cols: string) { appels.push(`select(${cols})`); return requete; },
        };
      },
    };
    return { c: c as unknown as SupabaseLike, appels };
  }

  test("l'effacement est conditionné à l'identifiant lu, et dit s'il a touché une ligne", async () => {
    const { c, appels } = client([{ id: "u1" }]);
    const r = await profilsConnect(c).majProfil("u1", "acct_lu", { stripe_account_id: null });
    assert.equal(r.modifie, true);
    assert.ok(appels.includes("eq(id,u1)"));
    assert.ok(appels.includes("eq(stripe_account_id,acct_lu)"));
    assert.ok(appels.includes("select(id)"), "sans select, on ne saurait pas si une ligne a bougé");

    const vide = await profilsConnect(client([]).c).majProfil("u1", "acct_lu", {});
    assert.equal(vide.modifie, false);
  });

  test("le compte neuf n'est posé que sur l'ancien ou sur un profil vide", async () => {
    const remplacement = client();
    await profilsConnect(remplacement.c).poserCompte("u1", "acct_1Ancien", "acct_1Neuf");
    assert.ok(remplacement.appels.includes("or(stripe_account_id.is.null,stripe_account_id.eq.acct_1Ancien)"));
    assert.ok(remplacement.appels.some((a) => a.startsWith("update(") && a.includes('"stripe_onboarded":false')));

    const premier = client();
    await profilsConnect(premier.c).poserCompte("u1", null, "acct_1Neuf");
    assert.ok(premier.appels.includes("is(stripe_account_id,null)"));
    assert.ok(!premier.appels.some((a) => a.startsWith("or(")));
  });

  test("un identifiant inattendu n'entre jamais dans un filtre écrit en texte", async () => {
    const { c } = client();
    await assert.rejects(
      () => profilsConnect(c).poserCompte("u1", "acct_1,id.neq.0", "acct_1Neuf"), /identifiant de compte inattendu/);
  });
});
