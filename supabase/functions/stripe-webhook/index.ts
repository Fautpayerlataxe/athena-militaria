/**
 * Endpoint webhook Stripe.
 *
 * Traité comme un composant d'infrastructure financière, pas comme une
 * notification. Ce que la version précédente ne faisait pas et qui est corrigé
 * ici :
 *
 *   - Elle répondait 200 quoi qu'il arrive, y compris quand l'écriture en base
 *     échouait. Stripe considérait l'événement livré et ne le rejouait jamais :
 *     paiement encaissé, aucune commande. Toute erreur renvoie désormais 500,
 *     et Stripe réessaie pendant trois jours.
 *   - Sa déduplication était un SELECT suivi d'un INSERT, donc inopérante sous
 *     concurrence. Deux livraisons simultanées passaient toutes les deux, et
 *     décrémentaient le stock deux fois. La déduplication se fait maintenant
 *     par event.id, avec un bail qui rend un événement interrompu rejouable.
 *   - Elle envoyait deux emails et interrogeait l'API Auth avant de répondre.
 *     Stripe n'attend que quelques secondes, et Checkout retarde la
 *     redirection de l'acheteur pendant ce temps. Les emails partent
 *     maintenant après la réponse.
 *   - Elle traitait checkout.session.completed comme une preuve d'encaissement.
 *     C'est payment_status qui tranche, relu chez Stripe.
 *   - Elle n'écoutait ni les remboursements, ni les litiges, ni les expirations
 *     de session : la base divergeait silencieusement de Stripe.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  environmentMatches,
  formatEuroCents,
  logEvent,
  planWebhookEvent,
  redactSecrets,
  stripeKeyMode,
} from "../_shared/payments.ts";
import { fulfillCheckoutSession, type FulfillDeps } from "../_shared/fulfillment.ts";

const STRIPE_API_VERSION = "2023-10-16";
const ADMIN_EMAIL = "contact@athenamilitaria.fr";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 15000,
});

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const KEY_MODE = stripeKeyMode(Deno.env.get("STRIPE_SECRET_KEY"));

/** Repousse un travail après la réponse HTTP. Le chemin critique du webhook ne
 *  doit contenir que ce qui décide de l'état financier. */
function defer(task: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else void task;
}

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    logEvent("email_skipped", { to, subject });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: "Athena Militaria <noreply@athenamilitaria.com>",
      to: [to],
      subject,
      text: body,
    }),
  });
  if (!res.ok) {
    logEvent("email_failed", { to, subject, status: res.status, body: redactSecrets(await res.text()) });
    return;
  }
  logEvent("email_sent", { to, subject });
}

const deps: FulfillDeps = {
  stripe: stripe as unknown as FulfillDeps["stripe"],
  db: {
    rpc: (name, args) => admin.rpc(name, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    async productTitle(productId) {
      if (productId == null) return { title: null, sellerId: null };
      const { data } = await admin.from("products").select("title, user_id").eq("id", productId).maybeSingle();
      return { title: data?.title ?? null, sellerId: data?.user_id ?? null };
    },
    async sellerEmail(sellerId) {
      const { data } = await admin.auth.admin.getUserById(sellerId);
      return data?.user?.email ?? null;
    },
  },
  sendEmail,
  defer,
};

Deno.serve(async (req) => {
  // Le corps brut, tel quel : toute désérialisation avant vérification
  // casserait la signature.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) return respond(400, { error: "missing signature" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (err) {
    logEvent("webhook_signature_rejected", { message: redactSecrets((err as Error)?.message) });
    return respond(400, { error: "invalid signature" });
  }

  // Un webhook de test frappant un backend live (ou l'inverse) écrirait de
  // fausses commandes. La signature ne le détecte pas : les deux
  // environnements peuvent viser la même URL.
  if (!environmentMatches(KEY_MODE, event.livemode)) {
    logEvent("webhook_environment_mismatch", {
      event_id: event.id, type: event.type, livemode: event.livemode, key_mode: KEY_MODE,
    });
    return respond(400, { error: "environment mismatch" });
  }

  // Réservation de l'événement. Renvoie « busy » si un autre traitement le
  // tient encore, « settled » s'il est déjà terminé : c'est ce qui rend un
  // rejeu inoffensif.
  const { data: claimed, error: claimError } = await admin.rpc("stripe_event_claim", {
    p_id: event.id,
    p_type: event.type,
    p_livemode: event.livemode,
    p_api_version: (event as { api_version?: string }).api_version ?? null,
  });

  if (claimError) {
    logEvent("webhook_claim_error", { event_id: event.id, message: redactSecrets(claimError.message) });
    return respond(500, { error: "claim failed" });
  }

  if (claimed === "settled") {
    // Déjà traité : acquitter est la bonne réponse.
    logEvent("webhook_duplicate", { event_id: event.id, type: event.type });
    return respond(200, { received: true, duplicate: true });
  }

  if (claimed !== "claimed") {
    // Encore sous bail : une autre exécution le tient, ou une exécution
    // précédente a été tuée en cours de route. Acquitter ici reviendrait à
    // affirmer un traitement qui n'a peut-être jamais eu lieu, et Stripe
    // cesserait de réessayer. On refuse la livraison : elle reviendra.
    logEvent("webhook_busy", { event_id: event.id, type: event.type });
    return respond(409, { error: "event already being processed" });
  }

  try {
    const handled = await handleEvent(event);
    await admin.rpc("stripe_event_finish", {
      p_id: event.id,
      p_status: handled ? "done" : "ignored",
      p_error: null,
    });
    return respond(200, { received: true });
  } catch (err) {
    const message = redactSecrets((err as Error)?.message ?? String(err));
    logEvent("webhook_processing_error", { event_id: event.id, type: event.type, message });
    await admin.rpc("stripe_event_finish", { p_id: event.id, p_status: "failed", p_error: message })
      .catch(() => {});
    // 500 : Stripe rejouera. Le bail sur stripe_events expirera d'ici là et
    // laissera la nouvelle tentative reprendre le travail.
    return respond(500, { error: "processing failed" });
  }
});

async function handleEvent(event: Stripe.Event): Promise<boolean> {
  const plan = planWebhookEvent(event as unknown as { type?: string; data?: { object?: unknown } });
  logEvent("webhook_received", { event_id: event.id, type: event.type, action: plan.action });

  switch (plan.action) {
    case "fulfill": {
      await fulfillCheckoutSession(deps, plan.sessionId);
      return true;
    }

    case "payment_failed": {
      const { error } = await admin.rpc("order_mark_payment_failed", {
        p_session_id: plan.sessionId,
        p_intent_id: plan.intentId,
        p_code: plan.code,
      });
      if (error) throw new Error(`order_mark_payment_failed: ${error.message}`);
      return true;
    }

    case "release": {
      // Session expirée sans paiement : le stock repart en vente. On passe par
      // l'identifiant de commande quand on l'a, sinon par la session.
      let orderId = plan.orderId;
      if (!orderId && plan.sessionId) {
        const { data } = await admin.from("orders").select("id").eq("stripe_session_id", plan.sessionId).maybeSingle();
        orderId = data?.id ?? null;
      }
      if (!orderId) return false;
      const { error } = await admin.rpc("checkout_release", { p_order_id: orderId, p_status: "expired" });
      if (error) throw new Error(`checkout_release: ${error.message}`);
      return true;
    }

    case "refund": {
      const { data, error } = await admin.rpc("order_apply_refund", {
        p_intent_id: plan.intentId,
        p_charge_id: plan.chargeId,
        p_refunded_cents: plan.refundedCents,
        p_fully_refunded: plan.fullyRefunded,
      });
      if (error) throw new Error(`order_apply_refund: ${error.message}`);

      const result = (data ?? {}) as Record<string, unknown>;
      if (result.changed === true) {
        const order = (result.order ?? {}) as Record<string, unknown>;
        await recoverTransferIfNeeded(order, plan.refundedCents, plan.fullyRefunded);
        defer(notifyRefund(order, plan.refundedCents, plan.fullyRefunded));
      }
      return true;
    }

    case "chargeback": {
      const { data, error } = await admin.rpc("order_mark_chargeback", {
        p_intent_id: plan.intentId,
        p_charge_id: plan.chargeId,
        p_status: plan.status,
        p_reason: plan.reason,
      });
      if (error) throw new Error(`order_mark_chargeback: ${error.message}`);

      const result = (data ?? {}) as Record<string, unknown>;
      if (result.changed === true) {
        // Paiement indirect : Stripe débite la plateforme du montant du litige
        // alors que les fonds sont déjà partis chez le vendeur. Cela demande
        // une décision humaine, donc une alerte immédiate.
        defer(notifyChargeback((result.order ?? {}) as Record<string, unknown>, plan.status, plan.reason));
      }
      return true;
    }

    case "connect_account": {
      const { data: profile } = await admin
        .from("profiles").select("id").eq("stripe_account_id", plan.accountId).maybeSingle();
      if (!profile) return false;

      const { error } = await admin
        .from("profiles")
        .update({
          stripe_onboarded: plan.ready,
          stripe_onboarded_at: plan.ready ? new Date().toISOString() : null,
        })
        .eq("id", profile.id);
      if (error) throw new Error(`profiles.update: ${error.message}`);

      logEvent("connect_account_updated", { account_id: plan.accountId, ready: plan.ready });
      return true;
    }

    default:
      return false;
  }
}

/**
 * Récupère les fonds déjà versés au vendeur quand la commande est remboursée.
 *
 * Un remboursement sort l'argent du compte de la plateforme. Si le vendeur a
 * déjà été payé, la plateforme perd deux fois le montant sans cette annulation
 * de transfert. Elle n'est possible que si le solde du vendeur le permet ; sinon
 * Stripe refuse, et un humain doit trancher — d'où l'alerte plutôt qu'une
 * relance automatique.
 */
async function recoverTransferIfNeeded(
  order: Record<string, unknown>,
  refundedCents: number,
  fullyRefunded: boolean,
): Promise<void> {
  const transferId = typeof order.stripe_transfer_id === "string" ? order.stripe_transfer_id : null;
  const orderId = String(order.id ?? "");
  if (!transferId || order.payout_state !== "released") return;

  const transferred = Number(order.transfer_amount_cents ?? 0);
  const total = Number(order.amount_total_cents ?? 0);
  // Remboursement partiel : on récupère la part correspondante, plafonnée au
  // montant réellement transféré.
  const amount = fullyRefunded
    ? transferred
    : Math.min(transferred, Math.round((refundedCents / Math.max(1, total)) * transferred));

  if (amount <= 0) return;

  try {
    const reversal = await stripe.transfers.createReversal(transferId, {
      amount,
      description: `Remboursement commande ${orderId.slice(0, 8).toUpperCase()}`,
      metadata: { order_id: orderId },
    }, {
      idempotencyKey: `payout-reversal:${orderId}:${amount}`,
    });

    await admin.rpc("order_mark_payout_reversed", {
      p_order_id: orderId,
      p_reason: `Transfert annulé (${reversal.id}) suite au remboursement`,
    });

    logEvent("payout_reversed", { order_id: orderId, transfer_id: transferId, amount_cents: amount });
  } catch (err) {
    const message = redactSecrets((err as Error)?.message ?? String(err));
    logEvent("payout_reversal_failed", { order_id: orderId, transfer_id: transferId, message });
    defer(sendEmail(
      ADMIN_EMAIL,
      `[Action requise] Récupération de fonds impossible sur la commande ${orderId.slice(0, 8).toUpperCase()}`,
      `La commande a été remboursée à l'acheteur, mais l'annulation du transfert vers le vendeur a échoué.\n\n` +
      `Transfert : ${transferId}\nMontant visé : ${formatEuroCents(amount)}\nMotif Stripe : ${message}\n\n` +
      `La cause la plus fréquente est un solde insuffisant sur le compte du vendeur. Le montant reste dû à ` +
      `la plateforme. À traiter depuis le Dashboard Stripe, section Transferts.`,
    ));
  }
}

async function notifyRefund(order: Record<string, unknown>, cents: number, full: boolean): Promise<void> {
  const reference = String(order.id ?? "").slice(0, 8).toUpperCase();
  const to = typeof order.customer_email === "string" ? order.customer_email : null;
  const label = full ? "intégralement remboursée" : "partiellement remboursée";

  if (to) {
    await sendEmail(
      to,
      `Remboursement de votre commande ${reference}`,
      `Bonjour,\n\nVotre commande ${reference} a été ${label} : ${formatEuroCents(cents)}.\n\n` +
        `Le montant réapparaîtra sur votre moyen de paiement sous cinq à dix jours ouvrés, ` +
        `selon votre banque.\n\nAthena Militaria`,
    );
  }
  await sendEmail(
    ADMIN_EMAIL,
    `[Remboursement] Commande ${reference}`,
    `Commande ${reference} ${label} : ${formatEuroCents(cents)}.\n` +
      `PaymentIntent : ${order.stripe_payment_intent_id ?? "?"}\n` +
      `Vendeur : ${order.seller_id ?? "?"}\n\n` +
      `Rappel : sur un paiement indirect Connect, le transfert vers le vendeur n'est annulé ` +
      `que si le remboursement a été créé avec reverse_transfer=true.`,
  );
}

async function notifyChargeback(order: Record<string, unknown>, status: string, reason: string | null): Promise<void> {
  const reference = String(order.id ?? "").slice(0, 8).toUpperCase();
  await sendEmail(
    ADMIN_EMAIL,
    `[Litige bancaire ${status}] Commande ${reference}`,
    `Un litige bancaire est ${status} sur la commande ${reference}.\n\n` +
      `Motif : ${reason ?? "non précisé"}\n` +
      `Montant : ${formatEuroCents(order.amount_total_cents as number | null)}\n` +
      `PaymentIntent : ${order.stripe_payment_intent_id ?? "?"}\n` +
      `Acheteur : ${order.customer_email ?? "?"}\n` +
      `Vendeur : ${order.seller_id ?? "?"}\n\n` +
      `Le montant du litige et les frais sont débités du compte plateforme. Si le versement au ` +
      `vendeur a déjà eu lieu, créer une annulation de transfert depuis le Dashboard Stripe ` +
      `(section Transferts) avant la clôture du litige.`,
  );
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
