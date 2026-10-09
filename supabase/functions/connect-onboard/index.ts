/**
 * Inscription des vendeurs chez Stripe Connect.
 *
 * Deux usages, une seule fonction :
 *
 *   - sans corps (boutons « Configurer », « Terminer » et « Gérer » de Mon
 *     compte) : renvoie un lien d'inscription Stripe ;
 *   - corps { "action": "synchroniser" } (retour d'inscription, ?connect=done) :
 *     relit le compte chez Stripe et met stripe_onboarded à jour, sans rien
 *     créer. C'est ce qui rend le vendeur prêt tout de suite, sans attendre
 *     le webhook ni la surveillance.
 *
 * Dans les deux cas, le compte enregistré est d'abord relu chez Stripe. Les
 * comptes créés pendant les essais en mode test n'existent pas en live : leur
 * demander un lien d'inscription échouait, et le vendeur restait bloqué sur
 * une erreur qu'il ne pouvait pas comprendre. Un compte introuvable avec la
 * clé live est remplacé par un compte neuf, et le vendeur repart d'une
 * inscription propre. La synchronisation, elle, ne crée rien : elle efface
 * l'identifiant introuvable, et le prochain clic sur le bouton en crée un.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  clientError,
  compteEffacable,
  corsHeaders as buildCors,
  logEvent,
  redactSecrets,
  resolveOrigin,
  stripeKeyMode,
} from "../_shared/payments.ts";
import {
  appliquerSynchroConnect,
  type ConnectDeps,
  type ConnectStripeLike,
  type Enregistrement,
  enregistrerCompteConnect,
  lireCompteConnect,
  profilsConnect,
  type SupabaseLike,
} from "../_shared/connect.ts";

type Action = "inscrire" | "synchroniser";

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

    const action = await lireAction(req);

    // Créer un compte Connect engage des vérifications d'identité chez Stripe :
    // cinq tentatives par heure suffisent très largement, et une boucle
    // accidentelle ne peut plus créer de comptes en série. La synchronisation
    // ne crée rien : elle a son propre compteur, plus large, pour qu'un retour
    // d'inscription ne consomme pas une tentative d'inscription.
    const { data: allowed, error: rateError } = await admin.rpc("rate_limit_hit", action === "synchroniser"
      ? { p_bucket: `connect-sync:${user.id}`, p_limit: 30, p_window_seconds: 3600 }
      : { p_bucket: `connect:${user.id}`, p_limit: 5, p_window_seconds: 3600 });
    if (rateError) {
      logEvent("rate_limit_unavailable", { user_id: user.id, message: redactSecrets(rateError.message) });
    } else if (allowed === false) {
      logEvent("rate_limited", { user_id: user.id, bucket: action === "synchroniser" ? "connect-sync" : "connect" });
      return fail(corsHeaders, "RATE_LIMITED");
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("stripe_account_id, stripe_onboarded, email")
      .eq("id", user.id)
      .maybeSingle();
    // Un profil illisible n'est pas un profil sans compte : poursuivre ferait
    // créer un second compte Express au vendeur qui en a déjà un.
    if (profileError) throw new Error(`profiles.select: ${profileError.message}`);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
      maxNetworkRetries: 2,
    });
    const keyMode = stripeKeyMode(Deno.env.get("STRIPE_SECRET_KEY"));

    const profils = profilsConnect(admin as unknown as SupabaseLike);
    const connectDeps: ConnectDeps = { stripe: stripe as unknown as ConnectStripeLike, db: profils, keyMode };

    let accountId = (profile?.stripe_account_id as string | null) ?? null;
    let onboarded = profile?.stripe_onboarded === true;
    let etatCompte: "absent" | "present" | "introuvable" = accountId ? "present" : "absent";
    let remplace: string | null = null;

    // Relire le compte existant avant d'en faire quoi que ce soit.
    if (accountId) {
      try {
        const lecture = await lireCompteConnect(connectDeps.stripe, accountId);

        if (action === "inscrire" && compteEffacable(keyMode, lecture)) {
          // Compte de test vu par la clé live, ou compte supprimé : un compte
          // neuf le remplacera plus bas. L'ancien identifiant reste en base
          // jusque-là : il n'est remplacé qu'une fois le neuf obtenu, en une
          // seule écriture (voir enregistrerCompteConnect).
          remplace = accountId;
          accountId = null;
          onboarded = false;
          etatCompte = "absent";
          logEvent("connect_account_checked", {
            user_id: user.id, account_id: remplace, issue: "a_remplacer", action, key_mode: keyMode,
          });
        } else {
          const synchro = await appliquerSynchroConnect(connectDeps, {
            id: user.id, stripe_account_id: accountId, stripe_onboarded: profile?.stripe_onboarded,
          }, lecture);
          if (synchro.issue === "introuvable_efface") {
            // Retour d'inscription sur un compte introuvable : effacé, et le
            // bouton de Mon compte en créera un neuf au prochain clic.
            accountId = null;
            onboarded = false;
            etatCompte = "absent";
          } else if (lecture.etat === "introuvable") {
            // Introuvable, mais la clé n'est pas live : on ne remplace rien
            // (voir compteEffacable). Le lien d'inscription échouera comme avant.
            etatCompte = "introuvable";
          } else {
            onboarded = lecture.pret;
          }
          logEvent("connect_account_checked", {
            user_id: user.id, account_id: profile?.stripe_account_id, issue: synchro.issue, ecrit: synchro.ecrit,
            action, key_mode: keyMode,
          });
        }
      } catch (err) {
        // Lecture impossible (réseau, panne Stripe) : rien ne prouve que le
        // compte manque. La synchronisation n'a alors rien de vrai à dire ;
        // l'inscription, elle, continue sur le compte enregistré, comme avant.
        if (action === "synchroniser") throw err;
        logEvent("connect_account_check_failed", {
          user_id: user.id, account_id: accountId, message: redactSecrets((err as Error)?.message ?? String(err)),
        });
      }
    }

    if (action === "synchroniser") {
      return json(corsHeaders, { onboarded, compte: etatCompte }, 200);
    }

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
        //
        // Un remplacement porte l'identifiant remplacé dans sa clé : il reste
        // idempotent (double-clic compris) sans jamais retomber sur le compte
        // qu'il remplace, si celui-ci avait été créé sous la clé d'origine.
        idempotencyKey: remplace
          ? `connect-account:${user.id}:remplace:${remplace}`
          : `connect-account:${user.id}`,
      });
      accountId = account.id;

      // Le compte neuf n'est posé que si le profil porte encore l'ancien
      // identifiant (ou aucun) : on n'écrase jamais un compte qu'on n'a pas vu.
      //
      // Si l'écriture échoue, le compte existe chez Stripe mais pas en base.
      // L'ancien identifiant, lui, est resté : le prochain appel le relira,
      // reprendra la même clé d'idempotence et retombera sur le même compte
      // neuf, sans en créer un autre. Stripe garde une clé d'idempotence
      // 24 heures : au-delà, un compte neuf serait créé, d'où l'identifiant
      // complet dans le journal, pour pouvoir rattacher l'orphelin à la main.
      let enregistrement: Enregistrement;
      try {
        enregistrement = await enregistrerCompteConnect(profils, user.id, remplace, accountId);
      } catch (err) {
        logEvent("connect_save_failed", {
          user_id: user.id, nouveau: accountId, ancien: remplace,
          message: redactSecrets((err as Error)?.message ?? String(err)),
        });
        return fail(corsHeaders, "INTERNAL");
      }
      if (typeof enregistrement === "object") {
        // Un autre compte a été posé entre-temps, par une autre requête :
        // on ne l'écrase pas. Course très improbable, mais une erreur claire
        // vaut mieux qu'un compte vendeur perdu.
        logEvent("connect_save_conflict", {
          user_id: user.id, nouveau: accountId, ancien: remplace, actuel: enregistrement.conflit,
        });
        return fail(corsHeaders, "INTERNAL");
      }

      if (remplace) {
        logEvent("connect_account_replaced", {
          user_id: user.id, ancien: remplace, nouveau: accountId, key_mode: keyMode,
        });
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

/** Le bouton de Mon compte n'envoie aucun corps : c'est l'inscription, comme
 *  avant. Un corps illisible retombe sur le même chemin. */
async function lireAction(req: Request): Promise<Action> {
  try {
    const texte = await req.text();
    if (!texte) return "inscrire";
    const corps = JSON.parse(texte) as { action?: unknown } | null;
    return corps?.action === "synchroniser" ? "synchroniser" : "inscrire";
  } catch {
    return "inscrire";
  }
}

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
