/**
 * La traduction des erreurs techniques.
 *
 * Ce qui est vérifié ici n'est pas cosmétique : chaque cas correspond à un
 * message que le site montrait réellement à l'utilisateur, avec le nom des
 * tables et des contraintes dedans.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/* Le fichier est chargé comme le fait un navigateur : évalué tel quel contre un
 * objet global, sans passer par le système de modules. C'est le fichier
 * exactement servi au visiteur qui est mis à l'épreuve, pas une variante
 * adaptée aux tests. */
const source = readFileSync(new URL("../error-messages.js", import.meta.url), "utf8");
const faux: Record<string, any> = { console: { warn() {} } };
faux.window = faux;
vm.createContext(faux);
vm.runInContext(source, faux);

const cleErreur = faux.cleErreur as (e: unknown) => string;
const messageErreur = faux.messageErreur as (e: unknown, k?: string) => string;

test("le fichier s'installe bien sur l'objet global du navigateur", () => {
  assert.equal(typeof cleErreur, "function");
  assert.equal(typeof messageErreur, "function");
});

describe("reconnaître une erreur par son code", () => {
  const cas: Array<[string, string, string]> = [
    ["23505", "err.deja_existant", "annonce créée deux fois"],
    ["23503", "err.element_lie", "suppression d'un objet encore référencé"],
    ["23514", "err.valeur_refusee", "prix négatif refusé par une contrainte"],
    ["23502", "err.champ_manquant", "colonne obligatoire laissée vide"],
    ["22P02", "err.valeur_invalide", "texte envoyé là où un nombre est attendu"],
    ["42501", "err.droits_insuffisants", "droit refusé sur une fonction"],
    ["40P01", "err.reessayer", "interblocage entre deux transactions"],
    ["PGRST301", "err.session_expiree", "jeton expiré côté PostgREST"],
    ["PGRST116", "err.introuvable", "aucune ligne renvoyée"],
  ];

  for (const [code, attendu, contexte] of cas) {
    test(`${code} : ${contexte}`, () => {
      assert.equal(cleErreur({ code, message: "peu importe" }), attendu);
    });
  }
});

describe("reconnaître une erreur à son texte, quand le code manque", () => {
  const cas: Array<[string, string]> = [
    ['new row violates row-level security policy for table "products"', "err.droits_insuffisants"],
    ["permission denied for function order_confirm_receipt", "err.droits_insuffisants"],
    ['duplicate key value violates unique constraint "products_pkey"', "err.deja_existant"],
    ['update or delete on table "products" violates foreign key constraint', "err.element_lie"],
    ['new row for relation "orders" violates check constraint "orders_seller_amount_check"', "err.valeur_refusee"],
    ['null value in column "title" violates not-null constraint', "err.champ_manquant"],
    ["JWT expired", "err.session_expiree"],
    ["TypeError: Failed to fetch", "err.reseau"],
    ["canceling statement due to statement timeout", "err.trop_long"],
  ];

  for (const [message, attendu] of cas) {
    test(message.slice(0, 52), () => {
      assert.equal(cleErreur({ message }), attendu);
    });
  }
});

describe("ne jamais laisser passer le message brut", () => {
  test("une erreur inconnue retombe sur une phrase générique", () => {
    assert.equal(cleErreur({ message: "quelque chose d'imprévu" }), "err.generique");
  });

  test("null, undefined et une chaîne nue sont acceptés sans planter", () => {
    assert.equal(cleErreur(null), "err.generique");
    assert.equal(cleErreur(undefined), "err.generique");
    assert.equal(cleErreur("Failed to fetch"), "err.reseau");
  });

  test("le message rendu ne contient jamais le détail technique", () => {
    const brut = 'new row violates row-level security policy for table "products"';
    const affiche = messageErreur({ message: brut });

    assert.doesNotMatch(affiche, /row-level|policy|products|violates/i,
      "le nom des tables et des politiques ne doit jamais atteindre l'écran");
    assert.ok(affiche.length > 10, "le message doit rester une vraie phrase");
  });

  test("sans traduction chargée, une phrase française reste affichée", () => {
    // Cas du chargement partiel : i18n.js pas encore exécuté. Montrer une clé
    // comme « err.generique » à un acheteur serait pire que le message brut.
    const affiche = messageErreur({ code: "23505" });
    assert.doesNotMatch(affiche, /^err\./, "une clé de traduction ne doit jamais s'afficher");
  });

  test("un appelant peut proposer une phrase plus précise pour son écran", () => {
    // La clé de secours ne sert que si l'erreur n'est pas reconnue : une
    // erreur identifiée donne toujours un message plus utile.
    assert.equal(cleErreur({ code: "23505" }), "err.deja_existant");
    const inconnue = messageErreur({ message: "???" }, "tr_js_account.delete_failed");
    assert.ok(inconnue.length > 0);
  });
});

describe("codes HTTP nus renvoyés par Supabase", () => {
  const cas: Array<[string, string]> = [
    ["401", "err.session_expiree"],
    ["403", "err.session_expiree"],
    ["404", "err.introuvable"],
    ["409", "err.deja_existant"],
    ["413", "err.fichier_trop_gros"],
    ["429", "err.trop_de_demandes"],
    ["503", "err.indisponible"],
  ];
  for (const [code, attendu] of cas) {
    test(`HTTP ${code}`, () => {
      assert.equal(cleErreur({ status: Number(code) }), attendu);
    });
  }
});
