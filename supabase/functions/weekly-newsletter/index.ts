import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { urlFiche } from "./urls.ts";

const SITE = "https://www.athenamilitaria.fr";

// Newsletter hebdomadaire : envoie aux membres (non désinscrits) les annonces
// publiées ces 7 derniers jours. Déclenchée par le planificateur (pg_cron)
// avec le secret CRON_SECRET. Déployée en --no-verify-jwt : le secret fait foi.
Deno.serve(async (req) => {
  try {
    /* testTo : envoi d'essai vers une seule adresse, pour voir le rendu dans
       un vrai client de messagerie avant de toucher aux abonnés. Il passe par
       le même secret que l'envoi réel, donc il n'ouvre aucune porte, et il
       sort avant la boucle sur les destinataires : un essai ne peut pas
       partir à la liste par accident. */
    const { secret, testTo } = await req.json().catch(() => ({}));
    if (!secret || secret !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "Non autorisé" }, 401);
    }
    const essai = typeof testTo === "string" && testTo.includes("@") ? testTo : null;

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

    /* Un essai lancé une semaine sans publication ne montrerait rien. On
       retombe alors sur les dernières annonces en ligne, quelle que soit
       leur date : c'est le gabarit qu'on veut voir, pas la sélection. */
    let annonces = products;
    if (!annonces || annonces.length === 0) {
      if (!essai) return json({ ok: true, skipped: "aucune annonce cette semaine" });
      const { data: recentes } = await admin
        .from("products")
        .select("id, title, price, image_url, image_urls, period, subcategory")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(3);
      annonces = recentes || [];
      if (annonces.length === 0) return json({ ok: false, error: "aucune annonce publiée" }, 400);
    }

    // Destinataires : profils avec e-mail, non désinscrits
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email")
      .eq("newsletter_opt_out", false)
      .not("email", "is", null);

    const recipients = essai
      ? [{ id: "00000000-0000-0000-0000-000000000000", email: essai }]
      : (profiles || []).filter((p) => p.email && p.email.includes("@"));
    if (recipients.length === 0) return json({ ok: true, skipped: "aucun destinataire" });

    // Plan gratuit Resend : 100 e-mails/jour. On plafonne par prudence.
    const MAX_PER_RUN = 90;
    const batch = recipients.slice(0, MAX_PER_RUN);
    const dropped = recipients.length - batch.length;

    /* Lien de courriel : on marque la provenance pour que la mesure
       d'audience distingue une visite venue de la newsletter d'une visite
       venue d'un moteur. Le paramètre ne change pas l'adresse canonique de
       la page, qui est recalculée côté serveur. */
    const lienSuivi = (url: string) =>
      url + (url.includes("?") ? "&" : "?") + "utm_source=newsletter&utm_medium=email";

    const itemsHtml = annonces.map((p) => {
      const img = p.image_url || (Array.isArray(p.image_urls) && p.image_urls[0]) || null;
      const lien = lienSuivi(urlFiche(p.id, p.title));
      const titre = escapeHtml(p.title || "Annonce");
      const prix = p.price ? `${Number(p.price).toLocaleString("fr-FR")}&nbsp;&euro;` : "";
      const contexte = [p.period, p.subcategory].filter(Boolean).map((v) => escapeHtml(String(v))).join(" &middot; ");
      return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cadre" style="border-collapse:separate;border:1px solid #e8e2d4;border-radius:12px;margin:0 0 10px">
        <tr>
          ${img ? `<td width="96" valign="top" style="padding:12px 0 12px 12px"><a href="${lien}" style="text-decoration:none"><img src="${escapeHtml(img)}" width="84" height="84" alt="${titre}" style="width:84px;height:84px;border-radius:8px;object-fit:cover;display:block;border:0"></a></td>` : ""}
          <td valign="top" style="padding:12px 14px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
            <a href="${lien}" class="titre" style="font-size:15px;font-weight:600;color:#1f2a3c;text-decoration:none;line-height:1.35">${titre}</a>
            ${prix ? `<div style="font-size:15px;font-weight:600;color:#8a6320;margin-top:5px">${prix}</div>` : ""}
            ${contexte ? `<div class="doux" style="font-size:13px;color:#7c8590;margin-top:3px;line-height:1.4">${contexte}</div>` : ""}
          </td>
        </tr>
      </table>`;
    }).join("");

    let sent = 0, failed = 0;
    for (const r of batch) {
      const sig = await hmacHex(NL_SECRET, r.id);
      const unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/newsletter-unsubscribe?uid=${encodeURIComponent(r.id)}&sig=${sig}`;

      const html = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Déclarer les deux schémas évite l'inversion sauvage que certains clients
     appliquent à un courriel muet : ils utilisent la palette ci-dessous
     plutôt que d'inventer la leur. -->
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
    .pied, .pied a { color:#8b93a0 !important; }
  }
  /* Sous 420 px, la vignette et le texte cessent de se disputer la largeur. */
  @media only screen and (max-width:420px) {
    .col-img { padding:12px 0 0 12px !important; }
    .col-txt { padding:10px 12px 12px !important; }
  }
</style>
</head>
<body class="fond" style="margin:0;padding:0;background:#f4efe4;-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Les nouvelles pi&egrave;ces mises en vente cette semaine.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fond" style="background:#f4efe4">
    <tr><td align="center" style="padding:28px 12px 36px">
      <!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <!-- Largeur 100 % plafonnée à 520, et non l'inverse. Une table en
           width:520px + max-width:100% ne rétrécit pas : le pourcentage se
           calcule sur une cellule de largeur automatique, donc indéterminée,
           et les navigateurs l'ignorent. Sur un téléphone, le courriel
           débordait de 170 px et se lisait en glissant l'écran. Outlook, qui
           ignore max-width, reçoit la table fixe par le bloc conditionnel. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto">
        <tr><td align="center" style="padding:0 6px 16px">
          <span class="marque" style="font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:.01em;color:#1f2a3c">Athena&nbsp;Militaria</span>
        </td></tr>
        <tr><td class="carte" style="background:#ffffff;border:1px solid #e8e2d4;border-top:3px solid #c9a84c;border-radius:14px;padding:28px 26px 24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
          <p class="txt" style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#2a3138">
            Bonjour,<br>Voici les pi&egrave;ces mises en vente cette semaine.
          </p>
          ${itemsHtml}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 4px">
            <tr><td align="center" style="border-radius:8px;background:#1f2a3c">
              <a href="${lienSuivi(SITE + "/militaria")}" style="display:block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Voir toutes les annonces</a>
            </td></tr>
          </table>
        </td></tr>
        <!-- Pied sur deux lignes : sur un écran de téléphone, la version en
             une seule ligne coupait « Se désinscrire » en deux. -->
        <tr><td align="center" class="pied" style="padding:18px 8px 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.7;color:#8d8577">
          Newsletter hebdomadaire d&rsquo;<a href="${SITE}" class="pied" style="color:#8d8577;text-decoration:none">athenamilitaria.fr</a>
        </td></tr>
        <tr><td align="center" class="pied" style="padding:4px 8px 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.7;color:#8d8577">
          <a href="${unsubUrl}" class="pied" style="color:#8d8577;text-decoration:underline;white-space:nowrap">Se d&eacute;sinscrire</a>
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
          to: [r.email],
          subject: `Cette semaine sur Athena Militaria : ${annonces.length} nouvelle${annonces.length > 1 ? "s" : ""} pièce${annonces.length > 1 ? "s" : ""}`,
          html,
        }),
      });
      if (res.ok) sent++;
      else { failed++; console.error("[NL ERR]", r.email, res.status, await res.text()); }
      // Limite Resend : 2 requêtes/seconde
      await new Promise((ok) => setTimeout(ok, 600));
    }

    if (dropped > 0) console.warn(`[NL] ${dropped} destinataire(s) non servis (plafond ${MAX_PER_RUN}/envoi)`);
    return json({ ok: true, essai: Boolean(essai), sent, failed, dropped, listings: annonces.length });
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
