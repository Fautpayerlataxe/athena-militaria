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
