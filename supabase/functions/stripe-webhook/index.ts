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

  // Stripe Connect : le compte vendeur a changé d'état (onboarding terminé ?)
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const isReady = !!(account.charges_enabled && account.details_submitted && account.payouts_enabled);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, stripe_onboarded")
      .eq("stripe_account_id", account.id)
      .maybeSingle();

    if (profile) {
      await supabase
        .from("profiles")
        .update({
          stripe_onboarded: isReady,
          stripe_onboarded_at: isReady ? new Date().toISOString() : null,
        })
        .eq("id", profile.id);
      console.log(`[CONNECT] account ${account.id} → onboarded=${isReady}`);
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const productId = session.metadata?.product_id;
    const shippingMethod = session.metadata?.shipping_method || null;
    const sellerId = session.metadata?.seller_id || null;
    const buyerId  = session.metadata?.buyer_id || null;

    if (productId) {
      // Idempotence : si on a déjà traité cette session, on ne refait rien
      // (Stripe peut renvoyer le même événement plusieurs fois en cas de retry)
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("stripe_session_id", session.id)
        .maybeSingle();

      if (existingOrder) {
        console.log(`[WEBHOOK] Session ${session.id} déjà traitée, skip.`);
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Récupérer le produit avec infos vendeur
      const { data: product } = await supabase
        .from("products")
        .select("quantity, title, user_id")
        .eq("id", productId)
        .single();

      if (product) {
        const currentQty = Number(product.quantity ?? 1);
        const newQty = Math.max(0, currentQty - 1);
        await supabase
          .from("products")
          .update({
            quantity: newQty,
            ...(newQty === 0 ? { status: "sold", sold_at: new Date().toISOString() } : {}),
          })
          .eq("id", productId);
      }

      // Construction de l'adresse de livraison (si collectée par Stripe)
      const ship = session.shipping_details || session.customer_details?.address
        ? (session.shipping_details || { address: session.customer_details?.address, name: session.customer_details?.name })
        : null;
      const relayPostal = session.metadata?.relay_postal || null;
      const shippingAddress = shippingMethod === "relay" && relayPostal
        ? {
            // Pour un envoi en point relais : on stocke le code postal souhaité
            name: ship?.name || session.customer_details?.name || null,
            postal_code: relayPostal,
            note: "Code postal du point relais souhaité par l'acheteur. Le vendeur choisira le Mondial Relay le plus proche.",
          }
        : ship?.address
        ? {
            name: ship.name || null,
            line1: ship.address.line1 || null,
            line2: ship.address.line2 || null,
            postal_code: ship.address.postal_code || null,
            city: ship.address.city || null,
            state: ship.address.state || null,
            country: ship.address.country || null,
          }
        : null;

      // Enregistrer la commande
      await supabase.from("orders").insert([
        {
          product_id: productId,
          stripe_session_id: session.id,
          customer_email: session.customer_details?.email || null,
          amount: session.amount_total ? session.amount_total / 100 : 0,
          currency: session.currency || "eur",
          status: "paid",
          shipping_method: shippingMethod,
          shipping_address: shippingAddress,
          seller_id: sellerId || null,
          buyer_id: buyerId || null,
        },
      ]);

      // Envoyer les emails de notification
      const buyerEmail = session.customer_details?.email;
      const productTitle = product?.title || "Article";
      const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : "0.00";

      const shippingLabel = shippingMethod === "post" ? "Envoi postal (Colissimo suivi)"
        : shippingMethod === "relay" ? "Point relais (Mondial Relay)"
        : shippingMethod === "pickup" ? "Remise en main propre"
        : "Non précisé";

      const addressText = shippingAddress
        ? `${shippingAddress.name || ""}\n${shippingAddress.line1 || ""}${shippingAddress.line2 ? "\n" + shippingAddress.line2 : ""}\n${shippingAddress.postal_code || ""} ${shippingAddress.city || ""}\n${shippingAddress.country || ""}`.trim()
        : "À convenir avec le vendeur";

      // Email acheteur
      if (buyerEmail) {
        await sendEmail(
          buyerEmail,
          `Confirmation d'achat - ${productTitle}`,
          `Bonjour,\n\nVotre achat a bien été confirmé !\n\nArticle : ${productTitle}\nMontant : ${amount} €\nLivraison : ${shippingLabel}\nAdresse :\n${addressText}\n\nLe vendeur a été notifié et organisera l'expédition.\n\nMerci pour votre confiance,\nAthena Militaria`
        );
      }

      // Email vendeur
      if (product?.user_id) {
        const { data: seller } = await supabase.auth.admin.getUserById(product.user_id);
        if (seller?.user?.email) {
          await sendEmail(
            seller.user.email,
            `Vente confirmée - ${productTitle}`,
            `Bonjour,\n\nVotre article "${productTitle}" a été vendu pour ${amount} € !\n\nAcheteur : ${buyerEmail || "Non renseigné"}\nMode de livraison : ${shippingLabel}\nAdresse de livraison :\n${addressText}\n\nConnectez-vous sur Athena Militaria pour gérer cette commande.\n\nBonne continuation,\nAthena Militaria`
          );
        }
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
