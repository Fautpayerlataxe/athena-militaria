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
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Stripe from "stripe";

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
