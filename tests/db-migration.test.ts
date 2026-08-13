/**
 * La migration elle-même : preuve du défaut d'origine, réparation des données,
 * ré-exécution et retour arrière.
 *
 * Le premier test est le plus important du dossier : il reconstruit la base
 * telle qu'elle était AVANT la migration de durcissement et démontre, sur un
 * vrai Postgres, que le défaut signalé existait réellement. Sans lui, la
 * correction reposerait sur une lecture de code.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { startPostgres, stopPostgres, REPO_ROOT } from "./helpers/postgres.mjs";
import { migrateFresh } from "./helpers/migrate.mjs";

const HARDENING = "20260813000000_stripe_hardening.sql";

before(async () => { await startPostgres(); }, { timeout: 180_000 });
after(async () => { await stopPostgres(); });

async function seedSale(db: pg.Client) {
  const seller = (await db.query(
    "INSERT INTO auth.users (email) VALUES ('v@old.local') RETURNING id")).rows[0].id;
  const product = (await db.query(
    `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, ship_post)
     VALUES ($1,'Casque','1GM','Uniformes','Bon',45,1,true) RETURNING id`, [seller])).rows[0].id;
  return { seller, product };
}

/* ================================================================== *
 *  1. Le défaut existait bel et bien
 * ================================================================== */

describe("état antérieur à la migration", () => {
  test("la contrainte quantity >= 1 empêchait réellement de marquer un article vendu", async () => {
    const { config } = await migrateFresh("am2_before", { stopBefore: HARDENING });
    const db = new pg.Client(config);
    await db.connect();

    // supabase_setup.sql a été corrigé lors du premier audit. La base de
    // production, elle, a été créée avec la version d'origine. On la remet
    // telle qu'elle était, en la relisant dans l'historique Git plutôt qu'en
    // la réécrivant de mémoire.
    const original = execSync("git show 094e5f6:supabase_setup.sql", { cwd: REPO_ROOT }).toString();
    const constraint = original.match(/quantity\s+INT NOT NULL DEFAULT 1 CHECK \(quantity >= (\d)\)/);
    assert.notEqual(constraint, null, "impossible de relire le script d'installation d'origine");
    assert.equal(constraint![1], "1", "la production a bien été créée avec CHECK (quantity >= 1)");

    await db.query(`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_quantity_check`);
    await db.query(`ALTER TABLE products ADD CONSTRAINT products_quantity_check CHECK (quantity >= 1)`);

    const { product } = await seedSale(db);

    // Reproduction exacte de ce que faisait l'ancien webhook après paiement :
    //   quantity: Math.max(0, currentQty - 1)  →  0
    //   status: 'sold'
    await assert.rejects(
      () => db.query("UPDATE products SET quantity = 0, status='sold', sold_at=now() WHERE id=$1", [product]),
      /violates check constraint "products_quantity_check"/,
      "l'écriture d'après-paiement devait échouer : c'est le défaut recherché",
    );

    // Et comme l'ancien code ne lisait jamais le résultat, l'article restait
    // en vente après avoir été payé.
    const after = (await db.query("SELECT quantity, status FROM products WHERE id=$1", [product])).rows[0];
    assert.equal(after.quantity, 1);
    assert.equal(after.status, "published", "article payé, toujours achetable");

    await db.end();
  });

  test("rien ne réservait le stock : deux acheteurs pouvaient partir payer le même exemplaire", async () => {
    const { config } = await migrateFresh("am2_before2", { stopBefore: HARDENING });
    const db = new pg.Client(config);
    await db.connect();
    const { product } = await seedSale(db);

    // Avant la migration, aucune fonction de réservation n'existe : la seule
    // chose que faisait le serveur était de lire le produit.
    const exists = await db.query(
      "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='checkout_reserve'");
    assert.equal(exists.rows[0].n, 0, "aucun mécanisme de réservation n'existait");

    const readable = await db.query("SELECT status, quantity FROM products WHERE id=$1", [product]);
    assert.equal(readable.rows[0].status, "published");
    assert.equal(readable.rows[0].quantity, 1);
    // Deux lectures concurrentes voyaient toutes deux l'article disponible :
    // rien n'aurait empêché deux sessions Stripe payables d'être ouvertes.

    await db.end();
  });

  test("aucune colonne ne reliait une commande à son PaymentIntent", async () => {
    const { config } = await migrateFresh("am2_before3", { stopBefore: HARDENING });
    const db = new pg.Client(config);
    await db.connect();
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orders'
          AND column_name IN ('stripe_payment_intent_id','stripe_charge_id','amount_refunded_cents')`);
    assert.equal(cols.rows.length, 0, "remboursements et litiges étaient impossibles à rapprocher");
    await db.end();
  });
});

/* ================================================================== *
 *  2. La migration répare les données déjà abîmées
 * ================================================================== */

describe("réparation des données existantes", () => {
  test("les articles payés restés en vente sont remis en cohérence", async () => {
    const { config } = await migrateFresh("am2_repair", { stopBefore: HARDENING });
    const db = new pg.Client(config);
    await db.connect();

    const { seller, product } = await seedSale(db);
    const buyer = (await db.query(
      "INSERT INTO auth.users (email) VALUES ('a@old.local') RETURNING id")).rows[0].id;

    // Situation telle qu'elle existe aujourd'hui en production : la commande a
    // bien été créée, mais l'article n'a jamais pu être marqué vendu.
    await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id)
       VALUES ($1,$2,$3,'paid',53.90,'cs_legacy_1')`, [product, buyer, seller]);

    const before = (await db.query("SELECT quantity, status FROM products WHERE id=$1", [product])).rows[0];
    assert.equal(before.status, "published", "point de départ : article payé encore en vente");

    await db.query(readFileSync(join(REPO_ROOT, "supabase", "migrations", HARDENING), "utf8"));

    const after = (await db.query("SELECT quantity, status, sold_at FROM products WHERE id=$1", [product])).rows[0];
    assert.equal(after.quantity, 0);
    assert.equal(after.status, "sold");
    assert.ok(after.sold_at, "la date de vente est reconstituée à partir de la commande");

    await db.end();
  });

  test("les commandes invité sont signalées pour traitement manuel", async () => {
    const { config } = await migrateFresh("am2_repair2", { stopBefore: HARDENING });
    const db = new pg.Client(config);
    await db.connect();
    const { seller, product } = await seedSale(db);

    await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id, customer_email)
       VALUES ($1, NULL, $2, 'paid', 53.90, 'cs_guest_legacy', 'invite@old.local')`, [product, seller]);

    await db.query(readFileSync(join(REPO_ROOT, "supabase", "migrations", HARDENING), "utf8"));

    const o = (await db.query(
      "SELECT needs_review, review_reason FROM orders WHERE stripe_session_id='cs_guest_legacy'")).rows[0];
    assert.equal(o.needs_review, true);
    assert.match(o.review_reason, /invité/);

    await db.end();
  });

  test("les commandes déjà payées reçoivent leurs montants en centimes", async () => {
    const { config } = await migrateFresh("am2_repair3", { stopBefore: HARDENING });
    const db = new pg.Client(config);
    await db.connect();
    const { seller, product } = await seedSale(db);
    const buyer = (await db.query(
      "INSERT INTO auth.users (email) VALUES ('a3@old.local') RETURNING id")).rows[0].id;
    await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id)
       VALUES ($1,$2,$3,'paid',53.90,'cs_amount_1')`, [product, buyer, seller]);

    await db.query(readFileSync(join(REPO_ROOT, "supabase", "migrations", HARDENING), "utf8"));

    const o = (await db.query(
      "SELECT amount_total_cents, paid_at, payment_status FROM orders WHERE stripe_session_id='cs_amount_1'")).rows[0];
    assert.equal(o.amount_total_cents, 5390, "53,90 € doit devenir 5390 centimes sans erreur d'arrondi");
    assert.ok(o.paid_at);
    assert.equal(o.payment_status, "paid");

    await db.end();
  });
});

/* ================================================================== *
 *  3. Ré-exécution
 * ================================================================== */

describe("la migration peut être rejouée", () => {
  test("trois exécutions successives donnent le même résultat", async () => {
    const { config } = await migrateFresh("am2_rerun");
    const db = new pg.Client(config);
    await db.connect();
    const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", HARDENING), "utf8");

    const snapshot = async () => {
      const fns = await db.query(
        `SELECT proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2`);
      const cols = await db.query(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
          WHERE table_schema='public' ORDER BY 1,2`);
      const cons = await db.query(
        `SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
          JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY 1`);
      const jobs = await db.query("SELECT jobname, schedule FROM cron.job ORDER BY 1");
      return JSON.stringify({ fns: fns.rows, cols: cols.rows, cons: cons.rows, jobs: jobs.rows });
    };

    const first = await snapshot();
    await db.query(sql);
    const second = await snapshot();
    await db.query(sql);
    const third = await snapshot();

    assert.equal(second, first, "la deuxième exécution ne doit rien changer");
    assert.equal(third, second, "ni la troisième");

    // Et une tâche cron n'est pas dupliquée.
    const jobs = await db.query("SELECT count(*)::int AS n FROM cron.job WHERE jobname='checkout-expire-stale'");
    assert.equal(jobs.rows[0].n, 1);

    await db.end();
  });

  test("rejouer la migration ne touche pas aux commandes en cours", async () => {
    const { config } = await migrateFresh("am2_rerun2");
    const db = new pg.Client(config);
    await db.connect();

    const seller = (await db.query("INSERT INTO auth.users (email) VALUES ('v2@x.local') RETURNING id")).rows[0].id;
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
    const buyer = (await db.query("INSERT INTO auth.users (email) VALUES ('a2@x.local') RETURNING id")).rows[0].id;
    const product = (await db.query(
      `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, ship_post)
       VALUES ($1,'Casque','1GM','Uniformes','Bon',45,1,true) RETURNING id`, [seller])).rows[0].id;

    const o = (await db.query(
      "SELECT * FROM checkout_reserve($1,$2,'post',NULL,'a2@x.local') AS o", [product, buyer])).rows[0];
    assert.equal(o.status, "pending");

    await db.query(readFileSync(join(REPO_ROOT, "supabase", "migrations", HARDENING), "utf8"));

    const after = (await db.query("SELECT status, amount_total_cents, seller_amount_cents FROM orders WHERE id=$1", [o.id])).rows[0];
    assert.equal(after.status, "pending", "une réservation en cours doit survivre à une reprise de migration");
    // 45,00 € d'article + 8,90 € de port + 2,95 € de Protection acheteurs.
    assert.equal(after.amount_total_cents, 5685);
    assert.equal(after.seller_amount_cents, 5390, "le vendeur reçoit prix + port, inchangé par la reprise");
    assert.equal((await db.query("SELECT reserved_qty FROM products WHERE id=$1", [product])).rows[0].reserved_qty, 1);

    await db.end();
  });
});

/* ================================================================== *
 *  4. Retour arrière
 * ================================================================== */

describe("retour arrière", () => {
  test("le nouveau schéma reste compatible avec l'ancien code des fonctions edge", async () => {
    // C'est la stratégie de rollback retenue : redéployer les anciennes
    // fonctions edge sans toucher à la base. Encore faut-il que l'ancien code
    // fonctionne sur le nouveau schéma. On rejoue ici exactement ce que faisait
    // l'ancien webhook.
    const { config } = await migrateFresh("am2_rollback");
    const db = new pg.Client(config);
    await db.connect();

    const seller = (await db.query("INSERT INTO auth.users (email) VALUES ('v3@x.local') RETURNING id")).rows[0].id;
    const product = (await db.query(
      `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, ship_post)
       VALUES ($1,'Casque','1GM','Uniformes','Bon',45,1,true) RETURNING id`, [seller])).rows[0].id;

    // 1. L'ancien webhook cherchait une commande par identifiant de session.
    const existing = await db.query("SELECT id FROM orders WHERE stripe_session_id=$1", ["cs_old_flow"]);
    assert.equal(existing.rows.length, 0);

    // 2. Puis décrémentait le stock — écriture qui échouait avant, et qui
    //    passe maintenant grâce à la contrainte relâchée.
    await db.query(
      "UPDATE products SET quantity=$2, status=$3, sold_at=now() WHERE id=$1", [product, 0, "sold"]);

    // 3. Puis insérait la commande avec exactement ses anciennes colonnes.
    await db.query(
      `INSERT INTO orders (product_id, stripe_session_id, customer_email, amount, currency,
                           status, shipping_method, shipping_address, seller_id, buyer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [product, "cs_old_flow", "x@y.z", 53.9, "eur", "paid", "post",
       JSON.stringify({ line1: "1 rue X" }), seller, null]);

    const o = (await db.query("SELECT status, amount FROM orders WHERE stripe_session_id='cs_old_flow'")).rows[0];
    assert.equal(o.status, "paid");
    assert.equal((await db.query("SELECT status FROM products WHERE id=$1", [product])).rows[0].status, "sold");

    await db.end();
  });

  test("le script de retour arrière retire la nouvelle logique sans détruire de données", async () => {
    const { config } = await migrateFresh("am2_rollback2");
    const db = new pg.Client(config);
    await db.connect();

    const seller = (await db.query("INSERT INTO auth.users (email) VALUES ('v4@x.local') RETURNING id")).rows[0].id;
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
    const buyer = (await db.query("INSERT INTO auth.users (email) VALUES ('a4@x.local') RETURNING id")).rows[0].id;
    const product = (await db.query(
      `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, ship_post)
       VALUES ($1,'Casque','1GM','Uniformes','Bon',45,1,true) RETURNING id`, [seller])).rows[0].id;

    const o = (await db.query(
      "SELECT * FROM checkout_reserve($1,$2,'post',NULL,'a4@x.local') AS o", [product, buyer])).rows[0];
    await db.query("SELECT order_settle_payment($1::jsonb)", [JSON.stringify({
      order_id: o.id, session_id: "cs_rb_1", payment_intent_id: "pi_rb_1",
      payment_status: "paid", amount_total_cents: 5685, currency: "eur",
    })]);

    const rollback = readFileSync(
      join(REPO_ROOT, "supabase", "migrations", "rollback", "20260813000000_stripe_hardening_down.sql"), "utf8");
    await db.query(rollback);

    // Les fonctions de la nouvelle logique ont disparu.
    const fns = await db.query(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND proname = ANY($1::text[])`,
      [["checkout_reserve", "checkout_release", "checkout_attach_session", "order_settle_payment",
        "stripe_event_claim", "stripe_event_finish", "order_apply_refund", "order_mark_chargeback"]]);
    assert.equal(fns.rows[0].n, 0);

    // La tâche planifiée aussi.
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM cron.job WHERE jobname='checkout-expire-stale'")).rows[0].n, 0);

    // Mais les données financières sont intactes : c'est la règle absolue d'un
    // retour arrière sur un système de paiement.
    const order = (await db.query(
      "SELECT status, amount_total_cents, stripe_payment_intent_id FROM orders WHERE id=$1", [o.id])).rows[0];
    assert.equal(order.status, "paid");
    assert.equal(order.amount_total_cents, 5685);
    assert.equal(order.stripe_payment_intent_id, "pi_rb_1");

    // Et l'article reste vendu : on ne remet pas en vente un objet déjà payé.
    const prod = (await db.query("SELECT quantity, status FROM products WHERE id=$1", [product])).rows[0];
    assert.equal(prod.quantity, 0);
    assert.equal(prod.status, "sold");

    // La contrainte relâchée n'est pas rétablie : la rétablir recréerait le
    // défaut d'origine et casserait l'ancien code comme le nouveau.
    const check = (await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname='products_quantity_check'`)).rows[0];
    assert.match(check.def, /quantity >= 0/);

    await db.end();
  });
});

/* ================================================================== *
 *  5. Adaptation au schéma réel de la production
 * ================================================================== */

describe("colonnes héritées présentes en production", () => {
  test("la migration rend facultatives les colonnes ajoutées hors migrations", async () => {
    // La production porte product_price, buyer_protection_fee et shipping_fee,
    // ajoutées à la main et absentes de tout l'historique. Si elles étaient
    // NOT NULL, checkout_reserve échouerait à chaque achat.
    const { config } = await migrateFresh("am2_legacycols", { stopBefore: HARDENING });
    const db = new pg.Client(config);
    await db.connect();

    await db.query(`
      ALTER TABLE public.orders
        ADD COLUMN product_price numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN buyer_protection_fee numeric(10,2) NOT NULL,
        ADD COLUMN shipping_fee numeric(10,2) NOT NULL`);
    await db.query("ALTER TABLE public.orders ALTER COLUMN product_price DROP DEFAULT");

    await db.query(readFileSync(join(REPO_ROOT, "supabase", "migrations", HARDENING), "utf8"));

    const cols = await db.query(`
      SELECT column_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='orders'
         AND column_name IN ('product_price','buyer_protection_fee','shipping_fee')
       ORDER BY column_name`);
    assert.equal(cols.rows.length, 3);
    for (const c of cols.rows) {
      assert.equal(c.is_nullable, "YES", `${c.column_name} doit devenir facultative`);
    }

    // Et surtout : une réservation doit aboutir malgré ces colonnes.
    const seller = (await db.query("INSERT INTO auth.users (email) VALUES ('v@leg.local') RETURNING id")).rows[0].id;
    const buyer = (await db.query("INSERT INTO auth.users (email) VALUES ('a@leg.local') RETURNING id")).rows[0].id;
    const product = (await db.query(
      `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, ship_post)
       VALUES ($1,'Casque','1GM','Uniformes','Bon',45,1,true) RETURNING id`, [seller])).rows[0].id;

    const order = (await db.query(
      "SELECT * FROM checkout_reserve($1,$2,'post',NULL,'a@leg.local') AS o", [product, buyer])).rows[0];
    assert.equal(order.status, "pending");
    assert.equal(order.amount_total_cents, 5390);

    await db.end();
  });

  test("la migration ne fait rien quand ces colonnes n'existent pas", async () => {
    const { config } = await migrateFresh("am2_nolegacy");
    const db = new pg.Client(config);
    await db.connect();
    const cols = await db.query(`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema='public' AND table_name='orders'
         AND column_name IN ('product_price','buyer_protection_fee','shipping_fee')`);
    assert.equal(cols.rows[0].n, 0, "aucune colonne inventée là où elle n'existait pas");
    await db.end();
  });
});
