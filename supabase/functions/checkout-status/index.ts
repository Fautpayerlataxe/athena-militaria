/**
 * État d'une commande après le retour de Stripe.
 *
 * La page de confirmation ne connaît qu'un identifiant de session lu dans
 * l'URL. Elle ne décide de rien : elle pose la question au serveur, qui relit
 * la session chez Stripe et répond. Ouvrir /order?session_id=... à la main, ou
 * recevoir le lien de quelqu'un d'autre, ne débloque donc rien.
 *
 * Stripe recommande de déclencher le traitement ici en plus du webhook : un
 * webhook peut être retardé, et l'acheteur est présent maintenant. Le chemin
 * étant le même et idempotent, les deux appels ne produisent qu'un seul
 * encaissement.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  clientError,
  corsHeaders,
  formatEuroCents,
  logEvent,
  redactSecrets,
  shippingLabel,
} from "../_shared/payments.ts";
import { fulfillCheckoutSession, type FulfillDeps } from "../_shared/fulfillment.ts";

const STRIPE_API_VERSION = "2023-10-16";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 15000,
});

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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
      from: "Athena Militaria <noreply@athenamilitaria.fr>",
      to: [to],
      subject,
      text: body,
    }),
  });
  if (!res.ok) logEvent("email_failed", { to, subject, status: res.status });
}

function defer(task: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else void task;
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
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(cors, "BAD_REQUEST");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(cors, "AUTH_REQUIRED");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return fail(cors, "AUTH_REQUIRED");

    let body: { sessionId?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(cors, "BAD_REQUEST");
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    // Format des identifiants de session Checkout : on refuse tout le reste
    // avant même d'interroger Stripe.
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(sessionId)) return fail(cors, "BAD_REQUEST");

    // Chaque appel interroge Stripe : sans plafond, cet endpoint deviendrait
    // un moyen commode d'épuiser notre quota d'API. Trente par minute laissent
    // largement la place aux rafraîchissements d'une page de confirmation.
    const { data: allowed, error: rateError } = await admin.rpc("rate_limit_hit", {
      p_bucket: `checkout-status:${user.id}`, p_limit: 30, p_window_seconds: 60,
    });
    if (rateError) {
      logEvent("rate_limit_unavailable", { user_id: user.id, message: redactSecrets(rateError.message) });
    } else if (allowed === false) {
      logEvent("rate_limited", { user_id: user.id, bucket: "checkout-status" });
      return fail(cors, "RATE_LIMITED");
    }

    /* --- Autorisation --------------------------------------------------- */

    const { data: existing } = await admin
      .from("orders")
      .select("id, buyer_id")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    if (existing) {
      if (existing.buyer_id !== user.id) {
        logEvent("checkout_status_forbidden", { user_id: user.id, order_id: existing.id });
        return fail(cors, "FORBIDDEN");
      }
    } else {
      // Aucune commande rattachée à cette session : on vérifie directement
      // chez Stripe que la session appartient bien à cet utilisateur.
      const probe = await stripe.checkout.sessions.retrieve(sessionId);
      if (probe.metadata?.buyer_id !== user.id) {
        logEvent("checkout_status_forbidden", { user_id: user.id, session_id: sessionId });
        return fail(cors, "FORBIDDEN");
      }
    }

    /* --- Traitement ----------------------------------------------------- */

    const outcome = await fulfillCheckoutSession(deps, sessionId);
    const order = (outcome.order ?? {}) as Record<string, unknown>;

    const productId = order.product_id;
    const { data: product } = productId != null
      ? await admin.from("products").select("title, image_url").eq("id", productId).maybeSingle()
      : { data: null };

    return json(cors, {
      status: outcome.status,
      order: {
        reference: String(order.id ?? "").slice(0, 8).toUpperCase(),
        state: order.status ?? null,
        amount: formatEuroCents(order.amount_total_cents as number | null),
        shipping: shippingLabel(order.shipping_method as string | null),
        productTitle: product?.title ?? null,
        productImage: product?.image_url ?? null,
      },
      // L'enquête Google Avis clients n'est proposée que sur un paiement
      // confirmé. Ces champs sont ceux que Google exige ; l'acheteur reste
      // libre de refuser dans la boîte de dialogue elle-même.
      review: outcome.status === "fulfilled" ? await surveyData(order) : null,
    }, 200);
  } catch (err) {
    logEvent("checkout_status_error", { message: redactSecrets((err as Error)?.message ?? String(err)) });
    return fail(cors, "INTERNAL");
  }
});

/** Champs exigés par l'enquête Google Avis clients.
 *
 *  La date de livraison estimée conditionne l'envoi de l'enquête : Google
 *  attend qu'elle soit passée pour écrire à l'acheteur. Mieux vaut donc
 *  l'estimer large que courte, sinon l'acheteur est interrogé sur un colis
 *  qu'il n'a pas reçu. On prend le délai maximal du transporteur plus deux
 *  jours de préparation ; la remise en main propre, qui n'annonce aucun
 *  délai, reçoit une semaine par convention. */
async function surveyData(order: Record<string, unknown>): Promise<Record<string, string> | null> {
  const orderId = typeof order.id === "string" ? order.id : null;
  const email = typeof order.customer_email === "string" ? order.customer_email : null;
  if (!orderId || !email) return null;

  const method = typeof order.shipping_method === "string" ? order.shipping_method : null;
  let days = 7;
  if (method === "relay" || method === "post") {
    const { data } = await admin.from("shipping_rates").select("max_days").eq("method", method).maybeSingle();
    const max = Number(data?.max_days);
    days = (Number.isFinite(max) && max > 0 ? max : 5) + 2;
  }

  const address = (order.shipping_address ?? null) as Record<string, unknown> | null;
  const country = typeof address?.country === "string" && /^[A-Za-z]{2}$/.test(address.country)
    ? address.country.toUpperCase()
    : "FR";

  return {
    orderId,
    email,
    deliveryCountry: country,
    estimatedDeliveryDate: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
  };
}

function json(cors: Record<string, string>, body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(cors: Record<string, string>, code: string) {
  const { status, code: safeCode, error } = clientError(code);
  return json(cors, { error, code: safeCode }, status);
}
