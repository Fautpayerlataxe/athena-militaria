/**
 * Traitement d'un paiement, bout en bout, avec Stripe et Supabase simulés.
 *
 * Ce que ces tests garantissent concrètement :
 *   - un webhook rejoué dix fois n'envoie qu'un email et n'encaisse qu'une fois
 *   - dix appels réellement concurrents ne produisent qu'un seul traitement
 *   - un paiement non réglé ne déclenche jamais de traitement
 *   - une erreur d'écriture remonte, pour que le webhook réponde 500 et que
 *     Stripe rejoue (l'ancienne version répondait 200 et perdait la commande)
 *   - la page de confirmation et le webhook partagent exactement le même chemin
 *
 * La base est simulée : ces tests valident la couche TypeScript, pas les
 * fonctions SQL. Les invariants SQL sont couverts par sql-contract.test.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  chargeIdFrom,
  fulfillCheckoutSession,
  settlePayloadFrom,
  type FulfillDeps,
} from "../supabase/functions/_shared/fulfillment.ts";

type Loose = Record<string, unknown>;

function session(overrides: Loose = {}): Loose {
  return {
    id: "cs_test_abc123",
    client_reference_id: "order-1",
    payment_status: "paid",
    amount_total: 5390,
    currency: "eur",
    customer_details: { email: "acheteur@example.com", name: "Jean Test" },
    shipping_details: { name: "Jean Test", address: { line1: "1 rue de la Paix", postal_code: "75002", city: "Paris", country: "FR" } },
    payment_intent: { id: "pi_test_1", latest_charge: "ch_test_1" },
    metadata: {
      order_id: "order-1",
      product_id: "42",
      seller_id: "seller-uuid",
      buyer_id: "buyer-uuid",
      shipping_method: "post",
      relay_postal: "",
    },
    ...overrides,
  };
}

/**
 * Base simulée. Le point critique est `settled` : il modélise ce que garantit
 * le verrou de ligne de la fonction SQL order_settle_payment, à savoir qu'une
 * seule exécution peut faire la transition vers « payée ». Le basculement est
 * synchrone, donc atomique du point de vue de la boucle d'événements : c'est
 * exactement la propriété que le SQL doit fournir.
 */
function makeDb(options: { failOn?: string; paymentStatus?: string } = {}) {
  const calls: Array<{ name: string; args: Loose }> = [];
  let settled = false;

  const db = {
    calls,
    rpc(name: string, args: Loose) {
      calls.push({ name, args });
      if (options.failOn === name) {
        return Promise.resolve({ data: null, error: { message: "connexion perdue" } });
      }
      if (name !== "order_settle_payment") return Promise.resolve({ data: null, error: null });

      const payload = (args.p_payload ?? {}) as Loose;
      const paid = payload.payment_status === "paid" || payload.payment_status === "no_payment_required";

      let firstTime = false;
      if (paid && !settled) {
        settled = true;      // basculement synchrone : le second appelant le voit
        firstTime = true;
      }

      return Promise.resolve({
        data: {
          first_time: firstTime,
          order: {
            id: "order-1",
            product_id: 42,
            seller_id: "seller-uuid",
            buyer_id: "buyer-uuid",
            customer_email: payload.customer_email,
            status: paid ? "paid" : "payment_pending",
            amount_total_cents: payload.amount_total_cents,
            shipping_method: payload.shipping_method,
            shipping_address: payload.shipping_address,
            stripe_payment_intent_id: payload.payment_intent_id,
          },
        },
        error: null,
      });
    },
    productTitle() {
      return Promise.resolve({ title: "Casque Adrian 1915", sellerId: "seller-uuid" });
    },
    sellerEmail() {
      return Promise.resolve("vendeur@example.com");
    },
  };
  return db;
}

function makeDeps(sessionOverrides: Loose = {}, dbOptions: Parameters<typeof makeDb>[0] = {}) {
  const emails: Array<{ to: string; subject: string; body: string }> = [];
  const retrieved: string[] = [];
  const db = makeDb(dbOptions);

  const deps: FulfillDeps = {
    stripe: {
      checkout: {
        sessions: {
          retrieve(id: string) {
            retrieved.push(id);
            return Promise.resolve(session(sessionOverrides));
          },
        },
      },
    },
    db: db as unknown as FulfillDeps["db"],
    sendEmail(to, subject, body) {
      emails.push({ to, subject, body });
      return Promise.resolve();
    },
    // defer non fourni : les emails sont attendus, pour que les tests soient
    // déterministes.
  };

  return { deps, emails, db, retrieved };
}

/* ================================================================== *
 *  Cas nominal
 * ================================================================== */

test("paiement réussi : une commande encaissée, deux emails, une seule fois", async () => {
  const { deps, emails, db, retrieved } = makeDeps();

  const outcome = await fulfillCheckoutSession(deps, "cs_test_abc123");

  assert.equal(outcome.status, "fulfilled");
  assert.equal(outcome.firstTime, true);
  assert.equal(outcome.order?.status, "paid");

  // L'état vient de Stripe, pas de la charge utile de l'événement.
  assert.deepEqual(retrieved, ["cs_test_abc123"]);

  const settle = db.calls.filter((c) => c.name === "order_settle_payment");
  assert.equal(settle.length, 1);

  assert.equal(emails.length, 2);
  assert.equal(emails[0].to, "acheteur@example.com");
  assert.equal(emails[1].to, "vendeur@example.com");
  // Le montant affiché vient des centimes renvoyés par Stripe.
  assert.match(emails[0].body, /53,90 €/);
});

/* ================================================================== *
 *  Rejeux et concurrence
 * ================================================================== */

test("webhook rejoué dix fois : un seul encaissement, un seul jeu d'emails", async () => {
  const { deps, emails } = makeDeps();

  for (let i = 0; i < 10; i++) {
    const outcome = await fulfillCheckoutSession(deps, "cs_test_abc123");
    assert.equal(outcome.status, "fulfilled");
    assert.equal(outcome.firstTime, i === 0, `appel ${i + 1}`);
  }

  assert.equal(emails.length, 2, "un rejeu ne doit pas renvoyer de confirmation");
});

test("dix appels réellement concurrents : un seul traitement", async () => {
  const { deps, emails } = makeDeps();

  const outcomes = await Promise.all(
    Array.from({ length: 10 }, () => fulfillCheckoutSession(deps, "cs_test_abc123")),
  );

  assert.equal(outcomes.filter((o) => o.firstTime).length, 1);
  assert.equal(emails.length, 2);
});

test("webhook et page de confirmation en même temps : un seul traitement", async () => {
  // Les deux chemins appellent la même fonction : c'est précisément ce qui
  // rend la double source (webhook + retour navigateur) sans danger.
  const { deps, emails } = makeDeps();

  const [webhook, successPage] = await Promise.all([
    fulfillCheckoutSession(deps, "cs_test_abc123"),
    fulfillCheckoutSession(deps, "cs_test_abc123"),
  ]);

  assert.equal([webhook, successPage].filter((o) => o.firstTime).length, 1);
  assert.equal(emails.length, 2);
});

/* ================================================================== *
 *  Paiement non abouti
 * ================================================================== */

test("payment_status = unpaid : aucun traitement, aucun email", async () => {
  const { deps, emails } = makeDeps({ payment_status: "unpaid" });

  const outcome = await fulfillCheckoutSession(deps, "cs_test_abc123");

  assert.equal(outcome.status, "pending_payment");
  assert.equal(outcome.firstTime, false);
  assert.equal(outcome.order?.status, "payment_pending");
  assert.equal(emails.length, 0, "une commande non encaissée ne doit rien déclencher");
});

test("un paiement différé passe à traité quand il aboutit, sans doubler les emails", async () => {
  // Premier passage : checkout.session.completed avec payment_status unpaid.
  const db = makeDb();
  const emails: Array<{ to: string }> = [];
  let paymentStatus = "unpaid";

  const deps: FulfillDeps = {
    stripe: {
      checkout: { sessions: { retrieve: () => Promise.resolve(session({ payment_status: paymentStatus })) } },
    },
    db: db as unknown as FulfillDeps["db"],
    sendEmail: (to) => { emails.push({ to }); return Promise.resolve(); },
  };

  const first = await fulfillCheckoutSession(deps, "cs_test_abc123");
  assert.equal(first.status, "pending_payment");
  assert.equal(emails.length, 0);

  // Second passage : checkout.session.async_payment_succeeded.
  paymentStatus = "paid";
  const second = await fulfillCheckoutSession(deps, "cs_test_abc123");
  assert.equal(second.status, "fulfilled");
  assert.equal(second.firstTime, true);
  assert.equal(emails.length, 2);

  // Troisième passage (rejeu Stripe) : plus rien.
  const third = await fulfillCheckoutSession(deps, "cs_test_abc123");
  assert.equal(third.firstTime, false);
  assert.equal(emails.length, 2);
});

test("no_payment_required est traité comme réglé", async () => {
  const { deps, emails } = makeDeps({ payment_status: "no_payment_required" });
  const outcome = await fulfillCheckoutSession(deps, "cs_test_abc123");
  assert.equal(outcome.status, "fulfilled");
  assert.equal(emails.length, 2);
});

/* ================================================================== *
 *  Pannes
 * ================================================================== */

test("échec d'écriture : l'erreur remonte pour que Stripe rejoue", async () => {
  const { deps, emails } = makeDeps({}, { failOn: "order_settle_payment" });

  await assert.rejects(
    () => fulfillCheckoutSession(deps, "cs_test_abc123"),
    /order_settle_payment/,
  );
  assert.equal(emails.length, 0, "aucun email tant que la commande n'est pas écrite");
});

test("panne Stripe à la relecture : l'erreur remonte, rien n'est écrit", async () => {
  const db = makeDb();
  const deps: FulfillDeps = {
    stripe: {
      checkout: { sessions: { retrieve: () => Promise.reject(new Error("StripeConnectionError")) } },
    },
    db: db as unknown as FulfillDeps["db"],
    sendEmail: () => Promise.resolve(),
  };

  await assert.rejects(() => fulfillCheckoutSession(deps, "cs_test_abc123"), /StripeConnectionError/);
  assert.equal(db.calls.length, 0);
});

test("un email qui échoue ne remet pas la commande en cause", async () => {
  const db = makeDb();
  const deps: FulfillDeps = {
    stripe: { checkout: { sessions: { retrieve: () => Promise.resolve(session()) } } },
    db: db as unknown as FulfillDeps["db"],
    sendEmail: () => Promise.reject(new Error("Resend indisponible")),
  };

  // L'argent est encaissé et la commande écrite : faire échouer le webhook
  // provoquerait un rejeu, donc un second décrément de stock tenté pour rien.
  const outcome = await fulfillCheckoutSession(deps, "cs_test_abc123");
  assert.equal(outcome.status, "fulfilled");
  assert.equal(outcome.firstTime, true);
});

/* ================================================================== *
 *  Charge utile envoyée à la base
 * ================================================================== */

test("la charge utile ne contient que des valeurs venues de Stripe", () => {
  const payload = settlePayloadFrom(session()) as { p_payload: Loose };
  const p = payload.p_payload;

  assert.equal(p.order_id, "order-1");
  assert.equal(p.session_id, "cs_test_abc123");
  assert.equal(p.payment_intent_id, "pi_test_1");
  assert.equal(p.charge_id, "ch_test_1");
  assert.equal(p.amount_total_cents, 5390);
  assert.equal(p.currency, "eur");
  assert.equal(p.payment_status, "paid");
  assert.equal(p.customer_email, "acheteur@example.com");
  assert.deepEqual(p.shipping_address, {
    name: "Jean Test", line1: "1 rue de la Paix", line2: null,
    postal_code: "75002", city: "Paris", state: null, country: "FR",
  });
});

test("une session sans payment_status est considérée non réglée", () => {
  const payload = settlePayloadFrom(session({ payment_status: undefined })) as { p_payload: Loose };
  assert.equal(payload.p_payload.payment_status, "unpaid");
});

test("un montant absent ou aberrant ne devient jamais zéro par accident", () => {
  const missing = settlePayloadFrom(session({ amount_total: undefined })) as { p_payload: Loose };
  assert.equal(missing.p_payload.amount_total_cents, null, "null laisse la base garder le montant réservé");

  const nonsense = settlePayloadFrom(session({ amount_total: "gratuit" })) as { p_payload: Loose };
  assert.equal(nonsense.p_payload.amount_total_cents, null);
});

test("le charge est retrouvé quel que soit la forme du PaymentIntent", () => {
  assert.equal(chargeIdFrom({ payment_intent: { id: "pi_1", latest_charge: "ch_1" } }), "ch_1");
  assert.equal(chargeIdFrom({ payment_intent: { id: "pi_1", latest_charge: { id: "ch_2" } } }), "ch_2");
  assert.equal(chargeIdFrom({ payment_intent: { id: "pi_1", charges: { data: [{ id: "ch_3" }] } } }), "ch_3");
  // Non développé : pas de charge, et surtout pas d'invention.
  assert.equal(chargeIdFrom({ payment_intent: "pi_1" }), null);
  assert.equal(chargeIdFrom({}), null);
});
