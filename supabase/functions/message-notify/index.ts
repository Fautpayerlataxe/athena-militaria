import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { objetDuMessage } from "./objet.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://www.athenamilitaria.fr";
const POLICE = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Seules les images du stockage du site entrent dans un courriel : une
 *  adresse d'image libre dans l'annonce servirait de pixel de suivi, ou
 *  changerait après la modération. */
function imageDuStockage(url: unknown): string | null {
  const base = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/`;
  return typeof url === "string" && base.length > 30 && url.startsWith(base) ? url : null;
}

// Notifie le destinataire d'un message par courriel.
// Appelée par le front après l'insertion du message (fire-and-forget).
// Anti-spam : un courriel au plus par conversation et par tranche de
// 10 minutes, compté sur les messages ET sur les envois (rate_limit_hit).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { receiverId, productId: productIdBrut } = await req.json();
    if (!receiverId) return json({ error: "receiverId requis" }, 400);

    /* L'identifiant d'annonce finit dans un lien du courriel. Concaténé tel
     * quel, il permettait d'y glisser des guillemets et donc du HTML dans un
     * message signé Athena Militaria : de quoi fabriquer un lien de
     * hameçonnage crédible. On n'accepte qu'un entier positif, rien d'autre. */
    const productId = Number.isInteger(Number(productIdBrut)) && Number(productIdBrut) > 0
      ? Number(productIdBrut)
      : null;

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
      .select("id, created_at, content")
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

    /* Le contrôle ci-dessus compte les messages, pas les courriels : après un
     * seul message, rejouer cet appel pendant deux minutes renvoyait un
     * courriel complet à chaque fois, vers n'importe quel membre, et brûlait
     * le quota quotidien de Resend dont dépendent les confirmations de
     * commande. Le compteur partagé rate_limit_hit (même mécanique que
     * checkout-status) limite donc les envois eux-mêmes : un par couple
     * expéditeur et destinataire par tranche de dix minutes, vingt par heure
     * pour un même expéditeur. Base injoignable : on garde l'ancien
     * comportement plutôt que de perdre la notification. */
    for (const [bucket, limite, fenetre] of [
      [`message-notify:${sender.id}:${receiverId}`, 1, 600],
      [`message-notify:${sender.id}`, 20, 3600],
    ] as Array<[string, number, number]>) {
      const { data: permis, error: erreurQuota } = await admin.rpc("rate_limit_hit", {
        p_bucket: bucket, p_limit: limite, p_window_seconds: fenetre,
      });
      if (erreurQuota) {
        console.error("[message-notify] rate_limit_hit indisponible :", erreurQuota.message);
        break;
      }
      if (permis === false) return json({ ok: true, skipped: "conversation déjà notifiée récemment" });
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
    // Jamais la partie locale de l'adresse électronique : sans pseudo, le
    // destinataire lisait « jean.dupont1975 », une donnée personnelle.
    const pseudo: string | null = senderProfile?.pseudo || null;
    const senderName = pseudo || "Un membre";

    // Contexte produit éventuel. L'annonce n'est retenue que si elle
    // appartient à l'un des deux correspondants : un appelant ne peut pas
    // accrocher au courriel l'annonce d'un tiers. Son propriétaire décide
    // aussi du texte : « votre annonce » pour le vendeur, « l'annonce
    // ci-dessous » pour l'acheteur à qui le vendeur répond (messages.js
    // transmet l'annonce de la conversation dans les deux sens).
    let productHtml = "";
    let titreAnnonce = "";
    let annonceDuDestinataire = false;
    if (productId) {
      const { data: prod } = await admin
        .from("products").select("title, image_url, image_urls, price, user_id").eq("id", productId).maybeSingle();
      if (prod && (prod.user_id === receiverId || prod.user_id === sender.id)) {
        titreAnnonce = String(prod.title || "Article");
        annonceDuDestinataire = prod.user_id === receiverId;
        const prodImg = imageDuStockage(prod.image_url || (Array.isArray(prod.image_urls) && prod.image_urls[0]) || null);
        productHtml = `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cadre" style="border-collapse:separate;border:1px solid #e8e2d4;border-radius:12px;margin:0 0 20px">
            <tr>
              ${prodImg ? `<td width="72" valign="top" style="padding:10px 0 10px 10px"><img src="${escapeHtml(prodImg)}" width="60" height="60" alt="" style="width:60px;height:60px;border-radius:8px;object-fit:cover;display:block;border:0"></td>` : ""}
              <td valign="top" style="padding:10px 14px;font-family:${POLICE}">
                <div class="titre" style="font-size:14px;font-weight:600;color:#1f2a3c;line-height:1.35">${escapeHtml(titreAnnonce)}</div>
                ${prod.price ? `<div class="or" style="font-size:14px;font-weight:600;color:#8a6320;margin-top:4px">${Number(prod.price).toLocaleString("fr-FR")}&nbsp;&euro;</div>` : ""}
              </td>
            </tr>
          </table>`;
      }
    }
    const hasProduct = titreAnnonce !== "";

    /* Le texte affiché est celui de la base, pas celui fourni par l'appelant.
     * Sinon un expéditeur pouvait écrire un message anodin et faire envoyer
     * un tout autre contenu dans un courriel portant la marque du site. */
    const preview = String(lastMsg.content ?? "").slice(0, 800);
    const replyUrl = `${SITE}/messages?to=${encodeURIComponent(sender.id)}` +
      (hasProduct ? `&product=${productId}` : "");
    const nom = pseudo ? escapeHtml(pseudo) : "Un membre";
    const suite = !hasProduct ? "" : annonceDuDestinataire ? " au sujet de votre annonce" : " au sujet de l&rsquo;annonce ci-dessous";
    // L'auteur est toujours présenté comme un membre : un pseudo comme
    // « Moderation » ne doit pas pouvoir passer pour un message du site.
    const introLine = pseudo
      ? `<strong class="titre" style="color:#1f2a3c">${nom}</strong>, membre d&rsquo;Athena&nbsp;Militaria, vous a envoy&eacute; un message${suite}.`
      : `Un membre d&rsquo;Athena&nbsp;Militaria vous a envoy&eacute; un message${suite}.`;
    // Le préentête suit l'objet dans la boîte de réception : même règle que
    // l'introduction, le pseudo n'y paraît jamais sans « membre ».
    const auteurPreentete = pseudo
      ? `${nom}, membre d&rsquo;Athena&nbsp;Militaria,`
      : `Un membre d&rsquo;Athena&nbsp;Militaria`;
    const preentete = hasProduct
      ? `${auteurPreentete} vous a &eacute;crit au sujet de &laquo;&nbsp;${escapeHtml(titreAnnonce)}&nbsp;&raquo;.`
      : `${auteurPreentete} vous a &eacute;crit sur la messagerie du site.`;
    // L'objet dit de quoi il s'agit ; sans annonce, de qui, avec l'élision
    // (« d'Antoine ») et la mention « membre » (objet.ts).
    const sujet = objetDuMessage(pseudo, hasProduct ? titreAnnonce : null);

    /* Même construction que authenticity-notify et la newsletter : table à
     * 100 % plafonnée à 520 px, et non l'inverse (width:520px ne rétrécit pas,
     * le courriel débordait de 237 px sur un téléphone), bloc conditionnel
     * pour Outlook, palette déclarée pour le thème sombre. */
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
    .citation { background:#252c35 !important; }
    .txt, .titre, .marque { color:#e9ecf1 !important; }
    .doux { color:#a4adb9 !important; }
    .or { color:#d9bd6a !important; }
    .pied, .pied a { color:#8b93a0 !important; }
    .bouton { background:#c9a84c !important; }
    .bouton a { color:#14181d !important; }
  }
</style>
</head>
<body class="fond" style="margin:0;padding:0;background:#f4efe4;-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preentete}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fond" style="background:#f4efe4">
    <tr><td align="center" style="padding:28px 12px 36px">
      <!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto">
        <tr><td align="center" style="padding:0 6px 16px">
          <span class="marque" style="font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:.01em;color:#1f2a3c">Athena&nbsp;Militaria</span>
        </td></tr>
        <tr><td class="carte" style="background:#ffffff;border:1px solid #e8e2d4;border-top:3px solid #c9a84c;border-radius:14px;padding:28px 26px 24px;font-family:${POLICE}">
          <p class="txt" style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#2a3138">Bonjour,</p>
          <p class="txt" style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#2a3138">${introLine}</p>
          ${productHtml}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="citation txt" style="background:#f7f4ec;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.6;color:#33404b;word-break:break-word">
              ${escapeHtml(preview).replace(/\n/g, "<br>")}
            </td></tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 4px">
            <tr><td align="center" class="bouton" style="border-radius:8px;background:#1f2a3c">
              <a href="${escapeHtml(replyUrl)}" style="display:block;padding:13px 30px;font-family:${POLICE};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">R&eacute;pondre</a>
            </td></tr>
          </table>
          <p class="doux" style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#5f6878">
            Pour r&eacute;pondre, utilisez le bouton &laquo;&nbsp;R&eacute;pondre&nbsp;&raquo;&nbsp;: vos &eacute;changes restent sur la messagerie du site. Les r&eacute;ponses &agrave; ce courriel ne sont pas transmises &agrave; votre correspondant.
          </p>
          <p class="doux" style="margin:10px 0 0;font-size:13px;line-height:1.55;color:#5f6878">
            Athena&nbsp;Militaria ne vous demandera jamais de payer en dehors du site, ni de communiquer vos coordonn&eacute;es bancaires par message.
          </p>
        </td></tr>
        <tr><td align="center" class="pied" style="padding:18px 8px 0;font-family:${POLICE};font-size:12px;line-height:1.7;color:#5f6878">
          L&rsquo;&eacute;quipe Athena&nbsp;Militaria &middot; <a href="${SITE}" class="pied" style="color:#5f6878;text-decoration:none">athenamilitaria.fr</a>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
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
        subject: sujet,
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
