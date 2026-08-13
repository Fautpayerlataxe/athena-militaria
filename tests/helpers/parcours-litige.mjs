/* Le cycle complet du litige, sur la production, dans une transaction annulée.
   Chaque transition est vérifiée par relecture, pas par le nombre de lignes. */
import { randomUUID } from "node:crypto";
import { connecter } from "./connexion.mjs";

const c = await connecter({ silencieux: true });
const acheteur = randomUUID(), vendeur = randomUUID();
const cmd = "00000000-0000-4000-8000-0000000000aa";
let ok = 0, ko = 0;
const dire = (b, t) => { console.log(`  ${b ? "ok " : "ÉCHEC"} ${t}`); b ? ok++ : ko++; };

async function scenario(nom, etat, action) {
  await c.query("BEGIN");
  try {
    await c.query(`INSERT INTO auth.users (id,email,created_at) VALUES ($1,'a@t.invalid',now()),($2,'v@t.invalid',now())`, [acheteur, vendeur]);
    await c.query(`INSERT INTO public.products (id,user_id,title,period,subcategory,condition,description,price,location,quantity)
      VALUES (900002,$1,'Objet','1GM','Uniformes','Bon','t',250,'Tarbes',1)`, [vendeur]);
    await c.query(`INSERT INTO public.orders (id,product_id,buyer_id,seller_id,status,amount,
        product_amount_cents,shipping_amount_cents,protection_fee_cents,amount_total_cents,seller_amount_cents,
        application_fee_cents,pricing_version,currency,stripe_session_id,stripe_payment_intent_id,stripe_charge_id,
        paid_at,payout_state,shipped_at,confirmed_at,report_window_ends_at)
      VALUES ($1,900002,$2,$3,$4,268.10,25000,890,1320,27210,25890,0,1,'eur','cs_l','pi_l','ch_l',
        now()-interval '3 days','pending',
        ${etat.shipped ?? "NULL"}, ${etat.confirmed ?? "NULL"}, ${etat.fenetre ?? "NULL"})`,
      [cmd, acheteur, vendeur, etat.status]);
    await action();
  } catch (e) { dire(false, `${nom} : ${String(e.message).split("\n")[0].slice(0,80)}`); }
  finally { await c.query("ROLLBACK"); }
}

const commeAcheteur = async () => {
  await c.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify({sub:acheteur,role:"authenticated",aud:"authenticated"})]);
  await c.query("SET LOCAL ROLE authenticated");
};
const commeExploitant = async () => { await c.query("RESET ROLE"); };

/** Exécute un appel dont on attend le refus, sans perdre la transaction. */
async function refuseAvec(sql, params, motif) {
  await c.query("SAVEPOINT essai");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT essai");
    return false;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT essai");
    return motif.test(String(e.message));
  }
}

console.log("\n=== La fenêtre de 48 heures ===");
await scenario("signalement pendant la fenêtre", { status:"completed", shipped:"now() - interval '5 days'", confirmed:"now() - interval '3 hours'", fenetre:"now() + interval '45 hours'" }, async () => {
  await commeAcheteur();
  await c.query("SELECT public.order_report_dispute($1,$2)", [cmd, "Le casque est arrivé cassé en deux"]);
  await commeExploitant();
  const r = await c.query("SELECT status FROM public.orders WHERE id=$1", [cmd]);
  dire(r.rows[0].status === "disputed", "un acheteur peut signaler un problème pendant les 48 h");
});

await scenario("signalement après la fenêtre", { status:"completed", confirmed:"now() - interval '5 days'", fenetre:"now() - interval '3 days'" }, async () => {
  await commeAcheteur();
  const refuse = await refuseAvec("SELECT public.order_report_dispute($1,$2)",
    [cmd, "Trop tard mais j essaie"], /délai de signalement est écoulé/);
  await commeExploitant();
  dire(refuse, "passé les 48 h, le signalement est refusé avec un motif clair");
});

await scenario("vendeur qui n'expédie jamais", { status:"paid" }, async () => {
  await commeAcheteur();
  await c.query("SELECT public.order_report_dispute($1,$2)", [cmd, "Rien recu depuis deux semaines"]);
  await commeExploitant();
  const r = await c.query("SELECT status FROM public.orders WHERE id=$1", [cmd]);
  dire(r.rows[0].status === "disputed", "un acheteur jamais livré peut signaler dès l'état payé");
});

await scenario("litige avant encaissement", { status:"payment_pending" }, async () => {
  await commeAcheteur();
  const refuse = await refuseAvec("SELECT public.order_report_dispute($1,$2)",
    [cmd, "Je signale avant de payer"], /Litige impossible/);
  await commeExploitant();
  dire(refuse, "aucun litige avant que le paiement soit encaissé");
});

console.log("\n=== Les sorties du litige ===");
for (const [decision, attendu] of [["retire","completed"],["vendeur_paye","completed"],["acheteur_rembourse","disputed"]]) {
  await scenario("sortie " + decision, { status:"disputed", confirmed:"now() - interval '2 days'" }, async () => {
    await c.query("SELECT public.order_resolve_dispute($1,$2,$3)", [cmd, decision, "note"]);
    const r = await c.query("SELECT status, payout_state, dispute_resolution FROM public.orders WHERE id=$1", [cmd]);
    dire(r.rows[0].status === attendu && r.rows[0].dispute_resolution === decision,
      `« ${decision} » mène à ${r.rows[0].status}, versement ${r.rows[0].payout_state}`);
  });
}

await scenario("un membre ne tranche pas son propre litige", { status:"disputed" }, async () => {
  await commeAcheteur();
  const refuse = await refuseAvec("SELECT public.order_resolve_dispute($1,$2,NULL)",
    [cmd, "vendeur_paye"], /permission denied/i);
  await commeExploitant();
  dire(refuse, "seul l'exploitant peut trancher");
});

console.log("\n=== Les blocages de versement ===");
await scenario("déblocage", { status:"completed", confirmed:"now() - interval '2 days'", fenetre:"now() - interval '1 day'" }, async () => {
  await c.query("UPDATE public.orders SET payout_state='blocked', payout_last_error='précaution' WHERE id=$1", [cmd]);
  const r = await c.query("SELECT public.order_unblock_payout($1,'vérifié') AS r", [cmd]);
  const e = await c.query("SELECT payout_state FROM public.orders WHERE id=$1", [cmd]);
  dire(r.rows[0].r === true && e.rows[0].payout_state === "pending", "un versement bloqué par précaution peut être rendu");
});

await scenario("pas de déblocage pendant un litige", { status:"disputed" }, async () => {
  await c.query("UPDATE public.orders SET payout_state='blocked' WHERE id=$1", [cmd]);
  const r = await c.query("SELECT public.order_unblock_payout($1,NULL) AS r", [cmd]);
  dire(r.rows[0].r === false, "un litige ouvert empêche de débloquer par mégarde");
});

await scenario("sortie de revue manuelle", { status:"shipped", shipped:"now() - interval '20 days'" }, async () => {
  await c.query("UPDATE public.orders SET payout_state='manual_review', needs_review=true WHERE id=$1", [cmd]);
  const r = await c.query("SELECT public.order_clear_manual_review($1,'contacté') AS r", [cmd]);
  const e = await c.query("SELECT payout_state, needs_review FROM public.orders WHERE id=$1", [cmd]);
  dire(r.rows[0].r === true && e.rows[0].payout_state === "pending" && e.rows[0].needs_review === false,
    "le silence de l'acheteur ne suspend plus le vendeur indéfiniment");
});

await c.end();
console.log(`\n  ${ko === 0 ? "TOUTES LES TRANSITIONS TIENNENT" : "⚠ " + ko + " ÉCHEC(S)"} — ${ok} vérifiée(s)`);
console.log("  Toutes les transactions ont été annulées : la base est intacte.");
if (ko) process.exitCode = 1;
