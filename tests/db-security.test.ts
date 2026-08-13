/**
 * Sécurité : RLS et droits d'exécution, testés avec de vraies identités.
 *
 * Chaque identité est une vraie connexion Postgres, avec SET ROLE et les
 * revendications JWT posées dans request.jwt.claims — exactement ce que fait
 * PostgREST pour chaque requête de l'API Supabase. Les politiques évaluées
 * sont donc les vraies, sur le vrai moteur.
 *
 * Identités couvertes :
 *   anon · acheteur A · acheteur B · vendeur · autre vendeur · admin 1 ·
 *   admin 2 · service_role
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { startPostgres, stopPostgres } from "./helpers/postgres.mjs";
import { migrateFresh, connectAs, connectService } from "./helpers/migrate.mjs";

const ADMIN_1 = "sayrox.ar@gmail.com";
const ADMIN_2 = "renduambroise@gmail.com";

let config: any;
let db: pg.Client;

const ids: Record<string, string> = {};
let productId: number;
let orderA: string;
let orderB: string;

/** Connexion telle que PostgREST l'établit pour un utilisateur connecté. */
function asUser(userId: string, email: string) {
  return connectAs(config, "authenticated", { sub: userId, role: "authenticated", email });
}
function asAnon() {
  return connectAs(config, "anon", { role: "anon" });
}
function asService() {
  return connectAs(config, "service_role", { role: "service_role" });
}

before(async () => {
  await startPostgres();
  const migrated = await migrateFresh("am2_security");
  config = migrated.config;
  db = await connectService(config);

  const mkUser = async (key: string, email: string) => {
    const r = await db.query("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [email]);
    ids[key] = r.rows[0].id;
  };
  await mkUser("buyerA", "a@test.local");
  await mkUser("buyerB", "b@test.local");
  await mkUser("seller", "vendeur@test.local");
  await mkUser("seller2", "vendeur2@test.local");
  await mkUser("admin1", ADMIN_1);
  await mkUser("admin2", ADMIN_2);

  await db.query(
    "UPDATE profiles SET stripe_account_id='acct_secret_123', stripe_onboarded=true WHERE id=$1",
    [ids.seller]);

  const p = await db.query(
    `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, ship_post)
     VALUES ($1,'Casque','1GM','Uniformes','Bon',45,5,true) RETURNING id`, [ids.seller]);
  productId = p.rows[0].id;

  const mkOrder = async (buyer: string, session: string) => {
    const r = await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, amount_total_cents,
                           stripe_session_id, customer_email)
       VALUES ($1,$2,$3,'paid',53.90,5390,$4,'x@test.local') RETURNING id`,
      [productId, buyer, ids.seller, session]);
    return r.rows[0].id;
  };
  orderA = await mkOrder(ids.buyerA, "cs_sec_a");
  orderB = await mkOrder(ids.buyerB, "cs_sec_b");
}, { timeout: 180_000 });

after(async () => {
  if (db) await db.end();
  await stopPostgres();
});

/* ================================================================== *
 *  Lecture des commandes
 * ================================================================== */

describe("qui peut lire les commandes", () => {
  const readOrders = async (client: pg.Client) =>
    (await client.query("SELECT id FROM orders ORDER BY id")).rows.map((r: any) => r.id);

  test("un visiteur anonyme ne voit aucune commande", async () => {
    const c = await asAnon();
    assert.deepEqual(await readOrders(c), []);
    await c.end();
  });

  test("un acheteur ne voit que ses achats", async () => {
    const c = await asUser(ids.buyerA, "a@test.local");
    assert.deepEqual(await readOrders(c), [orderA]);
    await c.end();
  });

  test("un acheteur ne voit pas la commande d'un autre, même en la nommant", async () => {
    const c = await asUser(ids.buyerB, "b@test.local");
    const r = await c.query("SELECT id, customer_email, amount FROM orders WHERE id=$1", [orderA]);
    assert.equal(r.rows.length, 0, "IDOR : connaître l'identifiant ne doit rien donner");
    await c.end();
  });

  test("le vendeur voit ses ventes, un autre vendeur ne voit rien", async () => {
    const c1 = await asUser(ids.seller, "vendeur@test.local");
    assert.deepEqual((await readOrders(c1)).sort(), [orderA, orderB].sort());
    await c1.end();

    const c2 = await asUser(ids.seller2, "vendeur2@test.local");
    assert.deepEqual(await readOrders(c2), []);
    await c2.end();
  });

  test("les deux administrateurs voient toutes les commandes", async () => {
    for (const [id, email] of [[ids.admin1, ADMIN_1], [ids.admin2, ADMIN_2]] as const) {
      const c = await asUser(id, email);
      const rows = await readOrders(c);
      assert.equal(rows.length, 2, `l'administrateur ${email} doit voir les deux commandes`);
      await c.end();
    }
  });

  test("une adresse voisine de celle d'un administrateur ne donne rien", async () => {
    const c = await asUser(ids.buyerA, "sayrox.ar@gmail.com.attaquant.fr");
    assert.deepEqual(await readOrders(c), [orderA], "seulement ses propres achats");
    await c.end();
  });
});

/* ================================================================== *
 *  Écriture des commandes
 * ================================================================== */

describe("personne ne peut réécrire une commande depuis le navigateur", () => {
  test("un acheteur ne peut pas modifier sa propre commande", async () => {
    const c = await asUser(ids.buyerA, "a@test.local");
    const r = await c.query(
      "UPDATE orders SET amount = 1, amount_total_cents = 100 WHERE id=$1 RETURNING id", [orderA]);
    assert.equal(r.rowCount, 0, "aucune politique UPDATE n'existe : l'écriture ne touche rien");
    await c.end();

    const after = await db.query("SELECT amount_total_cents FROM orders WHERE id=$1", [orderA]);
    assert.equal(after.rows[0].amount_total_cents, 5390);
  });

  test("un acheteur ne peut pas se déclarer payé en insérant une commande", async () => {
    const c = await asUser(ids.buyerA, "a@test.local");
    await assert.rejects(
      () => c.query(
        `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount)
         VALUES ($1,$2,$3,'paid',0.01)`, [productId, ids.buyerA, ids.seller]),
      /row-level security|permission denied/i,
    );
    await c.end();
  });

  test("un vendeur ne peut pas se réattribuer la commande d'un autre", async () => {
    const c = await asUser(ids.seller2, "vendeur2@test.local");
    const r = await c.query("UPDATE orders SET seller_id=$1 WHERE id=$2 RETURNING id", [ids.seller2, orderA]);
    assert.equal(r.rowCount, 0);
    await c.end();
  });

  test("personne ne peut supprimer une commande", async () => {
    for (const [role, id, email] of [
      ["buyer", ids.buyerA, "a@test.local"], ["seller", ids.seller, "vendeur@test.local"],
      ["admin", ids.admin1, ADMIN_1],
    ] as const) {
      const c = await asUser(id, email);
      const r = await c.query("DELETE FROM orders WHERE id=$1 RETURNING id", [orderA]);
      assert.equal(r.rowCount, 0, `${role} ne doit pas pouvoir supprimer une commande`);
      await c.end();
    }
  });
});

/* ================================================================== *
 *  Fonctions financières
 * ================================================================== */

describe("les fonctions qui touchent à l'argent sont hors de portée du navigateur", () => {
  const FINANCIAL = [
    ["checkout_reserve", "SELECT checkout_reserve(1, $1, 'post', NULL, 'x@y.z')", true],
    ["checkout_release", "SELECT checkout_release($1::uuid, 'canceled')", false],
    ["checkout_attach_session", "SELECT checkout_attach_session($1::uuid, 'cs_x')", false],
    ["checkout_expire_stale", "SELECT checkout_expire_stale(NULL)", false],
    ["order_settle_payment", "SELECT order_settle_payment('{}'::jsonb)", false],
    ["order_mark_payment_failed", "SELECT order_mark_payment_failed('cs','pi','x')", false],
    ["order_apply_refund", "SELECT order_apply_refund('pi','ch',100,true)", false],
    ["order_mark_chargeback", "SELECT order_mark_chargeback('pi','ch','lost','fraud')", false],
    ["stripe_event_claim", "SELECT stripe_event_claim('evt','type')", false],
    ["stripe_event_finish", "SELECT stripe_event_finish('evt','done',NULL)", false],
    ["orders_needing_attention", "SELECT * FROM orders_needing_attention()", false],
  ] as const;

  test("ni anon ni un utilisateur connecté ne peuvent les appeler", async () => {
    for (const [name, sql, needsUser] of FINANCIAL) {
      for (const [label, connect] of [
        ["anon", asAnon],
        ["authenticated", () => asUser(ids.buyerA, "a@test.local")],
      ] as const) {
        const c = await connect();
        await assert.rejects(
          () => c.query(sql, needsUser ? [ids.buyerA] : sql.includes("$1") ? [orderA] : []),
          /permission denied for function/,
          `${name} appelable par ${label}`,
        );
        await c.end();
      }
    }
  });

  test("même un administrateur ne peut pas les appeler depuis le navigateur", async () => {
    const c = await asUser(ids.admin1, ADMIN_1);
    await assert.rejects(
      () => c.query("SELECT order_apply_refund('pi','ch',100,true)"),
      /permission denied for function/,
      "un compte administrateur compromis ne doit pas pouvoir rembourser",
    );
    await c.end();
  });

  test("le service_role, lui, peut : c'est le backend", async () => {
    const c = await asService();
    const r = await c.query("SELECT checkout_expire_stale(NULL) AS n");
    assert.equal(typeof r.rows[0].n, "number");
    await c.end();
  });
});

/* ================================================================== *
 *  Cycle de vie : la faille reproduite puis refermée
 * ================================================================== */

describe("cycle de vie de commande : régression de la faille anonyme", () => {
  test("les trois RPC ne sont plus exécutables par anon", async () => {
    const c = await asAnon();
    for (const sql of [
      "SELECT order_mark_shipped($1::uuid,'X',NULL)",
      "SELECT order_confirm_receipt($1::uuid)",
      "SELECT order_report_dispute($1::uuid,'un motif suffisamment long')",
    ]) {
      await assert.rejects(() => c.query(sql, [orderA]), /permission denied for function/);
    }
    await c.end();
  });

  test("une commande sans acheteur rattaché n'est actionnable par personne", async () => {
    // Reproduction du cas réel : commande passée en invité avant que l'achat
    // n'exige un compte. buyer_id vaut NULL, et NULL IS DISTINCT FROM NULL
    // valait FALSE, ce qui laissait passer la garde d'origine.
    const guest = (await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id)
       VALUES ($1, NULL, $2, 'shipped', 53.90, 'cs_guest_sec') RETURNING id`,
      [productId, ids.seller])).rows[0].id;

    for (const [id, email] of [
      [ids.buyerA, "a@test.local"], [ids.buyerB, "b@test.local"], [ids.admin1, ADMIN_1],
    ] as const) {
      const c = await asUser(id, email);
      await assert.rejects(
        () => c.query("SELECT order_confirm_receipt($1::uuid)", [guest]),
        /Non autorisé/,
      );
      await c.end();
    }

    assert.equal((await db.query("SELECT status FROM orders WHERE id=$1", [guest])).rows[0].status, "shipped");
  });

  test("seul le vrai acheteur confirme, seul le vrai vendeur expédie", async () => {
    const o = (await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id)
       VALUES ($1,$2,$3,'paid',53.90,'cs_life_1') RETURNING id`,
      [productId, ids.buyerA, ids.seller])).rows[0].id;

    // L'acheteur ne peut pas déclarer l'expédition.
    const buyer = await asUser(ids.buyerA, "a@test.local");
    await assert.rejects(() => buyer.query("SELECT order_mark_shipped($1::uuid,'TRK',NULL)", [o]), /Non autorisé/);
    // Ni confirmer avant expédition.
    await assert.rejects(() => buyer.query("SELECT order_confirm_receipt($1::uuid)", [o]), /ne peut pas être confirmée/);

    // Le vendeur expédie.
    const seller = await asUser(ids.seller, "vendeur@test.local");
    await seller.query("SELECT order_mark_shipped($1::uuid,'TRK123','Colissimo')", [o]);
    assert.equal((await db.query("SELECT status FROM orders WHERE id=$1", [o])).rows[0].status, "shipped");
    // Mais pas deux fois.
    await assert.rejects(() => seller.query("SELECT order_mark_shipped($1::uuid,'TRK999',NULL)", [o]), /déjà expédiée/);

    // Un autre acheteur ne peut pas confirmer à la place du vrai.
    const other = await asUser(ids.buyerB, "b@test.local");
    await assert.rejects(() => other.query("SELECT order_confirm_receipt($1::uuid)", [o]), /Non autorisé/);
    await other.end();

    await buyer.query("SELECT order_confirm_receipt($1::uuid)", [o]);
    assert.equal((await db.query("SELECT status FROM orders WHERE id=$1", [o])).rows[0].status, "completed");

    // Et on ne peut plus ouvrir de litige sur une commande close.
    await assert.rejects(
      () => buyer.query("SELECT order_report_dispute($1::uuid,'motif assez long pour passer')", [o]),
      /Litige impossible/);

    await buyer.end();
    await seller.end();
  });
});

/* ================================================================== *
 *  Données du vendeur et réglages plateforme
 * ================================================================== */

describe("secrets et données privées", () => {
  test("un utilisateur ne peut pas lire le compte Stripe d'un autre", async () => {
    const c = await asUser(ids.buyerA, "a@test.local");
    const r = await c.query("SELECT id, stripe_account_id FROM profiles WHERE id=$1", [ids.seller]);
    assert.equal(r.rows.length, 0);
    await c.end();
  });

  test("un vendeur ne peut pas modifier son propre état Stripe", async () => {
    const c = await asUser(ids.seller2, "vendeur2@test.local");
    await c.query(
      "UPDATE profiles SET stripe_account_id='acct_pirate', stripe_onboarded=true WHERE id=$1",
      [ids.seller2]);
    await c.end();

    const after = await db.query("SELECT stripe_account_id, stripe_onboarded FROM profiles WHERE id=$1", [ids.seller2]);
    assert.equal(after.rows[0].stripe_account_id, null, "se déclarer onboardé permettrait de recevoir des paiements");
    assert.equal(after.rows[0].stripe_onboarded, false);
  });

  test("les réglages de commission ne sont lisibles par personne côté client", async () => {
    for (const connect of [asAnon, () => asUser(ids.buyerA, "a@test.local"), () => asUser(ids.admin1, ADMIN_1)]) {
      const c = await connect();
      const r = await c.query("SELECT * FROM platform_settings");
      assert.equal(r.rows.length, 0, "un taux de commission modifiable serait un levier financier");
      await c.end();
    }
  });

  test("le journal des événements Stripe est invisible côté client", async () => {
    await db.query(
      "INSERT INTO stripe_events (id, type, status) VALUES ('evt_sec_1','charge.refunded','done')");
    for (const connect of [asAnon, () => asUser(ids.buyerA, "a@test.local")]) {
      const c = await connect();
      assert.equal((await c.query("SELECT * FROM stripe_events")).rows.length, 0);
      await c.end();
    }
  });

  test("les tarifs de livraison, eux, sont publics : c'est un prix affiché", async () => {
    const c = await asAnon();
    const r = await c.query("SELECT method, amount_cents FROM shipping_rates ORDER BY method");
    assert.equal(r.rows.length, 3);
    await c.end();
  });
});

/* ================================================================== *
 *  Visibilité des produits
 * ================================================================== */

describe("visibilité des annonces", () => {
  test("un article vendu depuis plus de sept jours disparaît, sauf pour les parties", async () => {
    const p = (await db.query(
      `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, status, sold_at)
       VALUES ($1,'Vieux casque','1GM','Uniformes','Bon',30,0,'sold', now() - interval '10 days')
       RETURNING id`, [ids.seller])).rows[0].id;

    const anon = await asAnon();
    assert.equal((await anon.query("SELECT id FROM products WHERE id=$1", [p])).rows.length, 0);
    await anon.end();

    // L'acheteur de cet article doit continuer à le voir dans ses achats.
    await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id)
       VALUES ($1,$2,$3,'completed',30,'cs_old_1')`, [p, ids.buyerA, ids.seller]);

    const buyer = await asUser(ids.buyerA, "a@test.local");
    assert.equal((await buyer.query("SELECT id FROM products WHERE id=$1", [p])).rows.length, 1);
    await buyer.end();

    const stranger = await asUser(ids.buyerB, "b@test.local");
    assert.equal((await stranger.query("SELECT id FROM products WHERE id=$1", [p])).rows.length, 0);
    await stranger.end();
  });

  test("un brouillon n'est visible que par son auteur", async () => {
    const p = (await db.query(
      `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, status)
       VALUES ($1,'Brouillon','1GM','Uniformes','Bon',30,1,'draft') RETURNING id`, [ids.seller])).rows[0].id;

    const anon = await asAnon();
    assert.equal((await anon.query("SELECT id FROM products WHERE id=$1", [p])).rows.length, 0);
    await anon.end();

    const other = await asUser(ids.buyerA, "a@test.local");
    assert.equal((await other.query("SELECT id FROM products WHERE id=$1", [p])).rows.length, 0);
    await other.end();

    const owner = await asUser(ids.seller, "vendeur@test.local");
    assert.equal((await owner.query("SELECT id FROM products WHERE id=$1", [p])).rows.length, 1);
    await owner.end();
  });
});
