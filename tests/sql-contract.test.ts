/**
 * Invariants de la couche SQL.
 *
 * Aucun Postgres n'est disponible dans cet environnement : ces tests ne
 * PROUVENT pas que les fonctions SQL se comportent bien à l'exécution. Ils
 * vérifient que les garde-fous financiers sont bien présents dans la migration
 * et n'ont pas été retirés par une modification ultérieure. C'est une barrière
 * de non-régression, pas une preuve d'exécution.
 *
 * Chaque assertion correspond à un incident réel ou évité :
 *   - la contrainte quantity >= 1 empêchait le webhook de marquer un article
 *     vendu, et l'erreur n'était jamais lue
 *   - sans index unique sur le PaymentIntent, deux webhooks concurrents
 *     pouvaient enregistrer deux fois le même paiement
 *   - sans garde sur les statuts déjà encaissés, un rejeu décrémentait le stock
 *     une seconde fois
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SHIPPING_CATALOG } from "../supabase/functions/_shared/payments.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const migration = readFileSync(join(migrationsDir, "20260813000000_stripe_hardening.sql"), "utf8");

/** Corps d'une fonction plpgsql, pour cibler une assertion précise. */
function functionBody(name: string): string {
  const start = migration.indexOf(`FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `fonction ${name} absente de la migration`);
  const end = migration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `fin de ${name} introuvable`);
  return migration.slice(start, end);
}

/* ================================================================== *
 *  Le bug qui laissait revendre un article déjà payé
 * ================================================================== */

test("la contrainte de stock autorise zéro", () => {
  assert.match(migration, /ADD CONSTRAINT products_quantity_check CHECK \(quantity >= 0\)/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS products_quantity_check/);
});

test("aucun script SQL ne réintroduit CHECK (quantity >= 1)", () => {
  // Les commentaires sont retirés : la migration de correction cite justement
  // l'ancienne contrainte pour expliquer ce qu'elle répare.
  const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

  const files = [
    ...readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((f) => ({ name: f, path: join(migrationsDir, f) })),
    { name: "supabase_setup.sql", path: join(root, "supabase_setup.sql") },
  ];

  for (const { name, path } of files) {
    const sql = stripComments(readFileSync(path, "utf8"));
    assert.equal(
      /CHECK\s*\(\s*quantity\s*>=\s*1\s*\)/i.test(sql),
      false,
      `${name} réintroduit la contrainte qui empêchait de marquer un article vendu`,
    );
  }
});

test("les articles payés restés publiés sont rattrapés par la migration", () => {
  assert.match(migration, /UPDATE public\.products p[\s\S]*SET quantity = 0,[\s\S]*status\s*=\s*'sold'/);
});

/* ================================================================== *
 *  Unicité : un paiement, une commande
 * ================================================================== */

test("un PaymentIntent ne peut financer qu'une seule commande", () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_intent_uniq[\s\S]*ON public\.orders \(stripe_payment_intent_id\)[\s\S]*WHERE stripe_payment_intent_id IS NOT NULL/,
  );
});

test("la déduplication des événements repose sur une clé primaire, pas sur un SELECT", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.stripe_events \([\s\S]*id\s+text PRIMARY KEY/);
  const claim = functionBody("stripe_event_claim");
  assert.match(claim, /ON CONFLICT \(id\) DO UPDATE/);
  // Le bail : un événement interrompu par un crash redevient traitable.
  assert.match(claim, /locked_at < now\(\) - make_interval\(secs => p_lease_seconds\)/);
  assert.match(claim, /se\.status NOT IN \('done', 'ignored'\)/);
});

test("la réservation d'événement distingue « déjà traité » de « encore en cours »", () => {
  // Répondre 200 à un événement encore en cours de traitement reviendrait à
  // l'acquitter sans l'avoir traité : si la première exécution a été tuée,
  // Stripe cesserait de réessayer et l'événement serait perdu.
  const claim = functionBody("stripe_event_claim");
  assert.match(claim, /RETURN 'claimed';/);
  assert.match(claim, /RETURN 'settled';/);
  assert.match(claim, /RETURN 'busy';/);

  const webhook = readFileSync(join(root, "supabase", "functions", "stripe-webhook", "index.ts"), "utf8");
  assert.match(webhook, /claimed === "settled"[\s\S]*respond\(200/);
  assert.match(webhook, /claimed !== "claimed"[\s\S]*respond\(409/);
});

test("le type de retour changeant, l'ancienne signature est retirée avant recréation", () => {
  const dropIndex = migration.indexOf("DROP FUNCTION IF EXISTS public.stripe_event_claim");
  const createIndex = migration.indexOf("CREATE OR REPLACE FUNCTION public.stripe_event_claim");
  assert.notEqual(dropIndex, -1, "sans DROP, CREATE OR REPLACE échoue sur un changement de type de retour");
  assert.ok(dropIndex < createIndex, "le DROP doit précéder le CREATE");
});

/* ================================================================== *
 *  Idempotence de l'encaissement
 * ================================================================== */

test("order_settle_payment ne retraite jamais une commande déjà encaissée", () => {
  const body = functionBody("order_settle_payment");
  const guard = /IF v_order\.status IN \('paid','shipped','delivered','completed','disputed',\s*'refunded','partially_refunded'\) THEN/;
  assert.match(body, guard);
  // La sortie anticipée renvoie explicitement first_time = false : c'est ce
  // drapeau qui empêche le second email et le second décrément.
  assert.match(body, /'first_time', false/);
});

test("le stock n'est consommé que sur un encaissement réel", () => {
  const body = functionBody("order_settle_payment");
  assert.match(body, /IF v_new_status = 'paid' THEN[\s\S]*quantity\s*=\s*GREATEST\(0, quantity - 1\)/);
  // Et jamais sur un paiement encore en attente.
  assert.match(body, /WHEN COALESCE\(p_payload->>'payment_status',''\) IN \('paid','no_payment_required'\) THEN 'paid'/);
});

test("un paiement sans commande en base crée quand même une trace", () => {
  const body = functionBody("order_settle_payment");
  assert.match(body, /IF v_found_id IS NULL THEN[\s\S]*INSERT INTO public\.orders/);
  assert.match(body, /needs_review/);
});

test("un écart entre le montant Stripe et le montant réservé part en revue", () => {
  const body = functionBody("order_settle_payment");
  assert.match(body, /v_total <> v_order\.amount_total_cents/);
  assert.match(body, /Montant Stripe/);
});

test("la commande est retrouvée par trois chemins indépendants, puis verrouillée une fois", () => {
  const body = functionBody("order_settle_payment");
  assert.match(body, /SELECT id INTO v_found_id FROM public\.orders WHERE id = v_order_id/);
  assert.match(body, /SELECT id INTO v_found_id FROM public\.orders WHERE stripe_session_id = v_session/);
  assert.match(body, /SELECT id INTO v_found_id FROM public\.orders WHERE stripe_payment_intent_id = v_intent/);
  // Un seul verrou, pris sur la ligne effectivement retrouvée : c'est lui qui
  // sérialise deux webhooks concurrents portant sur la même commande.
  assert.match(body, /IF v_found_id IS NOT NULL THEN[\s\S]*WHERE id = v_found_id FOR UPDATE/);
});

test("la commande recréée porte le PaymentIntent, donc l'index unique", () => {
  // Sans cela, deux webhooks concurrents ne trouvant aucune commande
  // créeraient deux commandes pour un seul paiement.
  const body = functionBody("order_settle_payment");
  assert.match(body, /stripe_session_id, stripe_payment_intent_id,[\s\S]*v_session,\s*\n\s*v_intent,/);
});

/* ================================================================== *
 *  Réservation de stock
 * ================================================================== */

test("la réservation verrouille la ligne produit avant de décider", () => {
  const body = functionBody("checkout_reserve");
  assert.match(body, /SELECT \* INTO v_product FROM public\.products WHERE id = p_product_id FOR UPDATE/);
  assert.match(body, /v_product\.quantity - v_product\.reserved_qty < 1/);
  assert.match(body, /RAISE EXCEPTION 'PRODUCT_RESERVED'/);
});

test("le montant est calculé en base, à partir du prix et des tarifs stockés", () => {
  const body = functionBody("checkout_reserve");
  assert.match(body, /v_product_cents := ROUND\(v_product\.price \* 100\)::int/);
  assert.match(body, /v_ship_cents\s*:= v_rate\.amount_cents/);
  assert.match(body, /v_total_cents\s*:= v_product_cents \+ v_ship_cents/);
  // Aucun paramètre de montant : la fonction n'accepte pas de prix en entrée.
  assert.equal(/p_amount|p_price|p_total|p_currency/.test(body), false);
});

test("la commission ne porte pas sur le port et ne dépasse pas le total", () => {
  const body = functionBody("checkout_reserve");
  assert.match(body, /v_fee_cents := LEAST\(ROUND\(v_product_cents \* v_fee_rate\)::int, v_total_cents\)/);
});

test("un vendeur ne peut pas acheter son propre article, et le montant a un plancher", () => {
  const body = functionBody("checkout_reserve");
  assert.match(body, /v_product\.user_id = p_buyer_id[\s\S]*RAISE EXCEPTION 'SELF_PURCHASE'/);
  assert.match(body, /v_total_cents < v_min_cents[\s\S]*RAISE EXCEPTION 'AMOUNT_TOO_LOW'/);
  assert.match(body, /v_product\.status <> 'published'[\s\S]*RAISE EXCEPTION 'PRODUCT_NOT_AVAILABLE'/);
});

test("le mode de livraison doit être proposé par le vendeur", () => {
  const body = functionBody("checkout_reserve");
  assert.match(body, /WHEN 'pickup' THEN v_product\.ship_pickup/);
  assert.match(body, /WHEN 'relay'  THEN v_product\.ship_relay/);
  assert.match(body, /WHEN 'post'   THEN v_product\.ship_post/);
  assert.match(body, /RAISE EXCEPTION 'SHIPPING_NOT_OFFERED'/);
});

test("une réservation existante est réutilisée, jamais dupliquée", () => {
  const body = functionBody("checkout_reserve");
  assert.match(body, /status\s+= 'pending'[\s\S]*expires_at > now\(\)/);
  assert.match(body, /RETURN v_existing;/);
  // Changement de paramètres : l'ancienne est libérée avant d'en prendre une
  // nouvelle, sinon le même acheteur consommerait deux fois le stock.
  assert.match(body, /UPDATE public\.orders SET status = 'canceled'[\s\S]*reserved_qty = GREATEST\(0, reserved_qty - 1\)/);
});

test("la libération ne touche jamais une commande déjà payée", () => {
  const body = functionBody("checkout_release");
  assert.match(body, /WHERE id = p_order_id\s*\n\s*AND status = 'pending'/);
  assert.match(body, /IF NOT FOUND THEN\s*\n\s*RETURN false;/);
});

test("les réservations mortes sont libérées, par le cron et à chaque tentative", () => {
  assert.match(migration, /cron\.schedule\(\s*\n?\s*'checkout-expire-stale'/);
  const reserve = functionBody("checkout_reserve");
  assert.match(reserve, /PERFORM public\.checkout_expire_stale\(p_product_id\)/);
});

/* ================================================================== *
 *  Régressions d'états
 * ================================================================== */

test("un échec de paiement ne peut pas écraser un état plus avancé", () => {
  const body = functionBody("order_mark_payment_failed");
  assert.match(body, /IF v_order\.status NOT IN \('pending','payment_pending'\) THEN[\s\S]*'changed', false/);
});

test("un remboursement rejoué ne change rien et ne renotifie pas", () => {
  const body = functionBody("order_apply_refund");
  assert.match(body, /v_order\.amount_refunded_cents = COALESCE\(p_refunded_cents, 0\)[\s\S]*'changed', false/);
});

test("un remboursement total remet l'article en vente", () => {
  const body = functionBody("order_apply_refund");
  assert.match(body, /IF p_fully_refunded THEN[\s\S]*quantity = quantity \+ 1[\s\S]*'published'/);
});

test("un litige bancaire n'écrase pas le statut métier de la commande", () => {
  const body = functionBody("order_mark_chargeback");
  assert.match(body, /SET chargeback_status = p_status/);
  // La colonne status n'est pas touchée : une commande expédiée le reste.
  assert.equal(/SET[\s\S]{0,200}\bstatus\s*=\s*'/.test(body.split("UPDATE public.orders")[1] ?? ""), false);
  assert.match(body, /needs_review\s*= p_status NOT IN \('won','warning_closed'\)/);
});

/* ================================================================== *
 *  Droits
 * ================================================================== */

test("aucune fonction financière n'est appelable depuis le navigateur", () => {
  const sensitive = [
    "checkout_reserve", "checkout_release", "checkout_attach_session", "checkout_expire_stale",
    "order_settle_payment", "order_mark_payment_failed", "order_apply_refund",
    "order_mark_chargeback", "stripe_event_claim", "stripe_event_finish",
  ];
  for (const name of sensitive) {
    const revoke = new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+FROM PUBLIC, anon, authenticated`);
    assert.match(migration, revoke, `${name} reste appelable par un client`);
    const grant = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO service_role, postgres`);
    assert.match(migration, grant, `${name} n'est plus appelable par le backend`);
  }
});

test("le garde-fou sur reserved_qty ne bloque pas le backend", () => {
  const body = functionBody("products_protect_reserved_qty");
  // auth.role() vaut NULL pour le cron et les fonctions SECURITY DEFINER :
  // c'est le piège qui avait paralysé Stripe Connect en avril.
  assert.equal(body.includes("auth.role()"), false);
  assert.match(body, /current_user NOT IN \('postgres', 'service_role', 'supabase_admin'\)/);
});

test("l'administrateur peut enfin lire les commandes", () => {
  assert.match(migration, /CREATE POLICY "Admin reads all orders"[\s\S]*ON public\.orders FOR SELECT/);
});

test("les tables sensibles ont RLS activé", () => {
  for (const table of ["stripe_events", "platform_settings", "shipping_rates"]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table);
  }
  // Aucune policy sur stripe_events ni platform_settings : seul le
  // service_role, qui contourne RLS, y accède.
  assert.equal(/CREATE POLICY[^;]*ON public\.stripe_events/.test(migration), false);
  assert.equal(/CREATE POLICY[^;]*ON public\.platform_settings/.test(migration), false);
});

/* ================================================================== *
 *  Cohérence entre les tarifs SQL et les libellés TypeScript
 * ================================================================== */

test("les tarifs de livraison du code correspondent à ceux de la base", () => {
  // Le montant facturé vient de shipping_rates. Les constantes TypeScript ne
  // servent qu'aux libellés affichés sur la page Stripe ; si les deux
  // divergent, l'acheteur voit un prix et en paie un autre.
  const rows = [...migration.matchAll(/\('(pickup|relay|post)',\s*(\d+),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*'(\w+)'\)/g)];
  assert.equal(rows.length, 3, "les trois tarifs doivent être présents dans la migration");

  for (const [, method, cents, label, min, max, flag] of rows) {
    const local = SHIPPING_CATALOG[method as keyof typeof SHIPPING_CATALOG];
    assert.equal(local.amountCents, Number(cents), `montant ${method}`);
    assert.equal(local.label, label, `libellé ${method}`);
    assert.equal(local.minDays, Number(min), `délai min ${method}`);
    assert.equal(local.maxDays, Number(max), `délai max ${method}`);
    assert.equal(local.flag, flag, `drapeau ${method}`);
  }
});

test("une estimation de livraison n'est envoyée à Stripe que si elle a un sens", () => {
  const checkout = readFileSync(join(root, "supabase", "functions", "create-checkout", "index.ts"), "utf8");
  assert.match(checkout, /rate\.minDays >= 1 && rate\.maxDays >= rate\.minDays/);

  for (const [method, rate] of Object.entries(SHIPPING_CATALOG)) {
    if (rate.minDays === 0) {
      assert.equal(rate.maxDays, 0, `${method} : sans délai minimum, pas de délai maximum non plus`);
    } else {
      assert.ok(rate.maxDays >= rate.minDays, `${method} : délai maximum inférieur au minimum`);
    }
  }
});

test("la réservation survit à la session Stripe, jamais l'inverse", () => {
  // Stripe refuse une expiration à moins de 30 minutes. La réservation doit
  // durer plus longtemps que la session, sinon un paiement de dernière minute
  // arriverait sur un stock déjà rendu à quelqu'un d'autre.
  const match = migration.match(/\('reservation_minutes',\s*(\d+)\)/);
  assert.notEqual(match, null);
  const reservationMinutes = Number(match![1]);

  const checkout = readFileSync(join(root, "supabase", "functions", "create-checkout", "index.ts"), "utf8");
  const bufferMatch = checkout.match(/reservationEnd - (\d+) \* 60_000/);
  assert.notEqual(bufferMatch, null);
  const bufferMinutes = Number(bufferMatch![1]);

  assert.ok(reservationMinutes - bufferMinutes >= 30,
    `session Stripe de ${reservationMinutes - bufferMinutes} min : Stripe exige 30 min minimum`);
  assert.ok(bufferMinutes > 0, "la réservation doit dépasser la session Stripe");
});
