import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Lien de désinscription de la newsletter (clic depuis l'e-mail, sans login).
// Sécurisé par signature HMAC : uid + sig générés par weekly-newsletter.
// Déployée en --no-verify-jwt (lien public), la signature fait foi.
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const uid = url.searchParams.get("uid") || "";
    const sig = url.searchParams.get("sig") || "";
    const NL_SECRET = Deno.env.get("NEWSLETTER_SECRET");
    if (!uid || !sig || !NL_SECRET) return page("Lien invalide.", false);

    const expected = await hmacHex(NL_SECRET, uid);
    if (sig !== expected) return page("Lien invalide ou expiré.", false);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error } = await admin
      .from("profiles")
      .update({ newsletter_opt_out: true })
      .eq("id", uid);
    if (error) return page("Une erreur est survenue. Réessayez plus tard.", false);

    return page("Vous êtes désinscrit de la newsletter hebdomadaire.", true);
  } catch (_) {
    return page("Une erreur est survenue.", false);
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

function page(message: string, ok: boolean) {
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsletter — Athena Militaria</title></head>
<body style="margin:0;background:#eef0f2;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
  <div style="max-width:440px;margin:80px auto;background:#fff;border:1px solid #e5e7ea;border-radius:14px;padding:36px 32px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:19px;color:#1f2a3c;margin-bottom:18px">Athena&nbsp;Militaria</div>
    <p style="font-size:15px;color:#2a3138;line-height:1.6;margin:0 0 24px">${message}</p>
    <a href="https://www.athenamilitaria.fr" style="display:inline-block;padding:11px 26px;background:#1f2a3c;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Retour au site</a>
  </div>
</body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
