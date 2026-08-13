/* ==========================================================================
   Traduction des erreurs techniques en phrases lisibles

   Le site montrait jusqu'ici le message brut renvoyé par la base à
   l'utilisateur, dans une douzaine d'endroits. Cela donnait des écrans du
   genre :

     Erreur : new row violates row-level security policy for table "products"
     Erreur : duplicate key value violates unique constraint "products_pkey"

   Deux problèmes, et le second est le plus sérieux. D'abord personne ne
   comprend, et surtout personne ne sait quoi faire ensuite. Ensuite cela
   raconte au visiteur le nom des tables, celui des contraintes et l'existence
   des politiques de sécurité : de quoi cartographier la base sans effort.

   Ce module fait la traduction. Le message technique n'est pas perdu, il part
   dans la console du navigateur : c'est là qu'on en a besoin pour diagnostiquer,
   pas au milieu de l'écran d'un acheteur.

   Le fichier s'utilise dans le navigateur comme dans Node, pour que la
   correspondance soit vérifiable par des tests sans lancer de navigateur.
   ========================================================================== */

(function (global) {
  "use strict";

  /* Codes SQLSTATE de PostgreSQL et codes propres à PostgREST. Ce sont les
     seuls identifiants stables : les messages, eux, changent d'une version à
     l'autre et d'une locale à l'autre. */
  var PAR_CODE = {
    "23505": "err.deja_existant",      // unique_violation
    "23503": "err.element_lie",        // foreign_key_violation
    "23514": "err.valeur_refusee",     // check_violation
    "23502": "err.champ_manquant",     // not_null_violation
    "22P02": "err.valeur_invalide",    // invalid_text_representation
    "22001": "err.trop_long_texte",    // string_data_right_truncation
    "42501": "err.droits_insuffisants",// insufficient_privilege
    "42P01": "err.indisponible",       // undefined_table
    "40001": "err.reessayer",          // serialization_failure
    "40P01": "err.reessayer",          // deadlock_detected
    "57014": "err.trop_long",          // query_canceled
    "PGRST301": "err.session_expiree",
    "PGRST302": "err.session_expiree",
    "PGRST116": "err.introuvable",
    "PGRST204": "err.introuvable",
  };

  /* Quand le code manque, le texte reste le seul indice. On ne cherche que des
     formulations stables de PostgreSQL et du navigateur. */
  var PAR_TEXTE = [
    [/row-level security/i, "err.droits_insuffisants"],
    [/permission denied/i, "err.droits_insuffisants"],
    [/duplicate key|already exists/i, "err.deja_existant"],
    [/foreign key|still referenced/i, "err.element_lie"],
    [/check constraint|violates check/i, "err.valeur_refusee"],
    [/null value in column/i, "err.champ_manquant"],
    [/\bJWT\b|token is expired|invalid claim|not authenticated/i, "err.session_expiree"],
    [/failed to fetch|networkerror|network request failed|err_internet|err_network/i, "err.reseau"],
    [/timeout|timed out|aborted/i, "err.trop_long"],
    [/deadlock|could not serialize/i, "err.reessayer"],
    [/rate limit|too many requests/i, "err.trop_de_demandes"],
    [/payload too large|file too large|exceeded the maximum/i, "err.fichier_trop_gros"],
  ];

  /**
   * Rend la clé de traduction correspondant à une erreur.
   * Toujours une clé, jamais null : un appelant ne doit pas avoir à gérer
   * l'absence, sinon le message brut finit par ressortir quelque part.
   */
  function cleErreur(erreur) {
    if (!erreur) return "err.generique";

    var code = String(erreur.code || erreur.statusCode || erreur.status || "");
    if (PAR_CODE[code]) return PAR_CODE[code];

    // Supabase renvoie parfois le code HTTP seul.
    if (code === "401" || code === "403") return "err.session_expiree";
    if (code === "404") return "err.introuvable";
    if (code === "409") return "err.deja_existant";
    if (code === "413") return "err.fichier_trop_gros";
    if (code === "429") return "err.trop_de_demandes";
    if (code === "503" || code === "502" || code === "504") return "err.indisponible";

    var texte = [erreur.message, erreur.details, erreur.hint, erreur.error_description, erreur.error]
      .filter(function (v) { return typeof v === "string" && v; })
      .join(" ");
    if (!texte && typeof erreur === "string") texte = erreur;

    for (var i = 0; i < PAR_TEXTE.length; i++) {
      if (PAR_TEXTE[i][0].test(texte)) return PAR_TEXTE[i][1];
    }
    return "err.generique";
  }

  /**
   * Le message à montrer. `cleSecours` permet à l'appelant de proposer une
   * phrase plus précise pour son contexte (« La suppression a échoué »)
   * lorsque l'erreur n'est pas reconnue.
   */
  function messageErreur(erreur, cleSecours) {
    var cle = cleErreur(erreur);
    if (cle === "err.generique" && cleSecours) cle = cleSecours;

    var traduire = global.TR;
    var texte = typeof traduire === "function" ? traduire(cle) : cle;
    // TR rend la clé quand la traduction manque : on ne montre jamais une clé.
    if (!texte || texte === cle) {
      texte = typeof traduire === "function" ? traduire("err.generique") : "";
      if (!texte || texte === "err.generique") {
        texte = "L'opération n'a pas abouti. Réessayez dans un instant.";
      }
    }

    // Le détail technique reste accessible pour diagnostiquer, hors de l'écran.
    if (global.console && typeof global.console.warn === "function" && erreur) {
      global.console.warn("[erreur]", cle, erreur);
    }
    return texte;
  }

  var api = { cleErreur: cleErreur, messageErreur: messageErreur };

  if (typeof module === "object" && module.exports) module.exports = api;
  global.cleErreur = cleErreur;
  global.messageErreur = messageErreur;
})(typeof window !== "undefined" ? window : globalThis);
