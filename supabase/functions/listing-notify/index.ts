import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { urlFiche } from "./urls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://www.athenamilitaria.fr";
const POLICE = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/* Libellé affiché quand il diffère de la valeur en base : même table que
 * LIBELLES_PERIODES de taxonomie.js (fonction autonome, voir urls.ts). */
const LIBELLES_PERIODES: Record<string, string> = {
  "Guerre Napoléonienne": "Révolution et Premier Empire",
};

/** Seules les images du stockage du site entrent dans un courriel. */
function imageDuStockage(url: unknown): string | null {
  const base = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/`;
  return typeof url === "string" && base.length > 30 && url.startsWith(base) ? url : null;
}

/** Coupe un titre trop long pour un objet, avec des points de suspension.
 *  Même règle que _shared/courriels.ts. */
function abreger(texte: string, max: number): string {
  const t = String(texte ?? "").trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max - 1);
  const espace = coupe.lastIndexOf(" ");
  return (espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd() + "…";
}

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

    // Sans le secret ADMIN_EMAIL, aucune alerte ne part : comportement
    // d'origine, conservé. Pas d'adresse de repli : chaque alerte consomme le
    // quota quotidien de Resend dont dépendent les confirmations de commande.
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!ADMIN_EMAIL || !RESEND_API_KEY) {
      console.log("[LISTING NOTIFY SKIP] config manquante");
      return json({ ok: true, skipped: "config manquante" });
    }

    /* Un courriel par annonce. La seule garde était « annonce de moins de
     * 10 minutes appartenant à l'appelant » : pendant ces 10 minutes, chaque
     * appel rejoué envoyait un courriel, de quoi noyer la boîte de
     * l'exploitant et épuiser le quota quotidien de Resend dont dépendent les
     * confirmations de commande. Même compteur partagé que checkout-status
     * (rate_limit_hit). Base injoignable : on garde l'ancien comportement. */
    for (const [bucket, limite, fenetre] of [
      [`listing-notify:${prod.id}`, 1, 3600],
      [`listing-notify-vendeur:${user.id}`, 20, 3600],
    ] as Array<[string, number, number]>) {
      const { data: permis, error: erreurQuota } = await admin.rpc("rate_limit_hit", {
        p_bucket: bucket, p_limit: limite, p_window_seconds: fenetre,
      });
      if (erreurQuota) {
        console.error("[listing-notify] rate_limit_hit indisponible :", erreurQuota.message);
        break;
      }
      if (permis === false) return json({ ok: true, skipped: "déjà signalée" });
    }

    const { data: sellerProfile } = await admin
      .from("profiles").select("pseudo, email").eq("id", user.id).maybeSingle();
    const sellerName = sellerProfile?.pseudo || sellerProfile?.email || user.email || "Vendeur";

    const productUrl = urlFiche(prod.id, prod.title);
    const periode = prod.period ? (LIBELLES_PERIODES[prod.period] ?? prod.period) : null;
    const details = [periode, prod.subcategory, prod.location].filter(Boolean).map((v) => escapeHtml(v)).join(" &middot; ");
    const prodImg = imageDuStockage(prod.image_url || (Array.isArray(prod.image_urls) && prod.image_urls[0]) || null);
    const prix = prod.price ? `${Number(prod.price).toLocaleString("fr-FR")}&nbsp;&euro;` : "";

    /* Même construction que authenticity-notify et la newsletter : table à
     * 100 % plafonnée à 520 px, bloc conditionnel pour Outlook, thème sombre.
     * L'ancien gabarit en width:520px débordait sur téléphone. */
    const html = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .fond { background:#14181d !important; }
    .carte { background:#1d232b !important; border-color:#2b333d !important; }
    .cadre { border-color:#2b333d !important; }
    .txt, .titre, .marque { color:#e9ecf1 !important; }
    .doux { color:#a4adb9 !important; }
    .or { color:#d9bd6a !important; }
    .pied, .pied a { color:#8b93a0 !important; }
    .bouton { background:#c9a84c !important; }
    .bouton a { color:#14181d !important; }
    .lien { color:#e9ecf1 !important; }
  }
</style>
</head>
<body class="fond" style="margin:0;padding:0;background:#f4efe4;-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Nouvelle annonce publi&eacute;e par ${escapeHtml(sellerName)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fond" style="background:#f4efe4">
    <tr><td align="center" style="padding:28px 12px 36px">
      <!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto">
        <tr><td align="center" style="padding:0 6px 16px">
          <span class="marque" style="font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:.01em;color:#1f2a3c">Athena&nbsp;Militaria</span>
        </td></tr>
        <tr><td class="carte" style="background:#ffffff;border:1px solid #e8e2d4;border-top:3px solid #c9a84c;border-radius:14px;padding:28px 26px 24px;font-family:${POLICE}">
          <p class="txt" style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#2a3138">Bonjour,</p>
          <p class="txt" style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#2a3138">
            Une nouvelle annonce vient d&rsquo;&ecirc;tre publi&eacute;e par
            <strong class="titre" style="color:#1f2a3c">${escapeHtml(sellerName)}</strong>.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cadre" style="border-collapse:separate;border:1px solid #e8e2d4;border-radius:12px;margin:0 0 20px">
            <tr>
              ${prodImg ? `<td width="72" valign="top" style="padding:10px 0 10px 10px"><img src="${escapeHtml(prodImg)}" width="60" height="60" alt="" style="width:60px;height:60px;border-radius:8px;object-fit:cover;display:block;border:0"></td>` : ""}
              <td valign="top" style="padding:10px 14px;font-family:${POLICE}">
                <div class="titre" style="font-size:14px;font-weight:600;color:#1f2a3c;line-height:1.35">${escapeHtml(prod.title || "Annonce")}</div>
                ${prix ? `<div class="or" style="font-size:14px;font-weight:600;color:#8a6320;margin-top:4px">${prix}</div>` : ""}
                ${details ? `<div class="doux" style="font-size:13px;color:#5f6878;margin-top:3px;line-height:1.4">${details}</div>` : ""}
              </td>
            </tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:4px auto 4px">
            <tr><td align="center" class="bouton" style="border-radius:8px;background:#1f2a3c">
              <a href="${escapeHtml(productUrl)}" style="display:block;padding:13px 30px;font-family:${POLICE};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Voir l&rsquo;annonce</a>
            </td></tr>
          </table>
          <p class="doux" style="margin:14px 0 0;text-align:center;font-size:13px;line-height:1.55;color:#5f6878">
            <a href="${SITE}/account" class="lien" style="color:#1f2a3c;text-decoration:underline">Ouvrir la mod&eacute;ration</a> (Mon compte)
          </p>
        </td></tr>
        <tr><td align="center" class="pied" style="padding:18px 8px 0;font-family:${POLICE};font-size:12px;line-height:1.7;color:#5f6878">
          Alerte automatique r&eacute;serv&eacute;e &agrave; l&rsquo;&eacute;quipe d&rsquo;<a href="${SITE}" class="pied" style="color:#5f6878;text-decoration:none">athenamilitaria.fr</a>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
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
        subject: `Nouvelle annonce\u00a0: ${abreger(String(prod.title || "sans titre"), 60)}`,
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
