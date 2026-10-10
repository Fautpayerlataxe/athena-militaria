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
  | { action: "refund_updated"; refundId: string | null; status: string; intentId: string | null; chargeId: string | null;
      amountCents: number; failureReason: string | null; orderId: string | null; motif: string | null }
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
  /** Le compte de paiement du vendeur n'est pas prêt : l'achat est accepté,
   *  mais l'acheteur doit le savoir avant de payer (voir
   *  AVIS_VENDEUR_PAS_PRET). */
  sellerNotReady?: boolean;
};

/**
 * Les délais des ventes conclues chez un vendeur pas prêt, tels que les
 * textes les annoncent (page de paiement, courriels, CGV). La base lit les
 * siens dans platform_settings (seller_ready_days,
 * seller_ready_reminder_1_days, seller_ready_reminder_2_days,
 * shipping_deadline_business_days) : tests/db-vendeur-pas-pret.test.ts
 * vérifie que les deux disent la même chose, pour qu'aucun texte n'annonce
 * une date que le code n'applique pas.
 */
export const REGLAGES_VENDEUR_PAS_PRET = {
  joursEcheance: 7,
  relance1Jours: 2,
  relance2Jours: 5,
  joursOuvresExpedition: 5,
} as const;

/**
 * Le vendeur est-il prêt à recevoir l'argent, pour ce que create-checkout dit
 * à l'acheteur sur la page de paiement ? Décision pure, sortie de
 * create-checkout pour être testée :
 *   - sans relecture chez Stripe (pas de compte, ou lecture en panne), on
 *     s'en tient au profil : compte présent ET drapeau stripe_onboarded ;
 *   - avec une relecture, c'est elle qui tranche : le compte doit exister
 *     pour la clé en service et être prêt.
 * Elle ne refuse jamais l'achat (décision du 10 octobre 2026) : elle ne
 * décide que de l'avertissement. L'échéance, elle, est posée par la base au
 * paiement, d'après le profil à ce moment-là.
 */
export function vendeurPretPourAvis(
  profil: { stripe_account_id?: unknown; stripe_onboarded?: unknown } | null | undefined,
  lecture?: { etat?: string; pret?: boolean } | null,
): boolean {
  if (lecture) return lecture.etat === "present" && lecture.pret === true;
  return Boolean(profil?.stripe_account_id && profil.stripe_onboarded);
}

/**
 * Affiché sur la page de paiement Stripe, juste au-dessus du bouton, quand le
 * vendeur n'a pas terminé son inscription au paiement. La décision du
 * 10 octobre 2026 accepte ces achats ; l'acheteur doit pouvoir le lire avant
 * de payer, pas le découvrir après. Le texte dit exactement ce que fait le
 * code : échéance à 7 jours du paiement (seller_ready_days), puis
 * remboursement intégral automatique (payout-release). Stripe limite ce texte
 * à 1 200 caractères.
 */
export const AVIS_VENDEUR_PAS_PRET =
  "Le vendeur finalise son inscription auprès de Stripe, notre prestataire de paiement. " +
  "Votre paiement reste sur le compte d'Athena Militaria et ne lui est pas versé d'ici là. " +
  `S'il n'a pas terminé ${REGLAGES_VENDEUR_PAS_PRET.joursEcheance}\u00a0jours après votre paiement, ` +
  "la commande sera annulée et intégralement " +
  "remboursée (article, livraison et Protection acheteurs), automatiquement.";

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
    ...(input.sellerNotReady ? { custom_text: { submit: { message: AVIS_VENDEUR_PAS_PRET } } } : {}),
    // La page de confirmation lit cet identifiant et fait vérifier le paiement
    // par le serveur. L'URL seule ne prouve jamais rien.
    success_url: `${input.siteOrigin}/order?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.siteOrigin}/product?id=${input.productId}&checkout=canceled`,  // 301 vers /annonce/<titre>-<id>, paramètre conservé : le titre n'est pas connu ici
  };
}

/**
 * Les événements dont dépend le parcours de paiement, rangés par destination.
 *
 * Stripe livre les événements par deux portes distinctes, chacune avec son
 * propre secret de signature :
 *
 *   - « Votre compte » (la plateforme) : tout ce qui touche l'argent, puisque
 *     les paiements sont encaissés par la plateforme puis transférés ;
 *   - « Comptes connectés » : ce qui arrive aux comptes des vendeurs. Le
 *     account.updated d'un vendeur ne passe QUE par là. Coché sur « Votre
 *     compte », il ne rapporte que les changements du compte de la plateforme
 *     elle-même, et le vendeur qui termine son inscription n'est jamais
 *     déclaré prêt.
 *
 * Ces listes doivent être exactement celles cochées chez Stripe. En manquer un
 * ne provoque aucune erreur visible : la commande reste simplement bloquée
 * dans un état intermédiaire, et personne ne s'en aperçoit avant qu'un
 * acheteur réclame. En cocher d'autres n'est pas dangereux mais fait du bruit
 * et fatigue le journal.
 *
 * payments-monitor compare ces listes à la configuration réelle et signale
 * l'écart : une case décochée par mégarde dans le tableau de bord serait
 * autrement indétectable.
 */
export const PLATFORM_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  // Un remboursement peut être accepté (« pending ») puis échouer plus tard
  // (carte fermée, par exemple). Seul cet événement le dit : sans lui,
  // l'acheteur à qui l'on a promis un remboursement automatique pourrait ne
  // jamais le recevoir, sans que personne le sache.
  "charge.refund.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

export const CONNECT_WEBHOOK_EVENTS = [
  "account.updated",
] as const;

/** Tout ce que le code sait traiter, toutes destinations confondues. */
export const CONSUMED_WEBHOOK_EVENTS = [
  ...PLATFORM_WEBHOOK_EVENTS,
  ...CONNECT_WEBHOOK_EVENTS,
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

    case "charge.refund.updated": {
      // L'objet est un remboursement (Refund), pas une charge.
      const metadata = (object.metadata ?? {}) as Loose;
      const amount = Number(object.amount ?? 0);
      return {
        action: "refund_updated",
        refundId: str(object.id),
        status: str(object.status) ?? "inconnu",
        intentId: idOf(object.payment_intent),
        chargeId: idOf(object.charge),
        amountCents: Number.isFinite(amount) ? amount : 0,
        failureReason: str(object.failure_reason),
        orderId: str(metadata.order_id),
        motif: str(metadata.motif),
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
      return { action: "connect_account", accountId, ready: connectAccountReady(object) };
    }

    default:
      return { action: "ignore", reason: `type non traité : ${type || "inconnu"}` };
  }
}

/* ------------------------------------------------------------------ *
 *  Signature des webhooks : deux destinations, deux secrets
 *
 *  La destination « comptes connectés » a son propre secret, distinct de
 *  celui de « Votre compte ». Sans le second, chaque account.updated d'un
 *  vendeur est refusé à la signature, et aucun vendeur ne devient prêt.
 * ------------------------------------------------------------------ */

export type SourceSignature = "plateforme" | "connect";

export type VerificationSignature<E> =
  | { ok: true; event: E; source: SourceSignature }
  | { ok: false; message: string };

/**
 * Essaie le secret de la plateforme, puis celui des comptes connectés s'il
 * est défini.
 *
 * L'ordre compte : la plateforme porte l'argent, son secret passe en premier
 * et, sans secret Connect, le comportement est exactement l'ancien. Le
 * vérificateur est injecté (stripe.webhooks.constructEventAsync en
 * production) : ce module reste sans dépendance au SDK.
 *
 * Le message d'échec renvoyé est celui du premier secret, le plus parlant
 * quand la panne vient de la plateforme. Aucun secret n'en fait partie.
 */
export async function verifierSignatureWebhook<E>(
  verifier: (secret: string) => Promise<E>,
  secrets: { plateforme?: string | null; connect?: string | null },
): Promise<VerificationSignature<E>> {
  const essais: Array<[SourceSignature, string]> = [];
  if (secrets.plateforme) essais.push(["plateforme", secrets.plateforme]);
  // Le même secret collé deux fois ne doit pas valider un événement au titre
  // de Connect : il passerait d'abord au titre de la plateforme, de toute façon.
  if (secrets.connect && secrets.connect !== secrets.plateforme) essais.push(["connect", secrets.connect]);
  if (essais.length === 0) return { ok: false, message: "aucun secret de signature configuré" };

  let premierEchec: string | null = null;
  for (const [source, secret] of essais) {
    try {
      return { ok: true, event: await verifier(secret), source };
    } catch (err) {
      premierEchec ??= String((err as Error)?.message ?? err);
    }
  }
  return { ok: false, message: premierEchec ?? "signature invalide" };
}

export type TriEvenement =
  | { decision: "traiter" }
  | { decision: "ignorer"; motif: string }
  | { decision: "refuser"; motif: string };

/**
 * Ce qu'on accepte d'un événement selon le secret qui l'a authentifié.
 *
 * Sur le secret de la plateforme : tout, comme avant.
 *
 * Sur le secret Connect : seulement les types attendus d'un compte connecté
 * (event.account présent), dans le mode de la clé. Quatre cas à écarter :
 *
 *   - le format « léger » (object v2.core.event) : la destination a été créée
 *     avec ce format au lieu de « instantané ». La charge utile n'a alors ni
 *     event.account ni data.object, et rien ne peut en être tiré. Refusé
 *     (400) avec un motif qui dit quoi corriger : les échecs de livraison que
 *     Stripe signale par courriel sont ici le bon signal ;
 *   - pas de event.account : c'est un événement de la plateforme. Il n'a pu
 *     être signé avec le secret Connect que si les deux secrets ont été
 *     intervertis dans Supabase. Le traiter ferait passer l'argent par une
 *     porte qui n'est pas la sienne ; l'acquitter le ferait disparaître. On
 *     le refuse (400) : Stripe le relivrera une fois les secrets remis en
 *     ordre, et la surveillance rattrape entre-temps les paiements en attente ;
 *   - un événement d'un autre mode que la clé : Stripe livre AUSSI les
 *     événements de test des comptes connectés aux destinations Connect de
 *     production (c'est documenté : une application de production peut faire
 *     des essais). Le refuser ferait réessayer Stripe trois jours, puis
 *     désactiver la destination, celle-là même dont dépend l'inscription des
 *     vendeurs. On l'acquitte sans rien faire : un account.updated n'est
 *     qu'un signal, l'état est de toute façon relu chez Stripe, et la
 *     surveillance relit chaque compte toutes les 6 h. Le 400 sur un mode
 *     différent reste la règle pour la plateforme, où il protège l'argent ;
 *   - un type que nous ne consommons pas (la destination écoute plus que
 *     nécessaire) : acquitté sans traitement, pour la même raison.
 */
export function trierEvenementWebhook(
  source: SourceSignature,
  event: { type?: string; account?: string | null; livemode?: boolean; object?: string },
  keyMode: StripeMode,
): TriEvenement {
  if (source === "plateforme") return { decision: "traiter" };
  if (event?.object === "v2.core.event") {
    return {
      decision: "refuser",
      motif: "format de charge utile « léger » : recréer la destination « comptes connectés » au format « instantané »",
    };
  }
  if (!str(event?.account)) {
    return {
      decision: "refuser",
      motif: "événement de la plateforme signé avec le secret Connect : secrets probablement intervertis",
    };
  }
  if (!environmentMatches(keyMode, event.livemode)) {
    return {
      decision: "ignorer",
      motif: `événement ${event.livemode ? "live" : "de test"} d'un compte connecté, clé ${keyMode} : ` +
             `Stripe livre aussi les événements de test des comptes connectés aux destinations de production`,
    };
  }
  if (!(CONNECT_WEBHOOK_EVENTS as readonly string[]).includes(event.type ?? "")) {
    return { decision: "ignorer", motif: `type non consommé pour un compte connecté : ${event.type || "inconnu"}` };
  }
  return { decision: "traiter" };
}

/* ------------------------------------------------------------------ *
 *  Comptes vendeurs Connect
 * ------------------------------------------------------------------ */

/**
 * Un compte vendeur est « prêt » quand Stripe a reçu son dossier et autorise
 * à la fois les encaissements et les virements. Un seul manquant suffit à le
 * déclarer non prêt : sinon on continuerait à vendre pour un compte qui ne
 * peut pas recevoir l'argent.
 *
 * La règle vit ici, une seule fois : le webhook, le retour d'inscription, la
 * surveillance et l'ouverture d'un paiement la partagent.
 */
export function connectAccountReady(account: unknown): boolean {
  const compte = (account ?? {}) as Loose;
  return compte.charges_enabled === true &&
    compte.details_submitted === true &&
    compte.payouts_enabled === true;
}

/**
 * L'erreur Stripe dit-elle que le compte n'existe pas pour cette clé ?
 *
 * Un compte créé en mode test n'existe pas en live : chaque stripe_account_id
 * posé pendant les essais désigne, depuis le passage à la clé live, un compte
 * que Stripe ne connaît pas. Stripe le dit de plusieurs façons selon le
 * chemin : resource_missing (« No such account »), account_invalid, ou une
 * 403 « does not have access to account … (or that account does not exist) »,
 * car il ne distingue pas un compte inexistant d'un compte qui n'est pas le
 * nôtre. Dans tous ces cas, rien ne pourra y être versé.
 *
 * Tout le reste n'est PAS une absence : réseau, panne Stripe, limite de
 * débit, clé restreinte sans le droit de lire les comptes (« does not have
 * the required permissions »). Effacer un identifiant sur une panne passagère
 * couperait un vendeur réel de ses versements.
 */
export function compteConnectIntrouvable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Loose;
  const raw = (e.raw && typeof e.raw === "object" ? e.raw : {}) as Loose;
  const code = str(e.code) ?? str(raw.code);
  const status = Number(e.statusCode ?? raw.statusCode ?? 0);
  const message = String(e.message ?? raw.message ?? "");

  if (code === "resource_missing" || code === "account_invalid") return true;
  if (status === 404) return true;
  if (/no such account/i.test(message)) return true;
  if ((status === 403 || e.type === "StripePermissionError") &&
      /does not have access to account|that account does not exist/i.test(message)) {
    return true;
  }
  return false;
}

export type LectureCompte =
  | { etat: "introuvable"; motif: string }
  | { etat: "present"; pret: boolean };

/**
 * A-t-on le droit de tirer les conséquences d'un compte introuvable : effacer
 * l'identifiant du profil, en créer un autre ?
 *
 * Avec la clé live, oui : un compte que la clé live ne voit pas ne recevra
 * jamais de virement.
 *
 * Avec toute autre clé, non. Si une clé de test revenait par erreur en
 * production, chaque compte vendeur réel paraîtrait introuvable, et la
 * surveillance effacerait en une passe tous les identifiants live, obligeant
 * chaque vendeur à refaire son inscription. Le site, lui, signale déjà la clé
 * de test comme critique.
 */
export function compteEffacable(keyMode: StripeMode, lecture: LectureCompte): boolean {
  return lecture.etat === "introuvable" && keyMode === "live";
}

export type IssueSynchro =
  | "introuvable_efface"
  | "introuvable_conserve"
  | "devenu_pret"
  | "plus_pret"
  | "inchange";

/**
 * Ce qu'il faut écrire sur le profil après avoir relu son compte chez Stripe.
 *
 * Rien n'est écrit quand rien ne change : la date de première validation
 * (stripe_onboarded_at) survit ainsi aux account.updated successifs, que
 * Stripe envoie à chaque modification du dossier.
 *
 * options.effacer = false retient l'effacement même avec la clé live : la
 * surveillance s'en sert quand trop de comptes disparaissent d'un coup (voir
 * effacementsSuspects).
 */
export function planSynchroConnect(
  profil: { stripe_onboarded?: boolean | null },
  lecture: LectureCompte,
  keyMode: StripeMode,
  maintenant: string,
  options: { effacer?: boolean } = {},
): { issue: IssueSynchro; patch: Record<string, unknown> | null } {
  if (lecture.etat === "introuvable") {
    return compteEffacable(keyMode, lecture) && options.effacer !== false
      ? {
          issue: "introuvable_efface",
          patch: { stripe_account_id: null, stripe_onboarded: false, stripe_onboarded_at: null },
        }
      : { issue: "introuvable_conserve", patch: null };
  }

  const avant = profil.stripe_onboarded === true;
  if (lecture.pret && !avant) {
    return { issue: "devenu_pret", patch: { stripe_onboarded: true, stripe_onboarded_at: maintenant } };
  }
  if (!lecture.pret && avant) {
    return { issue: "plus_pret", patch: { stripe_onboarded: false, stripe_onboarded_at: null } };
  }
  return { issue: "inchange", patch: null };
}

/**
 * À partir de combien de vendeurs marqués prêts, introuvables dans une même
 * passe, la surveillance cesse d'effacer.
 */
export const SEUIL_EFFACEMENTS_SUSPECTS = 2;

/**
 * Trop de comptes prêts disparus d'un coup : est-ce la clé plutôt que les
 * comptes ?
 *
 * Une clé live d'un AUTRE compte Stripe, collée par erreur lors d'une
 * rotation de clé, ne voit aucun des comptes vendeurs : Stripe répond pour
 * chacun « does not have access to account … (or that account does not
 * exist) », exactement comme pour un compte de test. Sans garde-fou, la
 * surveillance effacerait en une passe tous les identifiants live, et chaque
 * vendeur serait poussé à recréer un compte, dans le mauvais compte Stripe.
 *
 * Un compte vendeur prêt qui disparaît vraiment (fermé, refusé par Stripe)
 * reste un événement isolé. Deux ou plus dans la même passe, c'est le signe
 * d'une clé erronée : on n'efface rien et on alerte en critique. Les comptes
 * de test jamais terminés, eux, ne comptent pas : aucun n'était prêt, et leur
 * nettoyage au passage en live doit pouvoir se faire d'un coup.
 */
export function effacementsSuspects(
  lectures: Array<{ pretEnBase: boolean; lecture: LectureCompte }>,
  keyMode: StripeMode,
): boolean {
  if (keyMode !== "live") return false;
  const pretsDisparus = lectures.filter((l) => l.pretEnBase && l.lecture.etat === "introuvable").length;
  return pretsDisparus >= SEUIL_EFFACEMENTS_SUSPECTS;
}

/* ------------------------------------------------------------------ *
 *  Configuration des endpoints chez Stripe
 * ------------------------------------------------------------------ */

export type EndpointStripe = {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  livemode: boolean;
  /** Renseigné par Stripe sur les destinations « comptes connectés ». */
  application?: string | null;
};

export type AnomalieSurveillance = { severity: "critique" | "attention"; line: string };

/**
 * Une destination « comptes connectés » se reconnaît à son champ application,
 * quand Stripe le remplit ; la documentation ne le garantit pas.
 *
 * À défaut, on la reconnaît à ce qu'elle écoute : aucun des événements
 * d'argent de la plateforme. C'est plus large que « seulement
 * account.updated » : une destination Connect où l'on aurait coché en plus
 * account.external_account.updated, par exemple, reste une destination
 * Connect. La classer « plateforme » la ferait déclarer critique toutes les
 * 6 h pour neuf événements qu'elle n'a pas à recevoir.
 *
 * « Tous les événements » (*) couvre l'argent : c'est la plateforme. Une
 * destination sans aucun événement aussi : elle sera signalée incomplète.
 */
export function estEndpointConnect(endpoint: Pick<EndpointStripe, "application" | "enabled_events">): boolean {
  if (str(endpoint.application)) return true;
  const evenements = endpoint.enabled_events ?? [];
  if (evenements.length === 0 || evenements.includes("*")) return false;
  return !evenements.some((e) => (PLATFORM_WEBHOOK_EVENTS as readonly string[]).includes(e));
}

/**
 * Compare la configuration réelle des endpoints à ce dont le code dépend.
 *
 * Sévérités :
 *   - la plateforme absente, désactivée ou incomplète est critique : les
 *     paiements ne sont plus confirmés en base ;
 *   - la destination « comptes connectés » absente, désactivée, incomplète ou
 *     sans secret côté Supabase est à surveiller seulement : un vendeur prêt
 *     est de toute façon rattrapé au retour d'inscription et par la
 *     surveillance toutes les 6 h. Aucun argent n'en dépend directement.
 */
export function analyserEndpointsWebhook(
  endpoints: EndpointStripe[],
  url: string,
  contexte: { keyMode: StripeMode; secretConnectDefini: boolean },
): { anomalies: AnomalieSurveillance[]; vus: Array<Record<string, unknown>> } {
  const anomalies: AnomalieSurveillance[] = [];
  const vus: Array<Record<string, unknown>> = [];
  const miens = endpoints.filter((e) => e.url === url);
  const connect = miens.filter((e) => estEndpointConnect(e));
  const plateforme = miens.filter((e) => !estEndpointConnect(e));

  if (plateforme.length === 0) {
    anomalies.push({
      severity: "critique",
      line: `Aucun endpoint de webhook Stripe « Votre compte » ne pointe vers ${url}. Sans lui, aucun ` +
            `paiement n'est confirmé en base : les acheteurs paient et les commandes restent en attente.`,
    });
  }

  for (const endpoint of miens) {
    const estConnect = estEndpointConnect(endpoint);
    const attendus: readonly string[] = estConnect ? CONNECT_WEBHOOK_EVENTS : PLATFORM_WEBHOOK_EVENTS;
    const actifs = new Set(endpoint.enabled_events ?? []);
    const couvreTout = actifs.has("*");
    const manquants = attendus.filter((e) => !couvreTout && !actifs.has(e));
    const severity = estConnect ? "attention" : "critique";
    const nom = estConnect ? `${endpoint.id} (comptes connectés)` : endpoint.id;

    if (endpoint.status !== "enabled") {
      anomalies.push({ severity, line: `L'endpoint de webhook ${nom} est désactivé chez Stripe.` });
    }
    if (manquants.length > 0) {
      anomalies.push({
        severity,
        line: estConnect
          ? `L'endpoint ${nom} n'écoute pas ${manquants.join(", ")} : un vendeur qui termine son ` +
            `inscription ne sera déclaré prêt qu'à son retour sur le site ou par la surveillance, ` +
            `toutes les 6 h. À cocher dans le tableau de bord Stripe.`
          : `L'endpoint ${nom} n'écoute pas ${manquants.length} événement(s) dont le parcours ` +
            `dépend : ${manquants.join(", ")}. À cocher dans le tableau de bord Stripe.`,
      });
    }
    vus.push({
      id: endpoint.id,
      type: estConnect ? "comptes connectés" : "plateforme",
      mode: endpoint.livemode ? "live" : "test",
      actif: endpoint.status === "enabled",
      evenements: couvreTout ? "tous" : (endpoint.enabled_events ?? []).length,
      manquants,
    });
  }

  if (connect.length === 0 && contexte.keyMode === "live") {
    anomalies.push({
      severity: "attention",
      line: `Aucune destination « comptes connectés » ne pointe vers ${url} en live. Le account.updated ` +
            `d'un vendeur n'est livré que par ce type de destination : sans elle, un vendeur qui termine ` +
            `son inscription n'est déclaré prêt qu'à son retour sur le site ou par la surveillance, ` +
            `toutes les 6 h.`,
    });
  }
  if (connect.length > 0 && !contexte.secretConnectDefini) {
    anomalies.push({
      severity: "attention",
      line: `La destination « comptes connectés » (${connect.map((e) => e.id).join(", ")}) existe, mais ` +
            `STRIPE_CONNECT_WEBHOOK_SECRET n'est pas renseigné dans Supabase : chacune de ses livraisons ` +
            `est refusée à la signature, et Stripe finira par la désactiver.`,
    });
  }

  return { anomalies, vus };
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
