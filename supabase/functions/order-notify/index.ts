import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non authentifié" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Session invalide" }, 401);

    const { orderId, event } = await req.json();
    if (!orderId || !["shipped", "completed", "disputed"].includes(event)) {
      return json({ error: "Paramètres invalides" }, 400);
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

    if (!order) return json({ error: "Commande introuvable" }, 404);

    // Sécurité : seul le bon rôle peut déclencher chaque type d'event
    // - shipped   : seul le vendeur (il vient de l'expédier)
    // - completed : seul l'acheteur (il vient de confirmer la réception)
    // - disputed  : seul l'acheteur (il signale un problème)
    if (event === "shipped" && order.seller_id !== user.id) {
      return json({ error: "Seul le vendeur peut notifier l'expédition" }, 403);
    }
    if ((event === "completed" || event === "disputed") && order.buyer_id !== user.id) {
      return json({ error: "Seul l'acheteur peut notifier cet événement" }, 403);
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
          `Bonjour,\n\nL'acheteur a confirmé la bonne réception de « ${productTitle} ».\nLa transaction est désormais validée.\n\nLe versement de ton paiement sera initié sous peu (commission plateforme déduite).\n\nMerci,\nAthena Militaria`
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

    return json({ ok: true });
  } catch (err) {
    console.error("order-notify error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
