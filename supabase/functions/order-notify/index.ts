import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { clientError, corsHeaders as buildCors, logEvent, redactSecrets } from "../_shared/payments.ts";

/** Le statut que la commande doit réellement porter pour que l'email parte.
 *  Sans ce contrôle, l'endpoint envoyait l'email sur simple demande : un
 *  acheteur pouvait le rappeler en boucle et inonder le vendeur, ou annoncer
 *  une expédition qui n'avait pas eu lieu. L'email suit l'état, il ne le
 *  précède pas. */
const REQUIRED_STATUS: Record<string, string> = {
  shipped: "shipped",
  completed: "completed",
  disputed: "disputed",
};

async function sendEmail(to: string, subject: string, body: string) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIP] ${to} : ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Athena Militaria <noreply@athenamilitaria.com>",
      to: [to],
      subject,
      text: body,
    }),
  });
  if (!res.ok) console.error(`[EMAIL ERR] ${to}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(corsHeaders, "AUTH_REQUIRED");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return fail(corsHeaders, "AUTH_REQUIRED");

    let body: { orderId?: unknown; event?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(corsHeaders, "BAD_REQUEST");
    }

    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const event = typeof body.event === "string" ? body.event : "";
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !REQUIRED_STATUS[event]) {
      return fail(corsHeaders, "BAD_REQUEST");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Charge la commande + produit
    const { data: order } = await admin
      .from("orders")
      .select("*, products(title)")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return fail(corsHeaders, "ORDER_NOT_FOUND");

    // Sécurité : seul le bon rôle peut déclencher chaque type d'event
    // - shipped   : seul le vendeur (il vient de l'expédier)
    // - completed : seul l'acheteur (il vient de confirmer la réception)
    // - disputed  : seul l'acheteur (il signale un problème)
    if (event === "shipped" && order.seller_id !== user.id) {
      return fail(corsHeaders, "FORBIDDEN");
    }
    if ((event === "completed" || event === "disputed") && order.buyer_id !== user.id) {
      return fail(corsHeaders, "FORBIDDEN");
    }

    // L'état doit déjà être écrit en base. C'est la fonction SQL qui décide de
    // la transition ; cet endpoint ne fait que notifier ce qui est acté.
    if (order.status !== REQUIRED_STATUS[event]) {
      logEvent("order_notify_state_mismatch", {
        order_id: orderId, event, order_status: order.status, user_id: user.id,
      });
      return fail(corsHeaders, "FORBIDDEN");
    }

    const productTitle = order.products?.title || "Article";
    const buyerEmail = order.customer_email;
    const sellerEmail = order.seller_id
      ? (await admin.auth.admin.getUserById(order.seller_id)).data?.user?.email || null
      : null;

    if (event === "shipped") {
      // Notif acheteur : ton article a été expédié
      if (buyerEmail) {
        const trackingLine = order.tracking_number
          ? `Suivi : ${order.tracking_number}${order.tracking_carrier ? " (" + order.tracking_carrier + ")" : ""}`
          : "Tu recevras le numéro de suivi sous peu.";
        await sendEmail(
          buyerEmail,
          `Ton article "${productTitle}" a été expédié`,
          `Bonjour,\n\nLe vendeur vient d'expédier ton achat « ${productTitle} ».\n\n${trackingLine}\n\nDès réception, n'oublie pas de confirmer la réception depuis Mon compte → Mes achats.\n\nMerci,\nAthena Militaria`
        );
      }
    } else if (event === "completed") {
      // Notif vendeur : l'acheteur a confirmé
      if (sellerEmail) {
        await sendEmail(
          sellerEmail,
          `Vente validée : "${productTitle}"`,
          `Bonjour,\n\nL'acheteur a confirmé la bonne réception de « ${productTitle} ».\nLa transaction est désormais validée.\n\nTon versement part automatiquement vers ton compte Stripe. Tu le retrouveras dans Mon compte, rubrique Mes ventes.\n\nMerci,\nAthena Militaria`
        );
      }
    } else if (event === "disputed") {
      // Notif vendeur + admin : litige ouvert
      const reason = order.dispute_reason || "Aucun détail fourni.";
      if (sellerEmail) {
        await sendEmail(
          sellerEmail,
          `⚠ Litige ouvert sur ta vente : "${productTitle}"`,
          `Bonjour,\n\nL'acheteur a signalé un problème sur la commande « ${productTitle} » :\n\n"${reason}"\n\nMerci de le contacter rapidement via la messagerie pour trouver une solution. Si nécessaire, l'équipe Athena Militaria pourra intervenir.\n\nAthena Militaria`
        );
      }
      // Notif admin
      await sendEmail(
        "contact@athenamilitaria.fr",
        `[Litige] Commande ${orderId} — ${productTitle}`,
        `Litige ouvert par l'acheteur ${buyerEmail || "?"} sur la commande ${orderId} (article: ${productTitle}).\n\nRaison :\n${reason}\n\nVendeur : ${sellerEmail || "?"}`
      );
    }

    return json(corsHeaders, { ok: true }, 200);
  } catch (err) {
    logEvent("order_notify_error", { message: redactSecrets((err as Error)?.message ?? String(err)) });
    return fail(corsHeaders, "INTERNAL");
  }
});

function json(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(cors: Record<string, string>, code: string) {
  const { status, code: safeCode, error } = clientError(code);
  return json(cors, { error, code: safeCode }, status);
}
