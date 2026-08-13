/**
 * Tests contre un VRAI PostgreSQL 17, la même majeure qu'en production.
 *
 * Tout l'historique du schéma est rejoué sur une base neuve : scripts
 * d'installation, puis les 22 migrations, dont celle de durcissement. Ce que
 * ces tests observent est donc le comportement réel de Postgres — verrous,
 * contraintes, triggers, RLS, plpgsql — et non une réimplémentation.
 *
 * C'est la différence avec la première campagne : elle vérifiait que des
 * chaînes de caractères étaient présentes dans un fichier SQL. Celle-ci
 * exécute le SQL et regarde ce qui se passe.
 *
 * Les connexions sont réellement concurrentes : deux acheteurs simultanés sur
 * le dernier exemplaire sont deux connexions Postgres distinctes, sérialisées
 * par le moteur, pas par une simulation.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { startPostgres, stopPostgres } from "./helpers/postgres.mjs";
import { migrateFresh, connectAs, connectService } from "./helpers/migrate.mjs";

let config: any;
let db: pg.Client;

/* ------------------------------------------------------------------ *
 *  Fixtures
 * ------------------------------------------------------------------ */

async function newUser(email: string): Promise<string> {
  const r = await db.query("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [email]);
  return r.rows[0].id;
}

async function newSeller(email: string, onboarded = true): Promise<string> {
  const id = await newUser(email);
  await db.query(
    `UPDATE profiles SET stripe_account_id = $2, stripe_onboarded = $3 WHERE id = $1`,
    [id, "acct_test_" + id.slice(0, 8), onboarded],
  );
  return id;
}

async function newProduct(sellerId: string, opts: Record<string, unknown> = {}): Promise<number> {
  const o = {
    price: 45.0, quantity: 1, status: "published",
    ship_pickup: true, ship_post: true, ship_relay: true, ...opts,
  };
  const r = await db.query(
    `INSERT INTO products (user_id, title, period, subcategory, condition, description,
                           price, quantity, status, ship_pickup, ship_post, ship_relay)
     VALUES ($1,'Casque Adrian','1ère Guerre Mondiale','Uniformes','Bon','desc',
             $2,$3,$4,$5,$6,$7) RETURNING id`,
    [sellerId, o.price, o.quantity, o.status, o.ship_pickup, o.ship_post, o.ship_relay],
  );
  return r.rows[0].id;
}

async function reserve(productId: number, buyerId: string, method = "post", postal: string | null = null) {
  const r = await db.query(
    "SELECT * FROM checkout_reserve($1,$2,$3,$4,$5) AS o",
    [productId, buyerId, method, postal, "acheteur@test.local"],
  );
  return r.rows[0];
}

/** Charge utile telle que la produit l'edge function à partir d'une session
 *  Stripe relue. Les champs sont ceux de settlePayloadFrom(). */
function settlePayload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    order_id: null, session_id: "cs_test_1", payment_intent_id: "pi_test_1",
    charge_id: "ch_test_1", payment_status: "paid", amount_total_cents: 5390,
    currency: "eur", customer_email: "acheteur@test.local",
    product_id: null, seller_id: null, buyer_id: null,
    shipping_method: "post", relay_postal: null,
    shipping_address: { name: "Jean", line1: "1 rue X", postal_code: "75002", city: "Paris", country: "FR" },
    ...over,
  });
}

async function settle(over: Record<string, unknown> = {}) {
  const r = await db.query("SELECT order_settle_payment($1::jsonb) AS result", [settlePayload(over)]);
  return r.rows[0].result;
}

async function product(id: number) {
  return (await db.query("SELECT * FROM products WHERE id=$1", [id])).rows[0];
}
async function order(id: string) {
  return (await db.query("SELECT * FROM orders WHERE id=$1", [id])).rows[0];
}

before(async () => {
  await startPostgres();
  const migrated = await migrateFresh("am2_payments");
  config = migrated.config;
  db = await connectService(config);
}, { timeout: 180_000 });

after(async () => {
  if (db) await db.end();
  await stopPostgres();
});

/* ================================================================== *
 *  1. Le schéma est bien celui qu'on croit
 * ================================================================== */

describe("schéma réellement créé", () => {
  test("products.quantity accepte zéro, et le refus de négatif tient", async () => {
    const seller = await newSeller("s1@test.local");
    const p = await newProduct(seller);
    await db.query("UPDATE products SET quantity = 0 WHERE id=$1", [p]);
    assert.equal((await product(p)).quantity, 0);

    await assert.rejects(
      () => db.query("UPDATE products SET quantity = -1 WHERE id=$1", [p]),
      /products_quantity_check/,
    );
  });

  test("un même PaymentIntent ne peut pas financer deux commandes", async () => {
    const seller = await newSeller("s2@test.local");
    const p = await newProduct(seller);
    const buyer = await newUser("b2@test.local");
    await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_payment_intent_id)
       VALUES ($1,$2,$3,'paid',10,'pi_unique_test')`, [p, buyer, seller]);

    await assert.rejects(
      () => db.query(
        `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_payment_intent_id)
         VALUES ($1,$2,$3,'paid',10,'pi_unique_test')`, [p, buyer, seller]),
      /orders_payment_intent_uniq/,
    );

    // Mais plusieurs commandes sans PaymentIntent restent possibles : l'index
    // est partiel, sinon deux réservations en attente entreraient en conflit.
    await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount)
       VALUES ($1,$2,$3,'pending',10), ($1,$2,$3,'pending',10)`, [p, buyer, seller]);
  });

  test("toutes les fonctions financières sont SECURITY DEFINER avec search_path figé", async () => {
    const r = await db.query(`
      SELECT proname, prosecdef, proconfig FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND proname = ANY($1::text[])`,
      [["checkout_reserve", "checkout_release", "checkout_attach_session", "checkout_expire_stale",
        "order_settle_payment", "order_mark_payment_failed", "order_apply_refund",
        "order_mark_chargeback", "stripe_event_claim", "stripe_event_finish",
        "order_mark_shipped", "order_confirm_receipt", "order_report_dispute"]]);

    assert.equal(r.rows.length, 13);
    for (const fn of r.rows) {
      assert.equal(fn.prosecdef, true, `${fn.proname} n'est pas SECURITY DEFINER`);
      // search_path figé : sans cela, un schéma placé devant public par
      // l'appelant pourrait détourner les tables lues par la fonction.
      assert.ok(
        (fn.proconfig ?? []).some((c: string) => c.startsWith("search_path=")),
        `${fn.proname} n'a pas de search_path figé`,
      );
    }
  });

  test("la tâche de libération des réservations est planifiée", async () => {
    const r = await db.query("SELECT schedule, command FROM cron.job WHERE jobname='checkout-expire-stale'");
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].schedule, "*/5 * * * *");
    assert.match(r.rows[0].command, /checkout_expire_stale/);
  });
});

/* ================================================================== *
 *  2. L'invariant central : un article payé n'est plus achetable
 * ================================================================== */

describe("invariant de stock", () => {
  test("quantité 1 → payé → quantité 0 → statut vendu → non réservable", async () => {
    const seller = await newSeller("s3@test.local");
    const buyer = await newUser("b3@test.local");
    const p = await newProduct(seller, { quantity: 1 });

    const o = await reserve(p, buyer);
    assert.equal(o.status, "pending");
    assert.equal((await product(p)).reserved_qty, 1, "la réservation doit retirer l'article du stock disponible");

    const result = await settle({ order_id: o.id, session_id: "cs_inv_1", payment_intent_id: "pi_inv_1" });
    assert.equal(result.first_time, true);
    assert.equal(result.order.status, "paid");

    const after = await product(p);
    assert.equal(after.quantity, 0, "le stock doit être consommé");
    assert.equal(after.reserved_qty, 0, "la réservation doit être libérée");
    assert.equal(after.status, "sold", "c'est cette écriture qui échouait avec l'ancienne contrainte");
    assert.ok(after.sold_at, "sold_at doit être posé");

    // Et surtout : plus personne ne peut l'acheter.
    const other = await newUser("b3b@test.local");
    await assert.rejects(() => reserve(p, other), /PRODUCT_NOT_AVAILABLE/);
  });

  test("quantité 3 : trois ventes possibles, la quatrième refusée", async () => {
    const seller = await newSeller("s4@test.local");
    const p = await newProduct(seller, { quantity: 3 });

    for (let i = 0; i < 3; i++) {
      const buyer = await newUser(`b4_${i}@test.local`);
      const o = await reserve(p, buyer);
      await settle({ order_id: o.id, session_id: `cs_q3_${i}`, payment_intent_id: `pi_q3_${i}` });
    }

    const after = await product(p);
    assert.equal(after.quantity, 0);
    assert.equal(after.status, "sold");

    const late = await newUser("b4_late@test.local");
    await assert.rejects(() => reserve(p, late), /PRODUCT_NOT_AVAILABLE/);
  });

  test("le vendeur ne peut pas remettre à zéro le stock réservé", async () => {
    const seller = await newSeller("s5@test.local");
    const buyer = await newUser("b5@test.local");
    const p = await newProduct(seller);
    await reserve(p, buyer);
    assert.equal((await product(p)).reserved_qty, 1);

    // Le vendeur agit avec le rôle authenticated, comme depuis le navigateur.
    const asSeller = await connectAs(config, "authenticated", { sub: seller, role: "authenticated" });
    await asSeller.query("UPDATE products SET reserved_qty = 0, quantity = 99 WHERE id=$1", [p]);
    await asSeller.end();

    const after = await product(p);
    assert.equal(after.reserved_qty, 1, "reserved_qty doit résister à une écriture du vendeur");
    assert.equal(after.quantity, 99, "la quantité, elle, reste sous son contrôle légitime");
  });
});

/* ================================================================== *
 *  3. Concurrence réelle
 * ================================================================== */

describe("concurrence", () => {
  test("deux acheteurs simultanés sur le dernier exemplaire : un seul passe", async () => {
    const seller = await newSeller("s6@test.local");
    const buyerA = await newUser("a6@test.local");
    const buyerB = await newUser("b6@test.local");
    const p = await newProduct(seller, { quantity: 1 });

    // Deux connexions Postgres distinctes, lancées ensemble. Le verrou de
    // ligne du produit les sérialise : la seconde voit le stock déjà pris.
    const [ca, cb] = [new pg.Client(config), new pg.Client(config)];
    await Promise.all([ca.connect(), cb.connect()]);

    const call = (c: pg.Client, buyer: string) =>
      c.query("SELECT * FROM checkout_reserve($1,$2,'post',NULL,'x@test.local') AS o", [p, buyer])
        .then((r) => ({ ok: true, order: r.rows[0] }))
        .catch((e) => ({ ok: false, error: e.message }));

    const results = await Promise.all([call(ca, buyerA), call(cb, buyerB)]);
    await Promise.all([ca.end(), cb.end()]);

    const winners = results.filter((r: any) => r.ok);
    const losers = results.filter((r: any) => !r.ok);

    assert.equal(winners.length, 1, "exactement un acheteur doit réserver");
    assert.equal(losers.length, 1);
    assert.match((losers[0] as any).error, /PRODUCT_RESERVED|PRODUCT_NOT_AVAILABLE/);

    const after = await product(p);
    assert.equal(after.reserved_qty, 1, "une seule unité réservée, pas deux");
    assert.equal(after.quantity, 1, "le stock n'est consommé qu'au paiement");
  });

  test("dix acheteurs simultanés sur un exemplaire unique : un seul passe", async () => {
    const seller = await newSeller("s7@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const buyers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => newUser(`b7_${i}@test.local`)));

    const clients = await Promise.all(
      buyers.map(async () => { const c = new pg.Client(config); await c.connect(); return c; }));

    const results = await Promise.all(clients.map((c, i) =>
      c.query("SELECT * FROM checkout_reserve($1,$2,'post',NULL,'x@test.local') AS o", [p, buyers[i]])
        .then(() => "ok").catch((e) => e.message)));

    await Promise.all(clients.map((c) => c.end()));

    const ok = results.filter((r) => r === "ok");
    assert.equal(ok.length, 1, `attendu 1 réservation, obtenu ${ok.length}`);
    assert.equal((await product(p)).reserved_qty, 1);
  });

  test("dix créations de checkout du même acheteur : une seule réservation", async () => {
    const seller = await newSeller("s8@test.local");
    const buyer = await newUser("b8@test.local");
    const p = await newProduct(seller, { quantity: 1 });

    const clients = await Promise.all(
      Array.from({ length: 10 }, async () => { const c = new pg.Client(config); await c.connect(); return c; }));

    const results = await Promise.all(clients.map((c) =>
      c.query("SELECT * FROM checkout_reserve($1,$2,'post',NULL,'x@test.local') AS o", [p, buyer])
        .then((r) => r.rows[0].id).catch((e) => "ERR:" + e.message)));

    await Promise.all(clients.map((c) => c.end()));

    const ids = new Set(results.filter((r) => !String(r).startsWith("ERR:")));
    // Le double-clic ne doit produire ni dix réservations, ni dix commandes.
    assert.equal(ids.size, 1, `attendu une seule commande, obtenu ${ids.size}`);
    assert.equal((await product(p)).reserved_qty, 1);

    const count = await db.query("SELECT count(*)::int AS n FROM orders WHERE product_id=$1 AND status='pending'", [p]);
    assert.equal(count.rows[0].n, 1);
  });

  test("dix webhooks concurrents sur le même paiement : un seul encaissement", async () => {
    const seller = await newSeller("s9@test.local");
    const buyer = await newUser("b9@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);

    const clients = await Promise.all(
      Array.from({ length: 10 }, async () => { const c = new pg.Client(config); await c.connect(); return c; }));

    const payload = settlePayload({ order_id: o.id, session_id: "cs_conc_1", payment_intent_id: "pi_conc_1" });
    const results = await Promise.all(clients.map((c) =>
      c.query("SELECT order_settle_payment($1::jsonb) AS r", [payload])
        .then((r) => r.rows[0].r.first_time)
        .catch((e) => "ERR:" + e.message)));

    await Promise.all(clients.map((c) => c.end()));

    const firsts = results.filter((r) => r === true);
    assert.equal(firsts.length, 1, `un seul « premier passage » attendu, obtenu ${firsts.length}`);

    const after = await product(p);
    assert.equal(after.quantity, 0, "le stock ne doit être décrémenté qu'une fois");
    assert.equal(after.reserved_qty, 0);

    const orders = await db.query("SELECT count(*)::int AS n FROM orders WHERE product_id=$1", [p]);
    assert.equal(orders.rows[0].n, 1, "une seule commande");
  });

  test("dix réservations d'événement concurrentes : une seule obtient le bail", async () => {
    const clients = await Promise.all(
      Array.from({ length: 10 }, async () => { const c = new pg.Client(config); await c.connect(); return c; }));

    const results = await Promise.all(clients.map((c) =>
      c.query("SELECT stripe_event_claim($1,$2,$3,$4) AS r", ["evt_conc_1", "checkout.session.completed", true, "2023-10-16"])
        .then((r) => r.rows[0].r)
        .catch((e) => "ERR:" + e.message)));

    await Promise.all(clients.map((c) => c.end()));

    const claimed = results.filter((r) => r === "claimed");
    assert.equal(claimed.length, 1, `un seul « claimed » attendu, obtenu ${claimed.length}`);
    assert.ok(results.every((r) => r === "claimed" || r === "busy"), "les autres doivent être « busy », jamais « settled »");
  });
});

/* ================================================================== *
 *  4. Idempotence des webhooks
 * ================================================================== */

describe("idempotence", () => {
  test("dix rejeux séquentiels du même paiement : un seul encaissement", async () => {
    const seller = await newSeller("s10@test.local");
    const buyer = await newUser("b10@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);

    const firsts: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await settle({ order_id: o.id, session_id: "cs_rep_1", payment_intent_id: "pi_rep_1" });
      firsts.push(r.first_time);
    }

    assert.deepEqual(firsts, [true, ...Array(9).fill(false)]);
    assert.equal((await product(p)).quantity, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM orders WHERE product_id=$1", [p])).rows[0].n, 1);
  });

  test("un événement terminé est reconnu comme tel, un événement inconnu est réservable", async () => {
    const first = await db.query("SELECT stripe_event_claim($1,$2) AS r", ["evt_seq_1", "charge.refunded"]);
    assert.equal(first.rows[0].r, "claimed");

    const busy = await db.query("SELECT stripe_event_claim($1,$2) AS r", ["evt_seq_1", "charge.refunded"]);
    assert.equal(busy.rows[0].r, "busy", "encore sous bail : Stripe doit repasser, pas être acquitté");

    await db.query("SELECT stripe_event_finish($1,'done',NULL)", ["evt_seq_1"]);
    const settled = await db.query("SELECT stripe_event_claim($1,$2) AS r", ["evt_seq_1", "charge.refunded"]);
    assert.equal(settled.rows[0].r, "settled", "traité : acquitter est correct");
  });

  test("un événement resté bloqué redevient traitable une fois le bail expiré", async () => {
    await db.query("SELECT stripe_event_claim($1,$2) AS r", ["evt_lease_1", "checkout.session.completed"]);
    // Simule un traitement interrompu par un crash : le bail court toujours.
    await db.query("UPDATE stripe_events SET locked_at = now() - interval '10 minutes' WHERE id=$1", ["evt_lease_1"]);
    const again = await db.query("SELECT stripe_event_claim($1,$2) AS r", ["evt_lease_1", "checkout.session.completed"]);
    assert.equal(again.rows[0].r, "claimed", "sans cela, l'événement serait perdu définitivement");

    const attempts = await db.query("SELECT attempts FROM stripe_events WHERE id=$1", ["evt_lease_1"]);
    assert.equal(attempts.rows[0].attempts, 2);
  });

  test("un paiement sans commande en base est quand même enregistré, et signalé", async () => {
    const seller = await newSeller("s11@test.local");
    const buyer = await newUser("b11@test.local");
    const p = await newProduct(seller, { quantity: 1 });

    const r = await settle({
      session_id: "cs_orphan_1", payment_intent_id: "pi_orphan_1",
      product_id: String(p), seller_id: seller, buyer_id: buyer,
    });

    assert.equal(r.first_time, true);
    assert.equal(r.order.status, "paid");
    assert.equal(r.order.needs_review, true, "l'argent est arrivé sans commande : cela demande une vérification");
    assert.match(r.order.review_reason, /absente en base/);
    assert.equal((await product(p)).quantity, 0);
  });

  test("un montant différent de celui réservé encaisse quand même, mais part en revue", async () => {
    const seller = await newSeller("s12@test.local");
    const buyer = await newUser("b12@test.local");
    const p = await newProduct(seller, { price: 45.0, quantity: 1 });
    const o = await reserve(p, buyer);

    const r = await settle({
      order_id: o.id, session_id: "cs_mismatch", payment_intent_id: "pi_mismatch",
      amount_total_cents: 100,
    });

    assert.equal(r.order.status, "paid", "l'argent est chez Stripe : on ne le perd pas");
    assert.equal(r.order.needs_review, true);
    assert.match(r.order.review_reason, /Montant Stripe/);
  });

  test("payment_status unpaid n'encaisse pas et ne consomme pas de stock", async () => {
    const seller = await newSeller("s13@test.local");
    const buyer = await newUser("b13@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);

    const r = await settle({
      order_id: o.id, session_id: "cs_unpaid", payment_intent_id: "pi_unpaid",
      payment_status: "unpaid",
    });

    assert.equal(r.first_time, false);
    assert.equal(r.order.status, "payment_pending");
    const after = await product(p);
    assert.equal(after.quantity, 1, "aucun stock consommé tant que le paiement n'est pas confirmé");
    assert.equal(after.reserved_qty, 1, "mais la réservation tient toujours");

    // Puis le paiement différé aboutit.
    const ok = await settle({ order_id: o.id, session_id: "cs_unpaid", payment_intent_id: "pi_unpaid" });
    assert.equal(ok.first_time, true);
    assert.equal((await product(p)).quantity, 0);
  });
});

/* ================================================================== *
 *  5. Expiration et libération
 * ================================================================== */

describe("expiration des réservations", () => {
  test("une réservation expirée libère le stock, et l'article redevient achetable", async () => {
    const seller = await newSeller("s14@test.local");
    const buyerA = await newUser("a14@test.local");
    const buyerB = await newUser("b14@test.local");
    const p = await newProduct(seller, { quantity: 1 });

    const o = await reserve(p, buyerA);
    assert.equal((await product(p)).reserved_qty, 1);

    // B ne peut pas réserver tant que A tient la place.
    await assert.rejects(() => reserve(p, buyerB), /PRODUCT_RESERVED/);

    // Le temps passe : A n'a jamais payé.
    await db.query("UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id=$1", [o.id]);
    const released = await db.query("SELECT checkout_expire_stale(NULL) AS n");
    assert.equal(released.rows[0].n, 1);

    assert.equal((await product(p)).reserved_qty, 0);
    assert.equal((await order(o.id)).status, "expired");

    const ob = await reserve(p, buyerB);
    assert.equal(ob.status, "pending");
  });

  test("libérer deux fois n'invente pas de stock", async () => {
    const seller = await newSeller("s15@test.local");
    const buyer = await newUser("b15@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);

    assert.equal((await db.query("SELECT checkout_release($1,'expired') AS r", [o.id])).rows[0].r, true);
    assert.equal((await product(p)).reserved_qty, 0);

    // Rejeu du webhook checkout.session.expired, ou passage du cron.
    assert.equal((await db.query("SELECT checkout_release($1,'expired') AS r", [o.id])).rows[0].r, false);
    await db.query("SELECT checkout_expire_stale(NULL)");

    const after = await product(p);
    assert.equal(after.reserved_qty, 0, "reserved_qty ne doit jamais passer sous zéro ni remonter");
    assert.equal(after.quantity, 1);
  });

  test("une commande déjà payée ne peut plus être libérée", async () => {
    const seller = await newSeller("s16@test.local");
    const buyer = await newUser("b16@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await settle({ order_id: o.id, session_id: "cs_paidrel", payment_intent_id: "pi_paidrel" });

    // Un checkout.session.expired retardé ne doit pas défaire un paiement.
    const r = await db.query("SELECT checkout_release($1,'expired') AS r", [o.id]);
    assert.equal(r.rows[0].r, false);
    assert.equal((await order(o.id)).status, "paid");
    assert.equal((await product(p)).quantity, 0);
  });

  test("un paiement arrivant après expiration est encaissé et signalé", async () => {
    const seller = await newSeller("s17@test.local");
    const buyer = await newUser("b17@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);

    await db.query("UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id=$1", [o.id]);
    await db.query("SELECT checkout_expire_stale(NULL)");
    assert.equal((await order(o.id)).status, "expired");

    const r = await settle({ order_id: o.id, session_id: "cs_late", payment_intent_id: "pi_late" });
    assert.equal(r.order.status, "paid", "l'argent prime : on ne perd jamais un paiement reçu");
    assert.equal(r.order.needs_review, true);
    assert.match(r.order.review_reason, /après expiration/);
  });

  test("plafond de réservations simultanées par acheteur", async () => {
    const seller = await newSeller("s18@test.local");
    const buyer = await newUser("b18@test.local");
    const products: number[] = [];
    for (let i = 0; i < 6; i++) products.push(await newProduct(seller, { quantity: 1 }));

    for (let i = 0; i < 5; i++) await reserve(products[i], buyer);
    await assert.rejects(() => reserve(products[5], buyer), /TOO_MANY_RESERVATIONS/);
  });
});

/* ================================================================== *
 *  6. Échecs, remboursements, litiges
 * ================================================================== */

describe("échecs et remboursements", () => {
  test("un paiement échoué libère la réservation", async () => {
    const seller = await newSeller("s19@test.local");
    const buyer = await newUser("b19@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await db.query("UPDATE orders SET stripe_session_id='cs_fail_1' WHERE id=$1", [o.id]);

    const r = await db.query("SELECT order_mark_payment_failed($1,$2,$3) AS r",
      ["cs_fail_1", null, "card_declined"]);
    assert.equal(r.rows[0].r.changed, true);
    assert.equal((await order(o.id)).status, "payment_failed");
    assert.equal((await product(p)).reserved_qty, 0, "l'article doit redevenir disponible");
    assert.equal((await product(p)).quantity, 1);
  });

  test("un échec de paiement ne peut pas annuler une commande déjà payée", async () => {
    const seller = await newSeller("s20@test.local");
    const buyer = await newUser("b20@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await settle({ order_id: o.id, session_id: "cs_ord_1", payment_intent_id: "pi_ord_1" });

    // Événement payment_intent.payment_failed arrivé en retard, ou hors ordre.
    const r = await db.query("SELECT order_mark_payment_failed($1,$2,$3) AS r",
      ["cs_ord_1", "pi_ord_1", "expired_card"]);
    assert.equal(r.rows[0].r.changed, false);
    assert.equal((await order(o.id)).status, "paid");
    assert.equal((await product(p)).quantity, 0);
  });

  test("remboursement total : commande remboursée et article remis en vente", async () => {
    const seller = await newSeller("s21@test.local");
    const buyer = await newUser("b21@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await settle({ order_id: o.id, session_id: "cs_ref_1", payment_intent_id: "pi_ref_1", charge_id: "ch_ref_1" });
    assert.equal((await product(p)).status, "sold");

    const r = await db.query("SELECT order_apply_refund($1,$2,$3,$4) AS r",
      ["pi_ref_1", "ch_ref_1", 5390, true]);
    assert.equal(r.rows[0].r.changed, true);

    const after = await order(o.id);
    assert.equal(after.status, "refunded");
    assert.equal(after.amount_refunded_cents, 5390);
    assert.ok(after.refunded_at);

    const prod = await product(p);
    assert.equal(prod.quantity, 1, "l'exemplaire revient en stock");
    assert.equal(prod.status, "published");
    assert.equal(prod.sold_at, null);
  });

  test("remboursement partiel : statut distinct, article non remis en vente", async () => {
    const seller = await newSeller("s22@test.local");
    const buyer = await newUser("b22@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await settle({ order_id: o.id, session_id: "cs_ref_2", payment_intent_id: "pi_ref_2", charge_id: "ch_ref_2" });

    const r = await db.query("SELECT order_apply_refund($1,$2,$3,$4) AS r",
      ["pi_ref_2", "ch_ref_2", 1000, false]);
    assert.equal(r.rows[0].r.changed, true);
    assert.equal((await order(o.id)).status, "partially_refunded");
    assert.equal((await product(p)).status, "sold", "un geste commercial ne remet pas l'objet en vente");
  });

  test("un remboursement rejoué ne change rien", async () => {
    const seller = await newSeller("s23@test.local");
    const buyer = await newUser("b23@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await settle({ order_id: o.id, session_id: "cs_ref_3", payment_intent_id: "pi_ref_3", charge_id: "ch_ref_3" });

    for (let i = 0; i < 5; i++) {
      const r = await db.query("SELECT order_apply_refund($1,$2,$3,$4) AS r", ["pi_ref_3", "ch_ref_3", 5390, true]);
      assert.equal(r.rows[0].r.changed, i === 0, `passage ${i + 1}`);
    }
    // Le stock ne doit pas remonter à chaque rejeu.
    assert.equal((await product(p)).quantity, 1);
  });

  test("deux remboursements concurrents : une seule prise en compte", async () => {
    const seller = await newSeller("s24@test.local");
    const buyer = await newUser("b24@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await settle({ order_id: o.id, session_id: "cs_ref_4", payment_intent_id: "pi_ref_4", charge_id: "ch_ref_4" });

    const clients = await Promise.all(
      Array.from({ length: 5 }, async () => { const c = new pg.Client(config); await c.connect(); return c; }));
    const results = await Promise.all(clients.map((c) =>
      c.query("SELECT order_apply_refund($1,$2,$3,$4) AS r", ["pi_ref_4", "ch_ref_4", 5390, true])
        .then((r) => r.rows[0].r.changed).catch(() => "ERR")));
    await Promise.all(clients.map((c) => c.end()));

    assert.equal(results.filter((r) => r === true).length, 1);
    assert.equal((await product(p)).quantity, 1, "le stock ne remonte qu'une fois");
  });

  test("un litige bancaire n'écrase pas le statut métier et déclenche une revue", async () => {
    const seller = await newSeller("s25@test.local");
    const buyer = await newUser("b25@test.local");
    const p = await newProduct(seller, { quantity: 1 });
    const o = await reserve(p, buyer);
    await settle({ order_id: o.id, session_id: "cs_dis_1", payment_intent_id: "pi_dis_1", charge_id: "ch_dis_1" });
    await db.query("SELECT order_mark_shipped($1,'TRK1',NULL)", [o.id]).catch(() => {});
    await db.query("UPDATE orders SET status='shipped' WHERE id=$1", [o.id]);

    const r = await db.query("SELECT order_mark_chargeback($1,$2,$3,$4) AS r",
      ["pi_dis_1", "ch_dis_1", "needs_response", "fraudulent"]);
    assert.equal(r.rows[0].r.changed, true);

    const after = await order(o.id);
    assert.equal(after.status, "shipped", "le statut métier reste ce qu'il est");
    assert.equal(after.chargeback_status, "needs_response");
    assert.equal(after.needs_review, true);

    // Litige gagné : la commande sort de la file de revue.
    await db.query("SELECT order_mark_chargeback($1,$2,$3,$4) AS r", ["pi_dis_1", "ch_dis_1", "won", "fraudulent"]);
    assert.equal((await order(o.id)).needs_review, false);
  });

  test("la file de réconciliation remonte les commandes douteuses", async () => {
    const rows = await db.query("SELECT * FROM orders_needing_attention()");
    assert.ok(rows.rows.length > 0, "les cas signalés plus haut doivent apparaître");
    assert.ok(rows.rows.every((r: any) => r.reason && r.reason.length > 0));
  });
});

/* ================================================================== *
 *  7. Manipulation des montants
 * ================================================================== */

describe("un client hostile ne peut pas choisir son prix", () => {
  test("le montant vient du produit et des tarifs, jamais de l'appelant", async () => {
    const seller = await newSeller("s26@test.local");
    const buyer = await newUser("b26@test.local");
    const p = await newProduct(seller, { price: 45.0, quantity: 1 });

    const o = await reserve(p, buyer, "post");
    assert.equal(o.product_amount_cents, 4500);
    assert.equal(o.shipping_amount_cents, 890);
    assert.equal(o.amount_total_cents, 5390);
    assert.equal(o.application_fee_cents, 360, "8 % de 45 €, sans commission sur le port");
    assert.equal(o.currency, "eur");

    // La fonction n'accepte aucun paramètre de montant : le vérifier par
    // introspection plutôt que par lecture du fichier.
    const args = await db.query(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND proname='checkout_reserve'`);
    assert.doesNotMatch(args.rows[0].args, /amount|price|total|fee|currency/i);
  });

  test("un article gratuit ou sous le plancher Stripe est refusé proprement", async () => {
    const seller = await newSeller("s27@test.local");
    const buyer = await newUser("b27@test.local");
    const free = await newProduct(seller, { price: 0, quantity: 1, ship_post: false, ship_relay: false });
    await assert.rejects(() => reserve(free, buyer, "pickup"), /AMOUNT_TOO_LOW/);

    // Avec des frais de port, le total repasse au-dessus du plancher.
    const p2 = await newProduct(seller, { price: 0, quantity: 1 });
    const o = await reserve(p2, buyer, "post");
    assert.equal(o.amount_total_cents, 890);
  });

  test("un mode de livraison non proposé par le vendeur est refusé", async () => {
    const seller = await newSeller("s28@test.local");
    const buyer = await newUser("b28@test.local");
    const p = await newProduct(seller, { ship_relay: false, ship_post: false });
    await assert.rejects(() => reserve(p, buyer, "relay", "75001"), /SHIPPING_NOT_OFFERED/);
    await assert.rejects(() => reserve(p, buyer, "post"), /SHIPPING_NOT_OFFERED/);
    const o = await reserve(p, buyer, "pickup");
    assert.equal(o.shipping_amount_cents, 0);
  });

  test("un code postal de point relais invalide est refusé côté base aussi", async () => {
    const seller = await newSeller("s29@test.local");
    const buyer = await newUser("b29@test.local");
    const p = await newProduct(seller);
    for (const bad of ["", "750", "ab#$%", "750019", null]) {
      await assert.rejects(() => reserve(p, buyer, "relay", bad), /RELAY_POSTAL_INVALID/, `code « ${bad} »`);
    }
    const o = await reserve(p, buyer, "relay", "75001");
    assert.equal(o.relay_postal, "75001");
  });

  test("un vendeur ne peut pas acheter son propre article", async () => {
    const seller = await newSeller("s30@test.local");
    const p = await newProduct(seller);
    await assert.rejects(() => reserve(p, seller), /SELF_PURCHASE/);
  });

  test("un brouillon ou un article vendu n'est pas réservable", async () => {
    const seller = await newSeller("s31@test.local");
    const buyer = await newUser("b31@test.local");
    const draft = await newProduct(seller, { status: "draft" });
    await assert.rejects(() => reserve(draft, buyer), /PRODUCT_NOT_AVAILABLE/);

    const p = await newProduct(seller);
    await db.query("UPDATE products SET status='sold', quantity=0 WHERE id=$1", [p]);
    await assert.rejects(() => reserve(p, buyer), /PRODUCT_NOT_AVAILABLE/);
  });

  test("un article inexistant est refusé sans fuite d'information", async () => {
    const buyer = await newUser("b32@test.local");
    await assert.rejects(() => reserve(999999999, buyer), /PRODUCT_NOT_FOUND/);
  });
});
