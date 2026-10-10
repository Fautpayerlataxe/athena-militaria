/**
 * Statut d'une annonce : « vendu » et « retiré » ne s'écrivent pas depuis
 * un compte de vendeur (audit du 10 oct. 2026, CODE-09 et CODE-10).
 *
 * Ce qui est vérifié ici, sans base :
 *
 *   - la migration 20261010000300_statut_annonce_garde.sql : déclencheur
 *     BEFORE INSERT OR UPDATE OF status, rejouable, SECURITY INVOKER avec un
 *     search_path figé, les deux règles (entrée en 'sold', sortie de
 *     'removed') et le message, l'exception pour l'administration reconnue
 *     exactement comme products_garde_authenticite ;
 *   - que tout ce qui pose 'sold' dans l'historique des migrations passe la
 *     garde (fonction SECURITY DEFINER, donc current_user = propriétaire),
 *     et qu'aucune fonction edge n'écrit products.status elle-même ;
 *   - que l'erreur renvoyée (42501) devient un message lisible sur le site ;
 *   - que la fenêtre « Modifier l'annonce » (account.js) n'offre plus
 *     « Vendu », propose « Retirée de la vente », et fige le statut d'une
 *     annonce déjà vendue ou retirée ;
 *   - les libellés, en français et en anglais.
 *
 * Le comportement réel, sur PostgreSQL, est dans
 * tests/db-statut-annonce.test.ts (npm run test:db).
 *
 * Lancement : npm run test:unit
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const racine = new URL("..", import.meta.url).pathname;
const lire = (chemin: string) => readFileSync(join(racine, chemin), "utf8");
const sansCommentairesSql = (sql: string) => sql.replace(/--[^\n]*/g, "");

const NOM = "20261010000300_statut_annonce_garde.sql";
const migration = lire(join("supabase", "migrations", NOM));
const code = sansCommentairesSql(migration);

/** Corps d'une fonction plpgsql, entre ses $$. */
function corps(sql: string, fonction: string): string {
  const debut = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fonction}(`);
  assert.notEqual(debut, -1, `${fonction} introuvable`);
  const a = sql.indexOf("$$", debut);
  const b = sql.indexOf("$$", a + 2);
  return sql.slice(debut, b + 2);
}
const normaliser = (s: string) => s.replace(/\s+/g, " ").trim();

describe("la migration", () => {
  const garde = corps(code, "products_garde_statut");

  test("déclencheur BEFORE INSERT OR UPDATE OF status sur public.products, une fois par ligne", () => {
    assert.match(
      code,
      /CREATE TRIGGER products_garde_statut\s+BEFORE INSERT OR UPDATE OF status ON public\.products\s+FOR EACH ROW EXECUTE FUNCTION public\.products_garde_statut\(\);/,
    );
  });

  test("rejouable : CREATE OR REPLACE, et DROP TRIGGER IF EXISTS avant la création", () => {
    assert.match(code, /CREATE OR REPLACE FUNCTION public\.products_garde_statut\(\)/);
    const drop = code.indexOf("DROP TRIGGER IF EXISTS products_garde_statut ON public.products;");
    const cree = code.indexOf("CREATE TRIGGER products_garde_statut");
    assert.notEqual(drop, -1);
    assert.ok(drop < cree, "le DROP doit précéder le CREATE");
    // Rien qui échouerait à la seconde exécution.
    assert.doesNotMatch(code, /CREATE TRIGGER(?! products_garde_statut)/);
    assert.doesNotMatch(code, /CREATE FUNCTION/);
  });

  test("SECURITY INVOKER, search_path figé, jamais SECURITY DEFINER", () => {
    // Dans une fonction SECURITY DEFINER, current_user vaut le propriétaire
    // (postgres) : la garde laisserait tout passer (20261005000100).
    assert.match(garde, /SECURITY INVOKER/);
    assert.doesNotMatch(code, /SECURITY DEFINER/);
    assert.match(garde, /SET search_path = public/);
    assert.match(garde, /RETURNS trigger/);
  });

  test("l'administration est reconnue exactement comme products_garde_authenticite", () => {
    const authenticite = sansCommentairesSql(lire("supabase/migrations/20261005000000_authenticite.sql"));
    const reference = /v_admin := ([\s\S]*?);/.exec(corps(authenticite, "products_garde_authenticite"));
    const ici = /v_admin := ([\s\S]*?);/.exec(garde);
    assert.ok(reference && ici);
    assert.equal(normaliser(ici[1]), normaliser(reference[1]));
    // postgres (éditeur SQL, fonctions SECURITY DEFINER), service_role (clé
    // de service), supabase_admin, et les deux adresses d'administrateur.
    for (const attendu of ["'postgres'", "'service_role'", "'supabase_admin'", "sayrox.ar@gmail.com", "renduambroise@gmail.com"]) {
      assert.ok(ici[1].includes(attendu), attendu);
    }
  });

  test("l'administration passe avant toute règle", () => {
    const sortie = garde.indexOf("IF v_admin THEN");
    assert.notEqual(sortie, -1);
    assert.match(garde.slice(sortie), /^IF v_admin THEN\s+RETURN NEW;\s+END IF;/);
    assert.ok(sortie < garde.indexOf("RAISE EXCEPTION"));
  });

  test("règle 1 : l'entrée en 'sold' est refusée, à la création comme à la modification", () => {
    assert.match(
      garde,
      /IF NEW\.status = 'sold'\s+AND \(TG_OP = 'INSERT' OR OLD\.status IS DISTINCT FROM 'sold'\) THEN\s+RAISE EXCEPTION '[^']*vendu[^']*'\s+USING ERRCODE = 'insufficient_privilege'/,
    );
  });

  test("règle 2 : la sortie de 'removed' est refusée", () => {
    assert.match(
      garde,
      /IF TG_OP = 'UPDATE'\s+AND OLD\.status = 'removed'\s+AND NEW\.status IS DISTINCT FROM 'removed' THEN\s+RAISE EXCEPTION '[^']*modération[^']*'\s+USING ERRCODE = 'insufficient_privilege'/,
    );
  });

  test("rien d'autre n'est refusé : publier, passer en brouillon, garder son statut", () => {
    assert.equal((garde.match(/RAISE EXCEPTION/g) || []).length, 2);
    // Un statut renvoyé inchangé n'est pas un passage : la fenêtre de
    // modification renvoie toujours le statut.
    assert.match(garde, /OLD\.status IS DISTINCT FROM 'sold'/);
    assert.match(garde, /NEW\.status IS DISTINCT FROM 'removed'/);
  });

  test("messages en français, typographie française, sans tiret cadratin", () => {
    const messages = [...migration.matchAll(/(?:RAISE EXCEPTION|HINT =) '((?:[^']|'')*)'/g)].map((m) => m[1]);
    assert.equal(messages.length, 4);
    for (const m of messages) {
      assert.doesNotMatch(m, /—/);
      assert.doesNotMatch(m, / [:;?!»]/, `espace ordinaire devant la ponctuation : ${m}`);
      assert.doesNotMatch(m, /« /, `espace ordinaire dans les guillemets : ${m}`);
    }
  });

  test("la migration vient après celles qu'elle complète", () => {
    const fichiers = readdirSync(join(racine, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const avant of ["20260918000000_archive_des_ventes.sql", "20261005000000_authenticite.sql", "20261005000100_gardes_admin.sql"]) {
      assert.ok(fichiers.indexOf(avant) < fichiers.indexOf(NOM), avant);
    }
  });
});

describe("ce qui pose 'sold' passe la garde", () => {
  test("toute fonction qui écrit 'sold' dans products est SECURITY DEFINER", () => {
    const dossier = join(racine, "supabase", "migrations");
    let vues = 0;
    for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql") && x !== NOM)) {
      const sql = sansCommentairesSql(readFileSync(join(dossier, f), "utf8"));
      const re = /CREATE OR REPLACE FUNCTION (?:public\.)?(\w+)\([\s\S]*?\$\$([\s\S]*?)\$\$/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) {
        const entete = sql.slice(m.index, sql.indexOf("$$", m.index));
        // Clause SET de chaque UPDATE de products : 'sold' y est-il une
        // valeur écrite ? (Le remboursement le cite dans une condition,
        // « WHEN status = 'sold' THEN 'published' » : ce n'est pas une
        // entrée en 'sold'.)
        const sets = [...m[2].matchAll(/UPDATE (?:public\.)?products\b[\s\S]*?\bSET\b([\s\S]*?)(?:\bWHERE\b|;)/g)].map((x) => x[1]);
        const ecritVendu = sets.some((s) => /THEN 'sold'|status\s*=\s*'sold'(?!\s*THEN)/.test(s));
        if (!ecritVendu) continue;
        vues++;
        assert.match(entete, /SECURITY DEFINER/, `${f} : ${m[1]} pose 'sold' sans être SECURITY DEFINER`);
      }
    }
    // order_settle_payment, dans ses deux versions.
    assert.ok(vues >= 2, `attendu au moins 2 fonctions, vu ${vues}`);
  });

  test("aucune fonction edge n'écrit products.status elle-même", () => {
    const fichiers: string[] = [];
    const parcourir = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) parcourir(p);
        else if (p.endsWith(".ts")) fichiers.push(p);
      }
    };
    parcourir(join(racine, "supabase", "functions"));
    assert.ok(fichiers.length > 10);
    for (const f of fichiers) {
      const src = readFileSync(f, "utf8");
      // .from("products") suivi d'un update/upsert qui touche status.
      const re = /\.from\(["']products["']\)\s*\.(?:update|upsert)\(\s*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        assert.doesNotMatch(m[1], /\bstatus\b/, `${f} écrit products.status`);
      }
    }
  });
});

describe("le message vu par le vendeur", () => {
  test("42501 devient « droits insuffisants », jamais le texte brut", () => {
    // Comme tests/error-messages.test.ts : le script du navigateur, exécuté
    // dans un bac à sable qui tient lieu de window.
    const bac: Record<string, unknown> = {};
    vm.createContext(bac);
    vm.runInContext(lire("error-messages.js"), bac);
    const cleErreur = bac.cleErreur as (e: unknown) => string;
    assert.equal(cleErreur({ code: "42501", message: "Le statut « vendu »…" }), "err.droits_insuffisants");
  });
});

describe("la fenêtre « Modifier l'annonce » (account.js)", () => {
  const compte = lire("account.js");
  const construction = compte.slice(compte.indexOf("function buildEditListingModal()"), compte.indexOf("async function saveEditedListing("));
  const liste = construction.slice(construction.indexOf('<select id="edit-status"'), construction.indexOf("</select>", construction.indexOf('<select id="edit-status"')));
  const ouverture = compte.slice(compte.indexOf("function openEditListingModal("), compte.indexOf("function closeEditListingModal("));

  test("la liste des statuts n'offre plus « Vendu »", () => {
    assert.ok(liste.length > 0, "liste des statuts introuvable");
    assert.doesNotMatch(liste, /value="sold"/);
    assert.doesNotMatch(liste, /status_sold/);
    assert.doesNotMatch(liste, /value="removed"/);
  });

  test("elle propose « En ligne » et « Retirée de la vente », c'est-à-dire un brouillon", () => {
    // TRaOu : phrase de secours si le dictionnaire du visiteur est plus ancien.
    const options = [...liste.matchAll(/<option value="([^"]+)">\$\{TRa(?:Ou)?\("([^"]+)"[^}]*\}<\/option>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(options, [
      ["published", "tr_js_account.status_online"],
      ["draft", "tr_js_account.status_withdrawn"],
    ]);
    assert.match(construction, /id="edit-status-hint">\$\{TRaOu\("tr_js_account\.status_hint",/);
    assert.match(liste, /aria-describedby="edit-status-hint"/);
  });

  test("une annonce déjà vendue ou retirée garde son statut, affiché et figé", () => {
    assert.match(ouverture, /removed: "tr_js_account\.status_removed", sold: "tr_js_account\.status_sold"/);
    assert.match(ouverture, /statut\.disabled = !!fige;/);
    // Les options ajoutées pour l'annonce précédente sont retirées : la
    // fenêtre sert d'une annonce à l'autre.
    assert.match(ouverture, /querySelectorAll\('option\[value="removed"\], option\[value="sold"\]'\)\.forEach\(\(o\) => o\.remove\(\)\)/);
    assert.match(ouverture, /#edit-status-hint"\)\.hidden = !!fige;/);
  });
});

describe("libellés", () => {
  const dico = lire("i18n.js");
  const debutEn = dico.indexOf("\n    en: {");
  const valeur = (cle: string, langue: "fr" | "en") => {
    const partie = langue === "fr" ? dico.slice(0, debutEn) : dico.slice(debutEn);
    const m = new RegExp(`^\\s*"${cle.replace(/\./g, "\\.")}": ("(?:[^"\\\\]|\\\\.)*"),$`, "m").exec(partie);
    return m ? (JSON.parse(m[1]) as string) : undefined;
  };
  const exporte = JSON.parse(lire("inc/i18n-dict.json"));

  for (const cle of ["tr_js_account.status_withdrawn", "tr_js_account.status_hint"]) {
    test(`${cle} : français et anglais, dictionnaire exporté à jour`, () => {
      const fr = valeur(cle, "fr");
      const en = valeur(cle, "en");
      assert.ok(fr && en, cle);
      assert.notEqual(fr, en);
      assert.equal(exporte.fr[cle], fr);
      assert.equal(exporte.en[cle], en);
      assert.doesNotMatch(fr + en, /—/);
      assert.doesNotMatch(fr, / [:;?!»]|« /, "espace insécable attendue");
    });
  }

  test("account.js porte en secours exactement les phrases du dictionnaire", () => {
    const compte = lire("account.js");
    for (const cle of ["tr_js_account.status_withdrawn", "tr_js_account.status_hint"]) {
      const m = new RegExp(`TRaOu\\("${cle.replace(/\./g, "\\.")}",\\s*("(?:[^"\\\\]|\\\\.)*"),\\s*("(?:[^"\\\\]|\\\\.)*")\\)`).exec(compte);
      assert.ok(m, cle);
      assert.equal(JSON.parse(m[1]), valeur(cle, "fr"));
      assert.equal(JSON.parse(m[2]), valeur(cle, "en"));
    }
  });

  test("l'aide nomme l'option telle qu'elle est écrite", () => {
    const option = valeur("tr_js_account.status_withdrawn", "fr")!.replace(/\s*\(.*\)$/, "");
    assert.ok(valeur("tr_js_account.status_hint", "fr")!.includes(`« ${option} »`));
    const optionEn = valeur("tr_js_account.status_withdrawn", "en")!.replace(/\s*\(.*\)$/, "");
    assert.ok(valeur("tr_js_account.status_hint", "en")!.includes(`“${optionEn}”`));
  });
});
