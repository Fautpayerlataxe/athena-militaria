/* ==========================================================================
   ATHENA MILITARIA — Système de traduction FR / EN
   --------------------------------------------------------------------------
   Usage HTML :
     <h1 data-i18n="home.title">Bienvenue</h1>
     <input data-i18n-placeholder="search.placeholder" placeholder="...">
     <button data-i18n-aria-label="menu.toggle" aria-label="...">
     <a data-i18n-html="footer.legal_html">...</a>
   --------------------------------------------------------------------------
   API :
     I18N.setLang("en")    → change la langue, persiste, applique partout
     I18N.t("home.title")  → renvoie la traduction
     I18N.current          → "fr" | "en"
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "lang";

  const DICT = {
    fr: {
      // ===== HEADER (commun à toutes les pages) =====
      "header.search": "Rechercher des articles",
      "header.search_sell": "Rechercher un objet",
      "header.login": "Connexion | S'inscrire",
      "header.account": "Mon compte",
      "header.sell": "Vendre",
      "header.community": "Communauté",
      "header.menu": "Menu",
      "header.logout": "Se déconnecter",
      "header.lang_toggle": "EN",

      // ===== CATÉGORIES (top nav) =====
      "cat.napoleon": "Guerre Napoléonienne",
      "cat.ww1": "1ère Guerre Mondiale",
      "cat.ww2": "2nde Guerre Mondiale",
      "cat.cold": "Guerre froide",
      "cat.uniforms": "Uniformes",
      "cat.weapons": "Armes",
      "cat.documents": "Documents",
      "cat.medals": "Médailles",
      "cat.misc": "Objets divers",
      "cat.accessories": "Accessoires",

      // ===== HOME =====
      "home.hero_title": "Prêt à vendre vos pièces ?",
      "home.cta_sell": "Commencer à vendre",
      "home.cta_how": "Découvrir comment ça marche",
      "home.latest": "Derniers articles mis en ligne",
      "home.reviews": "Avis",
      "home.reviews_note_html": 'Note moyenne : <strong>4,8/5</strong> (320 avis)',

      // ===== BREADCRUMBS / GENERIC =====
      "breadcrumb.home": "Accueil",
      "breadcrumb.sep": "/",
      "common.loading": "Chargement…",
      "common.back_home": "Retour à l'accueil",
      "common.see_more": "Voir plus",
      "common.cancel": "Annuler",
      "common.confirm": "Confirmer",
      "common.delete": "Supprimer",
      "common.save": "Enregistrer",
      "common.publish": "Publier",
      "common.send": "Envoyer",

      // ===== CATEGORY PAGE =====
      "category.title_all": "Toutes les annonces",
      "category.sidebar_title": "Catégories",
      "category.all_pieces": "Toutes les pièces",
      "category.filter_price_min": "Prix min",
      "category.filter_price_max": "Prix max",
      "category.filter_period": "Période",
      "category.filter_condition": "État",
      "category.filter_apply": "Appliquer",
      "category.filter_reset": "Réinitialiser",
      "category.no_results": "Aucun article ne correspond à votre recherche.",

      // ===== PRODUCT PAGE =====
      "product.loading": "Chargement du produit…",
      "product.not_found": "Produit introuvable.",
      "product.condition": "État",
      "product.period": "Période",
      "product.subcategory": "Sous-catégorie",
      "product.location": "Lieu",
      "product.stock": "Stock",
      "product.published": "Publié",
      "product.buy": "Acheter",
      "product.sold": "Article vendu",
      "product.add_fav": "♡ Ajouter aux favoris",
      "product.remove_fav": "♥ Dans les favoris",
      "product.contact_seller": "✉ Contacter le vendeur",
      "product.report": "⚠ Signaler cet article",
      "product.share": "Partager :",
      "product.similar": "Articles similaires",
      "product.seller_loading": "Chargement des infos vendeur…",

      // ===== SELL PAGE =====
      "sell.eyebrow": "Espace vendeur",
      "sell.title": "Mettre un article en vente",
      "sell.intro": "Partagez l'histoire d'une pièce avec la communauté des collectionneurs. Publication gratuite, commission 0%, paiement sécurisé.",
      "sell.breadcrumb_current": "Mettre en vente",
      "sell.card1_title": "Photos de la pièce",
      "sell.card1_desc": "Jusqu'à 6 photos nettes. La première sera l'image principale.",
      "sell.card1_dropzone_title": "Ajouter des photos",
      "sell.card1_dropzone_hint": "JPG, PNG ou HEIC · 5 Mo max par fichier",
      "sell.card2_title": "Titre & description",
      "sell.card2_desc": "Donnez envie de découvrir votre pièce, soyez précis, historique, factuel.",
      "sell.f_title": "Titre de l'annonce",
      "sell.f_title_ph": "Ex. Casque Adrian 1915, armée française",
      "sell.f_title_hint": "80 caractères max · objet + période + particularité",
      "sell.f_description": "Description détaillée",
      "sell.f_description_ph": "Marquages, dimensions, état précis, provenance, histoire de la pièce…",
      "sell.card3_title": "Catégorisation",
      "sell.card3_desc": "Aide les collectionneurs à retrouver facilement votre pièce.",
      "sell.f_period": "Période historique",
      "sell.f_period_ph": "Sélectionnez une période",
      "sell.f_subcategory": "Type de pièce",
      "sell.f_subcategory_ph": "Sélectionnez un type",
      "sell.f_condition": "État de conservation",
      "sell.f_condition_ph": "Sélectionnez l'état",
      "sell.f_quantity": "Quantité",
      "sell.cond.new": "Neuf",
      "sell.cond.very_good": "Très bon état",
      "sell.cond.good": "Bon état",
      "sell.cond.correct": "État correct",
      "sell.cond.restore": "À restaurer",
      "sell.sub.weapons_neutral": "Armes (neutralisées/maquettes)",
      "sell.sub.equipment": "Équipements",
      "sell.sub.medals": "Médailles & décorations",
      "sell.card4_title": "Prix de vente",
      "sell.card4_desc": "Commission 0%, vous gardez 100 % du prix affiché.",
      "sell.f_price": "Prix souhaité",
      "sell.card5_title": "Localisation & livraison",
      "sell.card5_desc": "Indiquez où se trouve la pièce et les modes d'envoi que vous acceptez.",
      "sell.f_location": "Ville de l'objet",
      "sell.f_location_ph": "Ex. Lyon, France",
      "sell.f_ship": "Modes d'envoi acceptés",
      "sell.ship_pickup": "Remise en main propre",
      "sell.ship_post": "Envoi postal",
      "sell.ship_relay": "Point relais",
      "sell.f_agree": "J'atteste que cette pièce respecte la législation en vigueur et les règles du site Athena Militaria.",
      "sell.f_submit": "Publier mon annonce",
      "sell.f_draft": "Enregistrer en brouillon",
      "sell.blocked_title": "Compte suspendu",
      "sell.blocked_text_html": "Votre compte a été suspendu par l'équipe de modération et ne peut plus mettre d'articles en vente. Pour toute question, contactez <a href=\"mailto:contact@athenamilitaria.fr\">contact@athenamilitaria.fr</a>.",
      "sell.gate_title": "Plus qu'une étape !",
      "sell.gate_sub": "Créez votre compte pour publier votre annonce. Votre fiche est sauvegardée, vous la retrouverez juste après.",
      "sell.gate_btn": "Créer mon compte / Se connecter",
      "sell.gate_b1": "Inscription gratuite en 30 secondes",
      "sell.gate_b2": "Vos données restent sauvegardées",
      "sell.gate_b3": "Vendeurs vérifiés, modération active",
      "sell.f_sensitive_title": "Cet objet comporte un symbole, insigne ou marquage d'une organisation dont l'exposition est encadrée par la loi française (régimes nazi ou fascistes, Waffen-SS, organisations collaborationnistes, formations paramilitaires condamnées, etc.).",
      "sell.f_sensitive_hint": "Une bannière d'avertissement sera affichée sur l'annonce et les photos seront floutées pour les visiteurs non connectés. Cette signalisation est uniquement une précaution de modération et ne vaut pas reconnaissance légale.",

      // ===== BANDEAU AVERTISSEMENT HISTORIQUE =====
      "hwb.title": "Bienvenue sur Athena Militaria",
      "hwb.body": "Notre plateforme est dédiée aux collectionneurs et passionnés d'histoire militaire. Certaines pièces peuvent porter des insignes de régimes historiques aujourd'hui dissous : elles sont exposées dans un strict cadre de collection et de mémoire, sans aucune valeur idéologique.",
      "hwb.ack": "Entrer sur le site",

      // ===== OBJETS SENSIBLES =====
      "product.sensitive_overlay": "Connectez-vous pour afficher",
      "product.sensitive_title": "Pièce historiquement sensible",
      "product.sensitive_sub": "Connectez-vous pour afficher les photos",
      "product.sensitive_notice": "Cet article porte un insigne ou symbole historique dissous. Présenté dans un strict cadre de collection.",

      // ===== AUTH MODAL =====
      "auth.title": "Inscrivez-vous et commencez dès aujourd'hui à acheter ou vendre vos pièces historiques",
      "auth.oauth_apple": "Continuer avec Apple",
      "auth.oauth_google": "Continuer avec Google",
      "auth.oauth_facebook": "Continuer avec Facebook",
      "auth.with_email": "Inscris-toi avec ton adresse e-mail",
      "auth.go_login": "Tu as déjà un compte ? Se connecter",
      "auth.reg_title": "Inscription par e-mail",
      "auth.reg_email": "Adresse e-mail",
      "auth.reg_pass": "Mot de passe (≥ 6 caractères)",
      "auth.reg_pass2": "Confirmer le mot de passe",
      "auth.reg_btn": "Créer mon compte",
      "auth.login_title": "Connexion",
      "auth.login_email": "Adresse e-mail",
      "auth.login_pass": "Mot de passe",
      "auth.login_btn": "Se connecter",
      "auth.close": "Fermer",

      // ===== ACCOUNT PAGE =====
      "account.guest_title": "Mon Compte",
      "account.guest_text": "Connecte-toi pour accéder à tes annonces et tes achats.",
      "account.guest_btn": "Se connecter",
      "account.member_since": "Membre depuis",
      "account.tab_listings": "Mes annonces",
      "account.tab_orders": "Mes achats",
      "account.tab_favorites": "Favoris",
      "account.tab_settings": "Paramètres",
      "account.tab_admin": "Modération",
      "account.new_listing": "+ Nouvelle annonce",
      "account.settings_pwd_title": "Modifier le mot de passe",
      "account.settings_pwd_ph": "Nouveau mot de passe (min. 6 caractères)",
      "account.settings_pwd_btn": "Mettre à jour",
      "account.signout_title": "Déconnexion",
      "account.signout_text": "Tu seras redirigé vers la page d'accueil.",
      "account.signout_btn": "Se déconnecter",
      "account.admin_badge": "Administrateur",

      // ===== ABOUT PAGE =====
      "about.tagline": "La place de marché française dédiée à la collection militaire et à l'histoire.",
      "about.nav_mission": "Notre mission",
      "about.nav_how": "Comment ça marche",
      "about.nav_security": "Sécurité & paiements",
      "about.nav_sellers": "Vendre un article",
      "about.nav_community": "La communauté",
      "about.nav_faq": "FAQ",
      "about.mission_title": "Notre mission",
      "about.how_title": "Comment ça marche",
      "about.security_title": "Sécurité & paiements",
      "about.community_title": "La communauté",
      "about.faq_title": "Questions fréquentes",

      // ===== COMMUNITY PAGE =====
      "community.hero_title": "Rejoignez la communauté",
      "community.hero_text": "Des milliers de passionnés d'histoire militaire partagent déjà leurs trouvailles, leurs connaissances et leur passion. Retrouvez-nous sur nos réseaux.",
      "community.follow": "Nous suivre",
      "community.join": "Rejoindre",
      "community.connect": "Se connecter",
      "community.stat_reviews": "Avis positifs",
      "community.stat_collectors": "Collectionneurs",
      "community.stat_objects": "Objets échangés",
      "community.cta_title": "Vous avez des pièces à partager ?",
      "community.cta_text": "Mettez vos objets en vente et rejoignez une communauté de passionnés qui valorise l'histoire.",
      "community.cta_btn": "Commencer à vendre",

      // ===== LEGAL PAGE =====
      "legal.title": "Informations légales",
      "legal.toc": "Sommaire",
      "legal.toc_mentions": "Mentions légales",
      "legal.toc_cgu": "Conditions Générales d'Utilisation (CGU)",
      "legal.toc_cgv": "Conditions Générales de Vente (CGV)",
      "legal.toc_rgpd": "Politique de confidentialité (RGPD)",
      "legal.toc_cookies": "Politique de cookies",
      "legal.toc_contact": "Contact",

      // ===== 404 =====
      "err.404_title": "Page introuvable",
      "err.404_text": "La page demandée n'existe pas.",
      "err.404_btn": "Retour à l'accueil",

      // ===== FOOTER =====
      "footer.brand": "Athena Militaria",
      "footer.about": "À propos",
      "footer.legal": "Mentions légales",
      "footer.cgv": "CGV",
      "footer.privacy": "Confidentialité",
      "footer.discover": "Découvrir",
      "footer.how": "Comment ça marche",
      "footer.browse": "Parcourir",
      "footer.sell": "Vendre",
      "footer.account": "Mon compte",
      "footer.community": "Communauté",
      "footer.contact": "Nous contacter",
      "footer.faq": "FAQ",
      "footer.copy": "© 2026 Athena Militaria · Tous droits réservés",
    },

    en: {
      // ===== HEADER =====
      "header.search": "Search items",
      "header.search_sell": "Search an item",
      "header.login": "Log in | Sign up",
      "header.account": "My account",
      "header.sell": "Sell",
      "header.community": "Community",
      "header.menu": "Menu",
      "header.logout": "Log out",
      "header.lang_toggle": "FR",

      // ===== CATEGORIES =====
      "cat.napoleon": "Napoleonic Wars",
      "cat.ww1": "World War I",
      "cat.ww2": "World War II",
      "cat.cold": "Cold War",
      "cat.uniforms": "Uniforms",
      "cat.weapons": "Weapons",
      "cat.documents": "Documents",
      "cat.medals": "Medals",
      "cat.misc": "Misc. items",
      "cat.accessories": "Accessories",

      // ===== HOME =====
      "home.hero_title": "Ready to sell your items?",
      "home.cta_sell": "Start selling",
      "home.cta_how": "How it works",
      "home.latest": "Latest items",
      "home.reviews": "Reviews",
      "home.reviews_note_html": 'Average rating: <strong>4.8/5</strong> (320 reviews)',

      // ===== BREADCRUMBS / GENERIC =====
      "breadcrumb.home": "Home",
      "breadcrumb.sep": "/",
      "common.loading": "Loading…",
      "common.back_home": "Back to home",
      "common.see_more": "See more",
      "common.cancel": "Cancel",
      "common.confirm": "Confirm",
      "common.delete": "Delete",
      "common.save": "Save",
      "common.publish": "Publish",
      "common.send": "Send",

      // ===== CATEGORY PAGE =====
      "category.title_all": "All listings",
      "category.sidebar_title": "Categories",
      "category.all_pieces": "All pieces",
      "category.filter_price_min": "Min price",
      "category.filter_price_max": "Max price",
      "category.filter_period": "Period",
      "category.filter_condition": "Condition",
      "category.filter_apply": "Apply",
      "category.filter_reset": "Reset",
      "category.no_results": "No item matches your search.",

      // ===== PRODUCT PAGE =====
      "product.loading": "Loading product…",
      "product.not_found": "Product not found.",
      "product.condition": "Condition",
      "product.period": "Period",
      "product.subcategory": "Sub-category",
      "product.location": "Location",
      "product.stock": "Stock",
      "product.published": "Published",
      "product.buy": "Buy",
      "product.sold": "Sold out",
      "product.add_fav": "♡ Add to favorites",
      "product.remove_fav": "♥ In favorites",
      "product.contact_seller": "✉ Contact seller",
      "product.report": "⚠ Report this item",
      "product.share": "Share:",
      "product.similar": "Similar items",
      "product.seller_loading": "Loading seller info…",

      // ===== SELL PAGE =====
      "sell.eyebrow": "Sellers' area",
      "sell.title": "List an item",
      "sell.intro": "Share the story of a piece with the collectors' community. Free listing, 0% commission, secure payment.",
      "sell.breadcrumb_current": "List an item",
      "sell.card1_title": "Photos",
      "sell.card1_desc": "Up to 6 sharp photos. The first one will be the main image.",
      "sell.card1_dropzone_title": "Add photos",
      "sell.card1_dropzone_hint": "JPG, PNG or HEIC · 5 MB max per file",
      "sell.card2_title": "Title & description",
      "sell.card2_desc": "Make people want to discover your piece, be precise, historical, factual.",
      "sell.f_title": "Listing title",
      "sell.f_title_ph": "Ex. Adrian helmet 1915, French Army",
      "sell.f_title_hint": "80 chars max · object + period + specifics",
      "sell.f_description": "Detailed description",
      "sell.f_description_ph": "Markings, dimensions, exact condition, provenance, item story…",
      "sell.card3_title": "Categorization",
      "sell.card3_desc": "Helps collectors find your piece easily.",
      "sell.f_period": "Historical period",
      "sell.f_period_ph": "Select a period",
      "sell.f_subcategory": "Item type",
      "sell.f_subcategory_ph": "Select a type",
      "sell.f_condition": "Condition",
      "sell.f_condition_ph": "Select condition",
      "sell.f_quantity": "Quantity",
      "sell.cond.new": "New",
      "sell.cond.very_good": "Very good",
      "sell.cond.good": "Good",
      "sell.cond.correct": "Fair",
      "sell.cond.restore": "To restore",
      "sell.sub.weapons_neutral": "Weapons (deactivated/replicas)",
      "sell.sub.equipment": "Equipment",
      "sell.sub.medals": "Medals & decorations",
      "sell.card4_title": "Sale price",
      "sell.card4_desc": "0% commission, you keep 100% of the listed price.",
      "sell.f_price": "Asking price",
      "sell.card5_title": "Location & shipping",
      "sell.card5_desc": "Indicate where the item is and the shipping methods you accept.",
      "sell.f_location": "Item city",
      "sell.f_location_ph": "Ex. Lyon, France",
      "sell.f_ship": "Accepted shipping methods",
      "sell.ship_pickup": "Hand delivery",
      "sell.ship_post": "Postal shipping",
      "sell.ship_relay": "Pickup point",
      "sell.f_agree": "I certify that this piece complies with applicable laws and the rules of Athena Militaria.",
      "sell.f_submit": "Publish my listing",
      "sell.f_draft": "Save as draft",
      "sell.blocked_title": "Account suspended",
      "sell.blocked_text_html": "Your account has been suspended by the moderation team and cannot list items anymore. For any question, contact <a href=\"mailto:contact@athenamilitaria.fr\">contact@athenamilitaria.fr</a>.",
      "sell.gate_title": "One last step!",
      "sell.gate_sub": "Create your account to publish your listing. Your form is saved, you'll get it back right after.",
      "sell.gate_btn": "Create account / Log in",
      "sell.gate_b1": "Free signup in 30 seconds",
      "sell.gate_b2": "Your data stays saved",
      "sell.gate_b3": "Verified sellers, active moderation",
      "sell.f_sensitive_title": "This item bears a symbol, insignia or marking of an organization whose display is regulated under French law (Nazi or fascist regimes, Waffen-SS, collaborationist organizations, condemned paramilitary groups, etc.).",
      "sell.f_sensitive_hint": "A warning banner will be shown on the listing and photos will be blurred for non-logged-in visitors. This flag is purely a moderation precaution and does not constitute legal acknowledgement.",

      // ===== HISTORICAL WARNING BANNER =====
      "hwb.title": "Welcome to Athena Militaria",
      "hwb.body": "Our platform is dedicated to collectors and military history enthusiasts. Some items may bear insignia of historical regimes that are now dissolved: they are displayed strictly within a framework of collection and remembrance, without any ideological purpose.",
      "hwb.ack": "Enter the site",

      // ===== SENSITIVE ITEMS =====
      "product.sensitive_overlay": "Log in to view",
      "product.sensitive_title": "Historically sensitive item",
      "product.sensitive_sub": "Log in to view the photos",
      "product.sensitive_notice": "This item bears a dissolved historical insignia or symbol. Presented strictly for collection purposes.",

      // ===== AUTH MODAL =====
      "auth.title": "Sign up and start buying or selling your historical items today",
      "auth.oauth_apple": "Continue with Apple",
      "auth.oauth_google": "Continue with Google",
      "auth.oauth_facebook": "Continue with Facebook",
      "auth.with_email": "Sign up with your email address",
      "auth.go_login": "Already have an account? Log in",
      "auth.reg_title": "Sign up with email",
      "auth.reg_email": "Email address",
      "auth.reg_pass": "Password (≥ 6 characters)",
      "auth.reg_pass2": "Confirm password",
      "auth.reg_btn": "Create my account",
      "auth.login_title": "Log in",
      "auth.login_email": "Email address",
      "auth.login_pass": "Password",
      "auth.login_btn": "Log in",
      "auth.close": "Close",

      // ===== ACCOUNT PAGE =====
      "account.guest_title": "My Account",
      "account.guest_text": "Log in to access your listings and orders.",
      "account.guest_btn": "Log in",
      "account.member_since": "Member since",
      "account.tab_listings": "My listings",
      "account.tab_orders": "My orders",
      "account.tab_favorites": "Favorites",
      "account.tab_settings": "Settings",
      "account.tab_admin": "Moderation",
      "account.new_listing": "+ New listing",
      "account.settings_pwd_title": "Change password",
      "account.settings_pwd_ph": "New password (min. 6 characters)",
      "account.settings_pwd_btn": "Update",
      "account.signout_title": "Log out",
      "account.signout_text": "You'll be redirected to the homepage.",
      "account.signout_btn": "Log out",
      "account.admin_badge": "Administrator",

      // ===== ABOUT PAGE =====
      "about.tagline": "The French marketplace dedicated to military collection and history.",
      "about.nav_mission": "Our mission",
      "about.nav_how": "How it works",
      "about.nav_security": "Security & payments",
      "about.nav_sellers": "Sell an item",
      "about.nav_community": "Community",
      "about.nav_faq": "FAQ",
      "about.mission_title": "Our mission",
      "about.how_title": "How it works",
      "about.security_title": "Security & payments",
      "about.community_title": "The community",
      "about.faq_title": "Frequently asked questions",

      // ===== COMMUNITY PAGE =====
      "community.hero_title": "Join the community",
      "community.hero_text": "Thousands of military history enthusiasts already share their finds, knowledge and passion. Find us on social media.",
      "community.follow": "Follow us",
      "community.join": "Join",
      "community.connect": "Connect",
      "community.stat_reviews": "Positive reviews",
      "community.stat_collectors": "Collectors",
      "community.stat_objects": "Items traded",
      "community.cta_title": "Have items to share?",
      "community.cta_text": "List your items and join a community of enthusiasts that values history.",
      "community.cta_btn": "Start selling",

      // ===== LEGAL PAGE =====
      "legal.title": "Legal information",
      "legal.toc": "Table of contents",
      "legal.toc_mentions": "Legal notice",
      "legal.toc_cgu": "Terms of Use",
      "legal.toc_cgv": "Terms of Sale",
      "legal.toc_rgpd": "Privacy policy (GDPR)",
      "legal.toc_cookies": "Cookie policy",
      "legal.toc_contact": "Contact",

      // ===== 404 =====
      "err.404_title": "Page not found",
      "err.404_text": "The requested page does not exist.",
      "err.404_btn": "Back to home",

      // ===== FOOTER =====
      "footer.brand": "Athena Militaria",
      "footer.about": "About",
      "footer.legal": "Legal notice",
      "footer.cgv": "Terms of sale",
      "footer.privacy": "Privacy",
      "footer.discover": "Explore",
      "footer.how": "How it works",
      "footer.browse": "Browse",
      "footer.sell": "Sell",
      "footer.account": "My account",
      "footer.community": "Community",
      "footer.contact": "Contact us",
      "footer.faq": "FAQ",
      "footer.copy": "© 2026 Athena Militaria · All rights reserved",
    },
  };

  // ===== Détection langue initiale =====
  function detectInitialLang() {
    // 1. URL ?lang=en
    try {
      const urlLang = new URLSearchParams(location.search).get("lang");
      if (urlLang === "fr" || urlLang === "en") return urlLang;
    } catch (e) {}
    // 2. localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "fr" || saved === "en") return saved;
    } catch (e) {}
    // 3. Navigator (par défaut FR sauf si explicitement EN)
    const nav = (navigator.language || "fr").toLowerCase();
    return nav.startsWith("en") ? "en" : "fr";
  }

  let currentLang = detectInitialLang();

  function t(key) {
    return (DICT[currentLang] && DICT[currentLang][key])
      || (DICT.fr && DICT.fr[key])
      || key;
  }

  // ===== Application sur le DOM =====
  function applyTo(root) {
    root = root || document;

    // textContent
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const val = t(key);
      // Préserver l'icône SVG / les enfants spéciaux : on cherche un text node final
      // Sinon on remplace tout le textContent (cas par défaut)
      el.textContent = val;
    });

    // innerHTML (pour textes contenant du HTML — ex. <strong>)
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (!key) return;
      el.innerHTML = t(key);
    });

    // placeholder
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key) return;
      el.setAttribute("placeholder", t(key));
    });

    // aria-label
    root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria-label");
      if (!key) return;
      el.setAttribute("aria-label", t(key));
    });

    // title attribute
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (!key) return;
      el.setAttribute("title", t(key));
    });

    // alt attribute
    root.querySelectorAll("[data-i18n-alt]").forEach((el) => {
      const key = el.getAttribute("data-i18n-alt");
      if (!key) return;
      el.setAttribute("alt", t(key));
    });

    // <html lang="...">
    if (root === document) {
      document.documentElement.setAttribute("lang", currentLang);
    }
  }

  function setLang(lang) {
    if (lang !== "fr" && lang !== "en") return;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    applyTo(document);
    // Notifier les modules dynamiques (account.js, product.js, etc.)
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang } }));
  }

  // ===== Branche le bouton EN/FR =====
  function bindToggle() {
    const btn = document.getElementById("lang-toggle");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setLang(currentLang === "fr" ? "en" : "fr");
    });
  }

  // ===== API publique =====
  window.I18N = {
    get current() { return currentLang; },
    t,
    setLang,
    apply: applyTo,
  };

  // ===== Initialisation =====
  document.addEventListener("DOMContentLoaded", () => {
    applyTo(document);
    bindToggle();
  });
})();
