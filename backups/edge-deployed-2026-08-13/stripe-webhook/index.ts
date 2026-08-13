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

async function sendEmail(to: string, subject: string, body: string) {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.log(`[EMAIL SKIP] Pas de cle Resend. Email a ${to}: ${subject}`);
      return;
    }
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Athena Militaria <noreply@athenamilitaria.com>",
        to: [to],
        subject,
        text: body,
      }),
    });
    console.log(`[EMAIL OK] ${to}: ${subject}`);
  } catch (err) {
    console.error(`[EMAIL ERR] ${to}:`, err.message);
  }
}

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
    const meta = session.metadata || {};
    const productId = meta.product_id;

    if (!productId) {
      console.log("Pas de product_id dans les metadata, on ignore");
      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Idempotence
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();

    if (existing) {
      console.log("Commande deja enregistree, on ignore (idempotence)");
      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: product } = await supabase
      .from("products")
      .select("quantity, title, user_id")
      .eq("id", productId)
      .single();

    if (product) {
      const newQty = Math.max(0, product.quantity - 1);
      await supabase
        .from("products")
        .update({
          quantity: newQty,
          ...(newQty === 0
            ? { status: "sold", sold_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", productId);
    }

    const productPrice = Number(meta.product_price) || 0;
    const protectionFee = Number(meta.buyer_protection_fee) || 0;
    const shippingFee = Number(meta.shipping_fee) || 0;
    const totalAmount = session.amount_total
      ? session.amount_total / 100
      : productPrice + protectionFee + shippingFee;

    await supabase.from("orders").insert([
      {
        product_id: Number(productId),
        buyer_id: meta.buyer_id || null,
        seller_id: meta.seller_id || product?.user_id || null,
        stripe_session_id: session.id,
        customer_email: session.customer_details?.email || null,
        amount: totalAmount,
        product_price: productPrice,
        buyer_protection_fee: protectionFee,
        shipping_fee: shippingFee,
        shipping_method: meta.shipping_method || null,
        shipping_address: session.customer_details?.address || null,
        currency: session.currency || "eur",
        status: "paid",
      },
    ]);

    const buyerEmail = session.customer_details?.email;
    const productTitle = product?.title || "Article";
    const amount = totalAmount.toFixed(2);

    if (buyerEmail) {
      await sendEmail(
        buyerEmail,
        `Confirmation d'achat - ${productTitle}`,
        [
          `Bonjour,`,
          ``,
          `Votre achat a bien ete confirme !`,
          ``,
          `Article : ${productTitle}`,
          `Prix de l'article : ${productPrice.toFixed(2)} EUR`,
          `Protection Acheteur : ${protectionFee.toFixed(2)} EUR`,
          shippingFee > 0 ? `Frais de livraison : ${shippingFee.toFixed(2)} EUR` : null,
          `Total paye : ${amount} EUR`,
          ``,
          `Le vendeur a ete notifie. Vous recevrez un email des que votre commande sera expediee.`,
          `Athena conserve votre paiement en securite jusqu'a confirmation de reception.`,
          ``,
          `Merci pour votre confiance,`,
          `Athena Militaria`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    if (product?.user_id) {
      const { data: seller } = await supabase.auth.admin.getUserById(
        product.user_id
      );
      if (seller?.user?.email) {
        await sendEmail(
          seller.user.email,
          `Nouvelle vente - ${productTitle}`,
          [
            `Bonjour,`,
            ``,
            `Votre article "${productTitle}" a ete vendu pour ${productPrice.toFixed(2)} EUR !`,
            ``,
            `Acheteur : ${buyerEmail || "Non renseigne"}`,
            `Mode de livraison : ${meta.shipping_method || "Non renseigne"}`,
            ``,
            `Connectez-vous sur Athena Militaria pour marquer la commande comme expediee.`,
            `Le paiement sera libere apres confirmation de reception par l'acheteur.`,
            ``,
            `Bonne continuation,`,
            `Athena Militaria`,
          ].join("\n")
        );
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
