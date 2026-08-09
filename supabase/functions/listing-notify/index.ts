import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://www.athenamilitaria.fr";

// Prévient l'administrateur par e-mail quand une annonce vient d'être publiée.
// Appelée par le front juste après la publication (fire-and-forget).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { productId } = await req.json();
    if (!productId) return json({ error: "productId requis" }, 400);

    // Publieur authentifié uniquement
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non authentifié" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // L'annonce doit exister, appartenir à l'appelant, et être récente (< 10 min)
    const { data: prod } = await admin
      .from("products")
      .select("id, user_id, title, price, image_url, image_urls, subcategory, period, location, created_at")
      .eq("id", productId)
      .maybeSingle();
    if (!prod) return json({ error: "Annonce introuvable" }, 404);
    if (prod.user_id !== user.id) return json({ error: "Non autorisé" }, 403);
    if (new Date(prod.created_at).getTime() < Date.now() - 10 * 60 * 1000) {
      return json({ error: "Annonce trop ancienne pour une notification" }, 400);
    }

    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!ADMIN_EMAIL || !RESEND_API_KEY) {
      console.log("[LISTING NOTIFY SKIP] config manquante");
      return json({ ok: true, skipped: "config manquante" });
    }

    const { data: sellerProfile } = await admin
      .from("profiles").select("pseudo, email").eq("id", user.id).maybeSingle();
    const sellerName = sellerProfile?.pseudo || sellerProfile?.email || user.email || "Vendeur";

    const productUrl = `${SITE}/product?id=${prod.id}`;
    const details = [prod.period, prod.subcategory, prod.location].filter(Boolean).join(" · ");
    const prodImg = prod.image_url || (Array.isArray(prod.image_urls) && prod.image_urls[0]) || null;

    const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#eef0f2;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f2">
    <tr><td align="center" style="padding:28px 12px 36px">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%">
        <tr><td style="padding:0 6px 14px">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:19px;color:#1f2a3c">Athena&nbsp;Militaria</span>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #e5e7ea;border-radius:14px;padding:30px 30px 26px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
          <p style="margin:0 0 4px;font-size:15px;color:#2a3138">Bonjour,</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#2a3138">
            Une nouvelle annonce vient d'&ecirc;tre publi&eacute;e par
            <strong style="color:#1f2a3c">${escapeHtml(sellerName)}</strong>.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef0;border-radius:10px;margin:0 0 22px">
            <tr>
              ${prodImg ? `<td width="66" style="padding:10px 0 10px 10px"><img src="${escapeHtml(prodImg)}" width="56" height="56" style="width:56px;height:56px;border-radius:8px;object-fit:cover;display:block" alt=""></td>` : ""}
              <td style="padding:10px 14px">
                <div style="font-size:14px;font-weight:600;color:#1f2a3c;line-height:1.3">${escapeHtml(prod.title || "Annonce")}</div>
                <div style="font-size:13px;color:#6b7480;margin-top:3px">
                  ${prod.price ? `${Number(prod.price).toLocaleString("fr-FR")}&nbsp;&euro;` : ""}${details ? ` &middot; ${escapeHtml(details)}` : ""}
                </div>
              </td>
            </tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px">
            <tr>
              <td style="border-radius:8px;background:#1f2a3c">
                <a href="${productUrl}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Voir l'annonce</a>
              </td>
              <td style="padding-left:10px">
                <a href="${SITE}/account" style="display:inline-block;padding:12px 18px;font-size:14px;color:#1f2a3c;text-decoration:underline">Mod&eacute;ration</a>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:#8a929c;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
          Notification automatique r&eacute;serv&eacute;e &agrave; l'administrateur d'athenamilitaria.fr.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Athena Militaria <noreply@athenamilitaria.fr>",
        to: [ADMIN_EMAIL],
        subject: `Nouvelle annonce : ${String(prod.title || "sans titre").slice(0, 60)}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error("[LISTING NOTIFY ERR]", res.status, await res.text());
      return json({ error: "Envoi échoué" }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("listing-notify error:", err);
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
