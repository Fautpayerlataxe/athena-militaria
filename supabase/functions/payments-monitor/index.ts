/**
 * Surveillance et réconciliation du système de paiement.
 *
 * Appelée par une tâche planifiée. Elle fait deux choses :
 *
 *   1. RÉCONCILIER. Pour chaque commande dont l'état interne est suspect, elle
 *      relit la vérité chez Stripe et répare ce qui est réparable sans risque.
 *      Réparable sans risque veut dire : une transition que le webhook aurait
 *      faite s'il était arrivé. Rien d'autre n'est automatisé — créer un
 *      paiement, un remboursement ou un transfert depuis un travail de fond
 *      serait le meilleur moyen de transformer une anomalie en perte.
 *
 *   2. ALERTER. Ce qui reste incohérent part par email, une seule fois par
 *      exécution, avec de quoi agir.
 *
 * Les webhooks restent la voie normale. Ceci est le filet : Stripe peut
 * échouer à livrer pendant trois jours, une fonction peut avoir été
 * indisponible, un événement peut avoir été perdu avant la mise en place du
 * journal. Sans réconciliation, une divergence silencieuse ne se découvre
 * qu'au moment où un client réclame.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { formatEuroCents, logEvent, redactSecrets } from "../_shared/payments.ts";
import { fulfillCheckoutSession, type FulfillDeps } from "../_shared/fulfillment.ts";

const STRIPE_API_VERSION = "2023-10-16";
const ADMIN_EMAIL = "contact@athenamilitaria.fr";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20000,
});

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { logEvent("email_skipped", { to, subject }); return; }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: "Athena Militaria <noreply@athenamilitaria.com>", to: [to], subject, text: body,
    }),
  }).catch(() => {});
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
};

type Anomaly = { severity: "critique" | "attention"; line: string };

Deno.serve(async (req) => {
  const expected = Deno.env.get("PAYMENTS_CRON_SECRET");
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const anomalies: Anomaly[] = [];
  const repaired: string[] = [];

  /* --- 1. Commandes bloquées en attente de confirmation de paiement ----
   *
   * Une session Checkout complétée dont le paiement n'a jamais été confirmé
   * en base : soit le webhook async_payment_succeeded s'est perdu, soit le
   * paiement a réellement échoué. Stripe tranche.
   */
  const { data: stuck } = await admin
    .from("orders")
    .select("id, stripe_session_id, created_at, amount_total_cents")
    .eq("status", "payment_pending")
    .lt("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .limit(50);

  for (const order of stuck ?? []) {
    if (!order.stripe_session_id) continue;
    try {
      const outcome = await fulfillCheckoutSession(deps, order.stripe_session_id);
      if (outcome.status === "fulfilled") {
        repaired.push(`commande ${short(order.id)} : paiement confirmé chez Stripe, état recalé sur « payée »`);
      } else if (Date.now() - new Date(order.created_at).getTime() > 3 * 86400_000) {
        anomalies.push({
          severity: "attention",
          line: `Commande ${short(order.id)} en attente de paiement depuis plus de trois jours ` +
                `(${formatEuroCents(order.amount_total_cents)}). Stripe ne la donne toujours pas pour réglée.`,
        });
      }
    } catch (err) {
      anomalies.push({
        severity: "attention",
        line: `Commande ${short(order.id)} : impossible de relire la session chez Stripe (${redactSecrets((err as Error)?.message)}).`,
      });
    }
  }

  /* --- 2. Réservations qui n'ont jamais été libérées -------------------- */
  const { data: swept } = await admin.rpc("checkout_expire_stale", { p_product_id: null });
  if (typeof swept === "number" && swept > 0) {
    repaired.push(`${swept} réservation(s) expirée(s) libérée(s)`);
  }

  /* --- 3. Divergences que Stripe seul peut confirmer -------------------
   *
   * Commandes marquées payées mais dont le remboursement a pu échapper au
   * webhook. On relit la charge : si Stripe la dit remboursée, on aligne.
   */
  const { data: paidOrders } = await admin
    .from("orders")
    .select("id, stripe_charge_id, stripe_payment_intent_id, amount_refunded_cents, status")
    .in("status", ["paid", "shipped", "delivered", "completed"])
    .not("stripe_charge_id", "is", null)
    .eq("amount_refunded_cents", 0)
    .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
    .limit(100);

  for (const order of paidOrders ?? []) {
    try {
      const charge = await stripe.charges.retrieve(order.stripe_charge_id as string);
      if (charge.amount_refunded > 0) {
        await admin.rpc("order_apply_refund", {
          p_intent_id: order.stripe_payment_intent_id,
          p_charge_id: order.stripe_charge_id,
          p_refunded_cents: charge.amount_refunded,
          p_fully_refunded: charge.refunded === true,
        });
        repaired.push(
          `commande ${short(order.id)} : remboursement de ${formatEuroCents(charge.amount_refunded)} ` +
          `constaté chez Stripe et reporté en base`);
      }
      if (charge.disputed) {
        anomalies.push({
          severity: "critique",
          line: `Commande ${short(order.id)} : litige bancaire ouvert chez Stripe, absent de la base.`,
        });
      }
    } catch (err) {
      logEvent("monitor_charge_read_failed", {
        order_id: order.id, message: redactSecrets((err as Error)?.message),
      });
    }
  }

  /* --- 4. Ce qui demande un humain ------------------------------------- */
  const { data: attention } = await admin.rpc("orders_needing_attention");
  for (const row of (attention ?? []) as Array<Record<string, unknown>>) {
    anomalies.push({
      severity: "critique",
      line: `Commande ${short(String(row.id))} (${formatEuroCents(row.amount_total_cents as number)}, ` +
            `état ${row.status}) : ${row.reason}`,
    });
  }

  /* --- 5. Webhooks en échec -------------------------------------------- */
  const { data: failedEvents } = await admin
    .from("stripe_events")
    .select("id, type, attempts, last_error")
    .eq("status", "failed")
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .limit(20);

  for (const event of failedEvents ?? []) {
    anomalies.push({
      severity: "critique",
      line: `Événement Stripe ${event.id} (${event.type}) en échec après ${event.attempts} tentative(s) : ${event.last_error ?? "?"}`,
    });
  }

  /* --- 6. Versements en souffrance ------------------------------------- */
  const { data: blockedPayouts } = await admin
    .from("orders")
    .select("id, payout_state, payout_last_error, amount_total_cents")
    .eq("payout_state", "blocked")
    .limit(20);

  for (const order of blockedPayouts ?? []) {
    anomalies.push({
      severity: "attention",
      line: `Versement suspendu sur la commande ${short(order.id)} ` +
            `(${formatEuroCents(order.amount_total_cents)}) : ${order.payout_last_error ?? "motif non précisé"}`,
    });
  }

  /* --- Rapport --------------------------------------------------------- */

  logEvent("monitor_run", {
    repaired: repaired.length,
    anomalies: anomalies.length,
    critical: anomalies.filter((a) => a.severity === "critique").length,
  });

  if (anomalies.length > 0) {
    const critical = anomalies.filter((a) => a.severity === "critique");
    await sendEmail(
      ADMIN_EMAIL,
      `[Paiements] ${critical.length} anomalie(s) critique(s), ${anomalies.length - critical.length} à surveiller`,
      [
        "Contrôle automatique du système de paiement.",
        "",
        critical.length ? "À TRAITER :" : "",
        ...critical.map((a) => "  - " + a.line),
        "",
        anomalies.length > critical.length ? "À SURVEILLER :" : "",
        ...anomalies.filter((a) => a.severity !== "critique").map((a) => "  - " + a.line),
        "",
        repaired.length ? "Corrigé automatiquement :" : "",
        ...repaired.map((r) => "  - " + r),
      ].filter((l) => l !== "").join("\n"),
    );
  }

  return json({ ok: true, repaired: repaired.length, anomalies: anomalies.length }, 200);
});

function short(id: string): string {
  return String(id).slice(0, 8).toUpperCase();
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
