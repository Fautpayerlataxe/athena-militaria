/**
 * Veille du site : quand écrire, et quoi.
 *
 * Une alerte qui part au premier hoquet réseau, ou qui se répète toutes les
 * dix minutes pendant une panne, finit ignorée ; une alerte qui ne part
 * jamais ne sert à rien. Ces contrôles fixent la règle : un courriel au
 * deuxième échec de suite, aucun pendant la panne, un au retour.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decider, duree, SEUIL_ALERTE, type Controle, type EtatVeille } from "../supabase/functions/veille-site/veille.ts";

const OK: Controle[] = [{ url: "https://www.athenamilitaria.fr/", ok: true, detail: "200" }];
const KO: Controle[] = [{ url: "https://www.athenamilitaria.fr/", ok: false, detail: "réponse 503" }];
const SAIN: EtatVeille = { echecs_consecutifs: 0, en_panne: false, panne_depuis: null };
const T0 = new Date("2026-10-10T10:00:00Z");
const plus = (min: number) => new Date(T0.getTime() + min * 60000);

describe("la veille du site", () => {
  test("site sain : rien à dire", () => {
    const d = decider(SAIN, OK, T0);
    assert.equal(d.courriel, null);
    assert.deepEqual(d.etat, SAIN);
  });

  test("un seul échec : pas encore d'alerte", () => {
    const d = decider(SAIN, KO, T0);
    assert.equal(SEUIL_ALERTE, 2);
    assert.equal(d.courriel, null);
    assert.equal(d.etat.echecs_consecutifs, 1);
    assert.equal(d.etat.en_panne, false);
  });

  test("deuxième échec de suite : une alerte, datée du premier échec", () => {
    const d1 = decider(SAIN, KO, T0);
    const d2 = decider(d1.etat, KO, plus(10));
    assert.ok(d2.courriel);
    assert.equal(d2.courriel!.sujet, "[Veille] Le site ne répond plus");
    assert.match(d2.courriel!.corps, /réponse 503/);
    assert.equal(d2.etat.en_panne, true);
    assert.equal(d2.etat.panne_depuis, T0.toISOString());
  });

  test("pendant la panne : aucun courriel de plus", () => {
    let e = decider(decider(SAIN, KO, T0).etat, KO, plus(10)).etat;
    for (let i = 2; i < 10; i++) {
      const d = decider(e, KO, plus(10 * i));
      assert.equal(d.courriel, null);
      e = d.etat;
    }
    assert.equal(e.en_panne, true);
  });

  test("retour : un courriel avec la durée, puis l'état est remis à zéro", () => {
    const e = decider(decider(SAIN, KO, T0).etat, KO, plus(10)).etat;
    const d = decider(e, OK, plus(135));
    assert.equal(d.courriel!.sujet, "[Veille] Le site répond de nouveau");
    assert.match(d.courriel!.corps, /2 h 15 min/);
    assert.deepEqual(d.etat, SAIN);
  });

  test("un échec isolé suivi d'un succès ne déclenche rien", () => {
    const d = decider(decider(SAIN, KO, T0).etat, OK, plus(10));
    assert.equal(d.courriel, null);
    assert.deepEqual(d.etat, SAIN);
  });

  test("durées lisibles", () => {
    assert.equal(duree(T0.toISOString(), plus(35)), "35 min");
    assert.equal(duree(null, T0), "une durée inconnue");
  });

  test("textes : vouvoiement implicite, aucun tiret cadratin, espaces insécables avant les deux-points", () => {
    const e = decider(decider(SAIN, KO, T0).etat, KO, plus(10));
    const r = decider(e.etat, OK, plus(30));
    for (const c of [e.courriel!, r.courriel!]) {
      assert.doesNotMatch(c.corps + c.sujet, /—|–/);
      assert.doesNotMatch(c.corps, /\btu\b|\bton\b|\btes\b/i);
      assert.doesNotMatch(c.corps.replace(/https?:\/\/\S+/g, ""), / :/);
    }
  });
});

describe("la tâche planifiée", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261010000100_veille_site.sql", import.meta.url), "utf8");
  test("toutes les dix minutes, avec le secret du coffre", () => {
    assert.match(sql, /'veille-site',\s*'\*\/10 \* \* \* \*'/);
    assert.match(sql, /'x-cron-secret', public\.payments_cron_secret\(\)/);
  });
  test("l'état n'est lisible par personne d'autre que la fonction", () => {
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(sql, /CREATE POLICY/);
  });
});
