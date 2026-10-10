/**
 * Achat chez un vendeur dont le compte de paiement n'est pas prêt, contre un
 * vrai Postgres (migration 20261010000000_vendeur_pas_pret.sql).
 *
 * Les règles décidées le 10 octobre 2026, et ce qui les garantit ici :
 *   - l'achat passe, et le paiement pose une échéance à 7 jours ;
 *   - le vendeur ne peut pas déclarer l'expédition tant que son compte n'est
 *     pas prêt ;
 *   - s'il devient prêt avant l'échéance, la commande reprend, quel que soit
 *     le chemin qui écrit le profil ;
 *   - à l'échéance, l'annulation est décidée une seule fois, le
 *     remboursement enregistré une seule fois, et l'annonce ne remonte
 *     qu'une fois en vente ;
 *   - les relances ne partent qu'une fois chacune, jamais deux d'un coup.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, startPostgres, stopPostgres } from "./helpers/postgres.mjs";
import { migrateFresh, connectAs, connectService } from "./helpers/migrate.mjs";
import { REGLAGES_VENDEUR_PAS_PRET } from "../supabase/functions/_shared/payments.ts";
import {
  EVENEMENTS,
  traiterVendeursPasPrets,
  type VendeursPasPretsDeps,
} from "../supabase/functions/_shared/vendeur-pas-pret.ts";

let config: any;
let db: pg.Client;
let n = 0;

before(async () => {
  await startPostgres();
  const migrated = await migrateFresh("am2_vendeur_pas_pret");
  config = migrated.config;
  db = await connectService(config);
}, { timeout: 180_000 });

after(async () => {
  if (db) await db.end();
  await stopPostgres();
});

/* ------------------------------------------------------------------ *
 *  Fixtures
 * ------------------------------------------------------------------ */

async function newUser(email: string): Promise<string> {
  return (await db.query("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [email])).rows[0].id;
}

/** Vendeur : sans compte, compte non terminé, ou prêt. */
async function newSeller(etat: "sans_compte" | "en_cours" | "pret"): Promise<string> {
  const id = await newUser(`v${++n}@vpp.local`);
  if (etat !== "sans_compte") {
    await db.query("UPDATE profiles SET stripe_account_id=$2, stripe_onboarded=$3 WHERE id=$1",
      [id, `acct_vpp${n}`, etat === "pret"]);
  }
  return id;
}

async function newProduct(sellerId: string): Promise<number> {
  return (await db.query(
    `INSERT INTO products (user_id, title, period, subcategory, condition, description,
                           price, quantity, status, ship_pickup, ship_post, ship_relay)
     VALUES ($1,'Casque Adrian','1ère Guerre Mondiale','Uniformes','Bon','desc',
             45,1,'published',true,true,true) RETURNING id`, [sellerId])).rows[0].id;
}

/** Réservation puis encaissement, exactement comme create-checkout puis le
 *  webhook : checkout_reserve, puis order_settle_payment. */
async function achat(seller: string) {
  const k = ++n;
  const buyer = await newUser(`a${k}@vpp.local`);
  const product = await newProduct(seller);
  const reserved = (await db.query("SELECT * FROM checkout_reserve($1,$2,'post',NULL,$3) AS o",
    [product, buyer, `a${k}@vpp.local`])).rows[0];
  const settled = (await db.query("SELECT order_settle_payment($1::jsonb) AS r", [JSON.stringify({
    order_id: reserved.id, session_id: `cs_vpp_${k}`, payment_intent_id: `pi_vpp_${k}`,
    charge_id: `ch_vpp_${k}`, payment_status: "paid", amount_total_cents: 5685, currency: "eur",
    customer_email: `a${k}@vpp.local`, shipping_method: "post",
    shipping_address: { name: "Jean", line1: "1 rue X", postal_code: "75002", city: "Paris", country: "FR" },
  })])).rows[0].r;
  return { buyer, product, order: settled.order, k };
}

const order = async (id: string) => (await db.query("SELECT * FROM orders WHERE id=$1", [id])).rows[0];
const product = async (id: number) => (await db.query("SELECT * FROM products WHERE id=$1", [id])).rows[0];
const claim = async (id: string) =>
  (await db.query("SELECT order_seller_not_ready_cancel_claim($1) AS r", [id])).rows[0].r;
const complete = async (id: string, refund: string | null, cents: number | null) =>
  (await db.query("SELECT order_seller_not_ready_cancel_complete($1,$2,$3) AS r", [id, refund, cents])).rows[0].r;
const queue = async () => (await db.query("SELECT * FROM orders_seller_ready_queue(500)")).rows;
const inQueue = async (id: string) => (await queue()).find((r: any) => r.order_id === id);

/** Fait comme si le paiement datait de `jours` jours. */
async function vieillir(id: string, jours: number) {
  await db.query(
    `UPDATE orders SET paid_at = now() - make_interval(days => $2::int),
                       seller_ready_deadline_at = now() - make_interval(days => $2::int) + interval '7 days'
      WHERE id=$1`, [id, jours]);
}

async function asSeller(sellerId: string) {
  return connectAs(config, "authenticated", { sub: sellerId, role: "authenticated" });
}

/* ================================================================== *
 *  1. L'achat est accepté
 * ================================================================== */

describe("achat chez un vendeur pas prêt", () => {
  test("vendeur sans compte : l'achat passe, et le paiement pose l'échéance à 7 jours", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, product: p } = await achat(seller);
    assert.equal(o.status, "paid");
    assert.ok(o.seller_ready_deadline_at, "l'échéance doit être posée au paiement");
    const ecart = new Date(o.seller_ready_deadline_at).getTime() - new Date(o.paid_at).getTime();
    assert.equal(ecart, 7 * 86400_000, "7 jours exactement après le paiement");
    assert.equal(o.seller_ready_at, null);
    // La vente est une vente : l'article est vendu, rien n'est remis en ligne.
    const prod = await product(p);
    assert.equal(prod.status, "sold");
    assert.equal(prod.quantity, 0);
  });

  test("vendeur à l'inscription commencée mais non terminée : même échéance", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    assert.ok(o.seller_ready_deadline_at);
  });

  test("vendeur prêt au paiement : aucune échéance, parcours inchangé", async () => {
    const seller = await newSeller("pret");
    const { order: o } = await achat(seller);
    assert.equal(o.seller_ready_deadline_at, null);
    assert.equal(await inQueue(o.id), undefined, "rien à faire pour cette commande");
  });

  test("un rejeu du webhook ne déplace pas l'échéance", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, k } = await achat(seller);
    const avant = (await order(o.id)).seller_ready_deadline_at;
    await db.query("SELECT order_settle_payment($1::jsonb)", [JSON.stringify({
      order_id: o.id, session_id: `cs_vpp_${k}`, payment_intent_id: `pi_vpp_${k}`,
      payment_status: "paid", amount_total_cents: 5685,
    })]);
    assert.deepEqual((await order(o.id)).seller_ready_deadline_at, avant);
  });
});

/* ================================================================== *
 *  2. Garde d'expédition
 * ================================================================== */

describe("le vendeur ne peut pas expédier sans compte prêt", () => {
  test("refus clair tant que le compte n'est pas prêt, puis expédition possible", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    const c = await asSeller(seller);
    try {
      await assert.rejects(
        () => c.query("SELECT order_mark_shipped($1::uuid,'TRK1',NULL)", [o.id]),
        (err: any) => {
          assert.match(err.message, /Finalisez d'abord votre inscription au paiement/);
          assert.equal(err.hint, "SELLER_STRIPE_NOT_READY");
          return true;
        },
      );
      assert.equal((await order(o.id)).status, "paid");

      await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
      await c.query("SELECT order_mark_shipped($1::uuid,'TRK1',NULL)", [o.id]);
      assert.equal((await order(o.id)).status, "shipped");
    } finally {
      await c.end();
    }
  });

  test("le vendeur ne peut pas se déclarer prêt lui-même pour passer la garde", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    const c = await asSeller(seller);
    try {
      await c.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]).catch(() => {});
      await assert.rejects(() => c.query("SELECT order_mark_shipped($1::uuid,'TRK1',NULL)", [o.id]),
        /Finalisez d'abord/);
      assert.equal((await order(o.id)).seller_ready_at, null, "aucune reprise sur une écriture refusée");
    } finally {
      await c.end();
    }
  });

  test("commande annulée à l'échéance : expédition refusée, même si le vendeur devient prêt", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 8);
    assert.equal((await claim(o.id)).decision, "annuler");
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);

    const c = await asSeller(seller);
    try {
      await assert.rejects(
        () => c.query("SELECT order_mark_shipped($1::uuid,'TRK1',NULL)", [o.id]),
        (err: any) => err.hint === "ORDER_CANCELED_SELLER_NOT_READY",
      );
    } finally {
      await c.end();
    }
  });
});

/* ================================================================== *
 *  3. Reprise
 * ================================================================== */

describe("reprise quand le vendeur devient prêt", () => {
  test("le profil devient prêt avant l'échéance : la commande reprend, le délai d'expédition repart", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 4);
    await db.query("UPDATE orders SET ship_deadline_at = now() - interval '1 day' WHERE id=$1", [o.id]);

    // Ce que font le webhook account.updated, le retour d'inscription et la
    // surveillance : écrire stripe_onboarded avec le jeton de service.
    await db.query("UPDATE profiles SET stripe_onboarded=true, stripe_onboarded_at=now() WHERE id=$1", [seller]);

    const after = await order(o.id);
    assert.ok(after.seller_ready_at, "la commande doit reprendre");
    assert.ok(new Date(after.ship_deadline_at).getTime() > Date.now() + 4 * 86400_000,
      "5 jours ouvrés à partir de maintenant, pas du paiement");
    const row = await inQueue(o.id);
    assert.equal(row?.phase, "reprise", "les courriels de reprise sont à envoyer");
    assert.equal((await claim(o.id)).decision, "hors_champ", "plus rien à annuler");
  });

  test("un compte devenu prêt reprend toutes ses commandes en attente, et seulement elles", async () => {
    const seller = await newSeller("sans_compte");
    const a = await achat(seller);
    const b = await achat(seller);
    const autre = await achat(await newSeller("sans_compte"));
    await db.query("UPDATE profiles SET stripe_account_id='acct_nouveau_vpp', stripe_onboarded=true WHERE id=$1", [seller]);
    assert.ok((await order(a.order.id)).seller_ready_at);
    assert.ok((await order(b.order.id)).seller_ready_at);
    assert.equal((await order(autre.order.id)).seller_ready_at, null);
  });

  test("devenu prêt après l'échéance : la commande n'est pas sauvée", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 8);
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
    assert.equal((await order(o.id)).seller_ready_at, null, "l'échéance annoncée à l'acheteur s'applique");
    assert.equal((await claim(o.id)).decision, "annuler");
  });

  test("filet : prêt en base mais reprise manquée, la décision fait reprendre avant l'échéance", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    // Écriture directe qui contourne le déclencheur (désactivé le temps de
    // l'écriture), pour simuler une reprise manquée.
    await db.query("ALTER TABLE profiles DISABLE TRIGGER profiles_reprise_commandes");
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
    await db.query("ALTER TABLE profiles ENABLE TRIGGER profiles_reprise_commandes");
    const r = await claim(o.id);
    assert.equal(r.decision, "pret");
    assert.ok((await order(o.id)).seller_ready_at);
  });

  test("après la reprise, le parcours normal va jusqu'au versement", async () => {
    const seller = await newSeller("en_cours");
    const { order: o, buyer } = await achat(seller);
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);

    const s = await asSeller(seller);
    await s.query("SELECT order_mark_shipped($1::uuid,'TRK9',NULL)", [o.id]);
    await s.end();
    const a = await connectAs(config, "authenticated", { sub: buyer, role: "authenticated" });
    await a.query("SELECT order_confirm_receipt($1::uuid)", [o.id]);
    await a.end();

    // 48 h de fenêtre et 24 h de garde écoulées.
    await db.query(`UPDATE orders SET paid_at = now() - interval '3 days',
                     report_window_ends_at = now() - interval '1 minute' WHERE id=$1`, [o.id]);
    const ready = (await db.query("SELECT * FROM orders_ready_for_payout(100)")).rows;
    assert.ok(ready.some((r: any) => r.order_id === o.id), "le versement doit devenir possible");
  });
});

/* ================================================================== *
 *  4. Échéance, annulation et remboursement uniques
 * ================================================================== */

describe("échéance : annulation et remboursement, une seule fois", () => {
  test("avant l'échéance : rien n'est annulé", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 6);
    const r = await claim(o.id);
    assert.equal(r.decision, "pas_encore");
    assert.equal((await order(o.id)).seller_ready_cancel_at, null);
  });

  test("après l'échéance : décision unique, remboursement intégral, annonce remise en vente une fois", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, product: p } = await achat(seller);
    await vieillir(o.id, 7);
    assert.equal((await inQueue(o.id))?.phase, "echeance");

    const r1 = await claim(o.id);
    assert.equal(r1.decision, "annuler");
    const decideLe = (await order(o.id)).seller_ready_cancel_at;
    assert.ok(decideLe);

    // Un second passage (remboursement en échec, tâche relancée) retombe sur
    // la même décision, sans la redater.
    const r2 = await claim(o.id);
    assert.equal(r2.decision, "annuler");
    assert.deepEqual((await order(o.id)).seller_ready_cancel_at, decideLe);
    assert.equal((await inQueue(o.id))?.phase, "annulation");

    const c1 = await complete(o.id, "re_vpp_1", 5685);
    assert.equal(c1.changed, true);
    const after = await order(o.id);
    assert.equal(after.status, "refunded");
    assert.equal(after.amount_refunded_cents, 5685, "prix, port et Protection acheteurs");
    assert.equal(after.seller_ready_refund_id, "re_vpp_1");
    assert.equal(after.payout_state, "not_applicable", "rien ne sera jamais versé");
    const prod = await product(p);
    assert.equal(prod.status, "published", "l'annonce revient en vente");
    assert.equal(prod.quantity, 1);

    const c2 = await complete(o.id, "re_vpp_1", 5685);
    assert.equal(c2.changed, false);
    assert.equal((await product(p)).quantity, 1, "l'annonce ne remonte qu'une fois");
    assert.equal((await claim(o.id)).decision, "deja_rembourse");
  });

  test("le webhook charge.refunded arrive avant l'écriture de la tâche : un seul retour en stock", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, product: p, k } = await achat(seller);
    await vieillir(o.id, 8);
    assert.equal((await claim(o.id)).decision, "annuler");

    const w = (await db.query("SELECT order_apply_refund($1,$2,$3,$4) AS r",
      [`pi_vpp_${k}`, `ch_vpp_${k}`, 5685, true])).rows[0].r;
    assert.equal(w.changed, true);
    assert.equal(w.order.seller_ready_cancel_at !== null, true,
      "le webhook voit que c'est l'annulation automatique (il n'écrit pas à l'acheteur)");

    const c = await complete(o.id, null, 5685);
    assert.equal(c.changed, true);
    assert.equal((await product(p)).quantity, 1);
    const after = await order(o.id);
    assert.equal(after.status, "refunded");
    assert.equal(after.payout_state, "not_applicable", "plus de « versement suspendu » perpétuel");
  });

  test("décisions concurrentes : une seule date de décision", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 9);
    const clients = await Promise.all(Array.from({ length: 5 }, async () => {
      const c = new pg.Client(config); await c.connect(); return c;
    }));
    const res = await Promise.all(clients.map((c) =>
      c.query("SELECT order_seller_not_ready_cancel_claim($1) AS r", [o.id]).then((r) => r.rows[0].r)));
    await Promise.all(clients.map((c) => c.end()));
    assert.ok(res.every((r: any) => r.decision === "annuler"));
    const dates = new Set(res.map((r: any) => r.order.seller_ready_cancel_at));
    assert.equal(dates.size, 1, "la décision n'est prise qu'une fois");
  });

  test("litige bancaire ouvert : pas d'annulation automatique (Stripe refuserait le remboursement)", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 8);
    await db.query("UPDATE orders SET chargeback_status='needs_response' WHERE id=$1", [o.id]);
    assert.equal(await inQueue(o.id), undefined);
    assert.equal((await claim(o.id)).decision, "hors_champ");
  });

  test("déjà remboursée à la main : la tâche n'y touche pas", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, k } = await achat(seller);
    await db.query("SELECT order_apply_refund($1,$2,$3,$4)", [`pi_vpp_${k}`, `ch_vpp_${k}`, 5685, true]);
    await vieillir(o.id, 8);
    assert.equal(await inQueue(o.id), undefined);
    assert.equal((await claim(o.id)).decision, "hors_champ");
  });

  test("après l'annulation, la file réclame les deux courriels jusqu'à leur envoi", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 8);
    await claim(o.id);
    await complete(o.id, "re_vpp_q", 5685);
    assert.equal((await inQueue(o.id))?.phase, "annulee");
    await db.query("SELECT order_notification_claim($1,'vendeur_pas_pret_annulation_acheteur')", [o.id]);
    assert.equal((await inQueue(o.id))?.phase, "annulee", "le courriel au vendeur manque encore");
    await db.query("SELECT order_notification_claim($1,'vendeur_pas_pret_annulation_vendeur')", [o.id]);
    assert.equal(await inQueue(o.id), undefined);
  });
});

/* ================================================================== *
 *  5. Relances sans doublon
 * ================================================================== */

describe("relances", () => {
  test("aucune relance le jour du paiement", async () => {
    const { order: o } = await achat(await newSeller("sans_compte"));
    assert.equal(await inQueue(o.id), undefined);
  });

  test("à J+2 la première, une seule fois", async () => {
    const { order: o } = await achat(await newSeller("sans_compte"));
    await vieillir(o.id, 3);
    const row = await inQueue(o.id);
    assert.equal(row?.phase, "attente");
    assert.equal(row?.relance, "relance_1");

    const premier = (await db.query("SELECT order_notification_claim($1,'vendeur_pas_pret_relance_1') AS r", [o.id])).rows[0].r;
    const second = (await db.query("SELECT order_notification_claim($1,'vendeur_pas_pret_relance_1') AS r", [o.id])).rows[0].r;
    assert.equal(premier, true);
    assert.equal(second, false, "un second passage ne renvoie pas la relance");
    assert.equal(await inQueue(o.id), undefined);
  });

  test("à J+5 la seconde ; une première manquée n'est pas envoyée en plus", async () => {
    const { order: o } = await achat(await newSeller("sans_compte"));
    await vieillir(o.id, 5);
    const row = await inQueue(o.id);
    assert.equal(row?.relance, "relance_2", "seule la plus récente part, jamais deux d'un coup");
    await db.query("SELECT order_notification_claim($1,'vendeur_pas_pret_relance_2')", [o.id]);
    assert.equal(await inQueue(o.id), undefined);
  });

  test("dans l'heure qui précède l'échéance, la commande est relue même sans relance due", async () => {
    const { order: o } = await achat(await newSeller("en_cours"));
    await db.query(`UPDATE orders SET paid_at = now() - interval '7 days' + interval '30 minutes',
                     seller_ready_deadline_at = now() + interval '30 minutes' WHERE id=$1`, [o.id]);
    await db.query("SELECT order_notification_claim($1,'vendeur_pas_pret_relance_2')", [o.id]);
    const row = await inQueue(o.id);
    assert.equal(row?.phase, "attente");
    assert.equal(row?.relance, null);
    assert.equal(row?.echeance_proche, true);
    assert.ok(row?.seller_account_id, "le compte à relire est fourni");
  });

  test("vendeur devenu prêt : plus aucune relance", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 3);
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
    const row = await inQueue(o.id);
    assert.equal(row?.phase, "reprise");
    assert.equal(row?.relance, null);
  });
});

/* ================================================================== *
 *  6. Revue manuelle et droits
 * ================================================================== */

describe("à côté", () => {
  test("une commande qui attend le vendeur n'est pas signalée « expédition en retard »", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o } = await achat(seller);
    await db.query("UPDATE orders SET ship_deadline_at = now() - interval '1 hour' WHERE id=$1", [o.id]);
    const flagged = (await db.query("SELECT * FROM orders_flag_manual_review()")).rows;
    assert.equal(flagged.some((r: any) => r.order_id === o.id), false);
    assert.equal((await order(o.id)).needs_review, false,
      "sinon le versement resterait bloqué après la reprise");
  });

  test("une commande ordinaire en retard reste signalée", async () => {
    const { order: o } = await achat(await newSeller("pret"));
    await db.query("UPDATE orders SET ship_deadline_at = now() - interval '1 hour' WHERE id=$1", [o.id]);
    const flagged = (await db.query("SELECT * FROM orders_flag_manual_review()")).rows;
    assert.ok(flagged.some((r: any) => r.order_id === o.id));
  });

  test("les fonctions de la tâche ne sont pas appelables depuis le site", async () => {
    const { order: o } = await achat(await newSeller("sans_compte"));
    for (const role of ["anon", "authenticated"]) {
      const c = await connectAs(config, role, role === "authenticated" ? { sub: o.buyer_id, role } : null);
      try {
        for (const sql of [
          "SELECT order_seller_not_ready_cancel_claim($1::uuid)",
          "SELECT order_seller_not_ready_cancel_complete($1::uuid, 're_x', 1)",
          "SELECT order_seller_not_ready_cancel_failed($1::uuid, 'x')",
          "SELECT * FROM orders_seller_ready_queue(10) WHERE order_id = $1::uuid",
          "SELECT seller_payout_ready($1::uuid)",
        ]) {
          await assert.rejects(() => c.query(sql, [o.id]), /permission denied/, `${role} : ${sql}`);
        }
      } finally {
        await c.end();
      }
    }
  });

  test("l'acheteur et le vendeur lisent l'échéance sur leur commande", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, buyer } = await achat(seller);
    for (const sub of [buyer, seller]) {
      const c = await connectAs(config, "authenticated", { sub, role: "authenticated" });
      const row = (await c.query("SELECT seller_ready_deadline_at FROM orders WHERE id=$1", [o.id])).rows[0];
      await c.end();
      assert.ok(row?.seller_ready_deadline_at, "Mon compte doit pouvoir l'afficher");
    }
  });

  test("la migration se rejoue sans erreur et sans toucher aux commandes en cours", async () => {
    // Elle sera collée à la main dans l'éditeur SQL : un second collage par
    // erreur ne doit rien casser ni rien redater.
    const seller = await newSeller("sans_compte");
    const { order: o } = await achat(seller);
    const avant = await order(o.id);
    const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "20261010000000_vendeur_pas_pret.sql"), "utf8");
    await db.query(sql);
    const apres = await order(o.id);
    assert.deepEqual(apres.seller_ready_deadline_at, avant.seller_ready_deadline_at);
    assert.equal((await db.query(
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('orders_seller_ready_deadline','profiles_reprise_commandes')"))
      .rows[0].n, 2, "chaque déclencheur une seule fois");
  });

  test("la tâche horaire existante est réutilisée : aucune nouvelle planification", async () => {
    const jobs = (await db.query("SELECT jobname, schedule FROM cron.job ORDER BY jobname")).rows;
    const payout = jobs.find((j: any) => j.jobname === "payout-release");
    assert.ok(payout, "payout-release doit rester planifiée");
    assert.equal(payout.schedule, "7 * * * *", "toutes les heures");
  });
});

/* ================================================================== *
 *  7. Corrections du contrôle du 10 octobre 2026
 * ================================================================== */

/** Écrit stripe_onboarded sans passer par le déclencheur de reprise : ce que
 *  produit une course entre le paiement et le webhook Connect (le
 *  déclencheur de profiles ne voit pas une commande dont le paiement n'est
 *  pas encore validé). */
async function pretSansReprise(seller: string) {
  await db.query("ALTER TABLE profiles DISABLE TRIGGER profiles_reprise_commandes");
  try {
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
  } finally {
    await db.query("ALTER TABLE profiles ENABLE TRIGGER profiles_reprise_commandes");
  }
}

async function expedier(seller: string, orderId: string, suivi = "TRK-C") {
  const c = await asSeller(seller);
  try {
    // FROM et non (f()).* : cette dernière forme appelle la fonction une
    // fois par colonne.
    return (await c.query("SELECT * FROM order_mark_shipped($1::uuid,$2,NULL)", [orderId, suivi])).rows[0];
  } finally {
    await c.end();
  }
}

describe("invariant : jamais d'expédition sur une commande que l'annulation peut rembourser", () => {
  test("échéance passée, vendeur devenu prêt avant le passage horaire : expédition refusée", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 8);
    // Devenu prêt après l'échéance : le déclencheur ne fait pas reprendre.
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
    assert.equal((await order(o.id)).seller_ready_cancel_at, null, "la décision n'est pas encore prise");
    await assert.rejects(() => expedier(seller, o.id), (err: any) => {
      assert.equal(err.hint, "ORDER_CANCELED_SELLER_NOT_READY");
      assert.match(err.message, /N'expédiez pas l'article/);
      return true;
    });
    assert.equal((await order(o.id)).status, "paid");
    assert.equal((await claim(o.id)).decision, "annuler", "l'échéance s'applique comme annoncé");
  });

  test("course paiement / webhook Connect : l'expédition constate la reprise, et la commande sort du champ", async () => {
    const seller = await newSeller("en_cours");
    const { order: o, buyer } = await achat(seller);
    await pretSansReprise(seller);
    assert.equal((await order(o.id)).seller_ready_at, null);

    const shipped = await expedier(seller, o.id);
    assert.equal(shipped.status, "shipped");
    assert.ok(shipped.seller_ready_at, "seller_ready_at posé à l'expédition");

    // L'acheteur signale un problème après l'échéance : rien d'automatique.
    const a = await connectAs(config, "authenticated", { sub: buyer, role: "authenticated" });
    try {
      await a.query("SELECT order_report_dispute($1::uuid, 'Le colis n''est jamais arrivé chez moi')", [o.id]);
    } finally {
      await a.end();
    }
    await db.query("UPDATE orders SET seller_ready_deadline_at = now() - interval '1 day' WHERE id=$1", [o.id]);
    assert.equal((await order(o.id)).status, "disputed");
    assert.equal(await inQueue(o.id), undefined);
    assert.equal((await claim(o.id)).decision, "hors_champ");
    assert.equal((await order(o.id)).seller_ready_cancel_at, null);
  });

  test("commande expédiée sans reprise notée puis en litige (état d'avant correction) : jamais annulée", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 8);
    await db.query(`UPDATE orders SET status='disputed', shipped_at=now() - interval '2 days',
                     tracking_number='TRK-ANCIEN' WHERE id=$1`, [o.id]);
    assert.equal(await inQueue(o.id), undefined, "pas dans la file de payout-release");
    const r = await claim(o.id);
    assert.equal(r.decision, "hors_champ");
    assert.equal(r.motif, "déjà déclarée expédiée");
  });

  test("vendeur prêt au paiement puis plus prêt (justificatif demandé) : il peut toujours expédier, comme avant", async () => {
    const seller = await newSeller("pret");
    const { order: o } = await achat(seller);
    assert.equal(o.seller_ready_deadline_at, null);
    await db.query("UPDATE profiles SET stripe_onboarded=false WHERE id=$1", [seller]);
    const shipped = await expedier(seller, o.id);
    assert.equal(shipped.status, "shipped", "le versement attendra son compte (orders_ready_for_payout)");
    assert.equal(shipped.seller_ready_at, null, "aucune reprise inventée hors du dispositif");
  });

  test("après l'expédition, plus de courriel « vous pouvez expédier »", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await db.query("UPDATE profiles SET stripe_onboarded=true WHERE id=$1", [seller]);
    assert.equal((await inQueue(o.id))?.phase, "reprise");
    await expedier(seller, o.id);
    assert.equal(await inQueue(o.id), undefined);
  });
});

describe("vendeur prêt en base sans reprise constatée", () => {
  test("la file le propose dès maintenant, sans attendre une relance, et la décision fait reprendre", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await pretSansReprise(seller);
    const row = await inQueue(o.id);
    assert.equal(row?.phase, "attente");
    assert.equal(row?.relance, null, "aucune relance due le jour même");
    assert.equal(row?.seller_onboarded, true);
    assert.equal((await claim(o.id)).decision, "pret");
    assert.equal((await inQueue(o.id))?.phase, "reprise");
  });
});

describe("remboursement : cumul, échecs, codes neutres", () => {
  test("remboursement partiel entre la décision et le remboursement, puis webhook : l'annonce ne remonte qu'une fois", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, product: p, k } = await achat(seller);
    await vieillir(o.id, 8);
    assert.equal((await claim(o.id)).decision, "annuler");

    // Remboursement partiel fait à la main, constaté par le webhook.
    await db.query("SELECT order_apply_refund($1,$2,1000,false)", [`pi_vpp_${k}`, `ch_vpp_${k}`]);
    // La tâche rembourse le reste (4 685 c) et enregistre.
    const c = await complete(o.id, "re_reste", 4685);
    assert.equal(c.changed, true);
    const after = await order(o.id);
    assert.equal(after.status, "refunded");
    assert.equal(after.amount_refunded_cents, 5685, "le cumul, comme charge.amount_refunded");
    assert.equal((await product(p)).quantity, 1);

    // Le webhook charge.refunded du solde arrive avec le cumul.
    const w = (await db.query("SELECT order_apply_refund($1,$2,5685,true) AS r", [`pi_vpp_${k}`, `ch_vpp_${k}`])).rows[0].r;
    assert.equal(w.changed, false, "rien à refaire");
    assert.equal((await product(p)).quantity, 1, "pièce unique : vendable une seule fois");
  });

  test("échec noté : code neutre, compteur de tentatives, lisible sans détail par l'acheteur", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, buyer } = await achat(seller);
    await vieillir(o.id, 8);
    await claim(o.id);
    const n1 = (await db.query("SELECT order_seller_not_ready_cancel_failed($1,'refund_failed') AS r", [o.id])).rows[0].r;
    const n2 = (await db.query("SELECT order_seller_not_ready_cancel_failed($1,'refund_failed') AS r", [o.id])).rows[0].r;
    assert.deepEqual([n1, n2], [1, 2]);
    const a = await connectAs(config, "authenticated", { sub: buyer, role: "authenticated" });
    try {
      const row = (await a.query("SELECT seller_ready_last_error FROM orders WHERE id=$1", [o.id])).rows[0];
      assert.equal(row.seller_ready_last_error, "refund_failed");
    } finally {
      await a.end();
    }
    // Une fois remboursée, plus rien n'est noté.
    await complete(o.id, "re_ok", 5685);
    const n3 = (await db.query("SELECT order_seller_not_ready_cancel_failed($1,'refund_failed') AS r", [o.id])).rows[0].r;
    assert.equal(n3, null);
    assert.equal((await order(o.id)).seller_ready_last_error, null);
  });
});

describe("les textes et la base disent les mêmes délais", () => {
  test("platform_settings = REGLAGES_VENDEUR_PAS_PRET", async () => {
    const rows = (await db.query(`SELECT key, value::int AS v FROM platform_settings
      WHERE key IN ('seller_ready_days','seller_ready_reminder_1_days','seller_ready_reminder_2_days',
                    'shipping_deadline_business_days')`)).rows;
    const v = Object.fromEntries(rows.map((r: any) => [r.key, r.v]));
    assert.equal(v.seller_ready_days, REGLAGES_VENDEUR_PAS_PRET.joursEcheance);
    assert.equal(v.seller_ready_reminder_1_days, REGLAGES_VENDEUR_PAS_PRET.relance1Jours);
    assert.equal(v.seller_ready_reminder_2_days, REGLAGES_VENDEUR_PAS_PRET.relance2Jours);
    assert.equal(v.shipping_deadline_business_days, REGLAGES_VENDEUR_PAS_PRET.joursOuvresExpedition);
  });
});

/* ================================================================== *
 *  8. Bout en bout : le module de payout-release branché sur la vraie base
 *
 *  Le harnais unitaire fabrique les lignes de la file à la main : une
 *  colonne renommée d'un côté passerait inaperçue. Ici, traiterVendeursPasPrets
 *  appelle les vraies fonctions SQL ; seuls Stripe et l'envoi des courriels
 *  sont simulés.
 * ================================================================== */

const RPC_AUTORISEES = new Set([
  "orders_seller_ready_queue", "order_notification_claim", "order_notification_release",
  "order_seller_not_ready_cancel_claim", "order_seller_not_ready_cancel_complete",
  "order_seller_not_ready_cancel_failed",
]);

/** Comme PostgREST : dates en chaînes ISO. */
function enJson(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}

/** `seulement` : la base est partagée par tout le fichier, et la file
 *  contient les commandes des autres tests ; on ne garde que celles du test
 *  (le filtre porte sur la sortie de la vraie fonction, pas sur sa forme). */
function depsReelles(seulement: string[], opts: { refund?: (p: any) => any } = {}) {
  const remboursements: any[] = [];
  const courriels: Array<{ to: string; sujet: string }> = [];
  const relectures: string[] = [];
  const deps: VendeursPasPretsDeps = {
    async rpc(name, args) {
      assert.ok(RPC_AUTORISEES.has(name), `rpc inattendue : ${name}`);
      try {
        if (name === "orders_seller_ready_queue") {
          const r = await db.query("SELECT * FROM public.orders_seller_ready_queue($1)", [args.p_limit]);
          return { data: r.rows.filter((row: any) => seulement.includes(row.order_id)).map(enJson), error: null };
        }
        const cles = Object.keys(args);
        const r = await db.query(
          `SELECT public.${name}(${cles.map((c, i) => `${c} => $${i + 1}`).join(", ")}) AS r`,
          cles.map((c) => args[c]));
        return { data: r.rows[0].r, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    },
    stripe: {
      refunds: {
        async create(params, options) {
          remboursements.push({ params, options });
          if (opts.refund) return opts.refund(params);
          return { id: `re_e2e_${remboursements.length}`, amount: 5685, status: "succeeded" };
        },
      },
    },
    async relireVendeur(sellerId) {
      relectures.push(sellerId);
      return false;
    },
    async emailUtilisateur(userId) {
      return (await db.query("SELECT email FROM auth.users WHERE id=$1", [userId])).rows[0]?.email ?? null;
    },
    async envoyer(to, sujet) {
      courriels.push({ to, sujet });
      return true;
    },
    journal: () => {},
    limite: 500,
  };
  return { deps, remboursements, courriels, relectures };
}

describe("bout en bout avec la vraie base", () => {
  test("achat, relance à J+3 une fois, annulation à J+8 une fois, puis plus rien", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o, product: p, k } = await achat(seller);
    const vendeurMail = (await db.query("SELECT email FROM auth.users WHERE id=$1", [seller])).rows[0].email;
    const pour = (h: ReturnType<typeof depsReelles>, to: string) => h.courriels.filter((c) => c.to === to);

    await vieillir(o.id, 3);
    const h = depsReelles([o.id]);
    await traiterVendeursPasPrets(h.deps);
    await traiterVendeursPasPrets(h.deps);
    assert.equal(pour(h, vendeurMail).length, 1, "une seule relance");
    assert.match(pour(h, vendeurMail)[0].sujet, /^Rappel/);
    assert.equal(h.remboursements.length, 0);

    await vieillir(o.id, 8);
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.remboursements.length, 1);
    assert.equal(h.remboursements[0].params.payment_intent, `pi_vpp_${k}`);
    assert.equal(h.remboursements[0].options.idempotencyKey, `vendeur-pas-pret:${o.id}`);
    const after = await order(o.id);
    assert.equal(after.status, "refunded");
    assert.equal(after.amount_refunded_cents, 5685);
    assert.equal(after.payout_state, "not_applicable");
    assert.equal((await product(p)).quantity, 1);
    assert.equal(pour(h, `a${k}@vpp.local`).length, 1, "un courriel à l'acheteur");
    assert.match(pour(h, `a${k}@vpp.local`)[0].sujet, /annulée et remboursée/);
    assert.equal(pour(h, vendeurMail).length, 2, "relance, puis annulation");

    const avant = h.courriels.length;
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.remboursements.length, 1, "pas de second remboursement");
    assert.equal(h.courriels.length, avant, "pas de second courriel");
    const notes = (await db.query("SELECT event FROM order_notifications WHERE order_id=$1 ORDER BY event", [o.id])).rows
      .map((r: any) => r.event);
    assert.deepEqual(notes, [EVENEMENTS.annulationAcheteur, EVENEMENTS.annulationVendeur, EVENEMENTS.relance_1].sort());
  });

  test("refus Stripe puis nouvel essai : nouvelle clé, puis remboursement", async () => {
    const seller = await newSeller("sans_compte");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 8);
    let refuser = true;
    const h = depsReelles([o.id], {
      refund: () => {
        if (refuser) throw Object.assign(new Error("Insufficient funds"), { code: "balance_insufficient" });
        return { id: "re_apres", amount: 5685, status: "succeeded" };
      },
    });
    const b1 = await traiterVendeursPasPrets(h.deps);
    assert.equal(b1.annulations, 0);
    assert.equal((await order(o.id)).seller_ready_last_error, "refund_failed");
    refuser = false;
    await traiterVendeursPasPrets(h.deps);
    assert.deepEqual(h.remboursements.map((r) => r.options.idempotencyKey),
      [`vendeur-pas-pret:${o.id}`, `vendeur-pas-pret:${o.id}:1`]);
    assert.equal((await order(o.id)).status, "refunded");
  });

  test("vendeur prêt en base sans reprise : reprise constatée sans appel à Stripe, sans relance", async () => {
    const seller = await newSeller("en_cours");
    const { order: o } = await achat(seller);
    await vieillir(o.id, 3);
    await pretSansReprise(seller);
    const h = depsReelles([o.id]);
    const b = await traiterVendeursPasPrets(h.deps);
    assert.deepEqual(h.relectures, []);
    assert.equal(b.reprises, 1);
    assert.equal(b.relances, 0);
    assert.ok((await order(o.id)).seller_ready_at);
    assert.ok(h.courriels.some((c) => /^Vous pouvez expédier/.test(c.sujet)));
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.courriels.length, 2, "les deux courriels de reprise, une fois chacun");
  });
});
