/**
 * Vérification de signature Stripe : cryptographie réelle, pas de simulacre.
 *
 * Ces tests utilisent le SDK Stripe dans la version exacte que chargent les
 * fonctions edge (14.21.0) et signent les charges utiles avec le vrai schéma
 * documenté par Stripe : HMAC-SHA256 sur `timestamp.payload`, en-tête
 * `t=…,v1=…`. Aucun appel réseau n'est nécessaire : la vérification de
 * signature est purement locale, c'est précisément ce qui la rend testable
 * sans clé de compte.
 *
 * Ce qui est réellement démontré ici :
 *   - une charge utile authentique est acceptée
 *   - un corps modifié d'un seul caractère est rejeté
 *   - une signature produite avec un autre secret est rejetée
 *   - un horodatage trop ancien est rejeté (protection contre le rejeu)
 *   - la rotation de secret est gérée (deux signatures dans l'en-tête)
 *   - la vérification porte bien sur le corps BRUT
 *   - les deux destinations (plateforme et comptes connectés) sont acceptées,
 *     chacune avec son secret, et chacune seulement pour ce qui la concerne
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import {
  stripeKeyMode,
  trierEvenementWebhook,
  verifierSignatureWebhook,
} from "../supabase/functions/_shared/payments.ts";

const stripe = new Stripe("sk_test_000000000000000000000000", { apiVersion: "2023-10-16" });

/** Secrets de test générés localement : ce ne sont pas des secrets Stripe. */
const SECRET = "whsec_" + "0".repeat(32);
const OTHER_SECRET = "whsec_" + "1".repeat(32);

const EVENT = {
  id: "evt_test_signature",
  object: "event",
  api_version: "2023-10-16",
  livemode: false,
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_sig", payment_status: "paid", client_reference_id: "order-1" } },
};

/** Construit l'en-tête Stripe-Signature exactement comme Stripe le fait. */
function sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("signature des webhooks", () => {
  test("une charge utile authentique est acceptée et correctement décodée", () => {
    const payload = JSON.stringify(EVENT);
    const event = stripe.webhooks.constructEvent(payload, sign(payload, SECRET), SECRET);
    assert.equal(event.id, "evt_test_signature");
    assert.equal(event.type, "checkout.session.completed");
    assert.equal(event.livemode, false);
  });

  test("un corps modifié d'un seul caractère est rejeté", () => {
    const payload = JSON.stringify(EVENT);
    const header = sign(payload, SECRET);

    // Le montant est le champ qu'un attaquant voudrait changer.
    const tampered = payload.replace('"payment_status":"paid"', '"payment_status":"paid" ');
    assert.notEqual(tampered, payload);

    assert.throws(
      () => stripe.webhooks.constructEvent(tampered, header, SECRET),
      /No signatures found matching the expected signature/,
    );
  });

  test("une signature forgée avec un autre secret est rejetée", () => {
    const payload = JSON.stringify(EVENT);
    assert.throws(
      () => stripe.webhooks.constructEvent(payload, sign(payload, OTHER_SECRET), SECRET),
      /No signatures found matching the expected signature/,
    );
  });

  test("un en-tête absent ou vide est rejeté", () => {
    const payload = JSON.stringify(EVENT);
    for (const header of ["", "t=1,v1=deadbeef", "n'importe quoi"]) {
      assert.throws(() => stripe.webhooks.constructEvent(payload, header, SECRET));
    }
  });

  test("un horodatage trop ancien est rejeté : protection contre le rejeu", () => {
    const payload = JSON.stringify(EVENT);
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.throws(
      () => stripe.webhooks.constructEvent(payload, sign(payload, SECRET, old), SECRET, 300),
      /Timestamp outside the tolerance zone/,
    );
    // La même charge utile, horodatée maintenant, passe : c'est bien l'âge qui
    // est refusé, pas le contenu.
    stripe.webhooks.constructEvent(payload, sign(payload, SECRET), SECRET, 300);
  });

  test("la rotation de secret est gérée : deux signatures, une seule doit correspondre", () => {
    // Stripe émet une signature par secret actif pendant les 24 h de rotation.
    const payload = JSON.stringify(EVENT);
    const timestamp = Math.floor(Date.now() / 1000);
    const v1a = createHmac("sha256", OTHER_SECRET).update(`${timestamp}.${payload}`).digest("hex");
    const v1b = createHmac("sha256", SECRET).update(`${timestamp}.${payload}`).digest("hex");
    const header = `t=${timestamp},v1=${v1a},v1=${v1b}`;

    const event = stripe.webhooks.constructEvent(payload, header, SECRET);
    assert.equal(event.id, "evt_test_signature");
  });

  test("la vérification porte sur le corps brut : reformater le JSON invalide la signature", () => {
    // C'est l'erreur classique : parser puis re-sérialiser avant de vérifier.
    const raw = JSON.stringify(EVENT);
    const header = sign(raw, SECRET);
    const reserialised = JSON.stringify(JSON.parse(raw), null, 2);

    assert.throws(
      () => stripe.webhooks.constructEvent(reserialised, header, SECRET),
      /No signatures found matching the expected signature/,
      "le webhook doit lire req.text() et jamais un objet déjà désérialisé",
    );
  });

  test("la version asynchrone utilisée par les fonctions edge se comporte identiquement", async () => {
    const payload = JSON.stringify(EVENT);
    const event = await stripe.webhooks.constructEventAsync(payload, sign(payload, SECRET), SECRET);
    assert.equal(event.id, "evt_test_signature");

    await assert.rejects(
      () => stripe.webhooks.constructEventAsync(payload, sign(payload, OTHER_SECRET), SECRET),
      /No signatures found/,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  Le webhook ne doit pas se laisser abuser par un environnement croisé
 * ------------------------------------------------------------------ */

describe("cohérence test / production", () => {
  test("un événement live signé correctement reste refusé par un backend de test", async () => {
    const { environmentMatches, stripeKeyMode } = await import("../supabase/functions/_shared/payments.ts");

    // Signature valide : l'authenticité n'est pas en cause. C'est l'origine
    // d'environnement qui l'est, et la signature ne la prouve pas.
    const liveEvent = { ...EVENT, livemode: true };
    const payload = JSON.stringify(liveEvent);
    const event = stripe.webhooks.constructEvent(payload, sign(payload, SECRET), SECRET);
    assert.equal(event.livemode, true);

    assert.equal(environmentMatches(stripeKeyMode("sk_test_abc"), event.livemode), false);
    assert.equal(environmentMatches(stripeKeyMode("sk_live_abc"), event.livemode), true);
  });
});

/* ------------------------------------------------------------------ *
 *  Deux destinations, deux secrets
 *
 *  Les account.updated des vendeurs n'arrivent que par la destination
 *  « comptes connectés », qui signe avec son propre secret. Avec un seul
 *  secret, ils étaient tous refusés et aucun vendeur ne devenait prêt.
 * ------------------------------------------------------------------ */

describe("signature à deux secrets", () => {
  /** Secrets inventés, comme plus haut : 2 pour la plateforme, 3 pour Connect. */
  const PLATEFORME = "whsec_" + "2".repeat(32);
  const CONNECT = "whsec_" + "3".repeat(32);
  const INCONNU = "whsec_" + "4".repeat(32);

  const evenementPlateforme = { ...EVENT, id: "evt_plateforme" };
  const evenementConnect = {
    ...EVENT,
    id: "evt_connect",
    type: "account.updated",
    account: "acct_vendeur",
    data: { object: { id: "acct_vendeur", charges_enabled: true, details_submitted: true, payouts_enabled: true } },
  };

  /** Le vérificateur exact de stripe-webhook : le SDK, sur le corps brut. */
  const verifier = (payload: string, header: string) =>
    (secret: string) => stripe.webhooks.constructEventAsync(payload, header, secret);

  test("un événement de la plateforme passe sur le secret de la plateforme", async () => {
    const payload = JSON.stringify(evenementPlateforme);
    const r = await verifierSignatureWebhook(verifier(payload, sign(payload, PLATEFORME)), {
      plateforme: PLATEFORME, connect: CONNECT,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.source, "plateforme");
    assert.equal(r.event.id, "evt_plateforme");
  });

  test("un événement d'un compte connecté passe sur le secret Connect", async () => {
    const payload = JSON.stringify(evenementConnect);
    const r = await verifierSignatureWebhook(verifier(payload, sign(payload, CONNECT)), {
      plateforme: PLATEFORME, connect: CONNECT,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.source, "connect", "le journal doit dire quelle destination a livré l'événement");
    assert.equal(r.event.account, "acct_vendeur");
  });

  test("signé par aucun des deux : refusé (le webhook répond 400)", async () => {
    const payload = JSON.stringify(evenementConnect);
    const r = await verifierSignatureWebhook(verifier(payload, sign(payload, INCONNU)), {
      plateforme: PLATEFORME, connect: CONNECT,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /No signatures found/);
    assert.doesNotMatch(r.message, /whsec_/, "aucun secret ne doit apparaître dans le motif journalisé");
  });

  test("sans secret Connect, le comportement est l'ancien : un seul secret essayé", async () => {
    const payload = JSON.stringify(evenementConnect);
    const essayes: string[] = [];
    const r = await verifierSignatureWebhook((secret) => {
      essayes.push(secret);
      return stripe.webhooks.constructEventAsync(payload, sign(payload, CONNECT), secret);
    }, { plateforme: PLATEFORME, connect: undefined });
    assert.equal(r.ok, false);
    assert.deepEqual(essayes, [PLATEFORME]);

    // Et la plateforme passe exactement comme avant.
    const p = JSON.stringify(evenementPlateforme);
    const ok = await verifierSignatureWebhook(verifier(p, sign(p, PLATEFORME)), { plateforme: PLATEFORME });
    assert.equal(ok.ok && ok.source, "plateforme");
  });

  test("le secret de la plateforme est toujours essayé en premier", async () => {
    const payload = JSON.stringify(evenementPlateforme);
    const essayes: string[] = [];
    await verifierSignatureWebhook((secret) => {
      essayes.push(secret);
      return stripe.webhooks.constructEventAsync(payload, sign(payload, PLATEFORME), secret);
    }, { plateforme: PLATEFORME, connect: CONNECT });
    assert.deepEqual(essayes, [PLATEFORME], "un événement de la plateforme ne doit jamais être attribué à Connect");
  });

  test("le même secret collé deux fois n'est essayé qu'une fois, au titre de la plateforme", async () => {
    const payload = JSON.stringify(evenementConnect);
    const essayes: string[] = [];
    const r = await verifierSignatureWebhook((secret) => {
      essayes.push(secret);
      return stripe.webhooks.constructEventAsync(payload, sign(payload, PLATEFORME), secret);
    }, { plateforme: PLATEFORME, connect: PLATEFORME });
    assert.equal(r.ok && r.source, "plateforme");
    assert.equal(essayes.length, 1);
  });

  test("aucun secret configuré : tout est refusé", async () => {
    const payload = JSON.stringify(evenementPlateforme);
    const r = await verifierSignatureWebhook(verifier(payload, sign(payload, PLATEFORME)), {});
    assert.equal(r.ok, false);
  });

  test("seul le secret Connect est défini : la plateforme est refusée, Connect passe", async () => {
    // Cas d'un STRIPE_WEBHOOK_SECRET effacé par erreur : la plateforme doit
    // échouer bruyamment, pas être acceptée par l'autre porte.
    const p = JSON.stringify(evenementPlateforme);
    const plateforme = await verifierSignatureWebhook(verifier(p, sign(p, PLATEFORME)), { connect: CONNECT });
    assert.equal(plateforme.ok, false);

    const c = JSON.stringify(evenementConnect);
    const connect = await verifierSignatureWebhook(verifier(c, sign(c, CONNECT)), { connect: CONNECT });
    assert.equal(connect.ok && connect.source, "connect");
  });
});

describe("ce qu'on accepte sur le secret Connect", () => {
  test("account.updated d'un compte connecté : traité", () => {
    assert.deepEqual(
      trierEvenementWebhook("connect", { type: "account.updated", account: "acct_1", livemode: true }, "live"),
      { decision: "traiter" },
    );
  });

  test("un événement sans compte connecté est refusé : les secrets sont intervertis", () => {
    // Un paiement signé avec le secret Connect : l'acquitter le ferait
    // disparaître, le traiter le ferait passer par la mauvaise porte. Refusé,
    // Stripe le relivrera une fois les secrets remis dans l'ordre.
    for (const type of ["checkout.session.completed", "charge.refunded", "account.updated"]) {
      const tri = trierEvenementWebhook("connect", { type, account: null, livemode: true }, "live");
      assert.equal(tri.decision, "refuser", type);
      if (tri.decision === "refuser") assert.match(tri.motif, /intervertis/);
    }
    assert.equal(trierEvenementWebhook("connect", { type: "account.updated" }, "live").decision, "refuser");
    assert.equal(
      trierEvenementWebhook("connect", { type: "account.updated", account: "" }, "live").decision, "refuser");
  });

  test("un autre type venant d'un compte connecté est acquitté sans traitement", () => {
    // Le refuser ferait réessayer Stripe trois jours, puis désactiver la
    // destination, pour un événement dont le code ne fait rien.
    for (const type of ["checkout.session.completed", "payout.paid", "capability.updated", ""]) {
      const tri = trierEvenementWebhook("connect", { type, account: "acct_1", livemode: true }, "live");
      assert.equal(tri.decision, "ignorer", type || "type vide");
    }
  });

  test("sur le secret de la plateforme, rien ne change : tout passe au routage habituel", () => {
    for (const ev of [
      { type: "checkout.session.completed" },
      { type: "account.updated" },
      { type: "account.updated", account: "acct_1" },
      { type: "invoice.paid" },
    ]) {
      assert.equal(trierEvenementWebhook("plateforme", ev, "live").decision, "traiter", ev.type);
    }
  });

  test("bout en bout : un paiement signé avec le secret Connect est authentique mais refusé", async () => {
    const PLATEFORME = "whsec_" + "5".repeat(32);
    const CONNECT = "whsec_" + "6".repeat(32);
    const payload = JSON.stringify({ ...EVENT, id: "evt_croise" });
    const r = await verifierSignatureWebhook(
      (secret) => stripe.webhooks.constructEventAsync(payload, sign(payload, CONNECT), secret),
      { plateforme: PLATEFORME, connect: CONNECT },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.source, "connect");
    assert.equal(
      trierEvenementWebhook(r.source, r.event as { type?: string; account?: string; livemode?: boolean }, "test")
        .decision,
      "refuser");
  });

  test("un événement de test d'un compte connecté, clé live : acquitté, jamais refusé", () => {
    // Stripe livre aussi les événements de test des comptes connectés à la
    // destination Connect de production. Un 400 ferait réessayer Stripe trois
    // jours, puis désactiver la destination dont dépend l'inscription.
    const tri = trierEvenementWebhook(
      "connect", { type: "account.updated", account: "acct_test_1", livemode: false }, "live");
    assert.equal(tri.decision, "ignorer");
    if (tri.decision === "ignorer") assert.match(tri.motif, /de test/);

    // L'inverse aussi : clé de test remise par erreur, événement live.
    assert.equal(
      trierEvenementWebhook("connect", { type: "account.updated", account: "acct_1", livemode: true }, "test")
        .decision,
      "ignorer");

    // Clé illisible : on ne sait pas trancher, on traite comme avant.
    assert.equal(
      trierEvenementWebhook("connect", { type: "account.updated", account: "acct_1", livemode: false }, "unknown")
        .decision,
      "traiter");
  });

  test("sur le secret de la plateforme, le mode n'est pas tranché par le tri (le webhook garde son 400)", () => {
    // Pour l'argent, un événement d'un autre mode reste refusé plus loin, par
    // environmentMatches : le tri ne doit pas l'acquitter à sa place.
    assert.equal(
      trierEvenementWebhook("plateforme", { type: "checkout.session.completed", livemode: false }, "live").decision,
      "traiter");
  });

  test("format « léger » (v2.core.event) : refusé avec un motif qui dit quoi corriger", () => {
    // Une destination créée au format léger livre une charge utile sans
    // event.account : sans ce cas, le motif serait « secrets intervertis ».
    const leger = {
      id: "evt_leger", object: "v2.core.event", type: "v1.account.updated", livemode: true,
      context: "acct_vendeur", related_object: { id: "acct_vendeur", type: "account" },
    };
    const tri = trierEvenementWebhook("connect", leger, "live");
    assert.equal(tri.decision, "refuser");
    if (tri.decision === "refuser") {
      assert.match(tri.motif, /léger/);
      assert.match(tri.motif, /instantané/);
      assert.doesNotMatch(tri.motif, /intervertis/);
      assert.doesNotMatch(tri.motif, /—/);
    }
  });

  test("bout en bout : un account.updated de test, signé avec le secret Connect, passe puis est acquitté", async () => {
    const PLATEFORME = "whsec_" + "7".repeat(32);
    const CONNECT = "whsec_" + "8".repeat(32);
    const payload = JSON.stringify({
      ...EVENT, id: "evt_connect_test", type: "account.updated", account: "acct_essai", livemode: false,
      data: { object: { id: "acct_essai" } },
    });
    const r = await verifierSignatureWebhook(
      (secret) => stripe.webhooks.constructEventAsync(payload, sign(payload, CONNECT), secret),
      { plateforme: PLATEFORME, connect: CONNECT },
    );
    assert.equal(r.ok && r.source, "connect");
    if (!r.ok) return;
    const tri = trierEvenementWebhook(
      r.source, r.event as { type?: string; account?: string; livemode?: boolean }, stripeKeyMode("sk_live_abc"));
    assert.equal(tri.decision, "ignorer");
  });

  test("stripe-webhook branche bien les deux secrets et les trois issues", () => {
    // Les fonctions ci-dessus ne protègent la production que si le webhook
    // les appelle, avec les bons noms de secrets et les bons codes HTTP.
    const source = readFileSync(
      new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.match(source, /verifierSignatureWebhook\(/);
    assert.match(source, /plateforme: Deno\.env\.get\("STRIPE_WEBHOOK_SECRET"\)/);
    assert.match(source, /connect: Deno\.env\.get\("STRIPE_CONNECT_WEBHOOK_SECRET"\)/);
    assert.match(source, /!verification\.ok\)[\s\S]*?respond\(400/);
    assert.match(source, /tri\.decision === "refuser"\)[\s\S]*?respond\(400/);
    assert.match(source, /tri\.decision === "ignorer"\)[\s\S]*?respond\(200/);
    // Le tri connaît le mode de la clé, et passe avant le refus pour mode
    // différent : sinon les événements de test des comptes connectés
    // seraient refusés en 400 avant d'être acquittés.
    assert.match(source, /trierEvenementWebhook\([\s\S]*?KEY_MODE,?\s*\)/);
    const tri = source.indexOf("trierEvenementWebhook(");
    const environnement = source.indexOf("environmentMatches(KEY_MODE");
    assert.ok(tri > 0 && environnement > 0 && tri < environnement,
      "le tri doit précéder le contrôle d'environnement");
    assert.match(source, /environmentMatches\(KEY_MODE[\s\S]*?respond\(400/);
    // Le nom du secret est journalisé, jamais sa valeur.
    assert.match(source, /secret: source/);
    assert.doesNotMatch(source, /logEvent\([^)]*Deno\.env\.get\("STRIPE_(CONNECT_)?WEBHOOK_SECRET"\)/);
  });
});
