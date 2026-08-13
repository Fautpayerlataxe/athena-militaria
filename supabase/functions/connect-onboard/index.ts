import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { clientError, corsHeaders as buildCors, logEvent, redactSecrets, resolveOrigin } from "../_shared/payments.ts";

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authentifier l'utilisateur via son JWT (Authorization: Bearer <token>)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return fail(corsHeaders, "AUTH_REQUIRED");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return fail(corsHeaders, "AUTH_REQUIRED");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Créer un compte Connect engage des vérifications d'identité chez Stripe :
    // cinq tentatives par heure suffisent très largement, et une boucle
    // accidentelle ne peut plus créer de comptes en série.
    const { data: allowed, error: rateError } = await admin.rpc("rate_limit_hit", {
      p_bucket: `connect:${user.id}`, p_limit: 5, p_window_seconds: 3600,
    });
    if (rateError) {
      logEvent("rate_limit_unavailable", { user_id: user.id, message: redactSecrets(rateError.message) });
    } else if (allowed === false) {
      logEvent("rate_limited", { user_id: user.id, bucket: "connect" });
      return fail(corsHeaders, "RATE_LIMITED");
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_account_id, stripe_onboarded, email")
      .eq("id", user.id)
      .maybeSingle();

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
      maxNetworkRetries: 2,
    });

    let accountId = profile?.stripe_account_id as string | null;

    // Créer le compte Express s'il n'existe pas encore
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "FR",
        email: profile?.email || user.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        metadata: {
          user_id: user.id,
        },
      }, {
        // Sans clé d'idempotence, un double-clic créait deux comptes Express
        // pour le même vendeur. Le second identifiant écrasait le premier en
        // base, laissant un compte orphelin chez Stripe, avec ses vérifications
        // d'identité et ses obligations.
        idempotencyKey: `connect-account:${user.id}`,
      });
      accountId = account.id;

      const { error: saveError } = await admin
        .from("profiles")
        .update({ stripe_account_id: accountId })
        .eq("id", user.id);

      // Si l'écriture échoue, le compte existe chez Stripe mais pas en base.
      // On le dit franchement : le prochain appel repassera par la même clé
      // d'idempotence et retombera sur le même compte, sans en créer un autre.
      if (saveError) {
        logEvent("connect_save_failed", { user_id: user.id, message: redactSecrets(saveError.message) });
        return fail(corsHeaders, "INTERNAL");
      }
    }

    // Lien d'onboarding (valable 1x, expire rapidement)
    const origin = resolveOrigin(req.headers.get("origin"));
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/account?connect=refresh`,
      return_url: `${origin}/account?connect=done`,
      type: "account_onboarding",
    });

    return json(corsHeaders, { url: accountLink.url }, 200);
  } catch (err) {
    // Le message de Stripe reste dans les logs : renvoyé au navigateur, il
    // n'aide pas le vendeur et renseigne un attaquant sur notre intégration.
    logEvent("connect_onboard_error", { message: redactSecrets((err as Error)?.message ?? String(err)) });
    const stripeType = (err as { type?: string })?.type ?? "";
    return fail(
      corsHeaders,
      stripeType === "StripeConnectionError" || stripeType === "StripeAPIError"
        ? "PAYMENT_PROVIDER_UNAVAILABLE"
        : "INTERNAL",
    );
  }
});

function json(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(cors: Record<string, string>, code: string) {
  const { status, code: safeCode, error } = clientError(code);
  return json(cors, { error, code: safeCode }, status);
}
