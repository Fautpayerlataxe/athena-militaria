/* ==========================================================================
   La seule liste de périodes, de types et d'états du site

   Il y en avait deux. La page de mise en vente proposait « 2nde Guerre
   Mondiale » et « Armes (neutralisées/maquettes) ». La modale de modification
   d'annonce proposait « Seconde Guerre mondiale (1939-1945) » et « Armes
   neutralisées ». Sur quatre périodes et six types, une seule valeur était
   commune aux deux listes.

   Les conséquences se voyaient dans cet ordre :

     1. À l'ouverture de la modale, la valeur enregistrée ne correspondait à
        aucune option : les deux listes retombaient sur « Choisir », et le
        vendeur croyait ses informations perdues.
     2. S'il enregistrait, ne serait-ce que pour corriger un prix, le champ
        obligatoire le forçait à choisir une des nouvelles valeurs.
     3. L'annonce était alors réécrite avec une période et un type que les
        pages catégorie ne savent pas retrouver. Elle disparaissait du
        catalogue tout en restant en ligne, sans que personne ne soit averti.

   Les valeurs ci-dessous sont celles de la base et de la navigation. Elles
   sont désormais lues d'un seul endroit par les deux formulaires, et un test
   vérifie que la page de mise en vente ne s'en écarte pas.
   ========================================================================== */

(function (global) {
  "use strict";

  /* L'ordre est chronologique : c'est celui qu'un collectionneur attend. */
  var PERIODES = [
    "Guerre Napoléonienne",
    "1ère Guerre Mondiale",
    "2nde Guerre Mondiale",
    "Guerre froide",
  ];

  var SOUS_CATEGORIES = [
    "Uniformes",
    "Armes (neutralisées/maquettes)",
    "Équipements",
    "Médailles & décorations",
    "Documents",
    "Objets divers",
  ];

  /* Du meilleur au plus abîmé : un ordre arbitraire obligerait l'acheteur à
     relire la liste entière pour se situer. */
  var ETATS = [
    "Neuf",
    "Très bon état",
    "Bon état",
    "État correct",
    "À restaurer",
  ];

  function echapper(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /**
   * Rend les <option> d'une liste, en sélectionnant la valeur courante.
   *
   * Si la valeur enregistrée ne figure pas dans la liste, elle est ajoutée en
   * tête et marquée. Sans cela, une annonce ancienne verrait sa valeur
   * silencieusement remplacée à la première modification, ce qui est le
   * défaut que ce fichier existe pour empêcher.
   */
  function options(liste, valeurCourante, texteVide) {
    var out = '<option value="">' + echapper(texteVide || "Choisir") + "</option>";
    var connue = false;
    for (var i = 0; i < liste.length; i++) {
      var v = liste[i];
      var choisie = v === valeurCourante;
      if (choisie) connue = true;
      out += '<option value="' + echapper(v) + '"' + (choisie ? " selected" : "") + ">" +
             echapper(v) + "</option>";
    }
    if (valeurCourante && !connue) {
      out = '<option value="' + echapper(valeurCourante) + '" selected>' +
            echapper(valeurCourante) + " (valeur actuelle)</option>" + out;
    }
    return out;
  }

  var api = {
    PERIODES: PERIODES,
    SOUS_CATEGORIES: SOUS_CATEGORIES,
    ETATS: ETATS,
    options: options,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  global.TAXONOMIE = api;
})(typeof window !== "undefined" ? window : globalThis);
