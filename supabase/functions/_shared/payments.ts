/**
 * Logique de paiement pure, partagée par les edge functions.
 *
 * Aucun import Deno, Stripe ou Supabase ici : ce fichier ne fait que décider.
 * C'est ce qui permet de le tester intégralement sous Node (tests/) sans
 * réseau ni base, et c'est là que vivent les règles qui ne doivent jamais
 * dépendre du navigateur : validation des entrées, routage des événements
 * webhook, traduction des erreurs.
 *
 * Le montant, lui, n'est calculé ni ici ni dans le navigateur : il vient de
 * la fonction SQL checkout_reserve. Les libellés ci-dessous ne servent qu'à
 * l'affichage sur la page Stripe, et un test vérifie qu'ils restent alignés
 * sur la table shipping_rates.
 */

export type ShippingMethod = "pickup" | "relay" | "post";

export const SHIPPING_CATALOG: Record<
  ShippingMethod,
  { label: string; amountCents: number; minDays: number; maxDays: number; flag: string }
> = {
  // Remise en main propre : aucun délai à annoncer, il se convient entre les
  // deux parties. 0/0 signifie « pas d'estimation », et create-checkout omet
  // alors delivery_estimate. L'ancienne version envoyait
  // delivery_estimate.minimum.value = 0 à Stripe pour ce mode.
  pickup: { label: "Remise en main propre", amountCents: 0, minDays: 0, maxDays: 0, flag: "ship_pickup" },
  relay: { label: "Point relais (Mondial Relay)", amountCents: 490, minDays: 3, maxDays: 5, flag: "ship_relay" },
  post: { label: "Envoi postal (Colissimo suivi)", amountCents: 890, minDays: 2, maxDays: 3, flag: "ship_post" },
};

/** Durée de vie de la session Stripe. Le minimum accepté par Stripe est 30 min.
 *  La réservation en base vit 35 min (platform_settings.reservation_minutes) :
 *  elle doit survivre à la session, jamais l'inverse, sinon un paiement de
 *  dernière seconde arriverait sur un stock déjà rendu à quelqu'un d'autre. */
export const SESSION_TTL_MINUTES = 30;

/**
 * L'adresse d'expédition de tous les courriels du site.
 *
 * Cinq fonctions écrivaient depuis athenamilitaria.com et trois depuis
 * athenamilitaria.fr, alors que le site n'existe qu'en .fr. Un domaine non
 * vérifié chez le routeur de courriels ne provoque aucune erreur visible :
 * les messages partent, et personne ne les reçoit. Les confirmations de
 * paiement étaient dans le lot.
 *
 * Une constante partagée plutôt qu'une chaîne recopiée : la divergence est
 * ainsi impossible à réintroduire sans le voir.
 */
export const EXPEDITEUR_COURRIEL = "Athena Militaria <noreply@athenamilitaria.fr>";

export const ALLOWED_SHIPPING_COUNTRIES = ["FR", "BE", "CH", "LU", "MC"] as const;

export function isShippingMethod(value: unknown): value is ShippingMethod {
  return value === "pickup" || value === "relay" || value === "post";
}

/** Un code postal de point relais : exactement cinq chiffres, rien d'autre.
 *  L'ancienne version tronquait à cinq caractères, ce qui laissait passer
 *  « ab#$% ». */
export function normaliseRelayPostal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9]{5}$/.test(trimmed) ? trimmed : null;
}

export type CheckoutRequest = {
  productId: number;
  shippingMethod: ShippingMethod;
  relayPostal: string | null;
};

export type ParseResult =
  | { ok: true; value: CheckoutRequest }
  | { ok: false; code: string };

/** Le corps de requête vient d'un navigateur qu'on suppose hostile : on ne
 *  garde que ce qu'on a explicitement validé, et rien d'autre n'est transmis
 *  plus loin. Aucun montant, aucun identifiant de prix, aucune devise. */
export function parseCheckoutRequest(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, code: "BAD_REQUEST" };
  const body = raw as Record<string, unknown>;

  const productId = Number(body.productId);
  if (!Number.isInteger(productId) || productId <= 0 || productId > Number.MAX_SAFE_INTEGER) {
    return { ok: false, code: "PRODUCT_INVALID" };
  }

  if (!isShippingMethod(body.shippingMethod)) return { ok: false, code: "SHIPPING_INVALID" };

  let relayPostal: string | null = null;
  if (body.shippingMethod === "relay") {
    relayPostal = normaliseRelayPostal(body.relayPostal);
    if (!relayPostal) return { ok: false, code: "RELAY_POSTAL_INVALID" };
  }

  return { ok: true, value: { productId, shippingMethod: body.shippingMethod, relayPostal } };
}

/* ------------------------------------------------------------------ *
 *  Erreurs présentées à l'acheteur
 *
 *  Le message technique de Stripe ou de Postgres ne doit jamais sortir : il
 *  n'aide pas l'acheteur et renseigne un attaquant. On renvoie un code stable
 *  que le frontend traduit, plus un texte français par défaut.
 * ------------------------------------------------------------------ */

const CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
  BAD_REQUEST: { status: 400, message: "Requête invalide." },
  AUTH_REQUIRED: { status: 401, message: "Connectez-vous pour finaliser votre achat." },
  PRODUCT_INVALID: { status: 400, message: "Article invalide." },
  PRODUCT_NOT_FOUND: { status: 404, message: "Cet article n'existe plus." },
  PRODUCT_NOT_AVAILABLE: { status: 409, message: "Cet article n'est plus disponible à la vente." },
  PRODUCT_RESERVED: { status: 409, message: "Un autre acheteur finalise son paiement sur cet article. Réessayez dans quelques minutes." },
  SELF_PURCHASE: { status: 400, message: "Vous ne pouvez pas acheter votre propre article." },
  SHIPPING_INVALID: { status: 400, message: "Mode de livraison invalide." },
  SHIPPING_NOT_OFFERED: { status: 400, message: "Ce mode de livraison n'est pas proposé pour cet article." },
  RELAY_POSTAL_INVALID: { status: 400, message: "Indiquez un code postal français à cinq chiffres." },
  AMOUNT_TOO_LOW: { status: 400, message: "Le montant total est inférieur au minimum accepté par notre prestataire de paiement." },
  TOO_MANY_RESERVATIONS: { status: 429, message: "Vous avez trop d'achats en cours. Finalisez-en un avant d'en commencer un autre." },
  SELLER_NOT_ONBOARDED: { status: 409, message: "Ce vendeur n'a pas encore finalisé la configuration de son compte de paiement." },
  SELLER_BLOCKED: { status: 409, message: "Cet article n'est pas disponible à la vente pour le moment." },
  ORDER_NOT_RESERVABLE: { status: 409, message: "Cette commande n'est plus réservable." },
  ORDER_NOT_FOUND: { status: 404, message: "Commande introuvable." },
  FORBIDDEN: { status: 403, message: "Accès refusé." },
  RATE_LIMITED: { status: 429, message: "Trop de tentatives. Patientez une minute avant de réessayer." },
  PAYMENT_PROVIDER_UNAVAILABLE: { status: 503, message: "Le service de paiement est momentanément indisponible. Réessayez dans un instant." },
  CHECKOUT_DISABLED: { status: 503, message: "Les achats sont momentanément suspendus le temps d'une mise à jour de notre système de paiement. L'annonce reste consultable et vous pouvez contacter le vendeur." },
  INTERNAL: { status: 500, message: "Une erreur interne est survenue. Aucun montant n'a été débité." },
};

export function clientError(code: string): { status: number; code: string; error: string } {
  const known = CLIENT_ERRORS[code] ?? CLIENT_ERRORS.INTERNAL;
  return { status: known.status, code: code in CLIENT_ERRORS ? code : "INTERNAL", error: known.message };
}

/** Les fonctions SQL lèvent des exceptions dont le message EST le code
 *  (RAISE EXCEPTION 'PRODUCT_RESERVED'). PostgREST le renvoie enrobé ; on
 *  retrouve le code s'il est connu, sinon on tombe sur INTERNAL et le détail
 *  reste dans les logs serveur. */
export function codeFromDbError(message: unknown): string {
  const text = typeof message === "string" ? message : String(message ?? "");
  for (const code of Object.keys(CLIENT_ERRORS)) {
    if (code !== "INTERNAL" && text.includes(code)) return code;
  }
  return "INTERNAL";
}

/* ------------------------------------------------------------------ *
 *  CORS
 * ------------------------------------------------------------------ */

export const ALLOWED_ORIGINS = [
  "https://www.athenamilitaria.fr",
  "https://athenamilitaria.fr",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

/** L'ancienne version renvoyait Access-Control-Allow-Origin: *, ce qui laissait
 *  n'importe quel site déclencher des créations de sessions de paiement avec le
 *  jeton d'un visiteur. On restreint à nos origines. */
export function resolveOrigin(origin: string | null, allowed: string[] = ALLOWED_ORIGINS): string {
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0];
}

export function corsHeaders(origin: string | null, allowed: string[] = ALLOWED_ORIGINS): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(origin, allowed),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

/* ------------------------------------------------------------------ *
 *  Cohérence des environnements
 * ------------------------------------------------------------------ */

export type StripeMode = "live" | "test" | "unknown";

export function stripeKeyMode(secretKey: string | undefined | null): StripeMode {
  if (!secretKey) return "unknown";
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) return "live";
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) return "test";
  return "unknown";
}

/** Un webhook de test qui frappe un backend live (ou l'inverse) écrirait de
 *  fausses commandes en production. La signature ne le détecte pas : les deux
 *  environnements peuvent viser la même URL. Le champ livemode, lui, tranche. */
export function environmentMatches(keyMode: StripeMode, eventLivemode: boolean | undefined): boolean {
  if (keyMode === "unknown" || eventLivemode === undefined) return true;
  return (keyMode === "live") === eventLivemode;
}

/* ------------------------------------------------------------------ *
 *  Routage des événements webhook
 * ------------------------------------------------------------------ */

export type WebhookPlan =
  | { action: "fulfill"; sessionId: string; orderId: string | null }
  | { action: "payment_failed"; sessionId: string | null; intentId: string | null; code: string | null }
  | { action: "release"; sessionId: string | null; orderId: string | null }
  | { action: "refund"; intentId: string | null; chargeId: string | null; refundedCents: number; fullyRefunded: boolean }
  | { action: "chargeback"; intentId: string | null; chargeId: string | null; status: string; reason: string | null }
  | { action: "connect_account"; accountId: string; ready: boolean }
  | { action: "ignore"; reason: string };

type Loose = Record<string, unknown>;

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && typeof (value as Loose).id === "string") {
    return (value as Loose).id as string;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/* ------------------------------------------------------------------ *
 *  Construction de la session Checkout
 * ------------------------------------------------------------------ */

export type CheckoutSessionInput = {
  orderId: string;
  productId: string;
  productTitle: string;
  productDescription?: string | null;
  productImageUrl?: string | null;
  /** Décomposition figée par checkout_reserve. Aucun recalcul ici. */
  productAmountCents: number;
  protectionAmountCents: number;
  shippingAmountCents: number;
  shippingMethod: ShippingMethod;
  currency: string;
  customerEmail?: string;
  expiresAt: number;
  metadata: Record<string, string>;
  siteOrigin: string;
};

/**
 * Les paramètres exacts envoyés à Stripe pour ouvrir un paiement.
 *
 * Cette fonction existe parce que les scénarios sandbox en avaient recopié le
 * contenu à la main. Une copie ne prouve rien : réintroduire une commission
 * dans la fonction déployée aurait laissé toute la suite au vert, puisqu'elle
 * n'aurait vérifié que sa propre copie. Production et tests appellent
 * désormais le même constructeur, et un écart devient impossible à obtenir
 * sans casser les deux.
 *
 * Deux choses ne doivent jamais réapparaître ici, et c'est tout l'objet du
 * modèle « paiements séparés et transferts » :
 *
 *   - application_fee_amount, qui prélèverait une commission au vendeur alors
 *     que la décision est qu'il ne paie rien ;
 *   - transfer_data.destination, qui verserait au vendeur dès l'encaissement
 *     et annulerait la retenue jusqu'à confirmation de réception.
 *
 * Le type de retour est structurel, sans dépendance au SDK Stripe : ce module
 * doit rester exécutable par Node pour les tests comme par Deno en production.
 */
export function buildCheckoutSessionParams(input: CheckoutSessionInput): Record<string, unknown> {
  const rate = SHIPPING_CATALOG[input.shippingMethod];
  const currency = input.currency || "eur";

  return {
    mode: "payment",
    // Les portefeuilles (Apple Pay, Google Pay, Link) sont proposés par Stripe
    // à l'intérieur de « card » lorsque l'appareil les gère : cette liste ne
    // les exclut pas.
    payment_method_types: ["card"],
    client_reference_id: input.orderId,
    ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    expires_at: input.expiresAt,
    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: input.productTitle,
            ...(input.productDescription
              ? { description: String(input.productDescription).slice(0, 500) }
              : {}),
            ...(input.productImageUrl ? { images: [String(input.productImageUrl)] } : {}),
          },
          unit_amount: input.productAmountCents,
        },
        quantity: 1,
      },
      {
        // Ligne distincte et nommée : l'acheteur doit voir ce qu'il paie en
        // plus du prix de l'article avant de valider, pas le découvrir après.
        price_data: {
          currency,
          product_data: {
            name: "Protection acheteurs",
            description: "Versement au vendeur après réception, assistance en cas de problème",
          },
          unit_amount: input.protectionAmountCents,
        },
        quantity: 1,
      },
    ],
    shipping_options: [{
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: input.shippingAmountCents, currency },
        display_name: rate.label,
        // Aucune estimation pour la remise en main propre : le délai se
        // convient entre les deux parties, et annoncer « 0 jour ouvré » à
        // Stripe n'a pas de sens.
        ...(rate.minDays >= 1 && rate.maxDays >= rate.minDays
          ? {
              delivery_estimate: {
                minimum: { unit: "business_day", value: rate.minDays },
                maximum: { unit: "business_day", value: rate.maxDays },
              },
            }
          : {}),
      },
    }],
    ...(input.shippingMethod !== "pickup"
      ? { shipping_address_collection: { allowed_countries: [...ALLOWED_SHIPPING_COUNTRIES] } }
      : {}),
    payment_intent_data: {
      description: `Athena Militaria - commande ${input.orderId.slice(0, 8).toUpperCase()}`,
      // Rattache la charge et son futur transfert : indispensable au
      // rapprochement comptable en mode versement différé.
      transfer_group: `order_${input.orderId}`,
      // Répétées sur le PaymentIntent : un remboursement ou un litige portent
      // sur la charge, pas sur la session, et doivent rester rattachables.
      metadata: input.metadata,
    },
    metadata: input.metadata,
    // La page de confirmation lit cet identifiant et fait vérifier le paiement
    // par le serveur. L'URL seule ne prouve jamais rien.
    success_url: `${input.siteOrigin}/order?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.siteOrigin}/product?id=${input.productId}&checkout=canceled`,
  };
}

/**
 * Les événements dont dépend le parcours de paiement.
 *
 * Cette liste doit être exactement celle cochée sur l'endpoint chez Stripe.
 * En manquer un ne provoque aucune erreur visible : la commande reste
 * simplement bloquée dans un état intermédiaire, et personne ne s'en aperçoit
 * avant qu'un acheteur réclame. En cocher d'autres n'est pas dangereux mais
 * fait du bruit et fatigue le journal.
 *
 * payments-monitor compare cette liste à la configuration réelle et signale
 * l'écart : une case décochée par mégarde dans le tableau de bord serait
 * autrement indétectable.
 */
export const CONSUMED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "account.updated",
] as const;

/**
 * Décide quoi faire d'un événement, sans rien exécuter.
 *
 * Deux principes tenus ici :
 *  - `checkout.session.completed` ne vaut pas encaissement. Il signale que
 *    l'acheteur a validé le formulaire. C'est `payment_status` qui tranche, et
 *    c'est la fonction de fulfillment qui le relit chez Stripe.
 *  - aucun événement ne fait régresser un état plus avancé. Stripe ne garantit
 *    pas l'ordre de livraison ; les gardes sont dans les fonctions SQL.
 */
export function planWebhookEvent(event: {
  type?: string;
  data?: { object?: unknown };
}): WebhookPlan {
  const type = event?.type ?? "";
  const object = (event?.data?.object ?? {}) as Loose;

  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const sessionId = str(object.id);
      if (!sessionId) return { action: "ignore", reason: "session sans identifiant" };
      return {
        action: "fulfill",
        sessionId,
        orderId: str(object.client_reference_id) ?? str((object.metadata as Loose)?.order_id),
      };
    }

    case "checkout.session.async_payment_failed":
      return {
        action: "payment_failed",
        sessionId: str(object.id),
        intentId: idOf(object.payment_intent),
        code: "async_payment_failed",
      };

    case "checkout.session.expired":
      return {
        action: "release",
        sessionId: str(object.id),
        orderId: str(object.client_reference_id) ?? str((object.metadata as Loose)?.order_id),
      };

    case "payment_intent.payment_failed": {
      const lastError = (object.last_payment_error ?? {}) as Loose;
      return {
        action: "payment_failed",
        sessionId: null,
        intentId: str(object.id),
        code: str(lastError.code) ?? str(lastError.decline_code) ?? "payment_failed",
      };
    }

    case "charge.refunded": {
      const refundedCents = Number(object.amount_refunded ?? 0);
      const amount = Number(object.amount ?? 0);
      return {
        action: "refund",
        intentId: idOf(object.payment_intent),
        chargeId: str(object.id),
        refundedCents: Number.isFinite(refundedCents) ? refundedCents : 0,
        // `refunded` est le drapeau officiel ; la comparaison des montants sert
        // de filet quand il manque.
        fullyRefunded: object.refunded === true || (amount > 0 && refundedCents >= amount),
      };
    }

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      const evidence = (object.evidence_details ?? {}) as Loose;
      return {
        action: "chargeback",
        intentId: idOf(object.payment_intent),
        chargeId: idOf(object.charge),
        status: str(object.status) ?? "needs_response",
        reason: str(object.reason) ?? str(evidence.due_by) ?? null,
      };
    }

    case "account.updated": {
      const accountId = str(object.id);
      if (!accountId) return { action: "ignore", reason: "compte sans identifiant" };
      return {
        action: "connect_account",
        accountId,
        ready: object.charges_enabled === true &&
          object.details_submitted === true &&
          object.payouts_enabled === true,
      };
    }

    default:
      return { action: "ignore", reason: `type non traité : ${type || "inconnu"}` };
  }
}

/* ------------------------------------------------------------------ *
 *  Adresse de livraison
 * ------------------------------------------------------------------ */

export type ShippingAddress = Record<string, string | null> | null;

/** Stripe expose l'adresse à des endroits différents selon la version d'API et
 *  selon qu'elle a été collectée pour la livraison ou pour la facturation. On
 *  couvre les deux, et le point relais garde son code postal d'origine. */
export function buildShippingAddress(
  session: Loose,
  shippingMethod: string | null,
  relayPostal: string | null,
): ShippingAddress {
  const details = (session.shipping_details ?? (session.collected_information as Loose)?.shipping_details ?? null) as Loose | null;
  const customer = (session.customer_details ?? null) as Loose | null;

  if (shippingMethod === "relay" && relayPostal) {
    return {
      name: str(details?.name) ?? str(customer?.name),
      postal_code: relayPostal,
      note: "Code postal du point relais souhaité par l'acheteur. Le vendeur choisira le Mondial Relay le plus proche.",
    };
  }

  const address = (details?.address ?? customer?.address ?? null) as Loose | null;
  if (!address) return null;

  return {
    name: str(details?.name) ?? str(customer?.name),
    line1: str(address.line1),
    line2: str(address.line2),
    postal_code: str(address.postal_code),
    city: str(address.city),
    state: str(address.state),
    country: str(address.country),
  };
}

/* ------------------------------------------------------------------ *
 *  Formatage
 * ------------------------------------------------------------------ */

export function formatEuroCents(cents: number | null | undefined): string {
  const value = Number(cents ?? 0);
  if (!Number.isFinite(value)) return "0,00 €";
  return (value / 100).toFixed(2).replace(".", ",") + " €";
}

export function shippingLabel(method: string | null | undefined): string {
  if (isShippingMethod(method)) return SHIPPING_CATALOG[method].label;
  return "Non précisé";
}

/* ------------------------------------------------------------------ *
 *  Journalisation
 * ------------------------------------------------------------------ */

const SECRET_PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9]+/g,
  /rk_(live|test)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9]+/g,
  /_secret_[A-Za-z0-9]+/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

/** Dernier rempart avant les logs. Un client_secret ou une clé qui se glisse
 *  dans un message d'erreur Stripe ne doit pas finir dans le journal, où il
 *  survivrait bien plus longtemps que la session concernée. */
export function redactSecrets(input: unknown): string {
  let text = typeof input === "string" ? input : JSON.stringify(input ?? "");
  if (typeof text !== "string") text = String(input);
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  return text;
}

export function logEvent(scope: string, fields: Record<string, unknown>): void {
  const safe: Record<string, unknown> = { scope };
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = typeof value === "string" ? redactSecrets(value) : value;
  }
  console.log(JSON.stringify(safe));
}
