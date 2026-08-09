import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://www.athenamilitaria.fr";

// Notifie le destinataire d'un message par e-mail (style marketplace propre).
// Appelée par le front après l'insertion du message (fire-and-forget).
// Anti-spam : 1 e-mail max par conversation par tranche de 10 minutes.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { receiverId, content, productId } = await req.json();
    if (!receiverId || !content) return json({ error: "receiverId et content requis" }, 400);

    // L'expéditeur doit être authentifié
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non authentifié" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: sender } } = await userClient.auth.getUser();
    if (!sender) return json({ error: "Session invalide" }, 401);
    if (sender.id === receiverId) return json({ error: "Auto-envoi ignoré" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Vérifie qu'un message correspondant existe bien (anti-abus : on ne
    // notifie pas des messages fantômes) : dernier message sender -> receiver < 2 min
    const { data: lastMsg } = await admin
      .from("messages")
      .select("id, created_at")
      .eq("sender_id", sender.id)
      .eq("receiver_id", receiverId)
      .gte("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastMsg) return json({ error: "Aucun message récent à notifier" }, 400);

    // Anti-spam : si un autre message du même expéditeur au même destinataire
    // existe dans les 10 dernières minutes (avant celui-ci), on ne renvoie pas d'e-mail.
    const { count: recentCount } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", sender.id)
      .eq("receiver_id", receiverId)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .lt("created_at", lastMsg.created_at);
    if ((recentCount ?? 0) > 0) {
      return json({ ok: true, skipped: "conversation déjà notifiée récemment" });
    }

    // Coordonnées du destinataire + pseudo de l'expéditeur
    const { data: receiverProfile } = await admin
      .from("profiles").select("email, pseudo").eq("id", receiverId).maybeSingle();
    let receiverEmail = receiverProfile?.email as string | undefined;
    if (!receiverEmail) {
      const { data: au } = await admin.auth.admin.getUserById(receiverId);
      receiverEmail = au?.user?.email ?? undefined;
    }
    if (!receiverEmail) return json({ error: "Destinataire sans e-mail" }, 404);

    const { data: senderProfile } = await admin
      .from("profiles").select("pseudo, email").eq("id", sender.id).maybeSingle();
    const senderName = senderProfile?.pseudo
      || (sender.email ? sender.email.split("@")[0] : "Un collectionneur");

    // Contexte produit éventuel
    let productHtml = "";
    let hasProduct = false;
    if (productId) {
      const { data: prod } = await admin
        .from("products").select("title, image_url, image_urls, price").eq("id", productId).maybeSingle();
      if (prod) {
        hasProduct = true;
        const prodImg = prod.image_url || (Array.isArray(prod.image_urls) && prod.image_urls[0]) || null;
        productHtml = `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef0;border-radius:10px;margin:0 0 22px">
            <tr>
              ${prodImg ? `<td width="66" style="padding:10px 0 10px 10px"><img src="${escapeHtml(prodImg)}" width="56" height="56" style="width:56px;height:56px;border-radius:8px;object-fit:cover;display:block" alt=""></td>` : ""}
              <td style="padding:10px 14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
                <div style="font-size:14px;font-weight:600;color:#1f2a3c;line-height:1.3">${escapeHtml(prod.title || "Article")}</div>
                ${prod.price ? `<div style="font-size:13px;color:#6b7480;margin-top:3px">${Number(prod.price).toLocaleString("fr-FR")}&nbsp;&euro;</div>` : ""}
              </td>
            </tr>
          </table>`;
      }
    }

    const preview = String(content).slice(0, 800);
    const replyUrl = `${SITE}/messages?to=${sender.id}${productId ? "&product=" + productId : ""}`;
    const introLine = hasProduct
      ? `<strong style="color:#1f2a3c">${escapeHtml(senderName)}</strong> vous a envoy&eacute; un message au sujet de votre annonce.`
      : `<strong style="color:#1f2a3c">${escapeHtml(senderName)}</strong> vous a envoy&eacute; un message.`;

    const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f2;-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(senderName)} vous a &eacute;crit &agrave; propos de votre annonce.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f2">
    <tr><td align="center" style="padding:28px 12px 36px">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%">

        <!-- Marque -->
        <tr><td style="padding:0 6px 14px">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:19px;color:#1f2a3c">Athena&nbsp;Militaria</span>
        </td></tr>

        <!-- Carte -->
        <tr><td style="background:#ffffff;border:1px solid #e5e7ea;border-radius:14px;padding:30px 30px 26px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
          <p style="margin:0 0 4px;font-size:15px;color:#2a3138">Bonjour,</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#2a3138">${introLine}</p>

          ${productHtml}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="background:#f5f7f8;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.6;color:#33404b">
              ${escapeHtml(preview).replace(/\n/g, "<br>")}
            </td></tr>
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 6px">
            <tr><td style="border-radius:8px;background:#1f2a3c">
              <a href="${replyUrl}" style="display:inline-block;padding:12px 30px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">R&eacute;pondre</a>
            </td></tr>
          </table>
        </td></tr>

        <!-- Pied -->
        <tr><td align="center" style="padding:16px 8px 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;line-height:1.7;color:#9aa1ab">
          Message re&ccedil;u sur <a href="${SITE}" style="color:#9aa1ab;text-decoration:none">athenamilitaria.fr</a>
          &nbsp;&middot;&nbsp; R&eacute;pondez depuis votre messagerie, les &eacute;changes restent sur la plateforme.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.log(`[EMAIL SKIP - clé absente] à ${receiverEmail} : message de ${senderName}`);
      return json({ ok: true, skipped: "RESEND_API_KEY non configurée" });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Athena Militaria <noreply@athenamilitaria.fr>",
        to: [receiverEmail],
        subject: `${senderName} vous a envoyé un message`,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("[EMAIL ERR]", res.status, detail);
      return json({ error: "Envoi e-mail échoué (" + res.status + ")" }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("message-notify error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
