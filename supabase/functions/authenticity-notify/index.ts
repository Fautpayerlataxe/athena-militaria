import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { urlFiche } from "./urls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://www.athenamilitaria.fr";
const CONTACT = "contact@athenamilitaria.fr";

/** Seules les images du stockage du site entrent dans un courriel. */
function imageDuStockage(url: unknown): string | null {
  const base = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/`;
  return typeof url === "string" && base.length > 30 && url.startsWith(base) ? url : null;
}

/** Coupe un titre trop long pour un objet, avec des points de suspension.
 *  Même règle que _shared/courriels.ts (fonction autonome, voir urls.ts). */
function abreger(texte: string, max: number): string {
  const t = String(texte ?? "").trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max - 1);
  const espace = coupe.lastIndexOf(" ");
  return (espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd() + "…";
}

/* Mêmes adresses que les politiques RLS d'administration (ADD_ADMIN.sql) et
 * que la garde de la base (20261005000000_authenticite.sql). */
const ADMINS = ["sayrox.ar@gmail.com", "renduambroise@gmail.com"];

/* Un seul e-mail par avis, et pas deux dans la même journée : un clic
 * « Authentifier », « Retirer », « Authentifier » ne doit pas faire recevoir
 * trois messages au vendeur. */
const DELAI_MIN_MS = 24 * 60 * 60 * 1000;

// Prévient le vendeur que la modération a jugé sa pièce authentique.
// Appelée par l'espace modération (account.js) juste après l'avis. Tout est
// revérifié ici : l'appelant, l'avis en base, et l'envoi déjà fait ou non.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "POST uniquement" }, 405);

  try {
    const corps = await req.json().catch(() => ({}));
    /* L'identifiant finit dans un lien du courriel : un entier positif,
     * rien d'autre (même garde que message-notify). */
    const productId = Number.isInteger(Number(corps?.productId)) && Number(corps.productId) > 0
      ? Number(corps.productId)
      : null;
    if (!productId) return json({ error: "productId requis" }, 400);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non authentifié" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Session invalide" }, 401);
    if (!ADMINS.includes(String(user.email || "").toLowerCase())) {
      return json({ error: "Réservé à la modération" }, 403);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: prod } = await admin
      .from("products")
      .select("id, user_id, title, price, image_url, image_urls, authenticated_at, authenticity_notified_at")
      .eq("id", productId)
      .maybeSingle();
    if (!prod) return json({ error: "Annonce introuvable" }, 404);
    if (!prod.authenticated_at) return json({ error: "Annonce non authentifiée" }, 409);

    const precedent: string | null = prod.authenticity_notified_at ?? null;
    if (precedent) {
      const t = Date.parse(precedent);
      if (t >= Date.parse(prod.authenticated_at) || Date.now() - t < DELAI_MIN_MS) {
        return json({ ok: true, skipped: "vendeur déjà prévenu" });
      }
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.log("[AUTHENTICITY SKIP] RESEND_API_KEY absente");
      return json({ error: "Envoi d'e-mail non configuré" }, 503);
    }

    const { data: profil } = await admin
      .from("profiles").select("email, pseudo").eq("id", prod.user_id).maybeSingle();
    let email = profil?.email as string | undefined;
    if (!email) {
      const { data: au } = await admin.auth.admin.getUserById(prod.user_id);
      email = au?.user?.email ?? undefined;
    }
    if (!email) return json({ error: "Vendeur sans e-mail" }, 404);

    /* On réserve l'envoi AVANT d'envoyer, par une écriture conditionnelle :
     * deux appels simultanés (double clic) ne peuvent pas la réussir tous les
     * deux, donc un seul courriel part. En cas d'échec d'envoi, on rend la
     * réservation pour qu'un nouvel essai reste possible. */
    let reservation = admin.from("products")
      .update({ authenticity_notified_at: new Date().toISOString() })
      .eq("id", prod.id);
    reservation = precedent
      ? reservation.eq("authenticity_notified_at", precedent)
      : reservation.is("authenticity_notified_at", null);
    const { data: pris, error: errPris } = await reservation.select("id");
    if (errPris) return json({ error: errPris.message }, 500);
    if (!pris || pris.length === 0) return json({ ok: true, skipped: "vendeur déjà prévenu" });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Athena Militaria <noreply@athenamilitaria.fr>",
        to: [email],
        // Une réponse du vendeur (question, demande de nouvel examen) arrive
        // à l'équipe plutôt qu'à noreply@.
        reply_to: CONTACT,
        subject: `Votre annonce «\u00a0${abreger(String(prod.title || "Annonce"), 80)}\u00a0» a été authentifiée`,
        html: gabarit(prod, profil?.pseudo ?? null),
      }),
    });
    if (!res.ok) {
      console.error("[AUTHENTICITY ERR]", res.status, await res.text());
      await admin.from("products").update({ authenticity_notified_at: precedent }).eq("id", prod.id);
      return json({ error: "Envoi e-mail échoué (" + res.status + ")" }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("authenticity-notify error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

/* Même construction que la newsletter (weekly-newsletter) : table à 100 %
 * plafonnée à 520 px et bloc conditionnel pour Outlook, palette déclarée
 * pour le thème sombre. Les deux pièges y sont expliqués. */
function gabarit(prod: Record<string, any>, pseudo: string | null): string {
  const lien = urlFiche(prod.id, prod.title);
  const titre = escapeHtml(prod.title || "Annonce");
  const img = imageDuStockage(prod.image_url || (Array.isArray(prod.image_urls) && prod.image_urls[0]) || null);
  const prix = prod.price ? `${Number(prod.price).toLocaleString("fr-FR")}&nbsp;&euro;` : "";
  const salut = pseudo ? `Bonjour ${escapeHtml(pseudo)},` : "Bonjour,";
  const police = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  return `<!doctype html>
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
    .txt, .titre { color:#e9ecf1 !important; }
    .doux { color:#a4adb9 !important; }
    .marque { color:#e9ecf1 !important; }
    .or { color:#d9bd6a !important; }
    .pied, .pied a { color:#8b93a0 !important; }
    .bouton { background:#c9a84c !important; }
    .bouton a { color:#14181d !important; }
  }
</style>
</head>
<body class="fond" style="margin:0;padding:0;background:#f4efe4;-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Les mod&eacute;rateurs d&rsquo;Athena&nbsp;Militaria ont examin&eacute; votre annonce et jugent la pi&egrave;ce authentique.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fond" style="background:#f4efe4">
    <tr><td align="center" style="padding:28px 12px 36px">
      <!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto">
        <tr><td align="center" style="padding:0 6px 16px">
          <span class="marque" style="font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:.01em;color:#1f2a3c">Athena&nbsp;Militaria</span>
        </td></tr>
        <tr><td class="carte" style="background:#ffffff;border:1px solid #e8e2d4;border-top:3px solid #c9a84c;border-radius:14px;padding:28px 26px 24px;font-family:${police}">
          <p class="or" style="margin:0 0 14px;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#75602c">Authentifi&eacute;e par nos mod&eacute;rateurs</p>
          <p class="txt" style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#2a3138">${salut}</p>
          <p class="txt" style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#2a3138">
            Les mod&eacute;rateurs d&rsquo;Athena&nbsp;Militaria ont examin&eacute; les photos et la description de votre annonce, et jugent la pi&egrave;ce authentique.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cadre" style="border-collapse:separate;border:1px solid #e8e2d4;border-radius:12px;margin:0 0 20px">
            <tr>
              ${img ? `<td width="96" valign="top" style="padding:12px 0 12px 12px"><a href="${escapeHtml(lien)}" style="text-decoration:none"><img src="${escapeHtml(img)}" width="84" height="84" alt="${titre}" style="width:84px;height:84px;border-radius:8px;object-fit:cover;display:block;border:0"></a></td>` : ""}
              <td valign="top" style="padding:12px 14px;font-family:${police}">
                <a href="${escapeHtml(lien)}" class="titre" style="font-size:15px;font-weight:600;color:#1f2a3c;text-decoration:none;line-height:1.35">${titre}</a>
                ${prix ? `<div class="or" style="font-size:15px;font-weight:600;color:#8a6320;margin-top:5px">${prix}</div>` : ""}
              </td>
            </tr>
          </table>
          <p class="txt" style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#2a3138">
            La mention &laquo;&nbsp;Authentifi&eacute;e par nos mod&eacute;rateurs&nbsp;&raquo; appara&icirc;t d&eacute;sormais sur votre annonce et dans le catalogue.
          </p>
          <p class="doux" style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#5f6878">
            Cet avis est form&eacute; sur les photos et la description publi&eacute;es. Il ne constitue ni une expertise ni une garantie, et ne d&eacute;charge pas le vendeur de sa responsabilit&eacute; (<a href="${SITE}/legal" class="doux" style="color:#5f6878">conditions g&eacute;n&eacute;rales</a>, article&nbsp;3.8).
          </p>
          <p class="doux" style="margin:0 0 4px;font-size:13px;line-height:1.55;color:#5f6878">
            Si vous modifiez ensuite les photos, le titre ou la description, la mention sera retir&eacute;e&nbsp;; vous pourrez demander un nouvel examen en &eacute;crivant &agrave; <a href="mailto:${CONTACT}" class="doux" style="color:#5f6878">${CONTACT}</a>.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 4px">
            <tr><td align="center" class="bouton" style="border-radius:8px;background:#1f2a3c">
              <a href="${escapeHtml(lien)}" style="display:block;padding:13px 30px;font-family:${police};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Voir mon annonce</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" class="pied" style="padding:18px 8px 0;font-family:${police};font-size:12px;line-height:1.7;color:#5f6878">
          L&rsquo;&eacute;quipe Athena&nbsp;Militaria &middot; <a href="${SITE}" class="pied" style="color:#5f6878;text-decoration:none">athenamilitaria.fr</a>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body></html>`;
}

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
