import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { clientError, corsHeaders as buildCors, logEvent, redactSecrets, shippingLabel } from "../_shared/payments.ts";
import {
  abreger,
  ADRESSE_CONTACT,
  chargeResend,
  corpsMembre,
  DELAIS,
  formatDateCourte,
  LIEN_MES_ACHATS,
  LIEN_MES_VENTES,
  lienMessagerie,
  montant,
  typographie,
} from "../_shared/courriels.ts";

/** Le statut que la commande doit réellement porter pour que l'email parte.
 *  Sans ce contrôle, l'endpoint envoyait l'email sur simple demande : un
 *  acheteur pouvait le rappeler en boucle et inonder le vendeur, ou annoncer
 *  une expédition qui n'avait pas eu lieu. L'email suit l'état, il ne le
 *  précède pas. */
const REQUIRED_STATUS: Record<string, string> = {
  shipped: "shipped",
  completed: "completed",
  disputed: "disputed",
};

/** Courriel à quelqu'un. Vrai seulement si Resend l'a accepté : la
 *  réservation de la notification est rendue sinon, pour un nouvel essai. */
async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    logEvent("email_skipped", { subject });
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(chargeResend(to, subject, body)),
    });
    if (!res.ok) {
      logEvent("email_failed", { subject, status: res.status, body: redactSecrets(await res.text()) });
      return false;
    }
    return true;
  } catch (err) {
    logEvent("email_failed", { subject, message: redactSecrets((err as Error)?.message ?? String(err)) });
    return false;
  }
}

/** Titre d'annonce dans un objet : au-delà, la boîte de réception coupe. */
const TITRE_OBJET_MAX = 70;

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(corsHeaders, "AUTH_REQUIRED");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return fail(corsHeaders, "AUTH_REQUIRED");

    let body: { orderId?: unknown; event?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(corsHeaders, "BAD_REQUEST");
    }

    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const event = typeof body.event === "string" ? body.event : "";
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !REQUIRED_STATUS[event]) {
      return fail(corsHeaders, "BAD_REQUEST");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Charge la commande + produit
    const { data: order } = await admin
      .from("orders")
      .select("*, products(title)")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return fail(corsHeaders, "ORDER_NOT_FOUND");

    // Sécurité : seul le bon rôle peut déclencher chaque type d'event
    // - shipped   : seul le vendeur (il vient de l'expédier)
    // - completed : seul l'acheteur (il vient de confirmer la réception)
    // - disputed  : seul l'acheteur (il signale un problème)
    if (event === "shipped" && order.seller_id !== user.id) {
      return fail(corsHeaders, "FORBIDDEN");
    }
    if ((event === "completed" || event === "disputed") && order.buyer_id !== user.id) {
      return fail(corsHeaders, "FORBIDDEN");
    }

    // L'état doit déjà être écrit en base. C'est la fonction SQL qui décide de
    // la transition ; cet endpoint ne fait que notifier ce qui est acté.
    if (order.status !== REQUIRED_STATUS[event]) {
      logEvent("order_notify_state_mismatch", {
        order_id: orderId, event, order_status: order.status, user_id: user.id,
      });
      return fail(corsHeaders, "FORBIDDEN");
    }

    const productTitle = order.products?.title || "Article";
    const titreObjet = abreger(productTitle, TITRE_OBJET_MAX);
    const reference = orderId.slice(0, 8).toUpperCase();
    const buyerEmail = order.customer_email;
    const sellerEmail = order.seller_id
      ? (await admin.auth.admin.getUserById(order.seller_id)).data?.user?.email || null
      : null;

    /* Un courriel par événement, pas un par appel. La garde d'état ci-dessus
     * empêche d'annoncer ce qui n'a pas eu lieu, pas de le répéter : l'état
     * reste vrai après l'envoi, et un appel rejoué renvoyait le même courriel
     * autant de fois qu'on voulait (au vendeur, à l'exploitant), en brûlant
     * le quota quotidien de Resend dont dépendent les confirmations de
     * commande. order_notifications, créée pour cela par la migration
     * 20260814000300, n'était pas appelée ici. On réserve le couple
     * (commande, événement) avant d'écrire, on le rend si l'envoi échoue.
     * Une base injoignable pour la réservation ne doit pas faire perdre la
     * notification : on écrit alors quand même, comme avant.
     * Vrai si le courriel est parti, maintenant ou lors d'un appel précédent :
     * les courriels qui suivent ne disent « prévenu » que de qui l'est. */
    const envoyesOuDeja: string[] = [];
    const notifierUneFois = async (evenement: string, to: string | null, sujet: string, corps: string): Promise<boolean> => {
      if (!to) return false;
      const { data: pris, error: erreurReservation } = await admin.rpc("order_notification_claim", {
        p_order_id: orderId, p_event: evenement,
      });
      if (erreurReservation) {
        logEvent("order_notify_claim_unavailable", { order_id: orderId, event: evenement, message: redactSecrets(erreurReservation.message) });
      } else if (pris !== true) {
        envoyesOuDeja.push(evenement);
        return true;
      }
      const parti = await sendEmail(to, sujet, corps);
      if (parti) {
        envoyesOuDeja.push(evenement);
      } else if (!erreurReservation) {
        await admin.rpc("order_notification_release", { p_order_id: orderId, p_event: evenement });
      }
      return parti;
    };

    if (event === "shipped") {
      // Remise en main propre : rien n'est expédié. Le vendeur a cliqué
      // « Confirmer la remise en main propre » et le champ du numéro de suivi
      // porte la date et le lieu qu'il a saisis (account.js).
      const enMain = order.shipping_method === "pickup";
      const suivi = typeof order.tracking_number === "string" ? order.tracking_number.trim() : "";
      const confirmer =
        `Si l'article ne correspond pas à l'annonce, ne confirmez pas la réception : signalez le problème depuis ` +
        `la même rubrique (bouton « Signaler un problème »). Après votre confirmation, vous disposez encore de ` +
        `${DELAIS.heuresSignalement} heures pour le faire ; le vendeur n'est payé qu'ensuite.`;
      if (enMain) {
        await notifierUneFois("suivi_expedition_acheteur", buyerEmail,
          typographie(`Remise en main propre enregistrée : « ${titreObjet} »`),
          corpsMembre([
            `Le vendeur a enregistré la remise en main propre de votre achat « ${productTitle} » ` +
            `(commande ${reference}), avec cette indication :`,
            `Remise : ${suivi || "date et lieu non précisés"}`,
            `Une fois l'article entre vos mains, confirmez la réception depuis Mon compte, rubrique Mes achats ` +
            `(bouton « J'ai bien reçu l'article ») :\n${LIEN_MES_ACHATS}`,
            confirmer,
          ]));
      } else {
        await notifierUneFois("suivi_expedition_acheteur", buyerEmail,
          typographie(`Votre achat « ${titreObjet} » a été expédié`),
          corpsMembre([
            `Le vendeur a expédié votre achat « ${productTitle} » (commande ${reference}).`,
            `Mode de livraison : ${shippingLabel(order.shipping_method)}\n` +
            (suivi
              ? `Numéro de suivi : ${suivi}` + (order.tracking_carrier ? ` (${order.tracking_carrier})` : "")
              : `Le vendeur n'a pas indiqué de numéro de suivi : vous pouvez le lui demander par la messagerie du site.`),
            `Dès réception, confirmez-la depuis Mon compte, rubrique Mes achats (bouton « J'ai bien reçu ` +
            `l'article ») :\n${LIEN_MES_ACHATS}`,
            confirmer,
          ]));
      }
    } else if (event === "completed") {
      // Le versement n'est automatique que si orders_ready_for_payout prend
      // la commande : pas de revue en cours (needs_review, posé par une
      // expédition déclarée hors délai ou par le silence de l'acheteur), et un
      // compte de paiement prêt chez le vendeur. Le courriel ne promet que ce
      // que ces conditions permettent.
      const enRevue = order.needs_review === true || order.payout_state === "manual_review" ||
        order.payout_state === "blocked";
      await notifierUneFois("suivi_reception_vendeur", sellerEmail,
        typographie(`Réception confirmée : « ${titreObjet} »`),
        corpsMembre([
          `L'acheteur a confirmé avoir bien reçu « ${productTitle} » (commande ${reference}).`,
          enRevue
            ? `Il dispose maintenant de ${DELAIS.heuresSignalement} heures pour signaler un problème. Le versement ` +
              `de cette vente sera ensuite examiné par notre équipe avant de partir.`
            : `Il dispose maintenant de ${DELAIS.heuresSignalement} heures pour signaler un problème. Passé ce délai, ` +
              `et sans signalement, votre versement de ${montant(order.seller_amount_cents)} part automatiquement ` +
              `vers votre compte de paiement Stripe. Il suppose que ce compte soit à jour : si Stripe vous demande ` +
              `une information ou un justificatif, le versement attend que ce soit fait.`,
          `Vous pouvez en suivre l'avancement depuis Mon compte, rubrique Mes ventes :\n${LIEN_MES_VENTES}`,
          `Merci pour cette vente.`,
        ]));
    } else if (event === "disputed") {
      const reason = order.dispute_reason || "Aucun détail fourni.";
      // Le signalement est daté : la clé de réservation suit le signalement,
      // pas seulement la commande.
      const cle = String(order.disputed_at ?? "");
      const pasExpediee = !order.shipped_at && !order.tracking_number;
      const enMain = order.shipping_method === "pickup";
      const ecrireAcheteur = lienMessagerie(order.buyer_id, order.product_id);
      const ecrireVendeur = lienMessagerie(order.seller_id, order.product_id);

      /* Ordre d'envoi : l'exploitant, puis le vendeur, puis l'acheteur. Les
       * courriels aux parties disent qui est prévenu ; ils ne peuvent le dire
       * que de ceux à qui l'on a déjà écrit, et dont l'envoi a abouti. */

      // Exploitant : de quoi trancher sans rouvrir la base.
      const etatAvant = order.confirmed_at
        ? `réception confirmée le ${formatDateCourte(order.confirmed_at)}`
        : order.shipped_at || order.tracking_number
          ? `expédiée` + (order.shipped_at ? ` le ${formatDateCourte(order.shipped_at)}` : "") +
            (order.tracking_number ? ` (suivi ou remise : ${order.tracking_number})` : "")
          : `payée, pas encore déclarée expédiée`;
      const equipePrevenue = await notifierUneFois(`suivi_litige_exploitant:${cle}`, ADRESSE_CONTACT,
        typographie(`[Litige] Commande ${reference} : ${abreger(productTitle, 60)}`),
        typographie([
          `Signalement ouvert par l'acheteur sur la commande ${reference}.`,
          "",
          `Article : ${productTitle}`,
          `Montant payé : ${montant(order.amount_total_cents)} (dont ${montant(order.seller_amount_cents)} pour le vendeur)`,
          `Mode de livraison : ${shippingLabel(order.shipping_method)}`,
          `État avant le signalement : ${etatAvant}`,
          `Versement au vendeur : suspendu tant que le signalement est ouvert.`,
          "",
          `Motif donné par l'acheteur :`,
          reason,
          "",
          `Acheteur : ${buyerEmail || "?"}`,
          `Vendeur : ${sellerEmail || "?"}`,
          `Identifiant complet : ${orderId}`,
          "",
          `Pour clore le signalement, dans l'éditeur SQL : select public.order_resolve_dispute('${orderId}', ` +
          `'retire'), ou 'vendeur_paye', ou 'acheteur_rembourse' (le remboursement se fait ensuite chez Stripe).`,
        ].join("\n")));

      // Vendeur. order_resolve_dispute est réservée à l'exploitant : un accord
      // entre les parties ne débloque rien tant que l'équipe ne l'a pas acté.
      // Le versement, lui, est suspendu par orders_guard_payout. En main
      // propre, rien ne s'expédie : on parle de remise.
      const vendeurPrevenu = await notifierUneFois(`suivi_litige_vendeur:${cle}`, sellerEmail,
        typographie(`Problème signalé sur votre vente « ${titreObjet} »`),
        corpsMembre([
          `L'acheteur de « ${productTitle} » (commande ${reference}) a signalé un problème :`,
          `« ${reason} »`,
          `Le versement de cette vente est suspendu tant que le signalement n'est pas clos.` +
          (!pasExpediee
            ? ""
            : enMain
              ? ` La remise de l'article n'est pas encore enregistrée : ne le remettez pas tant que le signalement ` +
                `n'est pas réglé.`
              : ` L'article n'est pas encore déclaré expédié : ne l'expédiez pas tant que le signalement n'est pas ` +
                `réglé.`),
          `Échangez avec l'acheteur depuis la messagerie du site pour comprendre le problème` +
          (ecrireAcheteur ? ` :\n${ecrireAcheteur}` : `.`),
          (equipePrevenue
            ? `Notre équipe est prévenue, et c'est elle qui clôt le signalement`
            : `C'est notre équipe qui clôt le signalement`) +
          ` : si vous trouvez un accord avec l'acheteur, dites-le-nous en répondant à ce courriel.`,
        ]));

      // Acheteur : une trace écrite de son signalement, avec la référence et
      // le moyen de nous joindre. Il n'avait jusqu'ici qu'un message à l'écran.
      const prevenus = vendeurPrevenu && equipePrevenue
        ? `Le vendeur et notre équipe sont prévenus. `
        : vendeurPrevenu
          ? `Le vendeur est prévenu. `
          : equipePrevenue
            ? `Notre équipe est prévenue. `
            : "";
      await notifierUneFois(`suivi_litige_acheteur:${cle}`, buyerEmail,
        typographie(`Votre signalement sur la commande ${reference} est enregistré`),
        corpsMembre([
          `Votre signalement sur « ${productTitle} » (commande ${reference}) est bien enregistré :`,
          `« ${reason} »`,
          `${prevenus}Rien n'est versé au vendeur tant que le signalement n'est pas réglé.`,
          `Vous pouvez échanger avec le vendeur depuis la messagerie du site` +
          (ecrireVendeur ? ` :\n${ecrireVendeur}` : `.`),
          `Pour compléter votre signalement (photos, précisions), écrivez-nous en répondant à ce courriel.`,
          `Vous suivez la commande depuis Mon compte, rubrique Mes achats :\n${LIEN_MES_ACHATS}`,
        ]));
    }

    return json(corsHeaders, { ok: true, notifications: envoyesOuDeja }, 200);
  } catch (err) {
    logEvent("order_notify_error", { message: redactSecrets((err as Error)?.message ?? String(err)) });
    return fail(corsHeaders, "INTERNAL");
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
