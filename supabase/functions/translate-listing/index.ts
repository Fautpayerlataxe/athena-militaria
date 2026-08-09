import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Traduit titre + description d'une annonce FR -> EN via DeepL (API Free)
// et stocke le résultat dans products.title_en / description_en.
// Appelée par le front juste après la publication (utilisateur connecté).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { productId } = await req.json();
    if (!productId) return json({ error: "productId requis" }, 400);

    // Utilisateur authentifié uniquement (le vendeur qui vient de publier)
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

    const { data: product, error } = await admin
      .from("products")
      .select("id, user_id, title, description, translated_at")
      .eq("id", productId)
      .single();
    if (error || !product) return json({ error: "Produit introuvable" }, 404);

    // Seul le propriétaire de l'annonce (ou un admin) peut déclencher la traduction
    const ADMIN_EMAILS = ["sayrox.ar@gmail.com", "renduambroise@gmail.com"];
    if (product.user_id !== user.id && !ADMIN_EMAILS.includes(user.email ?? "")) {
      return json({ error: "Non autorisé" }, 403);
    }

    const texts = [product.title || "", product.description || ""];
    if (!texts[0] && !texts[1]) return json({ error: "Rien à traduire" }, 400);

    // DeepL API Free
    const apiKey = Deno.env.get("DEEPL_API_KEY");
    if (!apiKey) return json({ error: "DEEPL_API_KEY non configurée" }, 500);
    const endpoint = apiKey.endsWith(":fx")
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api.deepl.com/v2/translate";

    const dlRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": "DeepL-Auth-Key " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: texts,
        source_lang: "FR",
        target_lang: "EN-GB",
        // préserve la mise en forme simple des descriptions
        preserve_formatting: true,
      }),
    });

    if (!dlRes.ok) {
      const detail = await dlRes.text();
      console.error("DeepL error:", dlRes.status, detail);
      return json({ error: "Traduction indisponible (" + dlRes.status + ")" }, 502);
    }

    const dl = await dlRes.json();
    const [titleEn, descriptionEn] = (dl.translations || []).map((t: { text: string }) => t.text);

    const { error: upErr } = await admin
      .from("products")
      .update({
        title_en: titleEn || null,
        description_en: descriptionEn || null,
        translated_at: new Date().toISOString(),
      })
      .eq("id", product.id);
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ ok: true, title_en: titleEn, description_en: descriptionEn });
  } catch (err) {
    console.error("translate-listing error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
