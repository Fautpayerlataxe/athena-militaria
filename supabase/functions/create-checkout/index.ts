/**
 * Ouverture d'une session Stripe Checkout.
 *
 * Ordre des opérations, et pourquoi il est dans cet ordre :
 *
 *   1. Authentifier réellement l'acheteur. La clé anon est un JWT valide : sans
 *      ce contrôle, une commande partait sans buyer_id, invisible pour son
 *      propre acheteur (RLS) et impossible à suivre ou à contester.
 *   2. Réserver le stock EN BASE, de façon atomique, avant de parler à Stripe.
 *      C'est le seul moment où l'on peut refuser un second acheteur sur un
 *      objet unique. Réserver après le paiement, c'est réserver trop tard.
 *   3. Créer la session Stripe avec une clé d'idempotence dérivée de la
 *      commande. Dix clics, un retry réseau ou un rafraîchissement retombent
 *      sur la même session, donc sur un seul paiement possible.
 *   4. Si Stripe échoue, rendre le stock. Une réservation orpheline bloquerait
 *      la vente pendant quarante minutes.
 *
 * Le navigateur n'envoie qu'un identifiant d'article et un mode de livraison.
 * Aucun montant, aucun prix, aucune devise, aucun identifiant de vendeur ne
 * transite par lui : tout est relu et recalculé par la fonction SQL
 * checkout_reserve.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildCheckoutSessionParams,
  clientError,
  codeFromDbError,
  corsHeaders,
  logEvent,
  parseCheckoutRequest,
  redactSecrets,
  resolveOrigin,
  stripeKeyMode,
} from "../_shared/payments.ts";
import {
  type ConnectStripeLike,
  profilsConnect,
  type SupabaseLike,
  synchroniserProfilConnect,
} from "../_shared/connect.ts";

const STRIPE_API_VERSION = "2023-10-16";
/** Stripe exige au moins trente minutes. On garde de la marge pour que la
 *  session reste créable même si la réservation date de quelques minutes. */
const MIN_SESSION_MINUTES = 31;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const siteOrigin = resolveOrigin(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(cors, "BAD_REQUEST");

  let orderId: string | null = null;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    /* --- 1. Interrupteur d'ouverture des achats -------------------------
     *
     * L'interrupteur est en base, pas dans le code. Une maintenance tenue par
     * une version déployée différente du dépôt est exactement ce qui a déjà
     * fait écraser huit fonctions ici : le code en ligne cesse d'être celui
     * qu'on lit. Rouvrir devient une ligne en base, refermer aussi, et sans
     * redéploiement il n'y a plus de fenêtre où le mauvais code est en ligne.
     *
     * En cas d'illisibilité du réglage, on refuse. Le coût d'un refus est un
     * acheteur qui réessaie ; le coût de l'inverse est une vente encaissée
     * pendant qu'on croit la boutique fermée.
     *
     * Ce contrôle passe AVANT l'authentification, pour deux raisons. Une
     * boutique fermée n'a aucune raison de vérifier qui frappe. Et surtout,
     * l'état fermé devient constatable de l'extérieur, sans compte ni jeton :
     * une fermeture qu'on ne peut pas vérifier soi-même n'est qu'une
     * intention. Le fait n'est pas sensible, il est écrit sur les fiches.
     */
    const { data: switchRow, error: switchError } = await admin
      .from("platform_settings").select("value").eq("key", "checkout_enabled").maybeSingle();

    if (switchError || !switchRow || Number(switchRow.value) !== 1) {
      logEvent("checkout_disabled", {
        reason: switchError ? "réglage illisible" : `checkout_enabled=${switchRow?.value ?? "absent"}`,
      });
      return fail(cors, "CHECKOUT_DISABLED");
    }

    /* --- 2. Authentification ------------------------------------------- */

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(cors, "AUTH_REQUIRED");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    // getUser ne renvoie un utilisateur que pour un jeton de session. Un appel
    // avec la seule clé anon tombe donc ici, et non en achat invité.
    if (!user) return fail(cors, "AUTH_REQUIRED");

    /* --- 2 bis. Validation de l'entrée ---------------------------------- */

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(cors, "BAD_REQUEST");
    }

    const parsed = parseCheckoutRequest(body);
    if (!parsed.ok) return fail(cors, parsed.code);
    const { productId, shippingMethod, relayPostal } = parsed.value;

    /* --- 3. Contrôles préalables sur les comptes ------------------------ */

    // Limitation par utilisateur, pas par adresse IP : l'endpoint est
    // authentifié, et compter par IP pénaliserait les clients d'un même
    // opérateur mobile. Dix ouvertures de paiement par minute couvrent
    // largement un usage normal, y compris les hésitations et les retours.
    const { data: allowed, error: rateError } = await admin.rpc("rate_limit_hit", {
      p_bucket: `checkout:${user.id}`, p_limit: 10, p_window_seconds: 60,
    });
    // Une panne du compteur ne doit pas bloquer les ventes : on laisse passer
    // et on trace. Les protections financières réelles sont ailleurs.
    if (rateError) {
      logEvent("rate_limit_unavailable", { user_id: user.id, message: redactSecrets(rateError.message) });
    } else if (allowed === false) {
      logEvent("rate_limited", { user_id: user.id, bucket: "checkout" });
      return fail(cors, "RATE_LIMITED");
    }

    const { data: buyerProfile } = await admin
      .from("profiles").select("blocked").eq("id", user.id).maybeSingle();
    if (buyerProfile?.blocked) return fail(cors, "FORBIDDEN");

    // Une seule lecture du produit : titre, description et image servent à la
    // page Stripe, le reste aux contrôles. En faire deux allongeait le chemin
    // critique entre le clic et la redirection pour rien.
    const { data: product, error: productError } = await admin
      .from("products")
      .select("id, user_id, status, title, description, image_url")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) return fail(cors, "PRODUCT_NOT_FOUND");

    const { data: seller } = await admin
      .from("profiles")
      .select("stripe_account_id, stripe_onboarded, blocked")
      .eq("id", product.user_id)
      .maybeSingle();

    if (seller?.blocked) return fail(cors, "SELLER_BLOCKED");
    if (!seller?.stripe_account_id || !seller.stripe_onboarded) {
      return fail(cors, "SELLER_NOT_ONBOARDED");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: STRIPE_API_VERSION,
      // Le SDK retente déjà les erreurs réseau ; associé à la clé
      // d'idempotence ci-dessous, un retry ne peut pas créer deux sessions.
      maxNetworkRetries: 2,
      timeout: 20000,
    });

    /* --- 3 bis. Le compte du vendeur existe-t-il vraiment ? -------------
     *
     * Le paiement est encaissé par la plateforme, et versé au vendeur plus
     * tard par un transfert. Un drapeau stripe_onboarded posé pendant les
     * essais en mode test désigne un compte que la clé live ne connaît pas :
     * la vente encaisserait alors un argent qu'aucun transfert ne pourra
     * jamais verser. Une lecture chez Stripe, avant toute réservation, suffit
     * à refuser proprement, avec le message habituel.
     *
     * La même lecture remet le profil d'aplomb (synchroniserProfilConnect) :
     * l'acheteur suivant est refusé sans même interroger Stripe, et le
     * vendeur voit dans Mon compte qu'il doit reprendre son inscription.
     *
     * Une lecture en panne ne bloque pas la vente : la création de session
     * plus bas échouerait de toute façon si Stripe était injoignable, et la
     * surveillance relit tous les comptes toutes les 6 h.
     */
    try {
      const { issue, lecture } = await synchroniserProfilConnect({
        stripe: stripe as unknown as ConnectStripeLike,
        db: profilsConnect(admin as unknown as SupabaseLike),
        keyMode: stripeKeyMode(Deno.env.get("STRIPE_SECRET_KEY")),
      }, {
        id: String(product.user_id),
        stripe_account_id: String(seller.stripe_account_id),
        stripe_onboarded: seller.stripe_onboarded,
      });
      if (lecture?.etat === "introuvable" || (lecture?.etat === "present" && !lecture.pret)) {
        // L'identifiant complet : s'il vient d'être effacé, c'est la trace qui
        // permet de le remettre (connect_account_erased le note aussi).
        logEvent("checkout_seller_not_ready", {
          product_id: productId, seller_id: String(product.user_id),
          account_id: String(seller.stripe_account_id), issue,
        });
        return fail(cors, "SELLER_NOT_ONBOARDED");
      }
    } catch (err) {
      logEvent("checkout_seller_unreadable", {
        product_id: productId, seller_id: String(product.user_id),
        message: redactSecrets((err as Error)?.message ?? String(err)),
      });
    }

    /* --- 4. Réservation atomique ---------------------------------------- */

    const reserve = async () => {
      const { data, error } = await admin.rpc("checkout_reserve", {
        p_product_id: productId,
        p_buyer_id: user.id,
        p_shipping_method: shippingMethod,
        p_relay_postal: relayPostal,
        p_buyer_email: user.email ?? null,
      });
      if (error) {
        const code = codeFromDbError(error.message);
        if (code === "INTERNAL") {
          logEvent("checkout_reserve_error", {
            user_id: user.id, product_id: productId, message: redactSecrets(error.message),
          });
        }
        return { order: null, code };
      }
      return { order: data as Record<string, unknown>, code: null };
    };

    let attempt = await reserve();
    if (!attempt.order) return fail(cors, attempt.code!);
    let order = attempt.order;
    orderId = String(order.id);

    /* --- 5. Session déjà ouverte : on la réutilise ---------------------- */

    const existingSessionId = typeof order.stripe_session_id === "string" ? order.stripe_session_id : null;
    if (existingSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(existingSessionId);
      if (existing.status === "open" && existing.url) {
        // Rafraîchissement, retour arrière, second onglet, double-clic : le
        // même acheteur retombe sur la même session, donc sur un seul paiement
        // possible.
        logEvent("checkout_session_reused", { order_id: orderId, session_id: existing.id });
        return json(cors, { url: existing.url, orderId }, 200);
      }
      if (existing.status === "complete") {
        // Le paiement est déjà passé : renvoyer vers la confirmation plutôt
        // que d'ouvrir une seconde session pour le même article.
        return json(cors, { url: `${siteOrigin}/order?session_id=${existing.id}`, orderId }, 200);
      }
      // Session expirée côté Stripe alors que la réservation vit encore : on
      // rend le stock et on en reprend un tout de suite. Renvoyer une erreur
      // ici obligerait l'acheteur à recliquer sans comprendre pourquoi.
      await admin.rpc("checkout_release", { p_order_id: orderId, p_status: "expired" });
      orderId = null;
      attempt = await reserve();
      if (!attempt.order) return fail(cors, attempt.code!);
      order = attempt.order;
      orderId = String(order.id);
    }

    /* --- 6. Fenêtre de paiement ----------------------------------------- */

    // Stripe refuse une session expirant à moins de trente minutes. Si la
    // réservation est trop entamée pour en porter une, on la reprend à zéro.
    let sessionExpiry = stripeExpiryFor(order);
    if (minutesUntil(sessionExpiry) < MIN_SESSION_MINUTES) {
      await admin.rpc("checkout_release", { p_order_id: orderId, p_status: "expired" });
      orderId = null;
      attempt = await reserve();
      if (!attempt.order) return fail(cors, attempt.code!);
      order = attempt.order;
      orderId = String(order.id);
      sessionExpiry = stripeExpiryFor(order);

      if (minutesUntil(sessionExpiry) < MIN_SESSION_MINUTES) {
        // Ne devrait pas arriver : une réservation neuve dure quarante minutes.
        // Si on est ici, reservation_minutes a été baissé sous le seuil Stripe.
        logEvent("checkout_reservation_window_too_short", {
          order_id: orderId, expires_at: order.expires_at,
        });
        return fail(cors, "INTERNAL");
      }
    }

    /* --- 7. Création de la session -------------------------------------- */

    // Décomposition figée par checkout_reserve. On ne recalcule rien ici :
    // deux calculs du même montant finissent toujours par diverger, et c'est
    // la ligne en base qui fait foi comptablement.
    const productAmount = Number(order.product_amount_cents);
    const shippingAmount = Number(order.shipping_amount_cents);
    const protectionAmount = Number(order.protection_fee_cents);
    const sellerAmount = Number(order.seller_amount_cents);
    const currency = String(order.currency ?? "eur");

    // Garde-fou de dernière ligne : si la base venait à livrer une
    // décomposition incohérente, mieux vaut refuser la vente que débiter un
    // montant que personne ne sait justifier.
    if (productAmount + shippingAmount + protectionAmount !== Number(order.amount_total_cents)
        || sellerAmount !== productAmount + shippingAmount) {
      logEvent("checkout_amount_inconsistent", {
        order_id: orderId, product: productAmount, shipping: shippingAmount,
        protection: protectionAmount, seller: sellerAmount, total: order.amount_total_cents,
      });
      await admin.rpc("checkout_release", { p_order_id: orderId, p_status: "canceled" });
      orderId = null;
      return fail(cors, "INTERNAL");
    }

    const metadata = {
      order_id: orderId,
      product_id: String(productId),
      seller_id: String(product.user_id),
      buyer_id: user.id,
      shipping_method: shippingMethod,
      relay_postal: relayPostal ?? "",
    };

    const session = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        orderId,
        productId: String(productId),
        productTitle: String(product.title ?? "Article"),
        productDescription: product.description ? String(product.description) : null,
        productImageUrl: product.image_url ? String(product.image_url) : null,
        // Montants issus de la base, pas du navigateur ni d'un recalcul local.
        productAmountCents: productAmount,
        protectionAmountCents: protectionAmount,
        shippingAmountCents: shippingAmount,
        shippingMethod,
        currency,
        customerEmail: user.email ?? undefined,
        expiresAt: sessionExpiry,
        metadata,
        siteOrigin,
      }) as Stripe.Checkout.SessionCreateParams,
      {
        // Clé stable : la commande. Double-clic, retry du SDK, rejeu du
        // navigateur : Stripe renvoie la session déjà créée au lieu d'en
        // ouvrir une seconde.
        idempotencyKey: `checkout:${orderId}`,
      },
    );

    /* --- 8. Rattachement ------------------------------------------------ */

    const { error: attachError } = await admin.rpc("checkout_attach_session", {
      p_order_id: orderId,
      p_session_id: session.id,
    });
    if (attachError) {
      // La session existe chez Stripe mais la base l'ignore. On ne laisse pas
      // partir l'acheteur : le webhook saurait recoller grâce au
      // client_reference_id, mais autant échouer franchement ici.
      logEvent("checkout_attach_failed", {
        order_id: orderId, session_id: session.id, message: redactSecrets(attachError.message),
      });
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      await admin.rpc("checkout_release", { p_order_id: orderId, p_status: "canceled" });
      return fail(cors, "INTERNAL");
    }

    logEvent("checkout_session_created", {
      order_id: orderId,
      session_id: session.id,
      product_id: productId,
      seller_id: String(product.user_id),
      buyer_id: user.id,
      product_cents: productAmount,
      shipping_cents: shippingAmount,
      protection_cents: protectionAmount,
      seller_cents: sellerAmount,
      amount_total_cents: Number(order.amount_total_cents),
      pricing_version: Number(order.pricing_version),
      shipping_method: shippingMethod,
      payout_mode: "after_buyer_confirmation",
    });

    return json(cors, { url: session.url, orderId }, 200);
  } catch (err) {
    // Toute sortie non prévue libère le stock : mieux vaut un acheteur qui
    // reclique qu'un article gelé quarante minutes après une panne Stripe.
    if (orderId) {
      await admin.rpc("checkout_release", { p_order_id: orderId, p_status: "canceled" }).catch(() => {});
    }

    const stripeType = (err as { type?: string })?.type ?? "";
    const code = stripeType === "StripeConnectionError" || stripeType === "StripeAPIError"
      ? "PAYMENT_PROVIDER_UNAVAILABLE"
      : "INTERNAL";

    logEvent("checkout_error", {
      order_id: orderId,
      stripe_type: stripeType || null,
      // Le message brut reste ici, jamais dans la réponse au navigateur.
      message: redactSecrets((err as Error)?.message ?? String(err)),
    });
    return fail(cors, code);
  }
});

function json(cors: Record<string, string>, body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(cors: Record<string, string>, code: string) {
  const { status, code: safeCode, error } = clientError(code);
  return json(cors, { error, code: safeCode }, status);
}

/** Expiration de la session Stripe, en secondes epoch : cinq minutes avant la
 *  fin de la réservation. La réservation doit survivre à la session, sinon un
 *  paiement de dernière seconde arriverait sur un stock déjà rendu. */
function stripeExpiryFor(order: Record<string, unknown>): number {
  const reservationEnd = new Date(String(order.expires_at)).getTime();
  return Math.floor((reservationEnd - 5 * 60_000) / 1000);
}

function minutesUntil(epochSeconds: number): number {
  return (epochSeconds * 1000 - Date.now()) / 60_000;
}
