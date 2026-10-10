/**
 * Ventes chez un vendeur pas prêt : la couche TypeScript, sans réseau.
 *
 * La base (décision, échéance, idempotence) est éprouvée contre un vrai
 * Postgres dans db-vendeur-pas-pret.test.ts. Ici on vérifie ce que la base ne
 * peut pas faire : l'appel de remboursement à Stripe, la relecture du compte
 * du vendeur, les courriels, et ce que disent les textes.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AVIS_VENDEUR_PAS_PRET,
  buildCheckoutSessionParams,
  planWebhookEvent,
  vendeurPretPourAvis,
} from "../supabase/functions/_shared/payments.ts";
import { sendOrderEmails, type FulfillDeps } from "../supabase/functions/_shared/fulfillment.ts";
import {
  alerterApresEchec,
  CODES_ECHEC,
  cleRemboursement,
  courrielAnnulationAcheteur,
  courrielAnnulationVendeur,
  courrielRelance,
  courrielRepriseAcheteur,
  courrielRepriseVendeur,
  enAttenteDuVendeur,
  etatVendeurPourAcheteur,
  EVENEMENTS,
  formatDateCourte,
  formatEcheance,
  paragrapheAcheteurAttente,
  paragrapheVendeurAttente,
  remboursementDeLAnnulationAutomatique,
  traiterVendeursPasPrets,
  typographie,
  type VendeursPasPretsDeps,
} from "../supabase/functions/_shared/vendeur-pas-pret.ts";

type Loose = Record<string, unknown>;

const ECHEANCE = "2026-10-17T12:05:00.000Z"; // samedi 17 octobre 2026, 14 h 05 à Paris

function ligne(over: Loose = {}): Loose {
  return {
    order_id: "aaaaaaaa-1111-2222-3333-444444444444",
    phase: "attente",
    relance: null,
    echeance_proche: false,
    seller_id: "vendeur-1",
    buyer_id: "acheteur-1",
    customer_email: "acheteur@example.test",
    product_id: 42,
    product_title: "Casque Adrian 1915",
    status: "paid",
    paid_at: "2026-10-10T12:05:00.000Z",
    seller_ready_deadline_at: ECHEANCE,
    seller_ready_at: null,
    ship_deadline_at: null,
    amount_total_cents: 5685,
    product_amount_cents: 4500,
    shipping_amount_cents: 890,
    protection_fee_cents: 295,
    seller_amount_cents: 5390,
    amount_refunded_cents: 0,
    stripe_payment_intent_id: "pi_1",
    stripe_charge_id: "ch_1",
    seller_account_id: null,
    seller_onboarded: false,
    ...over,
  };
}

/**
 * Base simulée. Les réservations de notifications reproduisent la clé
 * primaire de order_notifications : la première gagne, les suivantes non.
 * Les décisions d'annulation sont fournies par le test, comme la base les
 * rendrait.
 */
function harnais(opts: {
  lignes: Loose[] | (() => Loose[]);
  decisions?: Record<string, Loose>;
  refund?: (params: Loose, options: Loose) => Promise<Loose>;
  pret?: boolean | Error;
  envoyer?: (to: string) => boolean;
  emails?: Record<string, string | null>;
  /** Ce que rend order_seller_not_ready_cancel_failed : le nombre de
   *  tentatives en échec après celle-ci. */
  tentatives?: number;
}) {
  const appels: Array<{ name: string; args: Loose }> = [];
  const reserves = new Set<string>();
  const courriels: Array<{ to: string; sujet: string; corps: string }> = [];
  const remboursements: Array<{ params: Loose; options: Loose }> = [];
  const relectures: string[] = [];

  const deps: VendeursPasPretsDeps = {
    async rpc(name, args) {
      appels.push({ name, args });
      switch (name) {
        case "orders_seller_ready_queue":
          return { data: typeof opts.lignes === "function" ? opts.lignes() : opts.lignes, error: null };
        case "order_notification_claim": {
          const cle = `${args.p_order_id}:${args.p_event}`;
          if (reserves.has(cle)) return { data: false, error: null };
          reserves.add(cle);
          return { data: true, error: null };
        }
        case "order_notification_release":
          reserves.delete(`${args.p_order_id}:${args.p_event}`);
          return { data: null, error: null };
        case "order_seller_not_ready_cancel_claim":
          return { data: opts.decisions?.[String(args.p_order_id)] ?? { decision: "pas_encore", order: {} }, error: null };
        case "order_seller_not_ready_cancel_complete":
          return { data: { changed: true }, error: null };
        case "order_seller_not_ready_cancel_failed":
          return { data: opts.tentatives ?? 1, error: null };
        default:
          return { data: null, error: null };
      }
    },
    stripe: {
      refunds: {
        async create(params, options) {
          remboursements.push({ params, options });
          if (opts.refund) return opts.refund(params, options);
          return { id: "re_1", amount: 5685, status: "succeeded" };
        },
      },
    },
    async relireVendeur(sellerId) {
      relectures.push(sellerId);
      if (opts.pret instanceof Error) throw opts.pret;
      return opts.pret === true;
    },
    async emailUtilisateur(userId) {
      const table = opts.emails ?? { "vendeur-1": "vendeur@example.test", "acheteur-1": "acheteur@example.test" };
      return userId in table ? table[userId] : null;
    },
    async envoyer(to, sujet, corps) {
      if (opts.envoyer && !opts.envoyer(to)) return false;
      courriels.push({ to, sujet, corps });
      return true;
    },
    journal: () => {},
  };
  return { deps, appels, courriels, remboursements, relectures, reserves };
}

const appelsDe = (appels: Array<{ name: string }>, name: string) => appels.filter((a) => a.name === name);

/* ================================================================== *
 *  Relances
 * ================================================================== */

describe("relances du vendeur", () => {
  test("la relance due part une fois, et pas au passage suivant", async () => {
    const h = harnais({ lignes: [ligne({ relance: "relance_1" })] });
    const b1 = await traiterVendeursPasPrets(h.deps);
    const b2 = await traiterVendeursPasPrets(h.deps);
    assert.equal(b1.relances, 1);
    assert.equal(b2.relances, 0, "la réservation déjà prise empêche le doublon");
    assert.equal(h.courriels.length, 1);
    assert.equal(h.courriels[0].to, "vendeur@example.test");
    assert.match(h.courriels[0].sujet, /^Rappel/);
    assert.match(h.courriels[0].corps, /samedi 17 octobre 2026 à 14 h 05/);
    assert.ok(h.reserves.has(`aaaaaaaa-1111-2222-3333-444444444444:${EVENEMENTS.relance_1}`));
  });

  test("la dernière relance annonce la date d'annulation dans l'objet", async () => {
    const h = harnais({ lignes: [ligne({ relance: "relance_2" })] });
    await traiterVendeursPasPrets(h.deps);
    // « sans inscription terminée » : l'annulation n'est pas certaine, elle
    // n'a lieu que si le vendeur ne finit pas à temps.
    assert.match(h.courriels[0].sujet,
      /^Dernier rappel : sans inscription terminée, votre vente AAAAAAAA sera annulée le 17 octobre 2026$/);
  });

  test("un envoi raté rend la réservation : la relance repart au passage suivant", async () => {
    let echec = true;
    const h = harnais({ lignes: [ligne({ relance: "relance_1" })], envoyer: () => !echec });
    const b1 = await traiterVendeursPasPrets(h.deps);
    assert.equal(b1.relances, 0);
    assert.equal(b1.echecs, 1);
    assert.equal(appelsDe(h.appels, "order_notification_release").length, 1);
    echec = false;
    const b2 = await traiterVendeursPasPrets(h.deps);
    assert.equal(b2.relances, 1);
    assert.equal(h.courriels.length, 1);
  });

  test("vendeur sans adresse : la réservation est consommée, rien n'est retenté en boucle", async () => {
    const h = harnais({ lignes: [ligne({ relance: "relance_1" })], emails: { "vendeur-1": null } });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.equal(h.courriels.length, 0);
    assert.equal(b.echecs, 0);
    assert.equal(appelsDe(h.appels, "order_notification_release").length, 0);
  });

  test("le compte est relu avant de relancer : un vendeur déjà prêt n'est pas relancé, la commande reprend", async () => {
    const id = "aaaaaaaa-1111-2222-3333-444444444444";
    const h = harnais({
      lignes: [ligne({ relance: "relance_1", seller_account_id: "acct_1" })],
      pret: true,
      decisions: { [id]: { decision: "pret", order: { id, seller_ready_at: "2026-10-12T10:00:00Z", ship_deadline_at: "2026-10-19T10:00:00Z" } } },
    });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.deepEqual(h.relectures, ["vendeur-1"]);
    assert.equal(b.relances, 0);
    assert.equal(b.reprises, 1);
    const sujets = h.courriels.map((c) => c.sujet);
    assert.ok(sujets.includes("Vous pouvez expédier la commande AAAAAAAA"));
    assert.ok(sujets.includes("Votre commande AAAAAAAA suit son cours"));
  });

  test("compte illisible chez Stripe : la relance part quand même", async () => {
    const h = harnais({
      lignes: [ligne({ relance: "relance_1", seller_account_id: "acct_1" })],
      pret: new Error("Stripe indisponible"),
    });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.equal(b.relances, 1);
  });
});

/* ================================================================== *
 *  Échéance
 * ================================================================== */

describe("échéance : annulation et remboursement intégral", () => {
  const id = "aaaaaaaa-1111-2222-3333-444444444444";
  const commande = { id, stripe_payment_intent_id: "pi_1", stripe_charge_id: "ch_1", amount_total_cents: 5685,
    stripe_amount_total_cents: 5685, amount_refunded_cents: 0, seller_ready_cancel_at: "2026-10-17T13:07:00Z" };

  test("remboursement intégral chez Stripe, avec une clé d'idempotence par commande, puis deux courriels", async () => {
    const h = harnais({ lignes: [ligne({ phase: "echeance" })], decisions: { [id]: { decision: "annuler", order: commande } } });
    const b = await traiterVendeursPasPrets(h.deps);

    assert.equal(b.annulations, 1);
    assert.equal(h.remboursements.length, 1);
    const { params, options } = h.remboursements[0];
    assert.equal(params.payment_intent, "pi_1");
    assert.equal("amount" in params, false, "sans montant : Stripe rembourse tout (prix, port, Protection)");
    assert.equal(options.idempotencyKey, cleRemboursement(id));
    assert.equal(options.idempotencyKey, `vendeur-pas-pret:${id}`);

    const complete = appelsDe(h.appels, "order_seller_not_ready_cancel_complete");
    assert.equal(complete.length, 1);
    assert.deepEqual(complete[0].args, { p_order_id: id, p_refund_id: "re_1", p_refunded_cents: 5685 });

    const acheteur = h.courriels.find((c) => c.to === "acheteur@example.test")!;
    const vendeur = h.courriels.find((c) => c.to === "vendeur@example.test")!;
    assert.equal(acheteur.sujet, "Commande AAAAAAAA annulée et remboursée");
    assert.match(acheteur.corps, /56,85 €/);
    assert.match(acheteur.corps, /45,00 €/);
    assert.match(acheteur.corps, /8,90 €/);
    assert.match(acheteur.corps, /2,95 €/);
    assert.match(vendeur.sujet, /annulée : inscription au paiement non terminée/);
    assert.match(vendeur.corps, /N'expédiez pas l'article/);
  });

  test("un second passage ne rembourse pas deux fois et n'écrit pas deux fois", async () => {
    let tour = 0;
    const h = harnais({
      lignes: () => (tour++ === 0 ? [ligne({ phase: "echeance" })] : [ligne({ phase: "annulee" })]),
      decisions: { [id]: { decision: "annuler", order: commande } },
    });
    await traiterVendeursPasPrets(h.deps);
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.remboursements.length, 1);
    assert.equal(h.courriels.length, 2);
  });

  test("remboursement refusé par Stripe : la décision reste, l'erreur est notée, personne n'est prévenu à tort", async () => {
    const h = harnais({
      lignes: [ligne({ phase: "echeance" })],
      decisions: { [id]: { decision: "annuler", order: commande } },
      refund: async () => { throw Object.assign(new Error("balance_insufficient"), { code: "balance_insufficient" }); },
    });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.equal(b.annulations, 0);
    assert.equal(b.echecs, 1);
    assert.equal(appelsDe(h.appels, "order_seller_not_ready_cancel_failed").length, 1);
    assert.equal(appelsDe(h.appels, "order_seller_not_ready_cancel_complete").length, 0);
    assert.equal(h.courriels.length, 0, "on n'annonce pas un remboursement qui n'a pas eu lieu");
    assert.ok(b.rapport.some((l) => /Nouvel essai au prochain passage horaire, avec une nouvelle clé/.test(l)));
    const failed = appelsDe(h.appels, "order_seller_not_ready_cancel_failed")[0].args;
    assert.equal(failed.p_code, CODES_ECHEC.refus, "en base, un code neutre seulement");
    assert.doesNotMatch(JSON.stringify(failed), /balance_insufficient/, "le détail Stripe ne va pas en base");
  });

  test("déjà remboursée chez Stripe : on enregistre au lieu d'échouer", async () => {
    const h = harnais({
      lignes: [ligne({ phase: "annulation" })],
      decisions: { [id]: { decision: "annuler", order: commande } },
      refund: async () => { throw Object.assign(new Error("already"), { code: "charge_already_refunded" }); },
    });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.equal(b.annulations, 1);
    const complete = appelsDe(h.appels, "order_seller_not_ready_cancel_complete");
    assert.equal(complete[0].args.p_refund_id, null);
    assert.equal(complete[0].args.p_refunded_cents, 5685);
  });

  test("remboursement déjà constaté en base par le webhook : pas de second appel à Stripe", async () => {
    const h = harnais({
      lignes: [ligne({ phase: "annulation" })],
      decisions: { [id]: { decision: "annuler", order: { ...commande, amount_refunded_cents: 5685, status: "refunded" } } },
    });
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.remboursements.length, 0);
    assert.equal(appelsDe(h.appels, "order_seller_not_ready_cancel_complete").length, 1);
  });

  test("à l'échéance, la base seule décide : « pas encore » ne rembourse rien", async () => {
    const h = harnais({ lignes: [ligne({ phase: "echeance" })], decisions: { [id]: { decision: "pas_encore", order: {} } } });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.equal(h.remboursements.length, 0);
    assert.equal(b.annulations, 0);
  });

  test("le vendeur devenu prêt : courriels de reprise, une fois chacun", async () => {
    const h = harnais({ lignes: [ligne({ phase: "reprise", seller_ready_at: "2026-10-12T10:00:00Z", ship_deadline_at: "2026-10-19T10:00:00Z" })] });
    await traiterVendeursPasPrets(h.deps);
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.courriels.length, 2);
    const vendeur = h.courriels.find((c) => c.to === "vendeur@example.test")!;
    assert.match(vendeur.corps, /au plus tard le lundi 19 octobre 2026 à 12 h 00/);
  });
});

/* ================================================================== *
 *  Textes
 * ================================================================== */

describe("ce que disent les textes", () => {
  const tous = (): string[] => {
    const l = ligne({ ship_deadline_at: "2026-10-19T10:00:00Z" });
    const textes = [
      courrielRelance(l, "relance_1"), courrielRelance(l, "relance_2"),
      courrielAnnulationAcheteur(l), courrielAnnulationVendeur(l),
      courrielRepriseAcheteur(l), courrielRepriseVendeur(l),
    ].flatMap((c) => [c.sujet, c.corps]);
    return [...textes, paragrapheAcheteurAttente(ECHEANCE), paragrapheVendeurAttente(ECHEANCE), AVIS_VENDEUR_PAS_PRET];
  };

  test("l'échéance se lit à l'heure de Paris", () => {
    assert.equal(formatEcheance(ECHEANCE), "samedi 17 octobre 2026 à 14 h 05");
    assert.equal(formatDateCourte(ECHEANCE), "17 octobre 2026");
    // Après le passage à l'heure d'hiver (25 octobre 2026), UTC+1.
    assert.equal(formatEcheance("2026-11-02T09:30:00Z"), "lundi 2 novembre 2026 à 10 h 30");
    assert.equal(formatEcheance(null), "");
  });

  test("aucun tiret cadratin, et des espaces insécables avant : ; ? !", () => {
    for (const t of tous()) {
      assert.doesNotMatch(t, /—/, `tiret cadratin dans : ${t.slice(0, 60)}`);
      assert.doesNotMatch(t, / [:;?!]/, `espace ordinaire avant une ponctuation haute dans : ${t.slice(0, 80)}`);
    }
    assert.equal(typographie("Total : « 3 € » ?"), "Total : « 3 € » ?");
  });

  test("vouvoiement : aucun tutoiement", () => {
    for (const t of tous()) assert.doesNotMatch(t, /\b(tu|ton|ta|tes|toi)\b/i);
  });

  test("le texte de la page Stripe tient dans la limite de Stripe et dit la règle", () => {
    assert.ok(AVIS_VENDEUR_PAS_PRET.length <= 1200);
    assert.match(AVIS_VENDEUR_PAS_PRET, /7 jours après votre paiement/);
    assert.match(AVIS_VENDEUR_PAS_PRET, /intégralement remboursée \(article, livraison et Protection acheteurs\)/);
  });

  test("les noms d'événements sont les mêmes dans le code et dans la migration", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261010000000_vendeur_pas_pret.sql", import.meta.url), "utf8");
    for (const ev of Object.values(EVENEMENTS)) {
      assert.ok(sql.includes(`'${ev}'`), `${ev} absent de orders_seller_ready_queue`);
    }
  });
});

/* ================================================================== *
 *  Confirmation d'achat et page Stripe
 * ================================================================== */

describe("l'acheteur et le vendeur sont prévenus dès le paiement", () => {
  function depsCourriels() {
    const envoyes: Array<{ to: string; subject: string; body: string }> = [];
    const deps = {
      stripe: { checkout: { sessions: { retrieve: async () => ({}) } } },
      db: {
        rpc: async () => ({ data: null, error: null }),
        productTitle: async () => ({ title: "Casque Adrian 1915", sellerId: "vendeur-1" }),
        sellerEmail: async () => "vendeur@example.test",
      },
      sendEmail: async (to: string, subject: string, body: string) => { envoyes.push({ to, subject, body }); },
    } as unknown as FulfillDeps;
    return { deps, envoyes };
  }
  const commande = {
    id: "bbbbbbbb-1111-2222-3333-444444444444", product_id: 42, seller_id: "vendeur-1",
    customer_email: "acheteur@example.test", amount_total_cents: 5685, product_amount_cents: 4500,
    shipping_amount_cents: 890, protection_fee_cents: 295, seller_amount_cents: 5390, shipping_method: "post",
  };

  test("vendeur pas prêt : l'acheteur lit l'échéance et le remboursement automatique, le vendeur ce qu'il doit faire", async () => {
    const { deps, envoyes } = depsCourriels();
    await sendOrderEmails(deps, { ...commande, seller_ready_deadline_at: ECHEANCE });
    const [acheteur, vendeur] = envoyes;
    assert.match(acheteur.body, /samedi 17 octobre 2026 à 14 h 05/);
    assert.match(acheteur.body, /annulée et intégralement remboursée \(prix de l'article, frais de livraison et Protection acheteurs\), automatiquement/);
    assert.doesNotMatch(acheteur.body, /dispose de 5 jours ouvrés pour expédier votre commande\./);
    assert.match(vendeur.subject, /finalisez votre inscription pour être payé$/);
    assert.match(vendeur.body, /account\?tab=my-settings/);
    assert.match(vendeur.body, /vous ne pouvez pas déclarer l'expédition/);
  });

  test("vendeur prêt : les courriels de toujours", async () => {
    const { deps, envoyes } = depsCourriels();
    await sendOrderEmails(deps, commande);
    assert.match(envoyes[0].body, /Le vendeur a été prévenu et dispose de 5 jours ouvrés pour expédier votre commande\./);
    assert.doesNotMatch(envoyes[0].body, /remboursée/);
    assert.equal(envoyes[1].subject, "Vente confirmée BBBBBBBB - Casque Adrian 1915");
  });

  test("la page Stripe ne porte l'avertissement que si le vendeur n'est pas prêt", () => {
    const base = {
      orderId: "11111111-2222-3333-4444-555555555555", productId: "42", productTitle: "Casque",
      productAmountCents: 4500, protectionAmountCents: 295, shippingAmountCents: 890,
      shippingMethod: "post" as const, currency: "eur", expiresAt: 1_800_000_000,
      metadata: { order_id: "11111111" }, siteOrigin: "https://www.athenamilitaria.fr",
    };
    const normal = buildCheckoutSessionParams(base) as Loose;
    assert.equal("custom_text" in normal, false);
    const attente = buildCheckoutSessionParams({ ...base, sellerNotReady: true }) as Record<string, any>;
    assert.equal(attente.custom_text.submit.message, AVIS_VENDEUR_PAS_PRET);
  });

  test("checkout-status expose l'échéance tant que la commande attend le vendeur", () => {
    assert.deepEqual(etatVendeurPourAcheteur({ seller_ready_deadline_at: ECHEANCE }),
      { attente: true, echeance: ECHEANCE, echeanceTexte: "samedi 17 octobre 2026 à 14 h 05" });
    assert.equal(etatVendeurPourAcheteur({ seller_ready_deadline_at: ECHEANCE, seller_ready_at: "2026-10-12T00:00:00Z" }).attente, false);
    assert.equal(etatVendeurPourAcheteur({}).attente, false);
    assert.equal(enAttenteDuVendeur({ seller_ready_deadline_at: ECHEANCE, seller_ready_cancel_at: "x" }), false);
  });
});

/* ================================================================== *
 *  Branchements dans les fonctions déployées
 * ================================================================== */

describe("branchements", () => {
  const source = (chemin: string) => readFileSync(new URL(`../supabase/functions/${chemin}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("create-checkout ne refuse plus un vendeur pas prêt, mais refuse toujours un vendeur bloqué", () => {
    const s = source("create-checkout/index.ts");
    assert.doesNotMatch(s, /SELLER_NOT_ONBOARDED/);
    assert.match(s, /fail\(cors, "SELLER_BLOCKED"\)/);
    assert.match(s, /fail\(cors, "CHECKOUT_DISABLED"\)/);
    assert.match(s, /sellerNotReady: !sellerReady/);
  });

  test("payout-release, appelée toutes les heures, fait le traitement", () => {
    const s = source("payout-release/index.ts");
    assert.match(s, /traiterVendeursPasPrets\(/);
  });

  test("le webhook n'écrit pas un second courriel de remboursement à l'acheteur", () => {
    const s = source("stripe-webhook/index.ts");
    assert.match(s, /if \(to && !remboursementDeLAnnulationAutomatique\(order\)\)/);
    assert.equal(remboursementDeLAnnulationAutomatique({ seller_ready_cancel_at: "2026-10-17T13:07:00Z" }), true);
    assert.equal(remboursementDeLAnnulationAutomatique({}), false);
  });

  test("checkout-status renvoie l'échéance à la page de confirmation", () => {
    const s = source("checkout-status/index.ts");
    assert.match(s, /sellerPending: vendeur\.attente/);
    assert.match(s, /sellerDeadline: vendeur\.echeance/);
  });
});

/* ================================================================== *
 *  Corrections du contrôle du 10 octobre 2026
 * ================================================================== */

describe("remboursement : clé, statut, cumul, alertes", () => {
  const id = "aaaaaaaa-1111-2222-3333-444444444444";
  const commande = { id, stripe_payment_intent_id: "pi_1", stripe_charge_id: "ch_1", amount_total_cents: 5685,
    stripe_amount_total_cents: 5685, amount_refunded_cents: 0, seller_ready_cancel_at: "2026-10-17T13:07:00Z",
    seller_ready_refund_attempts: 0 };

  test("aucun « reason » envoyé : l'acheteur n'a rien demandé, le motif est dans metadata", async () => {
    const h = harnais({ lignes: [ligne({ phase: "echeance" })], decisions: { [id]: { decision: "annuler", order: commande } } });
    await traiterVendeursPasPrets(h.deps);
    const { params } = h.remboursements[0];
    assert.equal("reason" in params, false);
    assert.deepEqual(params.metadata, { order_id: id, motif: "vendeur_pas_pret" });
  });

  test("après des échecs notés, la clé d'idempotence change : Stripe retente au lieu de rejouer le refus", async () => {
    assert.equal(cleRemboursement(id), `vendeur-pas-pret:${id}`);
    assert.equal(cleRemboursement(id, 0), `vendeur-pas-pret:${id}`);
    assert.equal(cleRemboursement(id, 2), `vendeur-pas-pret:${id}:2`);
    const h = harnais({
      lignes: [ligne({ phase: "annulation" })],
      decisions: { [id]: { decision: "annuler", order: { ...commande, seller_ready_refund_attempts: 2 } } },
    });
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.remboursements[0].options.idempotencyKey, `vendeur-pas-pret:${id}:2`);
  });

  test("remboursement créé mais « failed » d'emblée : traité comme un échec, rien d'enregistré, aucun courriel", async () => {
    for (const status of ["failed", "canceled"]) {
      const h = harnais({
        lignes: [ligne({ phase: "echeance" })],
        decisions: { [id]: { decision: "annuler", order: commande } },
        refund: async () => ({ id: "re_x", amount: 5685, status, failure_reason: "expired_or_canceled_card" }),
      });
      const b = await traiterVendeursPasPrets(h.deps);
      assert.equal(b.annulations, 0, status);
      assert.equal(appelsDe(h.appels, "order_seller_not_ready_cancel_complete").length, 0, status);
      assert.equal(appelsDe(h.appels, "order_seller_not_ready_cancel_failed")[0].args.p_code, CODES_ECHEC.nonAbouti);
      assert.equal(h.courriels.length, 0, `${status} : on n'annonce pas un remboursement qui n'a pas eu lieu`);
    }
  });

  test("« pending » reste un remboursement accepté : il est enregistré (charge.refund.updated alerte s'il échoue)", async () => {
    const h = harnais({
      lignes: [ligne({ phase: "echeance" })],
      decisions: { [id]: { decision: "annuler", order: commande } },
      refund: async () => ({ id: "re_p", amount: 5685, status: "pending" }),
    });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.equal(b.annulations, 1);
  });

  test("remboursement partiel fait entre la décision et le remboursement : le cumul est enregistré, pas le reste", async () => {
    const h = harnais({
      lignes: [ligne({ phase: "annulation" })],
      decisions: { [id]: { decision: "annuler", order: { ...commande, amount_refunded_cents: 1000 } } },
      refund: async () => ({ id: "re_reste", amount: 4685, status: "succeeded" }),
    });
    await traiterVendeursPasPrets(h.deps);
    const complete = appelsDe(h.appels, "order_seller_not_ready_cancel_complete")[0].args;
    assert.equal(complete.p_refunded_cents, 5685, "comme charge.amount_refunded, que lit le webhook");
  });

  test("alertes à l'exploitant : au premier échec, puis une fois par jour", async () => {
    assert.deepEqual([1, 2, 23, 24, 25, 48].map(alerterApresEchec), [true, false, false, true, false, true]);
    const echoue = async () => { throw Object.assign(new Error("refus"), { code: "balance_insufficient" }); };
    const deuxieme = harnais({ lignes: [ligne({ phase: "annulation" })],
      decisions: { [id]: { decision: "annuler", order: commande } }, refund: echoue, tentatives: 2 });
    const b2 = await traiterVendeursPasPrets(deuxieme.deps);
    assert.equal(b2.echecs, 1);
    assert.equal(b2.rapport.length, 0, "pas de courriel horaire à l'exploitant pour le même refus");
    const premier = harnais({ lignes: [ligne({ phase: "annulation" })],
      decisions: { [id]: { decision: "annuler", order: commande } }, refund: echoue, tentatives: 1 });
    assert.equal((await traiterVendeursPasPrets(premier.deps)).rapport.length, 1);
  });

  test("aucun paiement rattaché : code neutre en base", async () => {
    const h = harnais({ lignes: [ligne({ phase: "echeance", stripe_payment_intent_id: null, stripe_charge_id: null })],
      decisions: { [id]: { decision: "annuler", order: { ...commande, stripe_payment_intent_id: null, stripe_charge_id: null } } } });
    await traiterVendeursPasPrets(h.deps);
    assert.equal(h.remboursements.length, 0);
    assert.equal(appelsDe(h.appels, "order_seller_not_ready_cancel_failed")[0].args.p_code, CODES_ECHEC.sansPaiement);
  });
});

describe("attente : vendeur déjà prêt en base, relecture sans effet", () => {
  const id = "aaaaaaaa-1111-2222-3333-444444444444";

  test("prêt en base sans reprise constatée : la base constate la reprise, sans appel à Stripe", async () => {
    const h = harnais({
      lignes: [ligne({ seller_account_id: "acct_1", seller_onboarded: true })],
      pret: new Error("Stripe ne devrait pas être appelé"),
      decisions: { [id]: { decision: "pret", order: { id, seller_ready_at: "2026-10-12T10:00:00Z", ship_deadline_at: "2026-10-19T10:00:00Z" } } },
    });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.deepEqual(h.relectures, [], "aucune relecture chez Stripe");
    assert.equal(b.reprises, 1);
    assert.equal(h.courriels.length, 2);
  });

  test("Stripe dit prêt mais la reprise n'a pas eu lieu en base : la relance due part quand même", async () => {
    const h = harnais({
      lignes: [ligne({ relance: "relance_1", seller_account_id: "acct_1" })],
      pret: true,
      decisions: { [id]: { decision: "pas_encore", order: { id } } },
    });
    const b = await traiterVendeursPasPrets(h.deps);
    assert.equal(b.reprises, 0);
    assert.equal(b.relances, 1);
  });
});

describe("webhook et page de paiement", () => {
  test("charge.refund.updated : l'objet est un remboursement, son statut et son motif sont lus", () => {
    const plan = planWebhookEvent({ type: "charge.refund.updated", data: { object: {
      id: "re_1", object: "refund", status: "failed", charge: "ch_1", payment_intent: "pi_1", amount: 5685,
      failure_reason: "expired_or_canceled_card", metadata: { order_id: "o-1", motif: "vendeur_pas_pret" },
    } } });
    assert.deepEqual(plan, {
      action: "refund_updated", refundId: "re_1", status: "failed", intentId: "pi_1", chargeId: "ch_1",
      amountCents: 5685, failureReason: "expired_or_canceled_card", orderId: "o-1", motif: "vendeur_pas_pret",
    });
  });

  test("le webhook alerte l'exploitant sur un remboursement failed ou canceled, et sur rien d'autre", () => {
    const s = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
    assert.match(s, /case "refund_updated": \{/);
    assert.match(s, /if \(plan\.status !== "failed" && plan\.status !== "canceled"\) return true;/);
    assert.match(s, /defer\(notifyRefundFailed\(order, plan\)\)/);
  });

  test("create-checkout : avertissement selon le profil, ou selon la relecture quand elle a eu lieu", () => {
    // Sans relecture (pas de compte, ou Stripe en panne) : le profil.
    assert.equal(vendeurPretPourAvis(null), false);
    assert.equal(vendeurPretPourAvis({}), false, "sans compte");
    assert.equal(vendeurPretPourAvis({ stripe_account_id: "acct_1", stripe_onboarded: false }), false, "inscription en cours");
    assert.equal(vendeurPretPourAvis({ stripe_account_id: "acct_1", stripe_onboarded: true }), true);
    assert.equal(vendeurPretPourAvis({ stripe_account_id: null, stripe_onboarded: true }), false, "drapeau sans compte");
    // Avec relecture : elle tranche, même contre le profil.
    assert.equal(vendeurPretPourAvis({ stripe_account_id: "acct_1", stripe_onboarded: true },
      { etat: "introuvable", motif: "clé live" }), false, "compte de test vu avec la clé live");
    assert.equal(vendeurPretPourAvis({ stripe_account_id: "acct_1", stripe_onboarded: true },
      { etat: "present", pret: false }), false);
    assert.equal(vendeurPretPourAvis({ stripe_account_id: "acct_1", stripe_onboarded: false },
      { etat: "present", pret: true }), true, "inscription finie sans que le webhook soit arrivé");
    const s = readFileSync(new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
    assert.match(s, /let sellerReady = vendeurPretPourAvis\(seller\);/);
    assert.match(s, /sellerReady = vendeurPretPourAvis\(seller, lecture\);/);
  });

  test("payout-release : une panne de la requête des versements n'empêche pas le traitement des vendeurs", () => {
    const s = readFileSync(new URL("../supabase/functions/payout-release/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const appel = s.indexOf("traiterVendeursPasPrets({");
    const premier500 = s.search(/, 500\)/);
    assert.ok(appel > 0 && premier500 > appel, "aucune réponse 500 avant le traitement des vendeurs pas prêts");
    assert.doesNotMatch(s, /return json\(\{ error: "query failed" \}, 500\);/);
  });
});

describe("typographie des messages SQL", () => {
  test("les messages de la garde d'expédition ont une espace insécable avant : ; ? !", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261010000000_vendeur_pas_pret.sql", import.meta.url), "utf8");
    const messages = [...sql.matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'\s*\n\s*USING ERRCODE = 'P0001', HINT/g)].map((m) => m[1]);
    assert.equal(messages.length, 3, "trois refus documentés par un HINT");
    for (const m of messages) {
      assert.doesNotMatch(m, / [:;?!]/, m.slice(0, 60));
      assert.doesNotMatch(m, /—/);
    }
  });
});
