/**
 * Versement des vendeurs, en mode « après réception ».
 *
 * Appelée par une tâche planifiée. Elle prend les commandes devenues
 * versables, crée un transfert Stripe vers le compte connecté du vendeur, et
 * l'enregistre. Rien d'autre.
 *
 * Les trois protections qui comptent, et pourquoi :
 *
 *   1. Clé d'idempotence dérivée de la commande. Deux exécutions simultanées
 *      du travail de versement, ou un retry réseau, retombent sur le même
 *      transfert au lieu d'en créer un second. Un double versement est une
 *      perte sèche : l'argent est parti deux fois chez le vendeur, et le
 *      récupérer dépend de son bon vouloir ou de son solde.
 *
 *   2. Index unique sur orders.stripe_transfer_id, et transition d'état sous
 *      verrou en base. Même si Stripe créait deux transferts, la base n'en
 *      accepterait qu'un et la seconde exécution échouerait bruyamment.
 *
 *   3. source_transaction pointant sur la charge d'origine. Le transfert est
 *      alors adossé à ce paiement précis : Stripe le refuse si la charge n'a
 *      pas eu lieu, et il n'exige pas que le solde de la plateforme soit déjà
 *      disponible.
 *
 * L'éligibilité elle-même n'est pas décidée ici mais par orders_ready_for_payout,
 * qui exige un paiement confirmé, aucun remboursement, aucun litige, aucune
 * revue en cours, un délai de garde écoulé, et soit la confirmation de
 * l'acheteur, soit l'expiration du délai de libération automatique.
 *
 * Depuis le 10 octobre 2026, le même passage horaire traite aussi les ventes
 * conclues chez un vendeur dont le compte de paiement n'était pas prêt
 * (_shared/vendeur-pas-pret.ts) : relances, reprise quand il devient prêt,
 * et, à l'échéance de 7 jours, annulation avec remboursement intégral. C'est
 * la seule tâche qui tourne toutes les heures et parle déjà à Stripe : en
 * créer une seconde aurait doublé la configuration (secret, planification)
 * sans rien apporter.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logEvent, redactSecrets, stripeKeyMode } from "../_shared/payments.ts";
import { chargeResend, montant, pluriel } from "../_shared/courriels.ts";
import {
  type ConnectStripeLike,
  profilsConnect,
  type SupabaseLike,
  synchroniserProfilConnect,
} from "../_shared/connect.ts";
import {
  type BilanVendeursPasPrets,
  type StripeRemboursementLike,
  traiterVendeursPasPrets,
  typographie,
} from "../_shared/vendeur-pas-pret.ts";

const STRIPE_API_VERSION = "2023-10-16";
const ADMIN_EMAIL = "contact@athenamilitaria.fr";
const BATCH_SIZE = 50;

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 20000,
});

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type PayoutRow = {
  order_id: string;
  seller_id: string;
  stripe_charge_id: string;
  stripe_payment_intent_id: string | null;
  transfer_amount_cents: number;
  currency: string;
  seller_account_id: string;
};

Deno.serve(async (req) => {
  // Endpoint interne : seule la tâche planifiée, qui porte le secret partagé,
  // peut le déclencher. Sans cela, n'importe qui pourrait provoquer des
  // versements en rafale.
  const expected = Deno.env.get("PAYMENTS_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    logEvent("payout_unauthorized", { has_header: Boolean(provided) });
    return json({ error: "unauthorized" }, 401);
  }

  // Une panne de la requête des versements ne doit pas priver ce passage du
  // traitement des ventes en attente du vendeur (relances, reprises,
  // annulations à l'échéance, qui ont une date promise à l'acheteur) : on
  // note l'échec, on saute la boucle des versements, on fait le reste, et on
  // répond 500 à la fin pour que l'échec reste visible.
  const { data, error } = await admin.rpc("orders_ready_for_payout", { p_limit: BATCH_SIZE });
  let requeteVersementsEnEchec = false;
  if (error) {
    requeteVersementsEnEchec = true;
    logEvent("payout_query_failed", { message: redactSecrets(error.message) });
  }

  const rows = (error ? [] : (data ?? [])) as PayoutRow[];
  const summary = { examined: rows.length, released: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      if (!row.transfer_amount_cents || row.transfer_amount_cents <= 0) {
        // Rien à verser : commission égale au total, ou montant absent.
        await admin.rpc("order_mark_payout_failed", {
          p_order_id: row.order_id, p_error: "Montant à verser nul ou négatif",
        });
        summary.skipped++;
        continue;
      }

      const transfer = await stripe.transfers.create({
        amount: row.transfer_amount_cents,
        currency: row.currency || "eur",
        destination: row.seller_account_id,
        // Adosse le transfert à la charge encaissée pour cette commande.
        source_transaction: row.stripe_charge_id,
        transfer_group: `order_${row.order_id}`,
        description: `Versement commande ${row.order_id.slice(0, 8).toUpperCase()}`,
        metadata: {
          order_id: row.order_id,
          seller_id: row.seller_id,
          payment_intent: row.stripe_payment_intent_id ?? "",
        },
      }, {
        // Une commande, un versement. Y compris si cette fonction est
        // rappelée avant d'avoir fini d'écrire en base.
        idempotencyKey: `payout:${row.order_id}`,
      });

      const { data: marked, error: markError } = await admin.rpc("order_mark_payout_released", {
        p_order_id: row.order_id,
        p_transfer_id: transfer.id,
        p_amount_cents: row.transfer_amount_cents,
      });

      if (markError) {
        // Le transfert existe chez Stripe mais la base l'ignore. Surtout ne
        // pas retenter : la clé d'idempotence renverra le même transfert au
        // prochain passage, et l'écriture pourra alors aboutir.
        logEvent("payout_recorded_failed", {
          order_id: row.order_id, transfer_id: transfer.id,
          message: redactSecrets(markError.message),
        });
        await notifyAdmin(
          `[Versement] Écriture en base échouée pour la commande ${row.order_id.slice(0, 8).toUpperCase()}`,
          `Le transfert ${transfer.id} a bien été créé chez Stripe (${montant(row.transfer_amount_cents)}) ` +
          `mais n'a pas pu être enregistré en base. Le prochain passage retombera sur le même transfert ` +
          `grâce à la clé d'idempotence : aucun double versement n'est possible. Vérifier tout de même ` +
          `l'état de la commande.`,
        );
        summary.failed++;
        continue;
      }

      const result = (marked ?? {}) as Record<string, unknown>;
      if (result.changed === true) {
        summary.released++;
        logEvent("payout_released", {
          order_id: row.order_id, seller_id: row.seller_id,
          transfer_id: transfer.id, amount_cents: row.transfer_amount_cents,
        });
      } else {
        summary.skipped++;
        logEvent("payout_already_released", { order_id: row.order_id, transfer_id: transfer.id });
      }
    } catch (err) {
      summary.failed++;
      const message = redactSecrets((err as Error)?.message ?? String(err));
      logEvent("payout_failed", { order_id: row.order_id, message });
      await admin.rpc("order_mark_payout_failed", { p_order_id: row.order_id, p_error: message })
        .catch(() => {});
    }
  }

  logEvent("payout_batch", { ...summary, key_mode: stripeKeyMode(Deno.env.get("STRIPE_SECRET_KEY")) });

  /* --- Ventes en attente du compte du vendeur ------------------------
   *
   * Après les versements, et isolé dans son propre try : une panne ici ne
   * doit pas empêcher les vendeurs prêts d'être payés. Dans l'autre sens, une
   * panne de la requête des versements ne l'empêche pas non plus (voir plus
   * haut : pas de sortie anticipée).
   */
  let vendeurs: BilanVendeursPasPrets | null = null;
  try {
    vendeurs = await traiterVendeursPasPrets({
      rpc: (name, args) =>
        admin.rpc(name, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
      stripe: stripe as unknown as StripeRemboursementLike,
      async relireVendeur(sellerId, accountId, onboarded) {
        const { lecture } = await synchroniserProfilConnect({
          stripe: stripe as unknown as ConnectStripeLike,
          db: profilsConnect(admin as unknown as SupabaseLike),
          keyMode: stripeKeyMode(Deno.env.get("STRIPE_SECRET_KEY")),
        }, { id: sellerId, stripe_account_id: accountId, stripe_onboarded: onboarded });
        return lecture?.etat === "present" && lecture.pret;
      },
      async emailUtilisateur(userId) {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error) throw new Error(`auth.getUserById: ${error.message}`);
        return data?.user?.email ?? null;
      },
      envoyer: sendEmail,
    });
  } catch (err) {
    const message = redactSecrets((err as Error)?.message ?? String(err));
    logEvent("seller_ready_batch_failed", { message });
    await notifyAdmin(
      "[Ventes en attente du vendeur] Traitement horaire en échec",
      `Le traitement des ventes dont le vendeur n'a pas fini son inscription au paiement a échoué : ${message}\n\n` +
      `Relances, reprises et annulations à l'échéance n'ont pas eu lieu ce passage-ci. Nouvel essai au ` +
      `prochain passage horaire.`,
    );
  }

  // Un courriel seulement s'il y a quelque chose à lire : une annulation, ou
  // une ligne de rapport. Un remboursement en échec n'en ajoute une qu'au
  // premier échec puis une fois par jour (alerterApresEchec) ; un courriel
  // raté vers un acheteur ou un vendeur est retenté sans alerte (journal).
  if (vendeurs && (vendeurs.annulations > 0 || vendeurs.rapport.length > 0)) {
    await notifyAdmin(
      `[Ventes en attente du vendeur] ${pluriel(vendeurs.annulations, "annulation", "annulations")}, ` +
      `${pluriel(vendeurs.echecs, "échec", "échecs")}`,
      [
        `Passage horaire : ${pluriel(vendeurs.examinees, "commande examinée", "commandes examinées")}, ` +
        `${pluriel(vendeurs.relances, "relance", "relances")}, ${pluriel(vendeurs.reprises, "reprise", "reprises")}, ` +
        `${pluriel(vendeurs.annulations, "annulation", "annulations")} avec remboursement intégral.`,
        "",
        ...vendeurs.rapport.map((l) => "  - " + l),
      ].join("\n"),
    );
  }

  if (summary.failed > 0) {
    await notifyAdmin(
      `[Versement] ${pluriel(summary.failed, "échec", "échecs")} sur ${pluriel(summary.examined, "commande", "commandes")}`,
      `Le versement automatique a échoué pour ${summary.failed} ${summary.failed > 1 ? "commandes" : "commande"} ` +
      `sur ${summary.examined}. Le détail est dans payout_last_error ; ` +
      `${summary.failed > 1 ? "elles restent en attente et seront retentées" : "elle reste en attente et sera retentée"} ` +
      `au prochain passage.`,
    );
  }

  if (requeteVersementsEnEchec) {
    return json({
      error: "query failed", ...summary, vendeurs_pas_prets: vendeurs && { ...vendeurs, rapport: undefined },
    }, 500);
  }
  return json({ ok: true, ...summary, vendeurs_pas_prets: vendeurs && { ...vendeurs, rapport: undefined } }, 200);
});

/** Courriel aux acheteurs et vendeurs. Renvoie vrai seulement si Resend l'a
 *  accepté : la notification est alors tenue pour envoyée, sinon sa
 *  réservation est rendue et elle repartira au prochain passage. */
async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    logEvent("email_skipped", { to, subject });
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(chargeResend(to, subject, body)),
    });
    if (!res.ok) {
      logEvent("email_failed", { to, subject, status: res.status, body: redactSecrets(await res.text()) });
      return false;
    }
    logEvent("email_sent", { to, subject });
    return true;
  } catch (err) {
    logEvent("email_failed", { to, subject, message: redactSecrets((err as Error)?.message ?? String(err)) });
    return false;
  }
}

/** Alerte à l'exploitant. La typographie est appliquée ici, une fois pour
 *  toutes les alertes ; un refus de Resend est journalisé au lieu d'être
 *  avalé en silence. */
async function notifyAdmin(subject: string, body: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    logEvent("email_skipped", { to: ADMIN_EMAIL, subject });
    return;
  }
  const charge = chargeResend(ADMIN_EMAIL, typographie(subject), typographie(body));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(charge),
  }).catch((err) => {
    logEvent("email_failed", { to: ADMIN_EMAIL, subject, message: redactSecrets((err as Error)?.message ?? String(err)) });
    return null;
  });
  if (res && !res.ok) logEvent("email_failed", { to: ADMIN_EMAIL, subject, status: res.status });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
