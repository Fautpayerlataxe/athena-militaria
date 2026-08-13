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
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { formatEuroCents, logEvent, redactSecrets, stripeKeyMode } from "../_shared/payments.ts";

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
  const expected = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    logEvent("payout_unauthorized", { has_header: Boolean(provided) });
    return json({ error: "unauthorized" }, 401);
  }

  const { data, error } = await admin.rpc("orders_ready_for_payout", { p_limit: BATCH_SIZE });
  if (error) {
    logEvent("payout_query_failed", { message: redactSecrets(error.message) });
    return json({ error: "query failed" }, 500);
  }

  const rows = (data ?? []) as PayoutRow[];
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
          `Le transfert ${transfer.id} a bien été créé chez Stripe (${formatEuroCents(row.transfer_amount_cents)}) ` +
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

  if (summary.failed > 0) {
    await notifyAdmin(
      `[Versement] ${summary.failed} échec(s) sur ${summary.examined} commande(s)`,
      `Le travail de versement a rencontré ${summary.failed} erreur(s). Les commandes concernées portent ` +
      `le détail dans payout_last_error et restent en attente : elles seront retentées au prochain passage.`,
    );
  }

  return json({ ok: true, ...summary }, 200);
});

async function notifyAdmin(subject: string, body: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    logEvent("email_skipped", { to: ADMIN_EMAIL, subject });
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: "Athena Militaria <noreply@athenamilitaria.com>",
      to: [ADMIN_EMAIL], subject, text: body,
    }),
  }).catch(() => {});
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
