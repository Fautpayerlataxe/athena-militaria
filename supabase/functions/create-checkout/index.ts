import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tarifs livraison (centimes TTC) — synchronisés avec product.js SHIPPING_RATES
const SHIPPING_RATES: Record<string, { label: string; amount: number; min: number; max: number; flag: string }> = {
  pickup: { label: "Remise en main propre", amount: 0,   min: 0, max: 30, flag: "ship_pickup" },
  relay:  { label: "Point relais (Mondial Relay)", amount: 490, min: 3, max: 5,  flag: "ship_relay" },
  post:   { label: "Envoi postal (Colissimo suivi)", amount: 890, min: 2, max: 3,  flag: "ship_post" },
};

// Commission plateforme sur le prix du produit (0.08 = 8%). Pas de commission sur les frais de port.
const PLATFORM_FEE_RATE = 0.08;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { productId, shippingMethod, relayPostal } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Récupère l'utilisateur authentifié (acheteur), si présent
    let buyerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user } } = await userClient.auth.getUser();
        if (user) buyerId = user.id;
      } catch (_) { /* token invalide, on continue en guest */ }
    }

    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (error || !product) {
      return json({ error: "Produit introuvable" }, 404);
    }

    // L'article doit être en vente (pas vendu, ni brouillon)
    if (product.status !== "published") {
      return json(
        { error: "Cet article n'est plus disponible à la vente.", code: "PRODUCT_NOT_AVAILABLE" },
        409
      );
    }

    // Un vendeur ne peut pas acheter son propre article
    if (buyerId && product.user_id === buyerId) {
      return json(
        { error: "Vous ne pouvez pas acheter votre propre article.", code: "SELF_PURCHASE" },
        400
      );
    }

    // Valide le mode de livraison : doit être accepté par le vendeur
    const rate = shippingMethod ? SHIPPING_RATES[shippingMethod] : null;
    if (!rate || !product[rate.flag]) {
      return json({ error: "Mode de livraison invalide pour cet article" }, 400);
    }

    // Récupère le compte Stripe du vendeur
    const { data: sellerProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_onboarded")
      .eq("id", product.user_id)
      .maybeSingle();

    if (!sellerProfile?.stripe_account_id || !sellerProfile.stripe_onboarded) {
      return json(
        {
          error: "Ce vendeur n'a pas encore finalisé la configuration de son compte de paiement. Impossible d'acheter cet article pour le moment.",
          code: "SELLER_NOT_ONBOARDED",
        },
        409
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
    });

    const productAmountCents = Math.round(Number(product.price) * 100);
    const applicationFeeCents = Math.round(productAmountCents * PLATFORM_FEE_RATE);

    const needsAddress = shippingMethod !== "pickup";

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: product.title,
              description: product.description || undefined,
              images: product.image_url ? [product.image_url] : undefined,
            },
            unit_amount: productAmountCents,
          },
          quantity: 1,
        },
      ],
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: rate.amount, currency: "eur" },
            display_name: rate.label,
            delivery_estimate: {
              minimum: { unit: "business_day", value: rate.min || 0 },
              maximum: { unit: "business_day", value: rate.max || 0 },
            },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeeCents,
        transfer_data: {
          destination: sellerProfile.stripe_account_id,
        },
      },
      mode: "payment",
      success_url: `${req.headers.get("origin")}/?payment=success`,
      cancel_url: `${req.headers.get("origin")}/product?id=${productId}`,
      metadata: {
        product_id: String(productId),
        shipping_method: shippingMethod,
        seller_id: String(product.user_id),
        buyer_id: buyerId || "",
        relay_postal: shippingMethod === "relay" && relayPostal ? String(relayPostal).slice(0, 5) : "",
      },
    };

    if (needsAddress) {
      sessionParams.shipping_address_collection = {
        allowed_countries: ["FR", "BE", "CH", "LU", "MC"],
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return json({ url: session.url });
  } catch (err) {
    console.error("create-checkout error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
