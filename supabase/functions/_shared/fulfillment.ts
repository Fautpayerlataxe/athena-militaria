/**
 * Point d'entrée unique du traitement d'un paiement.
 *
 * Le webhook Stripe et la page de confirmation appellent tous les deux cette
 * fonction, avec le même identifiant de session. C'est voulu : Stripe
 * recommande explicitement de déclencher le traitement des deux côtés, parce
 * qu'un webhook peut être retardé et qu'un acheteur peut fermer son navigateur
 * avant la redirection. Le chemin étant unique et idempotent, être appelé deux
 * fois, ou dix, ne produit qu'un seul encaissement, un seul décrément de stock
 * et un seul email.
 *
 * L'état vient toujours de Stripe, jamais du navigateur ni de la charge utile
 * de l'événement : on relit la session avant de décider. Un événement rejoué
 * trois jours plus tard ne peut donc pas réaffirmer un état périmé.
 *
 * Les dépendances sont injectées pour que la totalité de cette logique soit
 * testable sous Node sans réseau (voir tests/fulfillment.test.ts).
 */

import { buildShippingAddress, formatEuroCents, logEvent, shippingLabel } from "./payments.ts";

type Loose = Record<string, unknown>;

export interface StripeLike {
  checkout: {
    sessions: {
      retrieve(id: string, params?: Loose): Promise<Loose>;
    };
  };
}

export interface DbResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

export interface DbLike {
  rpc(name: string, args: Loose): Promise<DbResult<unknown>>;
  productTitle(productId: unknown): Promise<{ title: string | null; sellerId: string | null }>;
  sellerEmail(sellerId: string): Promise<string | null>;
}

export type Mailer = (to: string, subject: string, body: string) => Promise<void>;

export interface FulfillDeps {
  stripe: StripeLike;
  db: DbLike;
  sendEmail: Mailer;
  /** Permet d'écrire les emails hors du chemin critique du webhook : Stripe
   *  n'attend que quelques secondes, et Checkout retarde la redirection de
   *  l'acheteur tant que l'endpoint n'a pas répondu. */
  defer?: (task: Promise<unknown>) => void;
}

export interface FulfillOutcome {
  status: "fulfilled" | "pending_payment" | "not_paid";
  firstTime: boolean;
  order: Loose | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && typeof (value as Loose).id === "string") {
    return (value as Loose).id as string;
  }
  return null;
}

export function chargeIdFrom(session: Loose): string | null {
  const intent = session.payment_intent;
  if (intent && typeof intent === "object") {
    const expanded = intent as Loose;
    const latest = idOf(expanded.latest_charge);
    if (latest) return latest;
    const charges = expanded.charges as Loose | undefined;
    const list = charges?.data;
    if (Array.isArray(list) && list.length > 0) return idOf(list[0]);
  }
  return null;
}

/** Construit la charge utile envoyée à order_settle_payment. Extraite pour
 *  être testable seule : c'est elle qui décide de ce que la base retiendra
 *  d'un paiement. */
export function settlePayloadFrom(session: Loose): Loose {
  const metadata = (session.metadata ?? {}) as Loose;
  const customer = (session.customer_details ?? {}) as Loose;
  const shippingMethod = str(metadata.shipping_method);
  const relayPostal = str(metadata.relay_postal);

  return {
    p_payload: {
      order_id: str(session.client_reference_id) ?? str(metadata.order_id),
      session_id: str(session.id),
      payment_intent_id: idOf(session.payment_intent),
      charge_id: chargeIdFrom(session),
      payment_status: str(session.payment_status) ?? "unpaid",
      amount_total_cents: Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : null,
      currency: str(session.currency) ?? "eur",
      customer_email: str(customer.email),
      product_id: str(metadata.product_id),
      seller_id: str(metadata.seller_id),
      buyer_id: str(metadata.buyer_id),
      shipping_method: shippingMethod,
      relay_postal: relayPostal,
      shipping_address: buildShippingAddress(session, shippingMethod, relayPostal),
    },
  };
}

export async function fulfillCheckoutSession(
  deps: FulfillDeps,
  sessionId: string,
): Promise<FulfillOutcome> {
  // On relit la session : la charge utile de l'événement est un instantané, et
  // la page de confirmation, elle, n'a qu'un identifiant fourni par le
  // navigateur. Dans les deux cas c'est Stripe qui fait foi.
  const session = await deps.stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });

  const paymentStatus = str(session.payment_status) ?? "unpaid";
  const args = settlePayloadFrom(session);

  const { data, error } = await deps.db.rpc("order_settle_payment", args);
  if (error) {
    // Remonter l'erreur est essentiel : c'est ce qui fait répondre 500 au
    // webhook, donc ce qui fait rejouer Stripe. L'ancienne version avalait
    // l'échec et répondait 200, ce qui perdait la commande définitivement.
    throw new Error(`order_settle_payment: ${error.message ?? "erreur inconnue"}`);
  }

  const result = (data ?? {}) as Loose;
  const order = (result.order ?? null) as Loose | null;
  const firstTime = result.first_time === true;

  logEvent("fulfillment", {
    session_id: sessionId,
    order_id: order?.id ?? null,
    payment_intent: order?.stripe_payment_intent_id ?? null,
    payment_status: paymentStatus,
    order_status: order?.status ?? null,
    first_time: firstTime,
    needs_review: order?.needs_review ?? false,
  });

  if (paymentStatus === "unpaid") {
    return { status: "pending_payment", firstTime: false, order };
  }

  if (firstTime && order) {
    // Les emails ne partent qu'au tout premier encaissement. Un rejeu de
    // webhook n'en renverra pas : first_time est décidé par la transition
    // d'état en base, pas par le nombre d'appels.
    const task = sendOrderEmails(deps, order).catch((err) => {
      logEvent("fulfillment_email_error", { order_id: order.id ?? null, message: String(err?.message ?? err) });
    });
    if (deps.defer) deps.defer(task);
    else await task;
  }

  return { status: "fulfilled", firstTime, order };
}

export async function sendOrderEmails(deps: FulfillDeps, order: Loose): Promise<void> {
  const { title, sellerId } = await deps.db.productTitle(order.product_id);
  const productTitle = title ?? "Article";
  const amount = formatEuroCents(order.amount_total_cents as number | null);
  const label = shippingLabel(order.shipping_method as string | null);
  const address = order.shipping_address as Loose | null;

  const addressText = address
    ? [
        str(address.name),
        str(address.line1),
        str(address.line2),
        [str(address.postal_code), str(address.city)].filter(Boolean).join(" ") || null,
        str(address.country),
      ].filter(Boolean).join("\n")
    : "À convenir avec le vendeur";

  const reference = String(order.id ?? "").slice(0, 8).toUpperCase();
  const buyerEmail = str(order.customer_email);

  if (buyerEmail) {
    await deps.sendEmail(
      buyerEmail,
      `Confirmation d'achat ${reference} - ${productTitle}`,
      `Bonjour,\n\nVotre paiement a bien été reçu.\n\n` +
        `Commande : ${reference}\nArticle : ${productTitle}\nMontant : ${amount}\n` +
        `Livraison : ${label}\nAdresse :\n${addressText}\n\n` +
        `Le vendeur a été prévenu et organise l'expédition. Vous retrouverez le suivi ` +
        `de cette commande dans Mon compte, rubrique Mes achats.\n\n` +
        `Merci pour votre confiance,\nAthena Militaria`,
    );
  }

  const seller = str(order.seller_id) ?? sellerId;
  if (seller) {
    const sellerEmail = await deps.db.sellerEmail(seller);
    if (sellerEmail) {
      await deps.sendEmail(
        sellerEmail,
        `Vente confirmée ${reference} - ${productTitle}`,
        `Bonjour,\n\nVotre article « ${productTitle} » vient d'être vendu ${amount}.\n\n` +
          `Commande : ${reference}\nAcheteur : ${buyerEmail ?? "non renseigné"}\n` +
          `Mode de livraison : ${label}\nAdresse de livraison :\n${addressText}\n\n` +
          `Expédiez l'article puis renseignez le numéro de suivi depuis Mon compte, ` +
          `rubrique Mes ventes.\n\nBonne continuation,\nAthena Militaria`,
      );
    }
  }
}
