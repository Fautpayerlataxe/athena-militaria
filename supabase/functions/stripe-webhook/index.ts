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

// Envoi d'email via Supabase Edge (Resend ou SMTP configuré)
async function sendEmail(to: string, subject: string, body: string) {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.log(`[EMAIL SKIP] Pas de clé Resend. Email à ${to}: ${subject}`);
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
    const productId = session.metadata?.product_id;

    if (productId) {
      // Récupérer le produit avec infos vendeur
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

      // Envoyer les emails de notification
      const buyerEmail = session.customer_details?.email;
      const productTitle = product?.title || "Article";
      const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : "0.00";

      // Email acheteur
      if (buyerEmail) {
        await sendEmail(
          buyerEmail,
          `Confirmation d'achat - ${productTitle}`,
          `Bonjour,\n\nVotre achat a bien été confirmé !\n\nArticle : ${productTitle}\nMontant : ${amount} €\n\nLe vendeur a été notifié et vous contactera pour organiser la livraison.\n\nMerci pour votre confiance,\nAthena Militaria`
        );
      }

      // Email vendeur
      if (product?.user_id) {
        const { data: seller } = await supabase.auth.admin.getUserById(product.user_id);
        if (seller?.user?.email) {
          await sendEmail(
            seller.user.email,
            `Vente confirmée - ${productTitle}`,
            `Bonjour,\n\nVotre article "${productTitle}" a été vendu pour ${amount} € !\n\nAcheteur : ${buyerEmail || "Non renseigné"}\n\nConnectez-vous sur Athena Militaria pour gérer cette commande.\n\nBonne continuation,\nAthena Militaria`
          );
        }
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
