/**
 * Passe offensive contre la base de production, sans rien y laisser.
 *
 * Chaque tentative se déroule dans une transaction ouverte puis systématiquement
 * annulée. Si une écriture qui devrait échouer réussit, elle est quand même
 * défaite, et on l'apprend. C'est le seul moyen honnête de savoir ce qu'un
 * attaquant obtiendrait sans le lui faire obtenir.
 *
 * LE POINT QUI REND CE PROGRAMME UTILE : la cible est semée avant l'attaque.
 *
 * Une première version se contentait de lancer les tentatives sur la base telle
 * quelle. Or orders, reviews, reports et stripe_events sont vides en
 * production. « Un membre ne peut pas marquer une commande comme payée »
 * n'était donc pas un résultat : il n'y avait aucune commande à marquer. La
 * moitié des cas passaient sans rien démontrer, ce qui est pire que pas de test
 * du tout, parce qu'on s'en contente.
 *
 * Chaque attaque déclare maintenant ce qu'elle a besoin de trouver. La semence
 * est posée en tant que postgres, avant de prendre l'identité de l'attaquant, et
 * disparaît au ROLLBACK. Une tentative qui ne rend rien signifie alors vraiment
 * que la porte est fermée.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connecter } from "./connexion.mjs";

const password = execFileSync("/usr/bin/security",
  ["find-generic-password", "-a", process.env.USER ?? "", "-s", "athena-supabase-db", "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const client = await connecter();

const moi = randomUUID();
const victime = randomUUID();

/* --- Semences ---------------------------------------------------------- *
 * Posées en tant que postgres, à l'intérieur de la transaction annulée.
 * On crée l'attaquant et sa victime, une annonce, une commande complète, un
 * avis, un signalement et un événement Stripe : de quoi que chaque tentative
 * ait réellement quelque chose à atteindre.
 */
const SEMENCES = {
  comptes: `
    INSERT INTO auth.users (id, email, created_at) VALUES
      ('${moi}', 'attaquant@test.invalid', now()),
      ('${victime}', 'victime@test.invalid', now());
    UPDATE public.profiles SET pseudo = 'Victime', blocked = false,
           stripe_account_id = 'acct_victime', stripe_onboarded = true
     WHERE id = '${victime}';
    UPDATE public.profiles SET pseudo = 'Attaquant', blocked = true,
           block_reason = 'fraude', pseudo_changed_at = now()
     WHERE id = '${moi}';`,

  annonce: `
    INSERT INTO public.products (id, user_id, title, period, subcategory, condition,
                                 description, price, location, quantity, ship_post)
    VALUES (900001, '${victime}', 'Casque de la victime', '1GM', 'Uniformes', 'Bon',
            'Semence de test, annulée avec la transaction', 250, 'Tarbes', 1, true);`,

  commande: `
    INSERT INTO public.orders (id, product_id, buyer_id, seller_id, status, amount,
                               product_amount_cents, shipping_amount_cents, protection_fee_cents,
                               amount_total_cents, seller_amount_cents, application_fee_cents,
                               pricing_version, currency, stripe_session_id, stripe_payment_intent_id,
                               stripe_charge_id, paid_at, payout_state, confirmed_at, report_window_ends_at)
    VALUES ('00000000-0000-4000-8000-000000000001', 900001, '${victime}', '${victime}', 'completed', 268.10,
            25000, 890, 1320, 27210, 25890, 0,
            1, 'eur', 'cs_semence', 'pi_semence', 'ch_semence',
            now() - interval '3 days', 'pending', now() - interval '3 hours', now() - interval '1 hour');`,

  avis: `
    INSERT INTO public.reviews (product_id, reviewer_id, rating)
    VALUES (900001, '${victime}', 5);`,

  signalement: `
    INSERT INTO public.reports (product_id, reason) VALUES (900001, 'contrefaçon');`,

  evenement: `
    INSERT INTO public.stripe_events (id, type, status)
    VALUES ('evt_semence', 'checkout.session.completed', 'done');`,
};

let ouvert = 0, ferme = 0, vain = 0;
const trous = [];

/**
 * @param besoins  noms des semences à poser avant l'attaque
 * @param temoin   requête qui doit rendre au moins une ligne pour que la
 *                 tentative ait un sens ; sans elle on signale un essai vain
 */
async function tenter({ role, uid, libelle, sql, params = [], besoins = [], temoin, preuve, attendu }) {
  await client.query("BEGIN");
  try {
    try {
      for (const b of besoins) await client.query(SEMENCES[b]);
    } catch (err) {
      vain++;
      console.log(`  [??] ${libelle} : ESSAI VAIN, la cible n'a pas pu être semée ` +
        `(${String(err.message).split("\n")[0].slice(0, 70)})`);
      return;
    }

    if (temoin) {
      const t = await client.query(temoin);
      if ((t.rowCount ?? 0) === 0) {
        vain++;
        console.log(`  [??] ${libelle} : ESSAI VAIN, aucune cible en base`);
        return;
      }
    }

    const claims = uid
      ? JSON.stringify({ sub: uid, role: "authenticated", email: "attaquant@test.invalid", aud: "authenticated" })
      : JSON.stringify({ role: "anon", aud: "anon" });
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [claims]);
    await client.query(`SET LOCAL ROLE ${role}`);

    const r = await client.query(sql, params);
    let reussi = (r.rowCount ?? 0) > 0;
    let detail = `${r.rowCount} ligne(s)`;

    if (reussi && preuve) {
      // Relecture en tant que postgres : la question n'est pas « l'ordre
      // a-t-il touché une ligne » mais « la valeur a-t-elle réellement changé ».
      await client.query("RESET ROLE");
      const v = await client.query(preuve);
      reussi = (v.rowCount ?? 0) > 0;
      detail = reussi ? "valeur effectivement modifiée" : "sans effet, valeur restaurée";
    }

    if (attendu === "réussite") {
      // Fermer une porte est facile ; la fermer sans murer l'entrée légitime
      // l'est moins. Ce cas échoue si l'usage normal a été cassé au passage.
      if (reussi) { ferme++; console.log(`  [ok] ${libelle}`); }
      else { ouvert++; trous.push(`${libelle} → USAGE LÉGITIME CASSÉ`); console.log(`  [!!] ${libelle} : CASSÉ`); }
    } else if (reussi) {
      ouvert++;
      trous.push(`${libelle} → ${detail}`);
      console.log(`  [!!] ${libelle} : RÉUSSI (${detail})`);
    } else {
      ferme++;
      console.log(`  [ok] ${libelle}${preuve ? " : " + detail : ""}`);
    }
  } catch (err) {
    const m = String(err.message).split("\n")[0];
    // Une erreur de syntaxe ou de type n'est pas une défense : c'est un essai
    // qui n'a pas eu lieu. Le distinguer évite de se rassurer à bon compte.
    if (/does not exist|could not determine|syntax error|invalid input|bind message/i.test(m)) {
      vain++;
      console.log(`  [??] ${libelle} : ESSAI VAIN (${m.slice(0, 70)})`);
    } else {
      ferme++;
      console.log(`  [ok] ${libelle} : refusé (${m.slice(0, 62)})`);
    }
  } finally {
    await client.query("ROLLBACK");
  }
}

const anon = (libelle, sql, extra = {}) => tenter({ role: "anon", uid: null, libelle, sql, ...extra });
const membre = (libelle, sql, extra = {}) => tenter({ role: "authenticated", uid: moi, libelle, sql, ...extra });

console.log("\n=== Un visiteur non connecté ===");
await anon("lit les profils", "SELECT id FROM public.profiles LIMIT 5",
  { besoins: ["comptes"], temoin: "SELECT 1 FROM public.profiles LIMIT 1" });
await anon("lit les commandes", "SELECT id FROM public.orders LIMIT 5",
  { besoins: ["comptes", "annonce", "commande"], temoin: "SELECT 1 FROM public.orders LIMIT 1" });
await anon("lit les messages", "SELECT id FROM public.messages LIMIT 5",
  { temoin: "SELECT 1 FROM public.messages LIMIT 1" });
await anon("lit les réglages de la plateforme", "SELECT key FROM public.platform_settings LIMIT 5",
  { temoin: "SELECT 1 FROM public.platform_settings LIMIT 1" });
await anon("lit le journal des événements Stripe", "SELECT id FROM public.stripe_events LIMIT 5",
  { besoins: ["evenement"], temoin: "SELECT 1 FROM public.stripe_events LIMIT 1" });
await anon("lit les signalements", "SELECT id FROM public.reports LIMIT 5",
  { besoins: ["comptes", "annonce", "signalement"], temoin: "SELECT 1 FROM public.reports LIMIT 1" });
await anon("ouvre les achats",
  "UPDATE public.platform_settings SET value = 1 WHERE key = 'checkout_enabled' RETURNING key",
  { temoin: "SELECT 1 FROM public.platform_settings WHERE key='checkout_enabled'" , preuve: `SELECT 1 FROM public.platform_settings WHERE key='checkout_enabled' AND value = 1` });
await anon("baisse le tarif de la Protection",
  "UPDATE public.platform_settings SET value = 0 WHERE key = 'protection_rate_bps' RETURNING key",
  { temoin: "SELECT 1 FROM public.platform_settings WHERE key='protection_rate_bps'" , preuve: `SELECT 1 FROM public.platform_settings WHERE key='protection_rate_bps' AND value = 0` });
await anon("crée une annonce à son nom",
  `INSERT INTO public.products (user_id, title, period, subcategory, condition, price, quantity)
   VALUES ('${victime}', 'Intrus', '1GM', 'Uniformes', 'Bon', 1, 1) RETURNING id`,
  { besoins: ["comptes"] });
await anon("s'attribue une commande",
  `UPDATE public.orders SET buyer_id = '${moi}' RETURNING id`,
  { besoins: ["comptes", "annonce", "commande"], temoin: "SELECT 1 FROM public.orders LIMIT 1" , preuve: `SELECT 1 FROM public.orders WHERE buyer_id = '${moi}'` });
await anon("se déclare payé", "UPDATE public.orders SET payout_state = 'released' RETURNING id",
  { besoins: ["comptes", "annonce", "commande"], temoin: "SELECT 1 FROM public.orders LIMIT 1" , preuve: `SELECT 1 FROM public.orders WHERE payout_state = 'released'` });

console.log("\n=== Un membre connecté, sur ce qui ne lui appartient pas ===");
await membre("lit les commandes des autres", "SELECT id FROM public.orders LIMIT 5",
  { besoins: ["comptes", "annonce", "commande"], temoin: "SELECT 1 FROM public.orders LIMIT 1" });
await membre("lit les messages des autres",
  `SELECT id FROM public.messages WHERE sender_id <> '${moi}' LIMIT 5`,
  { temoin: "SELECT 1 FROM public.messages LIMIT 1" });
await membre("lit les adresses email des autres",
  `SELECT email FROM public.profiles WHERE id <> '${moi}' AND email IS NOT NULL LIMIT 5`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${victime}'` });
await membre("se fait passer pour un administrateur",
  `UPDATE public.profiles SET email = 'sayrox.ar@gmail.com' WHERE id = '${moi}' RETURNING id`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${moi}'` , preuve: `SELECT 1 FROM public.profiles WHERE id = '${moi}' AND email = 'sayrox.ar@gmail.com'` });
await membre("modifie le pseudo d'un autre",
  `UPDATE public.profiles SET pseudo = 'volé' WHERE id = '${victime}' RETURNING id`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${victime}'` , preuve: `SELECT 1 FROM public.profiles WHERE id = '${victime}' AND pseudo = 'volé'` });
await membre("lève sa propre suspension",
  `UPDATE public.profiles SET blocked = false, block_reason = NULL WHERE id = '${moi}' RETURNING id`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${moi}' AND blocked` , preuve: `SELECT 1 FROM public.profiles WHERE id = '${moi}' AND NOT blocked` });
await membre("suspend un concurrent",
  `UPDATE public.profiles SET blocked = true WHERE id = '${victime}' RETURNING id`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${victime}' AND NOT blocked` , preuve: `SELECT 1 FROM public.profiles WHERE id = '${victime}' AND blocked` });
await membre("contourne le délai de changement de pseudo",
  `UPDATE public.profiles SET pseudo_changed_at = NULL WHERE id = '${moi}' RETURNING id`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${moi}' AND pseudo_changed_at IS NOT NULL` , preuve: `SELECT 1 FROM public.profiles WHERE id = '${moi}' AND pseudo_changed_at IS NULL` });
await membre("s'attribue un compte de versement Stripe",
  `UPDATE public.profiles SET stripe_account_id = 'acct_intrus', stripe_onboarded = true WHERE id = '${moi}' RETURNING id`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${moi}'` , preuve: `SELECT 1 FROM public.profiles WHERE id = '${moi}' AND stripe_account_id = 'acct_intrus' AND stripe_onboarded` });
await membre("vole le compte de versement d'un autre",
  `UPDATE public.profiles SET stripe_account_id = 'acct_victime' WHERE id = '${moi}' RETURNING id`,
  { besoins: ["comptes"], temoin: `SELECT 1 FROM public.profiles WHERE id = '${victime}' AND stripe_onboarded` , preuve: `SELECT 1 FROM public.profiles WHERE id = '${moi}' AND stripe_account_id = 'acct_victime'` });
await membre("baisse le prix de l'annonce d'un autre",
  `UPDATE public.products SET price = 1 WHERE user_id <> '${moi}' RETURNING id`,
  { besoins: ["comptes", "annonce"], temoin: `SELECT 1 FROM public.products WHERE user_id = '${victime}'` , preuve: `SELECT 1 FROM public.products WHERE id = 900001 AND price = 1` });
await membre("s'approprie l'annonce d'un autre",
  `UPDATE public.products SET user_id = '${moi}' WHERE id = 900001 RETURNING id`,
  { besoins: ["comptes", "annonce"], temoin: "SELECT 1 FROM public.products WHERE id = 900001" , preuve: `SELECT 1 FROM public.products WHERE id = 900001 AND user_id = '${moi}'` });
await membre("marque une commande comme payée",
  "UPDATE public.orders SET status = 'paid', paid_at = now() RETURNING id",
  { besoins: ["comptes", "annonce", "commande"], temoin: "SELECT 1 FROM public.orders LIMIT 1" , preuve: `SELECT 1 FROM public.orders WHERE status = 'paid'` });
await membre("déclenche son propre versement",
  "UPDATE public.orders SET payout_state = 'released' RETURNING id",
  { besoins: ["comptes", "annonce", "commande"], temoin: "SELECT 1 FROM public.orders LIMIT 1" , preuve: `SELECT 1 FROM public.orders WHERE payout_state = 'released'` });
await membre("efface le journal des événements Stripe",
  "DELETE FROM public.stripe_events RETURNING id",
  { besoins: ["evenement"], temoin: "SELECT 1 FROM public.stripe_events LIMIT 1" , preuve: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.stripe_events WHERE id = 'evt_semence')` });
await membre("ouvre les achats",
  "UPDATE public.platform_settings SET value = 1 WHERE key = 'checkout_enabled' RETURNING key",
  { temoin: "SELECT 1 FROM public.platform_settings WHERE key='checkout_enabled'" });
await membre("lit les signalements", "SELECT id FROM public.reports LIMIT 5",
  { besoins: ["comptes", "annonce", "signalement"], temoin: "SELECT 1 FROM public.reports LIMIT 1" });
await membre("classe un signalement", "UPDATE public.reports SET status = 'closed' RETURNING id",
  { besoins: ["comptes", "annonce", "signalement"], temoin: "SELECT 1 FROM public.reports LIMIT 1" , preuve: `SELECT 1 FROM public.reports WHERE status = 'closed'` });
await membre("modifie l'avis d'un autre",
  `UPDATE public.reviews SET rating = 1 WHERE reviewer_id <> '${moi}' RETURNING id`,
  { besoins: ["comptes", "annonce", "avis"], temoin: "SELECT 1 FROM public.reviews LIMIT 1" , preuve: `SELECT 1 FROM public.reviews WHERE rating = 1` });
await membre("note une annonce qu'il n'a jamais achetée",
  `INSERT INTO public.reviews (product_id, reviewer_id, rating) VALUES (900001, '${moi}', 5) RETURNING id`,
  { besoins: ["comptes", "annonce"], temoin: "SELECT 1 FROM public.products WHERE id = 900001" , preuve: `SELECT 1 FROM public.reviews WHERE product_id = 900001 AND reviewer_id = '${moi}'` });

await tenter({
  role: "authenticated", uid: victime,
  libelle: "ACHETEUR LÉGITIME : note l'annonce qu'il a reçue (doit réussir)",
  sql: `INSERT INTO public.reviews (product_id, reviewer_id, rating) VALUES (900001, '${victime}', 5) RETURNING id`,
  besoins: ["comptes", "annonce", "commande"],
  temoin: `SELECT 1 FROM public.orders WHERE buyer_id = '${victime}' AND confirmed_at IS NOT NULL`,
  attendu: "réussite",
});

console.log("\n=== Fonctions financières appelées directement ===");
const APPELS = [
  ["confirmer la réception", `SELECT public.order_confirm_receipt('00000000-0000-4000-8000-000000000001'::uuid)`],
  ["marquer un paiement encaissé", `SELECT public.order_settle_payment('{"order_id":"00000000-0000-4000-8000-000000000001"}'::jsonb)`],
  ["libérer un versement", `SELECT public.order_mark_payout_released('00000000-0000-4000-8000-000000000001'::uuid,'tr_x',1)`],
  ["lister les commandes versables", `SELECT * FROM public.orders_ready_for_payout(10)`],
  ["réserver du stock", `SELECT public.checkout_reserve(900001::bigint,'${moi}'::uuid,'post',NULL)`],
  ["déclarer une expédition", `SELECT public.order_mark_shipped('00000000-0000-4000-8000-000000000001'::uuid,'AB123456789FR')`],
  ["bloquer un versement", `SELECT public.order_block_payout('00000000-0000-4000-8000-000000000001'::uuid,'prétexte')`],
];
for (const [nom, appel] of APPELS) {
  const besoins = ["comptes", "annonce", "commande"];
  await anon(`visiteur : ${nom}`, appel, { besoins });
  await membre(`membre : ${nom}`, appel, { besoins });
}

await client.end();

console.log(`\n  ${trous.length === 0 ? "AUCUNE PORTE OUVERTE" : "⚠ " + trous.length + " PORTE(S) OUVERTE(S)"}` +
  ` — ${ferme} tentative(s) repoussée(s) sur une cible réelle, ${ouvert} aboutie(s)` +
  (vain ? `, ${vain} essai(s) sans valeur` : ""));
trous.forEach((t) => console.log("    " + t));
console.log("  Toutes les transactions ont été annulées : la base est intacte.");
if (trous.length || vain) process.exitCode = 1;
