import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Lien de désinscription de la newsletter (clic depuis l'e-mail, sans login).
// Sécurisé par signature HMAC : uid + sig générés par weekly-newsletter.
// Déployée en --no-verify-jwt (lien public), la signature fait foi.
// uid et sig sont lus dans l'adresse quelle que soit la méthode : le POST
// « List-Unsubscribe=One-Click » des boîtes de réception (RFC 8058, en-tête
// posé par weekly-newsletter) désinscrit donc comme le clic sur le lien.
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const uid = url.searchParams.get("uid") || "";
    const sig = url.searchParams.get("sig") || "";
    const NL_SECRET = Deno.env.get("NEWSLETTER_SECRET");
    if (!uid || !sig || !NL_SECRET) return page(LIEN_INVALIDE, false);

    const expected = await hmacHex(NL_SECRET, uid);
    if (sig !== expected) return page(LIEN_INVALIDE, false);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error } = await admin
      .from("profiles")
      .update({ newsletter_opt_out: true })
      .eq("id", uid);
    if (error) return page(ERREUR, false);

    return page(
      "Votre désinscription de la newsletter hebdomadaire d'Athena\u00a0Militaria est enregistrée\u00a0: " +
      "vous ne la recevrez plus.",
      true,
    );
  } catch (_) {
    return page(ERREUR, false);
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

const LIEN_INVALIDE =
  "Ce lien de désinscription n'est pas valide. Pour demander votre désinscription, écrivez-nous à " +
  "contact@athenamilitaria.fr.";
const ERREUR =
  "La désinscription n'a pas pu être enregistrée. Réessayez dans quelques minutes, ou écrivez-nous à " +
  "contact@athenamilitaria.fr.";

/* Réponse en texte brut. Supabase sert le HTML de ses domaines *.supabase.co
 * en text/plain, sous une politique « sandbox » : l'ancienne page HTML
 * s'affichait en code source, avec son titre à tiret cadratin. Le texte brut
 * se lit tel quel. L'en-tête de type peut perdre son charset en route : la
 * marque d'ordre des octets (BOM) en tête fait reconnaître l'UTF-8 aux
 * navigateurs, accents compris. */
function page(message: string, ok: boolean) {
  const texte = `\uFEFFAthena Militaria\n\n${message}\n\nRetour au site\u00a0: https://www.athenamilitaria.fr\n`;
  return new Response(texte, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
