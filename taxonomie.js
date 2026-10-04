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

  /* L'ordre est chronologique : c'est celui qu'un collectionneur attend.
     Ce sont les valeurs enregistrées en base, jamais réécrites : une période
     renommée change de libellé (LIBELLES_PERIODES), pas de valeur. Les trois
     conflits ajoutés le 18 septembre 2026 n'apparaissent dans la navigation
     qu'une fois une annonce publiée (category.php). */
  var PERIODES = [
    "Guerre Napoléonienne",
    "Guerre de 1870",
    "1ère Guerre Mondiale",
    "2nde Guerre Mondiale",
    "Guerre d'Indochine",
    "Guerre d'Algérie",
    "Guerre froide",
  ];

  /* Libellé affiché dans les listes, quand il diffère de la valeur en base.
     « Guerre Napoléonienne » est devenu « Révolution et Premier Empire », le
     terme des collectionneurs, qui couvre aussi les guerres de 1792 à 1804. */
  var LIBELLES_PERIODES = {
    "Guerre Napoléonienne": "Révolution et Premier Empire",
  };

  /* Bornes affichées sous le nom de la période, dans les menus. */
  var DATES_PERIODES = {
    "Guerre Napoléonienne": "1789 - 1815",
    "Guerre de 1870": "1870 - 1871",
    "1ère Guerre Mondiale": "1914 - 1918",
    "2nde Guerre Mondiale": "1939 - 1945",
    "Guerre d'Indochine": "1946 - 1954",
    "Guerre d'Algérie": "1954 - 1962",
    "Guerre froide": "1947 - 1991",
  };

  var SOUS_CATEGORIES = [
    "Uniformes",
    "Armes (neutralisées/maquettes)",
    "Équipements",
    "Médailles & décorations",
    "Documents",
    "Objets divers",
  ];

  /* Adresses du catalogue : /militaria/<période>/<type>. Minuscules, sans
     accents, stables : un libellé peut changer, ces segments non, sauf à
     ajouter une redirection (category.php). Lues aussi par inc/athena.php. */
  var SEGMENTS_PERIODES = {
    "Guerre Napoléonienne": "revolution-premier-empire",
    "Guerre de 1870": "guerre-1870",
    "1ère Guerre Mondiale": "premiere-guerre-mondiale",
    "2nde Guerre Mondiale": "seconde-guerre-mondiale",
    "Guerre d'Indochine": "guerre-indochine",
    "Guerre d'Algérie": "guerre-algerie",
    "Guerre froide": "guerre-froide",
  };
  var SEGMENTS_TYPES = {
    "Uniformes": "uniformes",
    "Armes (neutralisées/maquettes)": "armes",
    "Équipements": "equipements",
    "Médailles & décorations": "medailles",
    "Documents": "documents",
    "Objets divers": "objets-divers",
  };

  /* Clé de traduction du libellé (i18n.js). */
  var CLES_PERIODES = {
    "Guerre Napoléonienne": "cat.napoleon",
    "Guerre de 1870": "cat.p1870",
    "1ère Guerre Mondiale": "cat.ww1",
    "2nde Guerre Mondiale": "cat.ww2",
    "Guerre d'Indochine": "cat.indochina",
    "Guerre d'Algérie": "cat.algeria",
    "Guerre froide": "cat.cold",
  };
  var CLES_TYPES = {
    "Uniformes": "cat.uniforms",
    "Armes (neutralisées/maquettes)": "cat.weapons",
    "Équipements": "cat.equipment",
    "Médailles & décorations": "cat.medals",
    "Documents": "cat.documents",
    "Objets divers": "cat.misc",
  };

  function cleDe(table, segment) {
    for (var k in table) if (table[k] === segment) return k;
    return "";
  }

  /* Adresse d'une fiche : /annonce/<titre>-<identifiant>. Le titre n'est là
     que pour le lecteur et pour le texte des liens partagés ; l'identifiant,
     à la fin, est ce qui compte. Un titre modifié change donc l'adresse, et
     l'ancienne redirige (product.php). */
  function slugTitre(titre) {
    var t = String(titre == null ? "" : titre);
    if (t.normalize) t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    t = t.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
         .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (t.length > 60) {
      t = t.slice(0, 60);
      var coupe = t.lastIndexOf("-");
      if (coupe > 20) t = t.slice(0, coupe);
      t = t.replace(/-+$/, "");
    }
    return t || "annonce";
  }

  function urlFiche(id, titre, lang) {
    return "/annonce/" + slugTitre(titre) + "-" + encodeURIComponent(String(id))
      + (lang === "en" ? "?lang=en" : "");
  }

  /** Adresse d'une page catalogue, depuis les valeurs en base. */
  function urlCategorie(periode, type, lang) {
    var chemin = "/militaria";
    if (periode && SEGMENTS_PERIODES[periode]) chemin += "/" + SEGMENTS_PERIODES[periode];
    if (type && SEGMENTS_TYPES[type] && periode && SEGMENTS_PERIODES[periode]) chemin += "/" + SEGMENTS_TYPES[type];
    return chemin + (lang === "en" ? "?lang=en" : "");
  }

  /* Du meilleur au plus abîmé : un ordre arbitraire obligerait l'acheteur à
     relire la liste entière pour se situer. */
  var ETATS = [
    "Neuf",
    "Très bon état",
    "Bon état",
    "État correct",
    "À restaurer",
  ];

  /* Libellés anglais des états : la même table que am_etat (inc/athena.php),
     pour que la fiche réécrite par le navigateur dise « Good condition »
     comme le HTML du serveur. */
  var ETATS_EN = {
    "Neuf": "New",
    "Très bon état": "Very good condition",
    "Bon état": "Good condition",
    "État correct": "Fair condition",
    "À restaurer": "Needs restoration",
  };
  function libelleEtat(etat, lang) {
    if (!etat) return "";
    return lang === "en" ? (ETATS_EN[etat] || etat) : etat;
  }

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
             echapper(LIBELLES_PERIODES[v] || v) + "</option>";
    }
    if (valeurCourante && !connue) {
      out = '<option value="' + echapper(valeurCourante) + '" selected>' +
            echapper(valeurCourante) + " (valeur actuelle)</option>" + out;
    }
    return out;
  }

  var api = {
    PERIODES: PERIODES,
    LIBELLES_PERIODES: LIBELLES_PERIODES,
    DATES_PERIODES: DATES_PERIODES,
    SOUS_CATEGORIES: SOUS_CATEGORIES,
    ETATS: ETATS,
    libelleEtat: libelleEtat,
    SEGMENTS_PERIODES: SEGMENTS_PERIODES,
    SEGMENTS_TYPES: SEGMENTS_TYPES,
    CLES_PERIODES: CLES_PERIODES,
    CLES_TYPES: CLES_TYPES,
    options: options,
    urlCategorie: urlCategorie,
    slugTitre: slugTitre,
    urlFiche: urlFiche,
    periodeDepuisSegment: function (s) { return cleDe(SEGMENTS_PERIODES, s); },
    typeDepuisSegment: function (s) { return cleDe(SEGMENTS_TYPES, s); },
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  global.TAXONOMIE = api;
})(typeof window !== "undefined" ? window : globalThis);
