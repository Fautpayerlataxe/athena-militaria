import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
    });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const productId = session.metadata?.product_id;

    if (productId) {
      // Decrémenter le stock
      const { data: product } = await supabase
        .from("products")
        .select("quantity")
        .eq("id", productId)
        .single();

      if (product) {
        const newQty = Math.max(0, product.quantity - 1);
        await supabase
          .from("products")
          .update({
            quantity: newQty,
            ...(newQty === 0 ? { status: "sold" } : {}),
          })
          .eq("id", productId);
      }

      // Enregistrer la commande
      await supabase.from("orders").insert([
        {
          product_id: productId,
          stripe_session_id: session.id,
          customer_email: session.customer_details?.email || null,
          amount: session.amount_total ? session.amount_total / 100 : 0,
          currency: session.currency || "eur",
          status: "paid",
        },
      ]);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
