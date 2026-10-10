/**
 * Statut d'une annonce, sur un vrai PostgreSQL : la garde
 * 20261010000300_statut_annonce_garde.sql (audit du 10 oct. 2026, CODE-09
 * et CODE-10), rejouée avec tout l'historique du schéma.
 *
 * Chaque identité est une connexion telle que PostgREST l'établit (SET ROLE
 * et revendications JWT) : vendeur, autre membre, administrateur, service.
 * Le paiement passe par la vraie fonction order_settle_payment, appelée
 * comme le fait stripe-webhook, avec la clé de service.
 *
 * La lecture du SQL et de la fenêtre de modification est dans
 * tests/statut-annonce.test.ts.
 *
 * Lancement : npm run test:db
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { startPostgres, stopPostgres, sqlFile } from "./helpers/postgres.mjs";
import { migrateFresh, connectAs, connectService } from "./helpers/migrate.mjs";

const ADMIN = "sayrox.ar@gmail.com";

let config: any;
let db: pg.Client;
const ids: Record<string, string> = {};

async function nouvelUtilisateur(cle: string, email: string) {
  const r = await db.query("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [email]);
  ids[cle] = r.rows[0].id;
}

async function nouvelleAnnonce(statut = "published", quantite = 1): Promise<number> {
  const r = await db.query(
    `INSERT INTO products (user_id, title, period, subcategory, condition, description,
                           price, quantity, status, ship_pickup, ship_post, ship_relay)
     VALUES ($1,'Casque Adrian','1ère Guerre Mondiale','Uniformes','Bon','desc',45,$2,$3,true,true,true)
     RETURNING id`,
    [ids.vendeur, quantite, statut],
  );
  return r.rows[0].id;
}

/* Annonce retirée par la modération telle qu'elle existe vraiment : une
   commande la référence (admin_moderer_signalement ne retire, au lieu de
   supprimer, que dans ce cas), et c'est par cette commande que le vendeur
   la voit encore (politique « Order parties can read product »). Sans ligne
   visible, PostgREST ne modifierait rien, garde ou pas. */
let numeroCommande = 0;
async function annonceRetiree(acheteur = ids.acheteur): Promise<number> {
  const p = await nouvelleAnnonce();
  await db.query(
    `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id)
     VALUES ($1,$2,$3,'completed',45,$4)`, [p, acheteur, ids.vendeur, "cs_retrait_" + ++numeroCommande]);
  await db.query("UPDATE products SET status='removed' WHERE id=$1", [p]);
  return p;
}

const statut = async (id: number) =>
  (await db.query("SELECT status, sold_at FROM products WHERE id=$1", [id])).rows[0];

/** Exécute une requête sous une identité, puis ferme la connexion. */
async function sous(role: "vendeur" | "autre" | "admin" | "service", sql: string, params: unknown[] = []) {
  const c = role === "service"
    ? await connectAs(config, "service_role", { role: "service_role" })
    : await connectAs(config, "authenticated", {
      sub: role === "admin" ? ids.admin : role === "autre" ? ids.autre : ids.vendeur,
      role: "authenticated",
      email: role === "admin" ? ADMIN : role === "autre" ? "autre@test.local" : "vendeur@test.local",
    });
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

/** Refus attendu : le code 42501 que le site traduit en « droits insuffisants ». */
async function refuse(promesse: Promise<unknown>, motif: RegExp) {
  await assert.rejects(promesse, (err: any) => {
    assert.equal(err.code, "42501", `code inattendu : ${err.code} ${err.message}`);
    assert.match(err.message, motif);
    return true;
  });
}

before(async () => {
  await startPostgres();
  const migrated = await migrateFresh("am2_statut_annonce");
  config = migrated.config;
  db = await connectService(config);
  await nouvelUtilisateur("vendeur", "vendeur@test.local");
  await nouvelUtilisateur("autre", "autre@test.local");
  await nouvelUtilisateur("acheteur", "acheteur@test.local");
  await nouvelUtilisateur("admin", ADMIN);
  await db.query("UPDATE profiles SET stripe_account_id='acct_test_statut', stripe_onboarded=true WHERE id=$1", [ids.vendeur]);
}, { timeout: 180_000 });

after(async () => {
  if (db) await db.end();
  await stopPostgres();
});

describe("le vendeur", () => {
  test("ne peut pas passer son annonce en « vendu » sans vente", async () => {
    const p = await nouvelleAnnonce();
    await refuse(sous("vendeur", "UPDATE products SET status='sold' WHERE id=$1", [p]), /vendu/);
    const apres = await statut(p);
    assert.equal(apres.status, "published");
    assert.equal(apres.sold_at, null, "rien n'entre dans l'archive des ventes");
  });

  test("ne peut pas créer une annonce déjà « vendue »", async () => {
    await refuse(
      sous("vendeur",
        `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, status, sold_at)
         VALUES ($1,'Faux vendu','1ère Guerre Mondiale','Uniformes','Bon',999,0,'sold',now())`, [ids.vendeur]),
      /vendu/,
    );
  });

  test("peut retirer son annonce de la vente (brouillon) et la republier", async () => {
    const p = await nouvelleAnnonce();
    const r1 = await sous("vendeur", "UPDATE products SET status='draft' WHERE id=$1 RETURNING status", [p]);
    assert.equal(r1.rows[0].status, "draft");
    const r2 = await sous("vendeur", "UPDATE products SET status='published' WHERE id=$1 RETURNING status", [p]);
    assert.equal(r2.rows[0].status, "published");
  });

  test("peut publier ou enregistrer un brouillon à la création", async () => {
    for (const s of ["published", "draft"]) {
      const r = await sous("vendeur",
        `INSERT INTO products (user_id, title, period, subcategory, condition, price, quantity, status)
         VALUES ($1,'Annonce','1ère Guerre Mondiale','Uniformes','Bon',10,1,$2) RETURNING status`, [ids.vendeur, s]);
      assert.equal(r.rows[0].status, s);
    }
  });

  test("ne peut pas remettre en ligne une annonce retirée par la modération", async () => {
    const p = await annonceRetiree();
    // Le vendeur voit bien la ligne : sans la garde, la requête passait.
    const vue = await sous("vendeur", "SELECT status FROM products WHERE id=$1", [p]);
    assert.equal(vue.rows[0]?.status, "removed");
    for (const s of ["published", "draft", "sold"]) {
      await refuse(sous("vendeur", "UPDATE products SET status=$2 WHERE id=$1", [p, s]), /modération|vendu/);
    }
    assert.equal((await statut(p)).status, "removed");
  });

  test("peut encore enregistrer une annonce vendue ou retirée sans changer son statut", async () => {
    // La fenêtre de modification renvoie toujours le statut, inchangé.
    const retiree = await annonceRetiree();
    const r1 = await sous("vendeur",
      "UPDATE products SET title='Casque Adrian, bombe repeinte', status='removed' WHERE id=$1 RETURNING status", [retiree]);
    assert.equal(r1.rowCount, 1);

    const vendue = await nouvelleAnnonce();
    await db.query("UPDATE products SET status='sold', quantity=0 WHERE id=$1", [vendue]);
    const r2 = await sous("vendeur",
      "UPDATE products SET description='Précisions', status='sold' WHERE id=$1 RETURNING status", [vendue]);
    assert.equal(r2.rows[0].status, "sold");
  });

  test("un autre membre n'atteint même pas la ligne (politique inchangée)", async () => {
    const p = await nouvelleAnnonce();
    const r = await sous("autre", "UPDATE products SET status='draft' WHERE id=$1", [p]);
    assert.equal(r.rowCount, 0);
  });
});

describe("ce qui passe la garde", () => {
  test("un paiement reçu (order_settle_payment, clé de service) marque l'annonce vendue", async () => {
    const p = await nouvelleAnnonce("published", 1);
    const reservation = await sous("service",
      "SELECT * FROM checkout_reserve($1,$2,'post',NULL,'acheteur@test.local') AS o", [p, ids.acheteur]);
    const o = reservation.rows[0];
    const charge = JSON.stringify({
      order_id: o.id, session_id: "cs_paiement_statut", payment_intent_id: "pi_paiement_statut", charge_id: "ch_paiement_statut",
      payment_status: "paid", amount_total_cents: o.amount_total_cents, currency: "eur",
      customer_email: "acheteur@test.local", product_id: null, seller_id: null, buyer_id: null,
      shipping_method: "post", relay_postal: null,
      shipping_address: { name: "Jean", line1: "1 rue X", postal_code: "75002", city: "Paris", country: "FR" },
    });
    const r = await sous("service", "SELECT order_settle_payment($1::jsonb) AS resultat", [charge]);
    assert.equal(r.rows[0].resultat.order.status, "paid");
    const apres = await statut(p);
    assert.equal(apres.status, "sold");
    assert.ok(apres.sold_at);
  });

  test("le service appelé directement par l'API", async () => {
    const p = await nouvelleAnnonce();
    const r = await sous("service", "UPDATE products SET status='sold' WHERE id=$1 RETURNING status", [p]);
    assert.equal(r.rows[0].status, "sold");
  });

  test("l'administrateur passe la garde : vendu, et sortie du retrait", async () => {
    const p = await nouvelleAnnonce();
    const r1 = await sous("admin", "UPDATE products SET status='sold' WHERE id=$1 RETURNING status", [p]);
    assert.equal(r1.rows[0].status, "sold");
    // Les politiques du dépôt ne donnent à l'administrateur aucune lecture
    // des annonces retirées : il atteint celle-ci comme acheteur de la
    // commande. C'est la garde qu'on éprouve ici, pas les politiques.
    const q = await annonceRetiree(ids.admin);
    const r2 = await sous("admin", "UPDATE products SET status='published' WHERE id=$1 RETURNING status", [q]);
    assert.equal(r2.rows[0].status, "published");
  });

  test("la modération retire toujours un article signalé (admin_moderer_signalement)", async () => {
    const p = await nouvelleAnnonce();
    // Une commande le référence : la suppression échoue, l'article est retiré.
    await db.query(
      `INSERT INTO orders (product_id, buyer_id, seller_id, status, amount, stripe_session_id)
       VALUES ($1,$2,$3,'completed',45,'cs_statut_moderation')`, [p, ids.acheteur, ids.vendeur]);
    const rep = await db.query(
      "INSERT INTO reports (product_id, reporter_id, reason) VALUES ($1,$2,'Copie') RETURNING id", [p, ids.acheteur]);
    await sous("admin", "SELECT admin_moderer_signalement($1,'retirer',NULL)", [rep.rows[0].id]);
    assert.equal((await statut(p)).status, "removed");
  });

  test("l'éditeur SQL du tableau de bord (session postgres, sans jeton)", async () => {
    const p = await nouvelleAnnonce();
    const brut = new pg.Client(config);
    await brut.connect();
    try {
      await brut.query("UPDATE products SET status='removed' WHERE id=$1", [p]);
      await brut.query("UPDATE products SET status='published' WHERE id=$1", [p]);
    } finally {
      await brut.end();
    }
    assert.equal((await statut(p)).status, "published");
  });
});

describe("la migration", () => {
  test("se rejoue sans erreur, et la garde reste unique et active", async () => {
    await db.query(sqlFile("supabase/migrations/20261010000300_statut_annonce_garde.sql"));
    const r = await db.query(
      `SELECT t.tgname, p.prosecdef, p.proconfig
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.products'::regclass AND t.tgname = 'products_garde_statut'`);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].prosecdef, false, "SECURITY INVOKER");
    assert.ok((r.rows[0].proconfig ?? []).some((c: string) => c.startsWith("search_path=")));
    const p = await nouvelleAnnonce();
    await refuse(sous("vendeur", "UPDATE products SET status='sold' WHERE id=$1", [p]), /vendu/);
  });
});
