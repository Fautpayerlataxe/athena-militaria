import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = "https://www.athenamilitaria.fr";

// Newsletter hebdomadaire : envoie aux membres (non désinscrits) les annonces
// publiées ces 7 derniers jours. Déclenchée par le planificateur (pg_cron)
// avec le secret CRON_SECRET. Déployée en --no-verify-jwt : le secret fait foi.
Deno.serve(async (req) => {
  try {
    const { secret } = await req.json().catch(() => ({}));
    if (!secret || secret !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "Non autorisé" }, 401);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const NL_SECRET = Deno.env.get("NEWSLETTER_SECRET");
    if (!RESEND_API_KEY || !NL_SECRET) return json({ error: "Config manquante" }, 500);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Annonces publiées ces 7 derniers jours (max 10, plus récentes d'abord)
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: products } = await admin
      .from("products")
      .select("id, title, price, image_url, image_urls, period, subcategory")
      .eq("status", "published")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!products || products.length === 0) {
      return json({ ok: true, skipped: "aucune annonce cette semaine" });
    }

    // Destinataires : profils avec e-mail, non désinscrits
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email")
      .eq("newsletter_opt_out", false)
      .not("email", "is", null);

    const recipients = (profiles || []).filter((p) => p.email && p.email.includes("@"));
    if (recipients.length === 0) return json({ ok: true, skipped: "aucun destinataire" });

    // Plan gratuit Resend : 100 e-mails/jour. On plafonne par prudence.
    const MAX_PER_RUN = 90;
    const batch = recipients.slice(0, MAX_PER_RUN);
    const dropped = recipients.length - batch.length;

    const itemsHtml = products.map((p) => {
      const img = p.image_url || (Array.isArray(p.image_urls) && p.image_urls[0]) || null;
      return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef0;border-radius:10px;margin:0 0 12px">
        <tr>
          ${img ? `<td width="84" style="padding:10px 0 10px 10px"><a href="${SITE}/product?id=${p.id}"><img src="${escapeHtml(img)}" width="72" height="72" style="width:72px;height:72px;border-radius:8px;object-fit:cover;display:block" alt=""></a></td>` : ""}
          <td style="padding:10px 14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
            <a href="${SITE}/product?id=${p.id}" style="font-size:14px;font-weight:600;color:#1f2a3c;text-decoration:none;line-height:1.3">${escapeHtml(p.title || "Annonce")}</a>
            <div style="font-size:13px;color:#6b7480;margin-top:3px">
              ${p.price ? `${Number(p.price).toLocaleString("fr-FR")}&nbsp;&euro;` : ""}${p.period ? ` &middot; ${escapeHtml(p.period)}` : ""}
            </div>
          </td>
        </tr>
      </table>`;
    }).join("");

    let sent = 0, failed = 0;
    for (const r of batch) {
      const sig = await hmacHex(NL_SECRET, r.id);
      const unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/newsletter-unsubscribe?uid=${encodeURIComponent(r.id)}&sig=${sig}`;

      const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#eef0f2;-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Les nouvelles pi&egrave;ces mises en vente cette semaine.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f2">
    <tr><td align="center" style="padding:28px 12px 36px">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%">
        <tr><td style="padding:0 6px 14px">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:19px;color:#1f2a3c">Athena&nbsp;Militaria</span>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #e5e7ea;border-radius:14px;padding:30px 30px 26px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
          <p style="margin:0 0 4px;font-size:15px;color:#2a3138">Bonjour,</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#2a3138">
            Voici les pi&egrave;ces mises en vente cette semaine sur Athena Militaria.
          </p>
          ${itemsHtml}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px">
            <tr><td style="border-radius:8px;background:#1f2a3c">
              <a href="${SITE}/category" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Voir toutes les annonces</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:16px 8px 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;line-height:1.7;color:#9aa1ab">
          Newsletter hebdomadaire d'<a href="${SITE}" style="color:#9aa1ab;text-decoration:none">athenamilitaria.fr</a>
          &nbsp;&middot;&nbsp;
          <a href="${unsubUrl}" style="color:#9aa1ab;text-decoration:underline">Se d&eacute;sinscrire</a>
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
          to: [r.email],
          subject: `Cette semaine sur Athena Militaria : ${products.length} nouvelle${products.length > 1 ? "s" : ""} pièce${products.length > 1 ? "s" : ""}`,
          html,
        }),
      });
      if (res.ok) sent++;
      else { failed++; console.error("[NL ERR]", r.email, res.status, await res.text()); }
      // Limite Resend : 2 requêtes/seconde
      await new Promise((ok) => setTimeout(ok, 600));
    }

    if (dropped > 0) console.warn(`[NL] ${dropped} destinataire(s) non servis (plafond ${MAX_PER_RUN}/envoi)`);
    return json({ ok: true, sent, failed, dropped, listings: products.length });
  } catch (err) {
    console.error("weekly-newsletter error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
