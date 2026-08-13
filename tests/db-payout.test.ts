/**
 * Versement du vendeur après réception, contre un vrai Postgres.
 *
 * Ce qui est mis à l'épreuve ici est la question la plus coûteuse de toute
 * l'intégration : à quel moment l'argent quitte la plateforme pour aller chez
 * le vendeur, et que se passe-t-il si la commande se dégrade après coup.
 *
 * Un versement en trop est irrécupérable en pratique : il faut la coopération
 * du vendeur ou un solde suffisant sur son compte. C'est le seul endroit du
 * système où une erreur coûte de l'argent réel sans recours automatique.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { startPostgres, stopPostgres } from "./helpers/postgres.mjs";
import { migrateFresh, connectService, connectAs } from "./helpers/migrate.mjs";

let config: any;
let db: pg.Client;

before(async () => {
  await startPostgres();
  const migrated = await migrateFresh("am2_payout");
  config = migrated.config;
  db = await connectService(config);
}, { timeout: 180_000 });

after(async () => {
  if (db) await db.end();
  await stopPostgres();
});

let counter = 0;

/** Crée une commande payée, prête à être rendue versable. */
async function paidOrder(opts: {
  confirmed?: boolean; shippedDaysAgo?: number; paidHoursAgo?: number;
  onboarded?: boolean; status?: string;
} = {}) {
  const n = ++counter;
  const o = { confirmed: true, paidHoursAgo: 48, onboarded: true, status: "completed", ...opts };

  const seller = (await db.query(
    "INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [`v${n}@payout.local`])).rows[0].id;
  await db.query(
    "UPDATE profiles SET stripe_account_id=$2, stripe_onboarded=$3 WHERE id=$1",
    [seller, `acct_${n}`, o.onboarded]);

  const buyer = (await db.query(
    "INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [`a${n}@payout.local`])).rows[0].id;

  const product = (await db.query(
    `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, ship_post)
     VALUES ($1,'Casque','1GM','Uniformes','Bon',45,1,true) RETURNING id`, [seller])).rows[0].id;

  // Décomposition conforme au barème : 45,00 + 8,90 + 2,95 = 56,85 €.
  // La confirmation de l'acheteur ouvre une fenêtre de 48 h ; on la place
  // dans le passé quand le scénario suppose qu'elle est écoulée.
  const order = (await db.query(
    `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount,
                         product_amount_cents, shipping_amount_cents, protection_fee_cents,
                         amount_total_cents, seller_amount_cents, application_fee_cents,
                         pricing_version, currency, stripe_session_id,
                         stripe_payment_intent_id, stripe_charge_id, paid_at, payout_state,
                         confirmed_at, report_window_ends_at, shipped_at)
     VALUES ($1,$2,$3,$4,56.85,
             4500,890,295,5685,5390,0,
             1,'eur',$5,$6,$7,
             now() - make_interval(hours => $8), 'pending',
             CASE WHEN $9 THEN now() - interval '3 hours' ELSE NULL END,
             CASE WHEN $9 THEN now() - interval '1 hour' ELSE NULL END,
             CASE WHEN $10::int IS NULL THEN NULL ELSE now() - make_interval(days => $10::int) END)
     RETURNING *`,
    [product, buyer, seller, o.status, `cs_p${n}`, `pi_p${n}`, `ch_p${n}`,
     o.paidHoursAgo, o.confirmed, o.shippedDaysAgo ?? null])).rows[0];

  return { seller, buyer, product, order };
}

const ready = async () => (await db.query("SELECT * FROM orders_ready_for_payout(100)")).rows;
const orderRow = async (id: string) => (await db.query("SELECT * FROM orders WHERE id=$1", [id])).rows[0];

/* ================================================================== *
 *  Éligibilité
 * ================================================================== */

describe("qui devient versable, et quand", () => {
  test("une commande confirmée, payée depuis plus du délai de garde, est versable", async () => {
    const { order, seller } = await paidOrder();
    const rows = await ready();
    const mine = rows.find((r: any) => r.order_id === order.id);
    assert.ok(mine, "la commande doit apparaître dans la file de versement");
    assert.equal(mine.seller_id, seller);
    // Total encaissé moins la commission : 5390 - 360.
    assert.equal(mine.transfer_amount_cents, 5390, "prix + port, sans aucune retenue");
    assert.equal(mine.seller_account_id, mine.seller_account_id);
  });

  test("le délai de garde après paiement est respecté", async () => {
    const { order } = await paidOrder({ paidHoursAgo: 2 });
    const rows = await ready();
    assert.equal(rows.some((r: any) => r.order_id === order.id), false,
      "verser deux heures après le paiement ne laisserait aucune fenêtre pour détecter une fraude");
  });

  test("sans confirmation ni expédition ancienne, rien n'est versé", async () => {
    const { order } = await paidOrder({ confirmed: false, status: "paid" });
    assert.equal((await ready()).some((r: any) => r.order_id === order.id), false);
  });

  test("la déclaration d'expédition du vendeur ne rend JAMAIS le versement admissible", async () => {
    // Le cœur de la protection acheteur : aucune action du vendeur, si
    // ancienne soit-elle, ne peut déclencher son propre paiement. Le numéro
    // de suivi qu'il saisit n'est vérifié par personne.
    for (const days of [3, 20, 60]) {
      const { order } = await paidOrder({ confirmed: false, status: "shipped", shippedDaysAgo: days });
      assert.equal((await ready()).some((r: any) => r.order_id === order.id), false,
        `expédition déclarée il y a ${days} jours : toujours pas versable`);
    }
  });

  test("sans réponse de l'acheteur, la commande part en revue manuelle et non en versement", async () => {
    const { order } = await paidOrder({ confirmed: false, status: "shipped", shippedDaysAgo: 20 });
    const flagged = await db.query("SELECT * FROM orders_flag_manual_review()");
    assert.ok(flagged.rows.some((r: any) => r.order_id === order.id), "la commande doit être signalée");

    const after = await orderRow(order.id);
    assert.equal(after.payout_state, "manual_review");
    assert.equal(after.needs_review, true);
    assert.match(after.review_reason, /sans réponse/);
    assert.equal((await ready()).some((r: any) => r.order_id === order.id), false);
  });

  test("le vendeur ne peut pas sortir seul sa commande de la revue manuelle", async () => {
    const { order, seller } = await paidOrder({ confirmed: false, status: "shipped", shippedDaysAgo: 20 });
    await db.query("SELECT orders_flag_manual_review()");
    assert.equal((await orderRow(order.id)).payout_state, "manual_review");

    const asSeller = await connectAs(config, "authenticated", { sub: seller, role: "authenticated" });
    await asSeller.query("UPDATE orders SET payout_state='pending' WHERE id=$1", [order.id]).catch(() => {});
    await asSeller.end();

    assert.equal((await orderRow(order.id)).payout_state, "manual_review",
      "seule l'administration peut lever une revue manuelle");
  });

  test("la fenêtre de signalement de 48 h doit être écoulée", async () => {
    const { order } = await paidOrder();
    // Confirmation toute fraîche : la fenêtre court encore.
    await db.query(
      "UPDATE orders SET confirmed_at = now(), report_window_ends_at = now() + interval '48 hours' WHERE id=$1",
      [order.id]);
    assert.equal((await ready()).some((r: any) => r.order_id === order.id), false,
      "verser avant la fin de la fenêtre priverait l'acheteur de son recours");

    await db.query("UPDATE orders SET report_window_ends_at = now() - interval '1 minute' WHERE id=$1", [order.id]);
    assert.equal((await ready()).some((r: any) => r.order_id === order.id), true);
  });

  test("un litige, un remboursement ou une revue suspendent le versement", async () => {
    for (const [label, sql] of [
      ["litige bancaire", "UPDATE orders SET chargeback_status='needs_response' WHERE id=$1"],
      ["remboursement partiel", "UPDATE orders SET amount_refunded_cents=1000 WHERE id=$1"],
      ["revue manuelle", "UPDATE orders SET needs_review=true WHERE id=$1"],
    ] as const) {
      const { order } = await paidOrder();
      assert.equal((await ready()).some((r: any) => r.order_id === order.id), true, `${label} : versable au départ`);
      await db.query(sql, [order.id]);
      assert.equal((await ready()).some((r: any) => r.order_id === order.id), false, `${label} : doit suspendre`);
    }
  });

  test("un vendeur dont le compte Stripe n'est pas prêt n'est pas versé", async () => {
    const { order } = await paidOrder({ onboarded: false });
    assert.equal((await ready()).some((r: any) => r.order_id === order.id), false,
      "un transfert vers un compte incapable de recevoir échouerait et bloquerait la file");
  });

  test("une commande non payée n'est jamais versable", async () => {
    const { order } = await paidOrder();
    await db.query("UPDATE orders SET paid_at=NULL WHERE id=$1", [order.id]);
    assert.equal((await ready()).some((r: any) => r.order_id === order.id), false);
  });
});

/* ================================================================== *
 *  Un seul versement, jamais deux
 * ================================================================== */

describe("un versement et un seul", () => {
  test("enregistrer le versement retire la commande de la file", async () => {
    const { order } = await paidOrder();
    const r = await db.query("SELECT order_mark_payout_released($1,$2,$3) AS r",
      [order.id, "tr_ok_1", 5390]);
    assert.equal(r.rows[0].r.changed, true);

    const after = await orderRow(order.id);
    assert.equal(after.payout_state, "released");
    assert.equal(after.stripe_transfer_id, "tr_ok_1");
    assert.equal(after.transfer_amount_cents, 5390);
    assert.ok(after.transferred_at);

    assert.equal((await ready()).some((r2: any) => r2.order_id === order.id), false);
  });

  test("un second appel ne verse pas une seconde fois", async () => {
    const { order } = await paidOrder();
    await db.query("SELECT order_mark_payout_released($1,$2,$3)", [order.id, "tr_dup_1", 5390]);

    const again = await db.query("SELECT order_mark_payout_released($1,$2,$3) AS r",
      [order.id, "tr_dup_2", 5390]);
    assert.equal(again.rows[0].r.changed, false, "un rejeu ne doit rien changer");
    assert.equal(again.rows[0].r.already_transfer_id, "tr_dup_1");

    const after = await orderRow(order.id);
    assert.equal(after.stripe_transfer_id, "tr_dup_1", "le premier transfert reste le seul enregistré");
  });

  test("dix enregistrements concurrents : un seul passe", async () => {
    const { order } = await paidOrder();
    const clients = await Promise.all(
      Array.from({ length: 10 }, async () => { const c = new pg.Client(config); await c.connect(); return c; }));

    const results = await Promise.all(clients.map((c, i) =>
      c.query("SELECT order_mark_payout_released($1,$2,$3) AS r", [order.id, `tr_conc_${i}`, 5390])
        .then((r) => r.rows[0].r.changed).catch(() => "ERR")));
    await Promise.all(clients.map((c) => c.end()));

    assert.equal(results.filter((r) => r === true).length, 1,
      "deux versements concurrents seraient une perte sèche");
  });

  test("un même identifiant de transfert ne peut pas servir deux commandes", async () => {
    const a = await paidOrder();
    const b = await paidOrder();
    await db.query("SELECT order_mark_payout_released($1,$2,$3)", [a.order.id, "tr_shared", 5390]);
    await assert.rejects(
      () => db.query("SELECT order_mark_payout_released($1,$2,$3)", [b.order.id, "tr_shared", 5390]),
      /orders_transfer_uniq/,
    );
  });

  test("une commande suspendue ne peut pas être versée par erreur", async () => {
    const { order } = await paidOrder();
    await db.query("SELECT order_block_payout($1,$2)", [order.id, "litige en cours"]);
    await assert.rejects(
      () => db.query("SELECT order_mark_payout_released($1,$2,$3)", [order.id, "tr_blocked", 5390]),
      /PAYOUT_NOT_PENDING/,
    );
  });
});

/* ================================================================== *
 *  Dégradation après versement
 * ================================================================== */

describe("quand la commande se dégrade", () => {
  test("un remboursement suspend automatiquement un versement encore en attente", async () => {
    const { order } = await paidOrder();
    assert.equal((await orderRow(order.id)).payout_state, "pending");

    await db.query("SELECT order_apply_refund($1,$2,$3,$4)",
      [order.stripe_payment_intent_id, order.stripe_charge_id, 5390, true]);

    const after = await orderRow(order.id);
    assert.equal(after.payout_state, "blocked",
      "sans ce garde-fou, le versement partirait entre le remboursement et son traitement");
    assert.equal((await ready()).some((r: any) => r.order_id === order.id), false);
  });

  test("un litige bancaire suspend le versement", async () => {
    const { order } = await paidOrder();
    await db.query("SELECT order_mark_chargeback($1,$2,$3,$4)",
      [order.stripe_payment_intent_id, order.stripe_charge_id, "needs_response", "fraudulent"]);
    assert.equal((await orderRow(order.id)).payout_state, "blocked");
  });

  test("un versement déjà parti est marqué annulé, pas effacé", async () => {
    const { order } = await paidOrder();
    await db.query("SELECT order_mark_payout_released($1,$2,$3)", [order.id, "tr_rev_1", 5390]);

    const ok = await db.query("SELECT order_mark_payout_reversed($1,$2) AS r",
      [order.id, "Transfert annulé (trr_1) suite au remboursement"]);
    assert.equal(ok.rows[0].r, true);

    const after = await orderRow(order.id);
    assert.equal(after.payout_state, "reversed");
    // La trace du transfert reste : sans elle, impossible de justifier le
    // mouvement auprès du vendeur ou de la comptabilité.
    assert.equal(after.stripe_transfer_id, "tr_rev_1");
    assert.equal(after.transfer_amount_cents, 5390);
  });

  test("le montant versé n'inclut jamais la Protection acheteurs", async () => {
    const { order } = await paidOrder();
    const row = (await ready()).find((r: any) => r.order_id === order.id);
    const o = await orderRow(order.id);

    assert.equal(row.transfer_amount_cents, o.seller_amount_cents);
    assert.equal(row.transfer_amount_cents, o.product_amount_cents + o.shipping_amount_cents);
    assert.equal(o.amount_total_cents - row.transfer_amount_cents, o.protection_fee_cents,
      "l'écart entre ce que paie l'acheteur et ce que reçoit le vendeur est exactement la Protection");
    assert.equal(o.application_fee_cents, 0, "aucune commission vendeur");
  });

  test("la base refuse une décomposition financière incohérente", async () => {
    const { order } = await paidOrder();
    // Tenter de gonfler le montant vendeur au-delà de prix + port.
    await assert.rejects(
      () => db.query("UPDATE orders SET seller_amount_cents = 5685 WHERE id=$1", [order.id]),
      /orders_seller_amount_check|orders_protection_never_to_seller_check/,
      "verser la Protection au vendeur doit être impossible, pas seulement déconseillé");

    await assert.rejects(
      () => db.query("UPDATE orders SET application_fee_cents = 100 WHERE id=$1", [order.id]),
      /orders_no_seller_commission_check/,
      "réintroduire une commission vendeur doit être impossible");

    await assert.rejects(
      () => db.query("UPDATE orders SET protection_fee_cents = 999 WHERE id=$1", [order.id]),
      /orders_amount_decomposition_check/,
      "la somme des composantes doit toujours égaler le total");
  });
});

/* ================================================================== *
 *  Réglage du mode
 * ================================================================== */

describe("le mode de versement est un réglage", () => {
  test("le mode par défaut est le versement après réception", async () => {
    const r = await db.query("SELECT value FROM platform_settings WHERE key='payout_on_delivery'");
    assert.equal(Number(r.rows[0].value), 1);
  });

  test("le barème et les délais sont en base, versionnés", async () => {
    const s = await db.query(
      "SELECT key, value FROM platform_settings WHERE key = ANY($1::text[]) ORDER BY key",
      [["pricing_version", "protection_rate_bps", "protection_fixed_cents",
        "report_window_hours", "buyer_silence_days", "shipping_deadline_business_days",
        "platform_fee_rate"]]);
    const v = Object.fromEntries(s.rows.map((r: any) => [r.key, Number(r.value)]));

    assert.equal(v.protection_rate_bps, 500, "5,00 %");
    assert.equal(v.protection_fixed_cents, 70, "0,70 €");
    assert.equal(v.report_window_hours, 48);
    assert.equal(v.buyer_silence_days, 14);
    assert.equal(v.shipping_deadline_business_days, 5);
    assert.equal(v.pricing_version, 1);
    assert.equal(v.platform_fee_rate, 0, "l'ancienne commission vendeur est ramenée à zéro");
  });

  test("le calcul de la Protection est exact au centime", async () => {
    const cases: Array<[number, number]> = [
      [0, 70], [100, 75], [500, 95], [1000, 120], [2500, 195],
      [4500, 295], [10000, 570], [50000, 2570],
      [1, 70], [10, 71], [19, 71], [21, 71],
    ];
    for (const [price, expected] of cases) {
      const r = await db.query("SELECT buyer_protection_fee_cents($1) AS fee", [price]);
      assert.equal(r.rows[0].fee, expected, `article de ${price} centimes`);
    }
  });

  test("la tâche de versement est planifiée", async () => {
    const r = await db.query("SELECT schedule, command FROM cron.job WHERE jobname='payout-release'");
    assert.equal(r.rows.length, 1);
    assert.match(r.rows[0].command, /payout-release/);
    assert.match(r.rows[0].command, /x-cron-secret/, "l'endpoint de versement ne doit pas être appelable sans secret");
  });
});

/* ================================================================== *
 *  Limitation d'abus
 * ================================================================== */

describe("limitation par utilisateur", () => {
  test("le compteur autorise puis refuse, dans la fenêtre", async () => {
    const bucket = `checkout:${Math.random().toString(36).slice(2)}`;
    const results: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      results.push((await db.query("SELECT rate_limit_hit($1,$2,$3) AS ok", [bucket, 10, 60])).rows[0].ok);
    }
    assert.equal(results.filter((r) => r).length, 10, "exactement dix appels autorisés");
    assert.deepEqual(results.slice(10), [false, false]);
  });

  test("chaque utilisateur a son propre compteur", async () => {
    const a = `checkout:${Math.random().toString(36).slice(2)}`;
    const b = `checkout:${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 10; i++) await db.query("SELECT rate_limit_hit($1,$2,$3)", [a, 10, 60]);

    assert.equal((await db.query("SELECT rate_limit_hit($1,$2,$3) AS ok", [a, 10, 60])).rows[0].ok, false);
    assert.equal((await db.query("SELECT rate_limit_hit($1,$2,$3) AS ok", [b, 10, 60])).rows[0].ok, true,
      "saturer un compte ne doit pas bloquer les autres");
  });

  test("vingt appels concurrents ne dépassent pas le plafond", async () => {
    const bucket = `checkout:${Math.random().toString(36).slice(2)}`;
    const clients = await Promise.all(
      Array.from({ length: 20 }, async () => { const c = new pg.Client(config); await c.connect(); return c; }));
    const results = await Promise.all(clients.map((c) =>
      c.query("SELECT rate_limit_hit($1,$2,$3) AS ok", [bucket, 5, 60]).then((r) => r.rows[0].ok)));
    await Promise.all(clients.map((c) => c.end()));

    assert.equal(results.filter((r) => r).length, 5,
      "incrément et test doivent être atomiques, sinon le plafond fuit sous charge");
  });

  test("la purge retire les fenêtres anciennes et garde les récentes", async () => {
    const old = `vieux:${Math.random().toString(36).slice(2)}`;
    await db.query(
      "INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, now() - interval '3 hours', 5)", [old]);
    const recent = `recent:${Math.random().toString(36).slice(2)}`;
    await db.query("SELECT rate_limit_hit($1,10,60)", [recent]);

    await db.query("SELECT rate_limits_purge()");

    assert.equal((await db.query("SELECT count(*)::int n FROM rate_limits WHERE bucket=$1", [old])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM rate_limits WHERE bucket=$1", [recent])).rows[0].n, 1);
  });

  test("le compteur est hors de portée du navigateur", async () => {
    for (const role of ["anon", "authenticated"]) {
      const c = await connectAs(config, role, { role });
      await assert.rejects(
        () => c.query("SELECT rate_limit_hit('x',10,60)"), /permission denied for function/);
      assert.equal((await c.query("SELECT count(*)::int n FROM rate_limits")).rows[0].n, 0,
        "voir les compteurs révélerait l'activité des autres");
      await c.end();
    }
  });
});
