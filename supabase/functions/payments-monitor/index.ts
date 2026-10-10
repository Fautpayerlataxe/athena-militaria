/**
 * Surveillance et réconciliation du système de paiement.
 *
 * Appelée par une tâche planifiée. Elle fait deux choses :
 *
 *   1. RÉCONCILIER. Pour chaque commande dont l'état interne est suspect, elle
 *      relit la vérité chez Stripe et répare ce qui est réparable sans risque.
 *      Réparable sans risque veut dire : une transition que le webhook aurait
 *      faite s'il était arrivé. Rien d'autre n'est automatisé — créer un
 *      paiement, un remboursement ou un transfert depuis un travail de fond
 *      serait le meilleur moyen de transformer une anomalie en perte.
 *
 *   2. ALERTER. Ce qui reste incohérent part par email, une seule fois par
 *      exécution, avec de quoi agir.
 *
 * Les webhooks restent la voie normale. Ceci est le filet : Stripe peut
 * échouer à livrer pendant trois jours, une fonction peut avoir été
 * indisponible, un événement peut avoir été perdu avant la mise en place du
 * journal. Sans réconciliation, une divergence silencieuse ne se découvre
 * qu'au moment où un client réclame.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  analyserEndpointsWebhook,
  effacementsSuspects,
  type EndpointStripe,
  formatEuroCents,
  type LectureCompte,
  logEvent,
  redactSecrets,
  stripeKeyMode,
} from "../_shared/payments.ts";
import { fulfillCheckoutSession, type FulfillDeps } from "../_shared/fulfillment.ts";
import {
  appliquerSynchroConnect,
  type ConnectDeps,
  type ConnectStripeLike,
  lireCompteConnect,
  type ProfilConnect,
  profilsConnect,
  type SupabaseLike,
} from "../_shared/connect.ts";

const STRIPE_API_VERSION = "2023-10-16";
const ADMIN_EMAIL = "contact@athenamilitaria.fr";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20000,
});

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { logEvent("email_skipped", { to, subject }); return; }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: "Athena Militaria <noreply@athenamilitaria.fr>", to: [to], subject, text: body,
    }),
  }).catch(() => {});
}

const deps: FulfillDeps = {
  stripe: stripe as unknown as FulfillDeps["stripe"],
  db: {
    rpc: (name, args) => admin.rpc(name, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    async productTitle(productId) {
      if (productId == null) return { title: null, sellerId: null };
      const { data } = await admin.from("products").select("title, user_id").eq("id", productId).maybeSingle();
      return { title: data?.title ?? null, sellerId: data?.user_id ?? null };
    },
    async sellerEmail(sellerId) {
      const { data } = await admin.auth.admin.getUserById(sellerId);
      return data?.user?.email ?? null;
    },
  },
  sendEmail,
};

// Une clé Stripe ne voit que son propre environnement. Le mode est établi une
// fois, au chargement : la relecture des comptes vendeurs en dépend (seule la
// clé live autorise à effacer un compte introuvable), et la vérification de
// configuration le rapporte.
const keyMode = stripeKeyMode(Deno.env.get("STRIPE_SECRET_KEY"));

const connectDeps: ConnectDeps = {
  stripe: stripe as unknown as ConnectStripeLike,
  db: profilsConnect(admin as unknown as SupabaseLike),
  keyMode,
};

/** Nombre maximal de comptes vendeurs relus par passage. L'ordre est fixe
 *  (prêts d'abord) : au-delà, les mêmes restent de côté, et le rapport le dit. */
const VENDEURS_PAR_PASSAGE = 200;

/** Temps accordé à la relecture des comptes vendeurs. Le reste de la
 *  surveillance, et surtout l'envoi du rapport, doit tenir dans la limite
 *  d'exécution d'une fonction edge. */
const BUDGET_VENDEURS_MS = 45_000;

/** Pannes Stripe de suite au-delà desquelles on cesse de relire : Stripe est
 *  en panne, insister n'apprendrait rien et mangerait le temps du rapport. */
const PANNES_DE_SUITE_MAX = 3;

/** Un client à délai court pour ces lectures. Avec le client principal
 *  (20 s, deux nouvelles tentatives), une seule lecture pouvait durer plus
 *  d'une minute, bien au-delà du budget. */
const stripeLecture: ConnectStripeLike = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1, timeout: 8000,
}) as unknown as ConnectStripeLike;

type Anomaly = { severity: "critique" | "attention"; line: string };

Deno.serve(async (req) => {
  const expected = Deno.env.get("PAYMENTS_CRON_SECRET");
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const anomalies: Anomaly[] = [];
  const repaired: string[] = [];
  let endpointsSeen: Array<Record<string, unknown>> = [];
  let etatCompte: Record<string, unknown> = {};
  const vendeurs = {
    relus: 0, effaces: 0, prets: 0, plus_prets: 0, illisibles: 0,
    ecritures_en_echec: 0, retenus: 0, non_relus: 0,
    interrompu: null as null | "temps" | "pannes",
  };

  /* --- 1. Commandes bloquées en attente de confirmation de paiement ----
   *
   * Une session Checkout complétée dont le paiement n'a jamais été confirmé
   * en base : soit le webhook async_payment_succeeded s'est perdu, soit le
   * paiement a réellement échoué. Stripe tranche.
   */
  const { data: stuck } = await admin
    .from("orders")
    .select("id, stripe_session_id, created_at, amount_total_cents")
    .eq("status", "payment_pending")
    .lt("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .limit(50);

  for (const order of stuck ?? []) {
    if (!order.stripe_session_id) continue;
    try {
      const outcome = await fulfillCheckoutSession(deps, order.stripe_session_id);
      if (outcome.status === "fulfilled") {
        repaired.push(`commande ${short(order.id)} : paiement confirmé chez Stripe, état recalé sur « payée »`);
      } else if (Date.now() - new Date(order.created_at).getTime() > 3 * 86400_000) {
        anomalies.push({
          severity: "attention",
          line: `Commande ${short(order.id)} en attente de paiement depuis plus de trois jours ` +
                `(${formatEuroCents(order.amount_total_cents)}). Stripe ne la donne toujours pas pour réglée.`,
        });
      }
    } catch (err) {
      anomalies.push({
        severity: "attention",
        line: `Commande ${short(order.id)} : impossible de relire la session chez Stripe (${redactSecrets((err as Error)?.message)}).`,
      });
    }
  }

  /* --- 2. Réservations qui n'ont jamais été libérées -------------------- */
  const { data: swept } = await admin.rpc("checkout_expire_stale", { p_product_id: null });
  if (typeof swept === "number" && swept > 0) {
    repaired.push(`${swept} réservation(s) expirée(s) libérée(s)`);
  }

  /* --- 3. Divergences que Stripe seul peut confirmer -------------------
   *
   * Commandes marquées payées mais dont le remboursement a pu échapper au
   * webhook. On relit la charge : si Stripe la dit remboursée, on aligne.
   */
  const { data: paidOrders } = await admin
    .from("orders")
    .select("id, stripe_charge_id, stripe_payment_intent_id, amount_refunded_cents, status")
    .in("status", ["paid", "shipped", "delivered", "completed"])
    .not("stripe_charge_id", "is", null)
    .eq("amount_refunded_cents", 0)
    .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
    .limit(100);

  for (const order of paidOrders ?? []) {
    try {
      const charge = await stripe.charges.retrieve(order.stripe_charge_id as string);
      if (charge.amount_refunded > 0) {
        await admin.rpc("order_apply_refund", {
          p_intent_id: order.stripe_payment_intent_id,
          p_charge_id: order.stripe_charge_id,
          p_refunded_cents: charge.amount_refunded,
          p_fully_refunded: charge.refunded === true,
        });
        repaired.push(
          `commande ${short(order.id)} : remboursement de ${formatEuroCents(charge.amount_refunded)} ` +
          `constaté chez Stripe et reporté en base`);
      }
      if (charge.disputed) {
        // Signaler ne suffit pas : le travail de versement passe toutes les
        // heures, l'exploitant lit ses courriels quand il peut. Entre les
        // deux, l'argent d'une commande contestée pourrait partir chez le
        // vendeur — et il faudrait ensuite le lui reprendre.
        //
        // Bloquer est sans risque : au pire on retarde un versement légitime,
        // que l'exploitant débloquera. Ne pas bloquer coûte le montant.
        const { data: blocked } = await admin.rpc("order_block_payout", {
          p_order_id: order.id,
          p_reason: "Litige bancaire constaté chez Stripe, en attente de vérification",
        });
        anomalies.push({
          severity: "critique",
          line: `Commande ${short(order.id)} : litige bancaire ouvert chez Stripe, absent de la base. ` +
                (blocked === true
                  ? "Le versement au vendeur a été suspendu par précaution."
                  : "Le versement n'a pas pu être suspendu : vérifier son état sans tarder."),
        });
      }
    } catch (err) {
      logEvent("monitor_charge_read_failed", {
        order_id: order.id, message: redactSecrets((err as Error)?.message),
      });
    }
  }

  /* --- 4. Ce qui demande un humain ------------------------------------- */
  const { data: attention } = await admin.rpc("orders_needing_attention");
  for (const row of (attention ?? []) as Array<Record<string, unknown>>) {
    anomalies.push({
      severity: "critique",
      line: `Commande ${short(String(row.id))} (${formatEuroCents(row.amount_total_cents as number)}, ` +
            `état ${row.status}) : ${row.reason}`,
    });
  }

  /* --- 4 bis. Événements réservés puis jamais clôturés -------------------
   *
   * Un traitement coupé en vol laisse l'événement en « processing ». Il n'est
   * alors ni traité, ni repris, ni signalé : le statut « failed » était le
   * seul surveillé. Constaté sur 61 événements après une série de
   * déploiements. Sur un checkout.session.completed, cela voudrait dire un
   * acheteur débité et une commande jamais honorée.
   *
   * On tente d'abord de finir le travail pour les événements qui portent de
   * l'argent, puis on rend la place pour que Stripe puisse relivrer.
   */
  try {
    const { data: bloques } = await admin.rpc("stripe_events_stuck", { p_older_seconds: 900 });
    for (const ev of (bloques ?? []) as Array<Record<string, unknown>>) {
      const type = String(ev.type ?? "");
      let repare = false;

      if (type.startsWith("checkout.session.")) {
        try {
          const evenement = await stripe.events.retrieve(String(ev.id));
          const objet = (evenement.data?.object ?? {}) as Record<string, unknown>;
          const sessionId = typeof objet.id === "string" ? objet.id : null;
          if (sessionId && type === "checkout.session.completed") {
            const issue = await fulfillCheckoutSession(deps, sessionId);
            repare = issue.status === "fulfilled";
          }
        } catch (err) {
          logEvent("monitor_event_replay_failed", {
            event_id: ev.id, message: redactSecrets((err as Error)?.message),
          });
        }
      }

      await admin.rpc("stripe_event_unstick", {
        p_id: String(ev.id),
        p_reason: repare
          ? "traitement interrompu, terminé par la surveillance"
          : "traitement interrompu, à relivrer par Stripe",
      });

      if (repare) {
        repaired.push(`événement ${String(ev.id).slice(0, 18)} (${type}) : traitement repris et terminé`);
      } else {
        anomalies.push({
          severity: type === "checkout.session.completed" ? "critique" : "attention",
          line: `Événement Stripe ${String(ev.id).slice(0, 18)} (${type}) est resté bloqué en cours de ` +
                `traitement. Il a été rendu reprenable ; Stripe le relivrera. ` +
                (type === "checkout.session.completed"
                  ? "Celui-ci porte une confirmation de paiement : vérifier la commande sans tarder."
                  : ""),
        });
      }
    }
  } catch (err) {
    logEvent("monitor_stuck_events_failed", { message: redactSecrets((err as Error)?.message) });
  }

  /* --- 5. Webhooks en échec -------------------------------------------- */
  const { data: failedEvents } = await admin
    .from("stripe_events")
    .select("id, type, attempts, last_error")
    .eq("status", "failed")
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .limit(20);

  /* Tous les échecs ne se valent pas. Un checkout.session.completed perdu,
   * c'est un acheteur débité sans commande. Une session expirée non traitée,
   * c'est au pire du stock qui reste réservé quelques minutes de plus, et le
   * balayage des réservations périmées s'en charge de toute façon. Mettre les
   * deux au même niveau, c'est apprendre à l'exploitant à ignorer l'alerte. */
  const TYPES_CRITIQUES = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "charge.refunded",
    "charge.dispute.created",
  ]);

  for (const event of failedEvents ?? []) {
    anomalies.push({
      severity: TYPES_CRITIQUES.has(String(event.type)) ? "critique" : "attention",
      line: `Événement Stripe ${event.id} (${event.type}) en échec après ${event.attempts} tentative(s) : ${event.last_error ?? "?"}`,
    });
  }

  /* --- 6. Versements en souffrance ------------------------------------- */
  const { data: blockedPayouts } = await admin
    .from("orders")
    .select("id, payout_state, payout_last_error, amount_total_cents")
    .eq("payout_state", "blocked")
    .limit(20);

  for (const order of blockedPayouts ?? []) {
    anomalies.push({
      severity: "attention",
      line: `Versement suspendu sur la commande ${short(order.id)} ` +
            `(${formatEuroCents(order.amount_total_cents)}) : ${order.payout_last_error ?? "motif non précisé"}`,
    });
  }

  /* --- 6 ter. Ventes en attente du compte du vendeur -------------------
   *
   * Depuis le 10 octobre 2026, une vente peut être conclue chez un vendeur
   * dont le compte de paiement n'est pas prêt ; payout-release relance,
   * fait reprendre ou annule à l'échéance, toutes les heures. Ici, on ne
   * fait que regarder : une annulation décidée dont le remboursement n'a pas
   * abouti depuis plus de deux heures veut dire un acheteur à qui l'on a
   * promis un remboursement automatique et qui ne l'a pas eu.
   */
  try {
    const { data: enAttente } = await admin
      .from("orders")
      .select("id, status, seller_ready_deadline_at, seller_ready_cancel_at, seller_ready_last_error, " +
              "seller_ready_refund_attempts, amount_total_cents, amount_refunded_cents, chargeback_status, " +
              "payout_state, shipped_at, tracking_number")
      .not("seller_ready_deadline_at", "is", null)
      .is("seller_ready_at", null)
      .is("seller_ready_refunded_at", null)
      .in("status", ["paid", "disputed", "partially_refunded"])
      .order("seller_ready_deadline_at", { ascending: true })
      .limit(50);

    const NB = "\u00a0";
    for (const o of enAttente ?? []) {
      const annuleeDepuis = o.seller_ready_cancel_at ? Date.now() - new Date(o.seller_ready_cancel_at).getTime() : 0;
      const echeanceDepassee = new Date(o.seller_ready_deadline_at).getTime() < Date.now() - 2 * 3600_000;
      if (o.seller_ready_cancel_at && annuleeDepuis > 2 * 3600_000) {
        anomalies.push({
          severity: "critique",
          line: `Commande ${short(o.id)} (${formatEuroCents(o.amount_total_cents)})${NB}: annulée à l'échéance ` +
                `(vendeur pas prêt) mais toujours pas remboursée. ${libelleEchecRemboursement(o)}`,
        });
      } else if (!o.seller_ready_cancel_at && echeanceDepassee) {
        // Les mêmes exclusions que la file de payout-release
        // (orders_seller_ready_queue) : une commande qu'elle ne prendra
        // jamais n'est pas le signe d'une tâche arrêtée, mais d'un cas à
        // trancher à la main.
        const motifs: string[] = [];
        if (o.chargeback_status) motifs.push(`litige bancaire ${o.chargeback_status}`);
        if (Number(o.amount_refunded_cents ?? 0) !== 0 || o.status === "partially_refunded") {
          motifs.push(`déjà remboursée en partie (${formatEuroCents(o.amount_refunded_cents)})`);
        }
        if (o.payout_state === "released") motifs.push("versement déjà libéré");
        if (o.shipped_at || o.tracking_number) motifs.push("déjà déclarée expédiée");
        anomalies.push(motifs.length > 0
          ? {
              severity: "attention",
              line: `Commande ${short(o.id)}${NB}: échéance du vendeur passée, annulation automatique ` +
                    `impossible (${motifs.join(", ")}). À traiter à la main.`,
            }
          : {
              severity: "critique",
              line: `Commande ${short(o.id)}${NB}: échéance du vendeur passée depuis plus de deux heures sans ` +
                    `annulation. Vérifier que la tâche payout-release tourne (réponses 200 et non 401).`,
            });
      }
    }
    const attente = (enAttente ?? []).filter((o) => !o.seller_ready_cancel_at).length;
    if (attente > 0) logEvent("monitor_seller_ready_waiting", { commandes: attente });
  } catch (err) {
    logEvent("monitor_seller_ready_failed", { message: redactSecrets((err as Error)?.message) });
  }

  /* --- 6 bis. Comptes vendeurs chez Stripe ------------------------------
   *
   * Le filet de l'inscription des vendeurs. Deux pannes silencieuses ici :
   *
   *   - un compte créé pendant les essais en mode test n'existe pas en live.
   *     Le vendeur reste « en attente » sans comprendre ; ou, s'il était
   *     marqué prêt, ses ventes encaissent un argent qu'aucun transfert ne
   *     pourra jamais lui verser ;
   *   - le account.updated qui déclare un vendeur prêt n'arrive que par la
   *     destination « comptes connectés ». Si elle manque, ou si son secret
   *     est faux, le vendeur a fini son inscription mais ne peut pas vendre.
   *
   * On relit donc chaque compte chez Stripe. Introuvable avec la clé live :
   * l'identifiant est effacé, et le vendeur repartira d'un compte neuf à son
   * prochain clic. Prêt : le drapeau est posé. Les vendeurs marqués prêts
   * passent en premier : ce sont eux qui peuvent encaisser à tort.
   *
   * En deux temps, pour deux raisons :
   *
   *   1. LIRE, sous un budget de temps. Cette section est la seule de la
   *      surveillance à faire des dizaines d'appels Stripe. Si Stripe est lent,
   *      elle ne doit pas emporter la fonction au-delà de sa limite
   *      d'exécution : le courriel de rapport, avec les anomalies critiques
   *      des sections précédentes, ne partirait jamais. On s'arrête donc après
   *      BUDGET_VENDEURS_MS, ou après quelques pannes de suite, et on le dit.
   *   2. PUIS DÉCIDER d'effacer. Si plusieurs vendeurs prêts disparaissent
   *      ensemble, c'est la clé qu'il faut soupçonner, pas les comptes (voir
   *      effacementsSuspects) : rien n'est effacé, et l'alerte est critique.
   *
   * Chaque identifiant effacé figure en entier dans le rapport et dans le
   * journal (connect_account_erased) : c'est ce qui permet de le remettre.
   */
  try {
    const debut = Date.now();
    const { data: profils, error: profilsError } = await admin
      .from("profiles")
      .select("id, stripe_account_id, stripe_onboarded")
      .not("stripe_account_id", "is", null)
      .order("stripe_onboarded", { ascending: false })
      .order("id", { ascending: true })
      .limit(VENDEURS_PAR_PASSAGE);
    if (profilsError) throw new Error(profilsError.message);
    const aRelire = (profils ?? []) as ProfilConnect[];

    // 1. Lire, sans rien écrire.
    const lus: Array<{ profil: ProfilConnect; lecture: LectureCompte }> = [];
    let pannesDeSuite = 0;
    for (const profil of aRelire) {
      if (Date.now() - debut > BUDGET_VENDEURS_MS) {
        vendeurs.interrompu = "temps";
        break;
      }
      try {
        lus.push({ profil, lecture: await lireCompteConnect(stripeLecture, String(profil.stripe_account_id)) });
        vendeurs.relus++;
        pannesDeSuite = 0;
      } catch (err) {
        vendeurs.illisibles++;
        pannesDeSuite++;
        logEvent("monitor_connect_read_failed", {
          profile_id: profil.id, account_id: profil.stripe_account_id,
          message: redactSecrets((err as Error)?.message ?? String(err)),
        });
        if (pannesDeSuite >= PANNES_DE_SUITE_MAX) {
          vendeurs.interrompu = "pannes";
          break;
        }
      }
    }
    vendeurs.non_relus = aRelire.length - vendeurs.relus - vendeurs.illisibles;

    // 2. Décider, puis écrire.
    const suspect = effacementsSuspects(
      lus.map(({ profil, lecture }) => ({ pretEnBase: profil.stripe_onboarded === true, lecture })),
      keyMode,
    );
    if (suspect) {
      const disparus = lus
        .filter(({ profil, lecture }) => profil.stripe_onboarded === true && lecture.etat === "introuvable")
        .map(({ profil }) => String(profil.stripe_account_id));
      logEvent("monitor_connect_erasure_held", { comptes: disparus, key_mode: keyMode });
      anomalies.push({
        severity: "critique",
        line: `${disparus.length} vendeurs marqués prêts sont introuvables d'un coup chez Stripe avec la clé ` +
              `${keyMode} (${disparus.join(", ")}). Des comptes qui disparaissent ensemble trahissent plutôt ` +
              `une clé Stripe d'un autre compte qu'une vraie disparition : rien n'a été effacé ce passage-ci, ` +
              `pour aucun vendeur. Vérifiez d'abord que STRIPE_SECRET_KEY est bien la clé du compte Stripe ` +
              `d'Athena Militaria. Si c'est le cas, et seulement alors, effacez ces identifiants dans ` +
              `l'éditeur SQL : UPDATE public.profiles SET stripe_account_id = NULL, stripe_onboarded = false, ` +
              `stripe_onboarded_at = NULL WHERE stripe_account_id IN ` +
              `(${disparus.map((c) => `'${c}'`).join(", ")});`,
      });
    }

    for (const { profil, lecture } of lus) {
      const court = short(String(profil.id));
      const qui = `Vendeur ${court}`;
      const compte = String(profil.stripe_account_id);
      try {
        const { issue, ecrit } = await appliquerSynchroConnect(connectDeps, profil, lecture, { effacer: !suspect });

        if (issue === "introuvable_efface") {
          // Zéro ligne modifiée : le vendeur a obtenu un autre compte entre la
          // lecture et l'écriture. Rien n'a été effacé, rien à rapporter.
          if (!ecrit) continue;
          vendeurs.effaces++;
          repaired.push(`vendeur ${court} : compte de paiement ${compte} introuvable avec la clé ${keyMode}, ` +
                        `identifiant effacé. Il repartira d'un compte neuf à sa prochaine inscription.`);
          if (profil.stripe_onboarded) {
            anomalies.push({
              severity: "attention",
              line: `${qui} était marqué prêt à vendre sur un compte de paiement (${compte}) que Stripe ne ` +
                    `connaît pas en ${keyMode}. Ses versements attendront sa nouvelle inscription ; ses nouvelles ` +
                    `ventes reçoivent une échéance de 7 jours, et il ne peut plus déclarer d'expédition d'ici là.`,
            });
          }
        } else if (issue === "introuvable_conserve") {
          if (suspect) {
            // Déjà dit, en une seule ligne critique.
            vendeurs.retenus++;
            continue;
          }
          anomalies.push({
            severity: "attention",
            line: `${qui} : compte de paiement ${compte} introuvable avec la clé ${keyMode}. Rien n'est ` +
                  `effacé tant que la clé n'est pas live.`,
          });
        } else if (issue === "devenu_pret" && ecrit) {
          vendeurs.prets++;
          repaired.push(`vendeur ${court} : inscription terminée chez Stripe, désormais prêt à vendre`);
        } else if (issue === "plus_pret" && ecrit) {
          vendeurs.plus_prets++;
          anomalies.push({
            severity: "attention",
            line: `${qui} : son compte de paiement n'est plus prêt chez Stripe (dossier, encaissements ou ` +
                  `virements). Jusqu'à régularisation de son côté, il ne peut plus déclarer d'expédition, ses ` +
                  `versements attendent, et ses nouvelles ventes reçoivent une échéance de 7 jours.`,
          });
        }
      } catch (err) {
        vendeurs.ecritures_en_echec++;
        logEvent("monitor_connect_write_failed", {
          profile_id: profil.id, account_id: compte, message: redactSecrets((err as Error)?.message ?? String(err)),
        });
      }
    }

    if (vendeurs.illisibles > 0 || vendeurs.ecritures_en_echec > 0) {
      anomalies.push({
        severity: "attention",
        line: `Comptes vendeurs : ${vendeurs.illisibles} n'ont pas pu être relus chez Stripe, ` +
              `${vendeurs.ecritures_en_echec} n'ont pas pu être mis à jour en base. Nouvel essai au ` +
              `prochain passage.`,
      });
    }
    if (vendeurs.interrompu) {
      anomalies.push({
        severity: "attention",
        line: `Relecture des comptes vendeurs arrêtée ` +
              (vendeurs.interrompu === "temps"
                ? `au bout de ${Math.round(BUDGET_VENDEURS_MS / 1000)} s`
                : `après ${PANNES_DE_SUITE_MAX} pannes de suite chez Stripe`) +
              ` : ${vendeurs.non_relus} compte(s) non relus ce passage-ci. Le reste du contrôle a eu lieu.`,
      });
    }
    if (aRelire.length >= VENDEURS_PAR_PASSAGE) {
      // L'ordre est fixe : au-delà de la limite, ce sont toujours les mêmes
      // qui restent de côté. Sans effet aujourd'hui ; le jour où cela arrive,
      // il faudra faire tourner la relecture plutôt que relever la limite.
      logEvent("monitor_connect_truncated", { limit: VENDEURS_PAR_PASSAGE });
      anomalies.push({
        severity: "attention",
        line: `Au moins ${VENDEURS_PAR_PASSAGE} vendeurs ont un compte de paiement : seuls les ` +
              `${VENDEURS_PAR_PASSAGE} premiers (prêts d'abord) sont relus par la surveillance. Les autres ne ` +
              `le sont qu'à leur inscription ou à l'ouverture d'un paiement.`,
      });
    }
    logEvent("monitor_connect_accounts", { ...vendeurs, key_mode: keyMode, ms: Date.now() - debut });
  } catch (err) {
    logEvent("monitor_connect_failed", { message: redactSecrets((err as Error)?.message ?? String(err)) });
  }

  /* --- 7. Configuration du webhook chez Stripe --------------------------
   *
   * Une case décochée dans le tableau de bord ne produit aucune erreur : les
   * événements concernés cessent simplement d'arriver, et les commandes
   * restent bloquées dans un état intermédiaire. C'est une panne silencieuse,
   * du genre qu'on découvre par une réclamation.
   *
   * On compare donc la configuration réelle à la liste dont le code dépend,
   * destination par destination : « Votre compte » pour l'argent, « comptes
   * connectés » pour l'inscription des vendeurs.
   */
  try {
    // Une clé Stripe ne voit que son propre environnement : une clé de test ne
    // liste que des endpoints de test. Le mode n'est donc pas un détail de
    // journal, c'est le premier fait à établir. Une boutique rouverte avec une
    // clé de test encaisse zéro euro tout en ayant l'air de fonctionner :
    // aucune erreur, aucune alerte, juste des cartes refusées côté acheteur.
    if (keyMode !== "live") {
      anomalies.push({
        severity: "critique",
        line: `Le site est relié à l'environnement « ${keyMode} » de Stripe. Tant que c'est le ` +
              `cas, aucun paiement réel ne peut être encaissé : les cartes des acheteurs seront ` +
              `refusées. À corriger avant toute réouverture des achats.`,
      });
    }

    /* Une clé de production ne suffit pas à encaisser : le compte doit avoir
     * été validé par Stripe. Tant que ce n'est pas fait, les sessions se créent
     * et les cartes sont refusées, sans que rien ne l'explique côté acheteur. */
    const compte = await stripe.accounts.retrieve();
    const encaisse = compte.charges_enabled === true;
    const verse = compte.payouts_enabled === true;
    etatCompte = { encaisse, verse, pays: compte.country ?? "?", devise: compte.default_currency ?? "?" };

    if (!encaisse) {
      const du = (compte.requirements?.currently_due ?? []).slice(0, 6).join(", ");
      anomalies.push({
        severity: "critique",
        line: `Le compte Stripe n'est pas autorisé à encaisser (charges_enabled = false). ` +
              `Les cartes des acheteurs seront refusées. ` +
              (du ? `Stripe attend encore : ${du}.` : "Vérifier l'activation du compte dans le tableau de bord."),
      });
    } else if (!verse) {
      anomalies.push({
        severity: "attention",
        line: `Le compte encaisse mais ne peut pas encore recevoir de virements ` +
              `(payouts_enabled = false). Les ventes fonctionnent, l'argent reste chez Stripe.`,
      });
    }

    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-webhook`;
    const analyse = analyserEndpointsWebhook(
      endpoints.data as unknown as EndpointStripe[],
      url,
      {
        keyMode,
        // Sa présence seulement, jamais sa valeur.
        secretConnectDefini: Boolean(Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET")),
      },
    );
    anomalies.push(...analyse.anomalies);
    endpointsSeen = analyse.vus;
    for (const vu of analyse.vus) {
      logEvent("monitor_webhook_config", {
        endpoint_id: vu.id, type: vu.type, mode: vu.mode, actif: vu.actif,
        events: vu.evenements, missing: (vu.manquants as string[]).length,
      });
    }
  } catch (err) {
    logEvent("monitor_webhook_check_failed", { message: redactSecrets((err as Error)?.message) });
  }

  /* --- 8. Économie du mois en cours ------------------------------------
   *
   * Le barème de lancement (5 % + 0,70 €) est assumé comme légèrement
   * déficitaire sur les petites ventes. Assumé ne veut pas dire ignoré : on
   * mesure l'écart réel entre ce que la Protection acheteurs rapporte et ce
   * que Stripe prélève, et on alerte au-delà du seuil convenu.
   *
   * Les frais ne sont pas recalculés depuis un barème recopié — un barème
   * recopié vieillit et ment. On lit les transactions de solde, où Stripe
   * inscrit ce qu'il a réellement pris : commission de paiement, frais de
   * versement Connect, abonnement mensuel par compte connecté, litiges.
   */
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    let feesCents = 0;
    let page = await stripe.balanceTransactions.list({
      created: { gte: Math.floor(monthStart.getTime() / 1000) },
      limit: 100,
    });
    for (;;) {
      for (const tx of page.data) feesCents += tx.fee ?? 0;
      if (!page.has_more) break;
      page = await stripe.balanceTransactions.list({
        created: { gte: Math.floor(monthStart.getTime() / 1000) },
        limit: 100,
        starting_after: page.data[page.data.length - 1].id,
      });
    }

    const month = monthStart.toISOString().slice(0, 10);
    const { data: revenue } = await admin.rpc("monthly_protection_revenue", { p_month: month });
    const line = (Array.isArray(revenue) ? revenue[0] : revenue) ?? {};
    const protectionCents = Number(line.protection_cents ?? 0);
    const ordersCount = Number(line.orders_count ?? 0);

    const { count: connected } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("stripe_onboarded", true);

    const { data: recorded } = await admin.rpc("record_monthly_economics", {
      p_month: month,
      p_protection_cents: protectionCents,
      p_stripe_fees_cents: feesCents,
      p_orders_count: ordersCount,
      p_connected_accounts: connected ?? 0,
    });

    const result = (recorded ?? {}) as Record<string, unknown>;
    const net = Number(result.net_cents ?? 0);
    logEvent("monitor_economics", {
      month, protection_cents: protectionCents, stripe_fees_cents: feesCents, net_cents: net,
    });

    if (result.alerter === true) {
      await sendEmail(
        ADMIN_EMAIL,
        `[Paiements] Le mois en cours coûte ${formatEuroCents(-net)} à la plateforme`,
        [
          `Mois ${month.slice(0, 7)}, arrêté à l'instant :`,
          "",
          `  Protection acheteurs encaissée : ${formatEuroCents(protectionCents)}`,
          `  Frais Stripe réellement prélevés : ${formatEuroCents(feesCents)}`,
          `  Résultat : ${formatEuroCents(net)}`,
          "",
          `  ${ordersCount} commande(s) payée(s) · ${connected ?? 0} compte(s) vendeur actif(s)`,
          "",
          `Le seuil convenu (${formatEuroCents(Number(result.seuil_cents ?? 10000))}) est franchi.`,
          "",
          "Rappel de la décision de lancement : le barème 5 % + 0,70 € est maintenu même",
          "s'il est déficitaire sur les petites ventes, et le vendeur ne paie rien. Cette",
          "alerte ne demande pas de changer le barème, seulement de savoir où en est le coût.",
          "",
          "Les postes les plus probables : l'abonnement mensuel par compte connecté, qui",
          "court même sans vente, et les paiements par carte hors zone euro.",
          "",
          "Un seul courriel est envoyé par mois.",
        ].join("\n"),
      );
    }
  } catch (err) {
    logEvent("monitor_economics_failed", { message: redactSecrets((err as Error)?.message) });
  }

  /* --- Rapport --------------------------------------------------------- */

  logEvent("monitor_run", {
    repaired: repaired.length,
    anomalies: anomalies.length,
    critical: anomalies.filter((a) => a.severity === "critique").length,
  });

  if (anomalies.length > 0) {
    const critical = anomalies.filter((a) => a.severity === "critique");
    await sendEmail(
      ADMIN_EMAIL,
      `[Paiements] ${critical.length} anomalie(s) critique(s), ${anomalies.length - critical.length} à surveiller`,
      [
        "Contrôle automatique du système de paiement.",
        "",
        critical.length ? "À TRAITER :" : "",
        ...critical.map((a) => "  - " + a.line),
        "",
        anomalies.length > critical.length ? "À SURVEILLER :" : "",
        ...anomalies.filter((a) => a.severity !== "critique").map((a) => "  - " + a.line),
        "",
        repaired.length ? "Corrigé automatiquement :" : "",
        ...repaired.map((r) => "  - " + r),
      ].filter((l) => l !== "").join("\n"),
    );
  }

  // Le détail, et pas seulement le compte. Sans cela, la seule façon de savoir
  // ce que la surveillance a trouvé est d'attendre le courriel, ce qui rend le
  // diagnostic impossible au moment où l'on en a besoin. L'endpoint n'est
  // joignable qu'avec le secret, et ces lignes ne contiennent ni clé ni
  // identifiant complet de commande.
  return json({
    ok: true,
    stripe: { mode: keyMode, compte: etatCompte, endpoints: endpointsSeen, vendeurs },
    repaired: repaired.length,
    anomalies: anomalies.length,
    details: {
      critiques: anomalies.filter((a) => a.severity === "critique").map((a) => a.line),
      a_surveiller: anomalies.filter((a) => a.severity !== "critique").map((a) => a.line),
      corrige: repaired,
    },
  }, 200);
});

function short(id: string): string {
  return String(id).slice(0, 8).toUpperCase();
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Ce que dit seller_ready_last_error, qui ne porte qu'un code neutre (la
 *  colonne est lisible par l'acheteur et le vendeur) : le détail Stripe est
 *  dans le journal de payout-release (seller_ready_refund_failed). */
function libelleEchecRemboursement(o: { seller_ready_last_error?: string | null; seller_ready_refund_attempts?: number | null }): string {
  const n = Number(o.seller_ready_refund_attempts ?? 0);
  const tentatives = n > 0 ? ` après ${n} tentative(s)` : "";
  switch (o.seller_ready_last_error) {
    case "refund_failed":
      return `Remboursement refusé par Stripe${tentatives}\u00a0; détail dans le journal de payout-release.`;
    case "refund_not_succeeded":
      return `Remboursement créé mais non abouti chez Stripe${tentatives}\u00a0; détail dans le journal de payout-release.`;
    case "no_payment":
      return "Aucun paiement Stripe rattaché à la commande\u00a0: remboursement à faire à la main.";
    default:
      return "Aucune erreur notée\u00a0: payout-release ne l'a peut-être pas traitée.";
  }
}
