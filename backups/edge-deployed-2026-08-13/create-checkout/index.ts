import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SHIPPING_RATES: Record<string, number> = {
  pickup: 0,
  relay: 4.9,
  post: 8.9,
};

function buyerProtectionFee(price: number): number {
  return Math.max(0.99, Math.round(price * 5) / 100);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { productId, shippingMethod } = await req.json();

    if (!shippingMethod || !(shippingMethod in SHIPPING_RATES)) {
      return new Response(
        JSON.stringify({ error: "Mode de livraison invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user: buyer },
    } = await supabaseUser.auth.getUser();

    if (!buyer) {
      return new Response(
        JSON.stringify({ error: "Connectez-vous pour acheter" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (error || !product) {
      return new Response(
        JSON.stringify({ error: "Produit introuvable" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (product.status === "sold") {
      return new Response(
        JSON.stringify({ error: "Cet article a deja ete vendu" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (product.user_id === buyer.id) {
      return new Response(
        JSON.stringify({ error: "Vous ne pouvez pas acheter votre propre article" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productPrice = Number(product.price);
    const protectionFee = buyerProtectionFee(productPrice);
    const shippingFee = SHIPPING_RATES[shippingMethod];
    const totalCents = Math.round((productPrice + protectionFee + shippingFee) * 100);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
    });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: product.title,
            description: product.description || undefined,
            images: product.image_url ? [product.image_url] : undefined,
          },
          unit_amount: Math.round(productPrice * 100),
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: "Protection Acheteur",
            description: "Garantie remboursement en cas de probleme",
          },
          unit_amount: Math.round(protectionFee * 100),
        },
        quantity: 1,
      },
    ];

    if (shippingFee > 0) {
      lineItems.push({
        price_data: {
          currency: "eur",
          product_data: {
            name:
              shippingMethod === "relay"
                ? "Livraison Mondial Relay"
                : "Livraison Colissimo",
          },
          unit_amount: Math.round(shippingFee * 100),
        },
        quantity: 1,
      });
    }

    const origin = req.headers.get("origin") || "https://www.athenamilitaria.fr";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      customer_email: buyer.email || undefined,
      success_url: `${origin}/account.html?tab=my-orders&payment=success`,
      cancel_url: `${origin}/product.html?id=${productId}`,
      metadata: {
        product_id: String(productId),
        buyer_id: buyer.id,
        seller_id: product.user_id,
        product_price: String(productPrice),
        buyer_protection_fee: String(protectionFee),
        shipping_fee: String(shippingFee),
        shipping_method: shippingMethod,
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-checkout error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
