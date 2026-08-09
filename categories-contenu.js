/* Contexte historique propre à chaque page de catégorie.

   Pourquoi ce fichier existe. category.html est un fichier unique servi pour
   toutes les périodes : /category?cat=Guerre-froide et
   /category?cat=2nde-Guerre-Mondiale renvoyaient le même document, au bit
   près, le tri étant fait dans le navigateur. Deux adresses distinctes pour
   un seul contenu, donc rien qui distingue une période d'une autre aux yeux
   d'un moteur, et une page vide de sens quand la catégorie ne contient
   aucune annonce.
   build-categories.js produit ici une copie de category.html par entrée, avec
   ce texte inséré dans le corps du document. Le texte est donc servi par le
   serveur, pas ajouté après coup par un script : c'est la seule forme qui
   compte pour ce à quoi il sert.

   Ajouter une catégorie demande deux gestes : une entrée ici, et la règle de
   réécriture correspondante dans .htaccess (build-categories.js l'affiche à
   la fin de son exécution, il n'y a qu'à la recopier).

   On n'écrit une entrée que pour une catégorie qui contient réellement des
   annonces : une catégorie vide est marquée noindex par script.js, son texte
   ne serait jamais lu.

   `cat` doit reprendre EXACTEMENT la valeur qui apparaît dans l'URL, c'est
   à dire la période avec ses espaces remplacés par des tirets, telle que la
   produisent les liens du site. */

const CATEGORIES = [
  {
    slug: "guerre-napoleonienne",
    cat: "Guerre-Napoléonienne",
    titre: "Collectionner le militaria du Premier Empire",
    corps: `
        <p>
          Deux siècles séparent le collectionneur d'aujourd'hui des campagnes de 1803 à 1815.
          C'est la donnée qui commande tout le reste. Sur une pièce de cette période, la
          question n'est jamais de savoir si elle est belle, mais si elle a traversé deux
          cents ans, une industrie du souvenir née dès le XIXe siècle, et les
          commémorations du centenaire. La rareté y est réelle, les prix suivent, et les
          contrefaçons aussi.
        </p>
        <h3>Ce qui a traversé le temps</h3>
        <p>
          Le temps a trié les matériaux. Le métal et le papier subsistent, le textile
          beaucoup plus rarement : les grands ensembles d'uniformes sont conservés dans
          les collections publiques, et les pièces d'habillement authentiques ne se
          rencontrent qu'en petit nombre, chez quelques marchands spécialisés et en vente
          publique, à des prix élevés. Ce qui circule couramment sous ce nom relève le
          plus souvent de la reproduction destinée à la reconstitution. Ce que l'on rencontre réellement, ce
          sont des armes blanches, des armes à feu, des boutons de régiment, des plaques
          de shako, des décorations, et surtout des documents : congés, états de service,
          brevets, correspondance de soldats.
        </p>
        <h3>Lire une pièce, établir une provenance</h3>
        <p>
          Les armes blanches françaises de la période portent fréquemment, au dos de la
          lame, la mention de la manufacture qui les a produites. Le Klingenthal, en
          Alsace, et Versailles sont les deux noms que l'on croise le plus souvent. Ces
          marquages, la forme de la lame et le montage de la garde se recoupent : c'est
          l'ensemble qui authentifie une pièce, jamais un seul indice.
        </p>
        <p>
          Pour cette période plus que pour aucune autre, la provenance vaut autant que
          l'objet. Une pièce accompagnée de son histoire, d'une facture ancienne ou d'un
          passage en vente documenté se défend ; la même sans rien se discute
          indéfiniment. Le papier reste la porte d'entrée la plus accessible et la moins
          risquée. Nos conseils pour
          <a href="/guides/reconnaitre-un-faux-militaria">reconnaître un faux militaria</a>
          s'appliquent ici avec une acuité particulière, et
          <a href="/guides/entretien-militaria-cuir-textile-metal">l'entretien du cuir, du textile et du métal</a>
          devient une question de conservation à part entière.
        </p>`,
  },
  {
    slug: "1ere-guerre-mondiale",
    cat: "1ère-Guerre-Mondiale",
    titre: "Collectionner le militaria de la Grande Guerre",
    corps: `
        <p>
          De 1914 à 1918, la France mobilise environ huit millions d'hommes. Aucune guerre
          antérieure n'avait équipé autant de combattants, ni produit autant d'objets
          normalisés : c'est la première fois qu'un conflit laisse derrière lui un
          matériel de masse, fabriqué en série et marqué comme tel. Un siècle plus tard,
          cette abondance reste sensible sur le marché, malgré les récupérations, les
          refontes et l'usure du temps.
        </p>
        <h3>Les pièces emblématiques</h3>
        <p>
          Le casque Adrian, adopté en 1915, est la pièce emblématique de la période et le
          premier casque moderne distribué à grande échelle dans l'armée française, après
          la cervelière d'acier portée sous le képi à partir de février 1915. L'uniforme bleu horizon s'impose au cours de cette même année 1915,
          en remplacement d'une tenue héritée du siècle précédent. À côté de la dotation
          réglementaire, l'artisanat de tranchée occupe une place particulière : douilles
          repoussées, briquets, bagues et objets façonnés au front, souvent invérifiables
          et pourtant très recherchés.
        </p>
        <h3>Documents et points de vigilance</h3>
        <p>
          Les documents accompagnent rarement l'objet, et c'est précisément ce qui fait
          leur prix : livret militaire, citations, carte du combattant, photographies de
          groupe. Un ensemble ainsi attribué ancre la pièce dans une unité et dans un
          parcours, et se négocie nettement au-dessus d'une pièce anonyme.
        </p>
        <p>
          Les casques ont beaucoup vécu après 1918 : repeints, remontés,
          rééquipés d'attributs qui ne sont pas les leurs, ils demandent un examen posé.
          Notre guide pour
          <a href="/guides/identifier-casque-adrian-1915">identifier un casque Adrian de 1915</a>
          détaille les points à contrôler. Et l'artisanat de tranchée a été produit bien
          après la guerre, pour le marché du souvenir : la datation y repose sur le style
          et la provenance, rarement sur un marquage.
        </p>`,
  },
  {
    slug: "2nde-guerre-mondiale",
    cat: "2nde-Guerre-Mondiale",
    titre: "Collectionner le militaria de la Seconde Guerre mondiale",
    corps: `
        <p>
          C'est le domaine le plus collectionné, et par conséquent le plus falsifié. La
          raison tient à la nature du conflit : entre 1939 et 1945, plusieurs armées se
          succèdent et se croisent sur le sol français, si bien qu'un même département
          peut avoir vu passer des effets français, allemands, britanniques et
          américains. Le champ de collection est immense, les points d'entrée nombreux, et
          la documentation abondante.
        </p>
        <h3>Un champ de collection très large</h3>
        <p>
          Les casques donnent la mesure de cette diversité, du modèle allemand de 1935 au
          casque américain M1 apparu en 1941, chacun décliné en variantes de production
          que les collectionneurs distinguent finement. À côté, les effets de campagne,
          les insignes, les papiers d'unité et les objets de la vie quotidienne du soldat
          constituent l'essentiel de ce qui change de mains.
        </p>
        <h3>Authenticité et cadre légal</h3>
        <p>
          La contrepartie de cette popularité est une industrie de la reproduction ancienne
          et compétente. Les insignes sont les premiers concernés, parce qu'ils sont petits,
          chers au gramme et faciles à produire. Les marquages de fabricant, quand ils
          existent, donnent un premier repère, mais beaucoup de pièces d'époque n'en
          portent aucun et ces marques sont elles-mêmes copiées. Une pièce non marquée
          n'est donc pas suspecte par principe : c'est la cohérence de l'ensemble,
          matériau, tissage ou frappe, finition, usure et provenance, qui décide. Le récit du grenier providentiel ne vaut pas preuve.
          Notre guide pour
          <a href="/guides/reconnaitre-un-faux-militaria">reconnaître un faux militaria</a>
          reprend cette méthode en détail.
        </p>
        <p>
          Une part de ce matériel porte les insignes de régimes aujourd'hui dissous. Sur
          Athena Militaria, ces pièces sont présentées dans un cadre strict de collection
          et de mémoire, sans aucune valeur idéologique, et leur diffusion obéit à un
          encadrement légal précis, détaillé dans notre guide
          <a href="/guides/vendre-militaria-legalement-france">vendre du militaria légalement en France</a>.
        </p>`,
  },
  {
    slug: "guerre-froide",
    cat: "Guerre-froide",
    titre: "Collectionner le militaria de la Guerre froide",
    corps: `
        <p>
          De 1947 à 1991, l'Europe vit quarante ans de confrontation sans guerre générale.
          L'Alliance atlantique d'un côté, le pacte de Varsovie de l'autre, entretiennent et
          rééquipent sans interruption des armées de conscription qui comptent des millions
          d'hommes. Pour le collectionneur, cette période a une conséquence directe : le
          matériel a été produit en quantités considérables et n'a, pour l'essentiel, jamais
          servi au combat. C'est ce qui rend la Guerre froide plus abordable que les deux
          guerres mondiales, et ce qui en fait souvent une première collection.
        </p>
        <h3>Ce qui circule aujourd'hui</h3>
        <p>
          L'ouverture des pays de l'Est, après 1989, a déversé sur le marché occidental des
          stocks entiers restés en caisse. Uniformes, effets de campagne, masques à gaz,
          casques, coiffures et documents d'unité circulent aujourd'hui en abondance, aux
          côtés du matériel occidental réformé au fil des changements de dotation, du casque
          français modèle 1951 aux effets de l'armée américaine remplacés dans les années
          1980.
        </p>
        <h3>Lire les marquages, éviter les pièges</h3>
        <p>
          Le premier réflexe, sur une pièce de cette période, est de chercher les marquages.
          Les productions du bloc de l'Est sont presque toujours marquées, mais chaque pays a
          son code : l'URSS et la Pologne inscrivent le plus souvent l'année en entier à côté
          de la marque de fabrique, la Tchécoslovaquie deux épées croisées suivies des deux
          derniers chiffres de l'année, tandis que la RDA emploie à partir de 1968 une lettre
          de millésime, ce qui déroute quand on cherche des chiffres. Ces marques se trouvent
          à l'intérieur de la coiffe, sous une patte ou au revers d'une sangle. Le matériel de
          dotation occidentale porte fréquemment, à partir des années 1960, un numéro de
          nomenclature OTAN à treize chiffres qui permet d'identifier précisément l'article.
        </p>
        <p>
          Deux pièges à connaître. L'usure ne dit rien de l'âge : une part importante de ce
          qui se vend est du stock neuf, jamais porté, et un objet impeccable n'est pas pour
          autant récent. Et les pièces les plus recherchées, insignes et coiffures en tête,
          sont abondamment reproduites. Notre guide pour
          <a href="/guides/reconnaitre-un-faux-militaria">reconnaître un faux militaria</a>
          détaille les vérifications à faire avant l'achat. Sur les objets réglementés, armes
          neutralisées comprises, reportez-vous au guide
          <a href="/guides/vendre-militaria-legalement-france">vendre du militaria légalement en France</a>.
        </p>`,
  },

  /* --- Sous-catégories ---------------------------------------------------
     Une entrée par couple période + sous-catégorie. Chaque texte est propre à
     ce type d'objet pour cette période, et n'a de recouvrement ni avec la page
     de période ni avec les autres sous-catégories : les trois textes d'une même
     période ont été écrits ensemble pour cette raison.
     Le champ `sub` doit reprendre EXACTEMENT la valeur qui apparaît dans l'URL,
     telle que la produisent les liens de la barre latérale.
  ---------------------------------------------------------------------- */
  {
    slug: "guerre-napoleonienne-uniformes",
    cat: "Guerre-Napoléonienne",
    sub: "Uniformes",
    titre: "Collectionner les effets d'uniforme du Premier Empire",
    corps: `
        <p>Une part de ce qui se vend sous cette rubrique sort du sol. Les plaques de shako, les boutons et les plaques de giberne présentés par les maisons spécialisées sont souvent donnés comme trouvailles de champ de bataille ou de bivouac, et leur aspect s'en ressent : fragments plutôt que pièces entières, laiton corrodé et cassant, reliefs adoucis, dorure disparue. Une pièce annoncée comme trouvaille mais dont la surface reste régulière, sans piqûres ni différence de patine entre les creux et les arêtes, demande à être expliquée avant tout le reste.</p>
        <h3>Lire une plaque de shako</h3>
        <p>La plaque de shako dite modèle 1810 de l'infanterie de ligne est l'exemple le plus instructif. Losangique, en laiton estampé, elle porte le numéro du régiment au centre, dans un encadrement mouluré. Le modèle étant générique et le numéro seul distinctif, la tentation de transformer un régiment banal en régiment recherché existe depuis longtemps. Il faut donc regarder le revers avant l'avers. L'estampage d'origine laisse au dos le négatif exact du relief visible devant : un numéro rapporté, regravé ou soudé ne trouve pas son correspondant au verso. Les traces de brasure autour des pattes de fixation et la répartition de l'usure se lisent de la même façon.</p>
        <h3>Boutons et effets textiles</h3>
        <p>Pour les boutons, la forme, le diamètre et le type d'attache renseignent plus sûrement que le décor. Le marquage de fabricant au revers ne se généralise qu'après la période impériale : son absence n'est pas un défaut, sa présence demande à être expliquée. Une pièce estampée ne se confond pas avec une copie de fonte, dont le relief reste mou et la surface granuleuse. Sur les habits, la difficulté tient moins au tissu qu'à l'ensemble : beaucoup sont des remontages associant une base ancienne à des boutons et des passementeries rapportés.</p>`,
  },
  {
    slug: "guerre-napoleonienne-armes",
    cat: "Guerre-Napoléonienne",
    sub: "Armes",
    titre: "Collectionner les armes des guerres napoléoniennes",
    corps: `
        <p>L'arme à feu réglementaire domine cette catégorie, et un modèle y revient sans cesse : le fusil d'infanterie modèle 1777 corrigé an IX, produit à plus d'un million d'exemplaires par les manufactures de Charleville, Saint-Étienne, Maubeuge et Tulle. Cette abondance change la logique d'achat. Le modèle n'est pas rare en lui-même. Ce qui l'est, c'est un exemplaire complet, cohérent, resté dans sa configuration d'origine.</p>
        <h3>Dater par la platine et les poinçons</h3>
        <p>La platine porte le nom de la manufacture, et c'est par là que commence la datation. Le même fusil a été fabriqué sous l'Empire puis sous la Restauration, la mention impériale cédant la place à la mention royale. Une platine royale sur une arme vendue comme napoléonienne n'est pas une anomalie : elle situe la production après l'Empire, ce qui n'est pas la même chose. Les poinçons de contrôle frappés sur le canon, la platine et les garnitures doivent former un ensemble homogène. Des marquages d'aspect, de style et de profondeur très différents signalent un assemblage de pièces d'origines diverses, cas de loin le plus fréquent sur ce marché.</p>
        <h3>Le piège de la remise à silex</h3>
        <p>Le piège le plus courant reste la remise à silex. Beaucoup de ces armes ont été transformées à percussion au milieu du XIXe siècle, puis ramenées au silex bien plus tard pour satisfaire les collectionneurs. Il faut chercher autour de la lumière et du bassinet : un trou rebouché, une soudure reprise, un bois recreusé puis comblé le long de la platine, des vis dont les fentes n'ont pas l'usure du reste de l'arme. Un chien ou une batterie récents se repèrent à la vivacité des arêtes et à la régularité de la surface. Les mêmes réserves valent pour les pistolets et les mousquetons de cavalerie, souvent raccourcis, réassemblés ou complétés avec des pièces postérieures.</p>`,
  },
  {
    slug: "guerre-napoleonienne-documents",
    cat: "Guerre-Napoléonienne",
    sub: "Documents",
    titre: "Collectionner les documents du Premier Empire",
    corps: `
        <p>Un document se juge d'abord comme objet matériel, avant d'être lu. Le papier de la période est le plus souvent un vergé : tenu à contre-jour, il laisse voir les vergeures serrées et les pontuseaux plus espacés de la forme, parfois un filigrane. L'encre ferro-gallique brunit en vieillissant et mord la fibre, au point d'être perceptible au revers de la feuille. Une écriture restée noire, posée en surface sur un papier uniformément clair, n'appartient pas à cette époque.</p>
        <h3>Imprimé, manuscrit et cachets</h3>
        <p>Beaucoup de ces pièces sont des formulaires imprimés remplis à la main, avec un en-tête gravé où reviennent les trophées d'armes, l'aigle et les couronnes de laurier. L'imprimé et le manuscrit doivent avoir vieilli ensemble : un écart de ton entre les deux, ou une encre déposée par-dessus des plis déjà formés, appellent un examen plus long. Le timbre sec, la cire, les marques postales et le sens des pliures font partie de la lecture au même titre que le texte.</p>
        <h3>La signature, la plus imitée</h3>
        <p>La signature demande le plus de prudence. Les actes émis au nom de l'Empereur portent très majoritairement une signature de secrétaire ou une griffe, et c'est le contreseing du ministre qui les valide. Une signature impériale autographe relève d'un autre marché, et reste la plus imitée de toutes. Un fac-similé lithographié se trahit à la régularité mécanique du trait, à l'épaisseur constante des pleins et des déliés, et à une encre qui reste posée sur la surface sans mordre la fibre.</p>
        <p>L'intérêt d'un congé ou d'un état de service tient enfin au nom qu'il porte. Les contrôles de troupes conservés au Service historique de la Défense et les dossiers de Légion d'honneur numérisés dans la base Léonore permettent souvent de retrouver l'homme, son unité et ses campagnes. Un document recoupé vaut nettement plus qu'un document isolé.</p>`,
  },
  {
    slug: "1ere-guerre-mondiale-uniformes",
    cat: "1ère-Guerre-Mondiale",
    sub: "Uniformes",
    titre: "Collectionner les uniformes bleu horizon de 1914-1918",
    corps: `
        <p>La capote de troupe reste la pièce la plus présente sur le marché, devant la vareuse, le pantalon et les coiffures. Les effets d'officier, taillés chez un civil aux frais de l'intéressé, varient beaucoup d'un exemplaire à l'autre et suivent le règlement de façon souple. Les tenues complètes et homogènes, où toutes les pièces viennent du même homme, sont rares : la plupart des ensembles proposés ont été reconstitués pièce par pièce, ce qui n'est pas un défaut en soi mais doit être annoncé.</p>
        <h3>Ce que dit l'intérieur</h3>
        <p>L'examen commence par l'intérieur. La doublure de toile porte les tampons de fabrication et de réception, la taille, parfois un millésime, souvent délavés jusqu'à la limite du lisible. Le drap lui-même renseigne : le bleu horizon est obtenu par mélange de laines de teintes différentes, ce qui donne de près un aspect chiné que les tissus modernes rendent mal. Viennent ensuite les boutons, la nature des coutures, la reprise des poches, et surtout la cohérence des usures entre le col, les coudes et le bas des manches.</p>
        <h3>Les productions d'après-guerre</h3>
        <p>Le bleu horizon est resté en service longtemps après l'armistice, et des capotes ou vareuses fabriquées dans les années 1920 sont régulièrement présentées comme des effets de guerre. Les reproductions destinées à la reconstitution et au cinéma circulent depuis des décennies, parfois vieillies pour tromper. Enfin, la patte de collet se découd et se remplace en quelques minutes : un numéro de régiment recherché cousu sur une capote banale est une manipulation fréquente.</p>
        <p>Une capote de troupe en état moyen reste abordable. Les effets de chasseurs, de troupes coloniales, d'aviation ou de chars, et plus généralement toute pièce datée, marquée et non retouchée, se situent à un autre niveau.</p>`,
  },
  {
    slug: "1ere-guerre-mondiale-armes",
    cat: "1ère-Guerre-Mondiale",
    sub: "Armes",
    titre: "Collectionner les armes de la Grande Guerre",
    corps: `
        <p>Le fusil Lebel modèle 1886 modifié 1893 et les Berthier, fusil 1907-15, modèle 1916 et mousquetons, forment l'essentiel de l'offre française en armes longues. Viennent les revolvers réglementaires, les pistolets de fabrication espagnole achetés en masse pendant le conflit, et les armes blanches : baïonnettes, poignards, couteaux de tranchée. Le statut légal dépend du modèle et du calibre, et se vérifie avant l'achat.</p>
        <h3>Lire les marquages</h3>
        <p>Les armes réglementaires sont bavardes, à condition de lire au bon endroit. Le boîtier de culasse porte le nom de la manufacture d'État, Saint-Étienne, Châtellerault ou Tulle, et le modèle, mais pas la date : l'année de fabrication se lit sur le canon, précédée de l'initiale de la manufacture. Le numéro de série est repris sur plusieurs éléments, et sa concordance entre canon, boîtier, culasse mobile et garnitures est le premier point à contrôler. Le cartouche frappé dans la crosse complète la lecture quand le bois n'a pas été poncé.</p>
        <h3>Remaniements et pièces douteuses</h3>
        <p>Ces armes ont servi bien au-delà de 1918 et sont largement passées en atelier : reprises, raccourcies, rebronzées, parfois renumérotées. Une arme aux numéros dépareillés est un assemblage, courant sur le marché. Sur les baïonnettes, la suppression du quillon a été pratiquée pendant la guerre mais aussi longtemps après, et poignées comme fourreaux se remplacent sans laisser de trace.</p>
        <p>Le couteau de tranchée reste le cas le plus délicat. Le seul modèle réglementaire français, le poignard modèle 1916, porte au talon de lame la mention Le Vengeur de 1870 d'un côté et le nom du fabricant de l'autre. Plusieurs couteliers privés l'ont produit, et les marquages varient d'un exemplaire à l'autre sans que cela soit suspect. Il est resté en service jusqu'à la guerre suivante, et les exemplaires tardifs se vendent comme pièces de 1914-1918. Le reste relève de la fabrication d'atelier ou de fortune, qui se copie sans difficulté.</p>`,
  },
  {
    slug: "1ere-guerre-mondiale-medailles",
    cat: "1ère-Guerre-Mondiale",
    sub: "Médailles",
    titre: "Collectionner les médailles et décorations de 1914-1918",
    corps: `
        <p>Deux familles se croisent sur le marché. D'un côté les décorations attribuées pour un fait précis, Légion d'honneur, Médaille militaire, Croix de guerre. De l'autre les commémoratives, remises à tous les ayants droit : la médaille commémorative de la Grande Guerre, créée en 1920, et la médaille interalliée dite de la Victoire, créée en 1922. Frappées en très grand nombre, ces dernières restent parmi les objets les plus accessibles de la période, et leur intérêt tient presque entièrement à ce qui les accompagne.</p>
        <h3>Deux décorations à savoir lire</h3>
        <p>La croix de guerre, instituée en avril 1915, porte au revers les dates du conflit tel qu'il durait : 1914-1915 d'abord, puis 1914-1916, 1914-1917 et 1914-1918. Le millésime situe la frappe, pas nécessairement la citation. Le ruban compte autant que la croix : étoile de bronze pour une citation à l'ordre du régiment ou de la brigade, étoile d'argent pour la division, étoile de vermeil pour le corps d'armée, palme pour l'armée. Une croix séparée de son ruban perd l'essentiel de ce qu'elle dit.</p>
        <p>La médaille interalliée française existe en modèle officiel, gravé par Morlon et frappé à la Monnaie de Paris, et en plusieurs modèles de fabricants privés, de style différent et signés d'autres graveurs. Ce ne sont pas des copies mais des variantes d'époque, et elles se collectionnent comme telles.</p>
        <h3>Ce qui trompe : le montage</h3>
        <p>Ce qui trompe tient rarement à la médaille elle-même. Rubans remontés, étoiles ajoutées, barrettes composées par un vendeur pour étoffer un ensemble : la vérification consiste à rapprocher les décorations des citations et des états de service. Sans document, un groupe reste une hypothèse commode.</p>`,
  },
  {
    slug: "2nde-guerre-mondiale-uniformes",
    cat: "2nde-Guerre-Mondiale",
    sub: "Uniformes",
    titre: "Collectionner les uniformes de la Seconde Guerre mondiale",
    corps: `
        <p>La tenue complète d'un même homme est l'exception. Ce qui change de mains, ce sont des pièces isolées, vestes de campagne allemandes, battle-dress britanniques, effets américains, plus rarement des vareuses françaises de 1939, que l'acheteur réunit ensuite. Un ensemble dont les tailles, la coupe et l'usure concordent vaut nettement plus qu'une addition de bonnes pièces sans rapport entre elles, et c'est là que se joue l'essentiel de l'écart de prix.</p>
        <h3>Dater par l'intérieur</h3>
        <p>La datation passe par l'intérieur du vêtement. Sur les effets allemands, on lit des tampons d'intendance, des indications de taille et, jusqu'au début des années 1940, un nom de fabricant; à partir de 1943, ce nom cède la place à un numéro d'entreprise attribué à l'échelle du Reich. Le drap parle autant que l'étiquette: laine dense et régulière en début de guerre, mélanges de plus en plus chargés en fibres artificielles ensuite, teinte qui tire vers le gris terne. Côté britannique, la coupe de 1937 aux boutonnages dissimulés se distingue de la version simplifiée de 1940, aux boutons apparents. Les étiquettes de contrat américaines donnent souvent la lecture la plus directe.</p>
        <h3>Les pièces recomposées</h3>
        <p>La manipulation la plus fréquente ne consiste pas à fabriquer un faux vêtement, mais à enrichir un vrai. La veste est d'époque, les pattes de col et les écussons ajoutés ne le sont pas. Il faut regarder le fil, le pas de couture, le tissu resté plus clair sous un insigne déposé, les anciens trous d'aiguille. Enfin, les tailles portées à l'époque sont petites, les trous de mite banals sur la laine, et les reproductions destinées à la reconstitution ont parfois quarante ans de vieillissement derrière elles.</p>`,
  },
  {
    slug: "2nde-guerre-mondiale-armes",
    cat: "2nde-Guerre-Mondiale",
    sub: "Armes",
    titre: "Collectionner les armes de la Seconde Guerre mondiale",
    corps: `
        <p>Le mot recouvre des réalités juridiques très différentes. Les armes blanches de la période, baïonnettes en tête, s'acquièrent et se détiennent librement en France par une personne majeure. Les armes à feu relèvent d'un classement, et l'arme neutralisée elle-même n'est pas en vente libre : sa cession passe par un armurier et une déclaration, avec le certificat et le marquage de neutralisation qui doivent l'accompagner. Vérifier ce statut avant l'achat fait partie de l'examen de l'objet, au même titre que celui du métal.</p>
        <h3>Lire une baïonnette</h3>
        <p>Sur une baïonnette allemande, la lecture commence au talon de la lame. Le nom du fabricant y est frappé jusqu'en 1940, année où un code de trois lettres minuscules le remplace ; le millésime sur deux chiffres et les poinçons de réception militaire complètent l'ensemble. La concordance des numéros entre la lame et le fourreau pèse lourd sur le prix : une paire assortie se paie nettement plus cher, ce qui explique que des numéros aient été refrappés pour en constituer.</p>
        <h3>Les dagues, les plus copiées</h3>
        <p>Les dagues de sortie allemandes comptent parmi les objets les plus reproduits de tout le militaria. Leur fabrication s'arrête en 1945, mais la copie démarre dans les années 1960, à Solingen même puis à Toledo, et bien plus tard en Asie ; les logos de fabricant sont reproduits au passage. S'y ajoutent les lames repolies puis regravées et les pièces remontées à partir d'éléments d'origines diverses. Du côté des armes d'épaule, la confusion la plus banale oppose les productions de guerre aux fabrications ou remises en état d'après-guerre, dont les modèles restent très proches. Sur les armes américaines, un assemblage de pièces de fournisseurs et de dates différentes est la règle plutôt que l'anomalie, la révision en arsenal ayant été systématique.</p>`,
  },
  {
    slug: "2nde-guerre-mondiale-objets-divers",
    cat: "2nde-Guerre-Mondiale",
    sub: "Objets-divers",
    titre: "Collectionner les objets divers de la Seconde Guerre mondiale",
    corps: `
        <p>C'est par cette catégorie que l'on entre dans la collection sans y engager de grosses sommes, et c'est elle qui documente le mieux la vie matérielle du soldat : gamelles, bidons, quarts, étuis, lampes, boussoles, mais aussi papiers militaires, courrier, photographies et petits effets personnels. Les prix restent accessibles tant que la pièce est anonyme ; ils changent d'échelle dès qu'un nom, une unité et une date se recoupent sur plusieurs objets d'un même ensemble.</p>
        <h3>Dater par la matière</h3>
        <p>Le matériel de campagne se date par la matière autant que par le marquage. Les bidons allemands ont un corps en aluminium jusqu'au début des années 1940, puis en acier peint ou émaillé quand l'aluminium est réservé à d'autres usages. La même logique d'appauvrissement se lit sur les accessoires : la housse de feutre laisse place à une matière de substitution en fibres pressées imprégnées de résine, les sangles de cuir à du tissu tissé, les ferrures deviennent plus grossières. Un objet de fin de guerre mal fini n'est donc pas suspect par sa grossièreté même.</p>
        <h3>Ce qui trompe</h3>
        <p>Deux pièges dominent. Le premier tient à la continuité d'après-guerre : bien des modèles américains ont été refabriqués à l'identique jusque dans les années 1950 et 1960, et seule la date portée sur la pièce sépare le matériel de guerre du suivant. Le second concerne les papiers, où l'ajout d'un tampon, d'une mention ou d'une affectation prestigieuse sur un livret authentique demande peu de moyens. Il faut y comparer les encres, les écritures et la cohérence des dates entre elles. Enfin, les objets de fouille, corrodés et souvent remontés, ne se comparent pas aux pièces sorties de stock, et le petit artisanat à partir de douilles s'est poursuivi longtemps après 1945.</p>`,
  },
  {
    slug: "guerre-froide-uniformes",
    cat: "Guerre-froide",
    sub: "Uniformes",
    titre: "Collectionner les uniformes de la Guerre froide (1947-1991)",
    corps: `
        <p>Le marché sépare deux familles. D'un côté les tenues de service et de sortie, en drap ou en gabardine, avec passepoils d'arme et pattes d'épaule amovibles, surtout venues de l'Est et encore complètes. De l'autre les tenues de combat, dont la valeur tient au modèle plus qu'à l'état. Le treillis français modèle 1947 et ses variantes, puis le satin 300 et le modèle F1, couvrent à eux seuls presque toute la période. Les tenues de travail américaines en coton vert olive cèdent la place au camouflage boisé au début des années 1980.</p>
        <h3>Dater par la coupe</h3>
        <p>La coupe date mieux qu'une étiquette. L'armée soviétique abandonne en 1969 la gimnastiorka, tunique enfilée par la tête et fermée par une courte patte de boutonnage, au profit d'une vareuse boutonnée sur toute la hauteur. Une tunique du premier type appartient donc au début de la période, le remplacement s'étant étalé sur quelques années. En République démocratique allemande, le camouflage à traits verticaux dit Strichtarn remplace à partir de 1965 un motif à taches en service depuis la fin des années 1950. La matière compte autant : le coton pur domine les deux premières décennies, les mélanges synthétiques et les fermetures à glissière en plastique se généralisent ensuite.</p>
        <h3>Ce qui trompe</h3>
        <p>Trois pièges reviennent. Les insignes et les pattes d'épaule se rapportent sans difficulté sur une tenue vierge : il faut regarder l'envers du tissu, la couleur du fil et la décoloration autour de l'emplacement. Les tenues d'officier soviétiques ont été largement remontées après 1991 à partir d'éléments d'origine, avec des grades et des couleurs d'arme choisis pour la vente. Enfin, les tailles de l'Est suivent des tables nationales étrangères aux tailles françaises : il faut demander les mesures à plat, épaules, poitrine et longueur de manche, plutôt que se fier au chiffre inscrit.</p>`,
  },
  {
    slug: "guerre-froide-documents",
    cat: "Guerre-froide",
    sub: "Documents",
    titre: "Collectionner les documents militaires de la Guerre froide (1947-1991)",
    corps: `
        <p>Le papier est la part la moins chère et la plus documentaire de la période. Circulent en nombre les livrets individuels et les fascicules de mobilisation français, les billets militaires soviétiques que chaque appelé conservait à vie, les livrets de service est-allemands, les titres de permission, les ordres de mission et les feuilles de route. À côté de ces pièces nominatives vient la littérature de service : manuels techniques, règlements d'emploi, notices d'armement et mémentos d'instruction, tirés à des dizaines de milliers d'exemplaires, donc peu coûteux, mais utiles pour identifier un matériel ou dater une dotation.</p>
        <h3>Le cas des cartes</h3>
        <p>La cartographie forme une famille à part. Le service topographique de l'état-major soviétique a cartographié la quasi-totalité des terres émergées aux échelles moyennes, et l'Europe jusqu'aux échelles les plus détaillées, sur des feuilles portant une mention de classification ; le démantèlement des dépôts après 1991 en a mis beaucoup en circulation. Une feuille se lit en marge : année d'établissement, année de mise à jour, service producteur et nomenclature de découpage y figurent. C'est un des rares documents de la période dont la datation ne demande aucune expertise.</p>
        <h3>Authentifier par la cohérence</h3>
        <p>L'authentification tient à la cohérence interne. Un livret réellement utilisé montre plusieurs écritures et plusieurs encres, des tampons appliqués à des dates éloignées et donc d'usure inégale, des pliures et un jaunissement réguliers sur toute l'épaisseur. Le faux courant n'est pas un document fabriqué de toutes pièces mais un exemplaire vierge, disponible par cartons, rempli après coup au nom d'une unité qui fait vendre : troupes aéroportées, formations stationnées à Berlin, services spécialisés. Un tampon net et une écriture unique sur un papier par ailleurs sali doivent arrêter l'achat. Un ensemble nominatif complet, livret, photographies et effets d'un même homme, vaut nettement plus que la somme de ses éléments : le disperser détruit sa valeur.</p>`,
  },
  {
    slug: "guerre-froide-equipements",
    cat: "Guerre-froide",
    sub: "Équipements",
    titre: "Collectionner les équipements de campagne de la Guerre froide (1947-1991)",
    corps: `
        <p>L'équipement recouvre ici le portage et le nécessaire individuel : ceinturons et brelages, porte-chargeurs, musettes, sacs à dos, gourdes et quarts, gamelles, étuis d'outil de retranchement, trousses d'entretien. Ces effets étant distribués par dotations complètes, il reste possible de reconstituer un paquetage entier plutôt que d'aligner des pièces isolées. Les écarts internes sont pourtant nets : les modèles des premières années, retirés tôt, se rencontrent beaucoup moins que ceux des années 1970 et 1980, restés en service jusqu'à la dissolution des armées qui les employaient.</p>
        <h3>Dater par la matière</h3>
        <p>La matière date mieux que l'aspect. Côté américain, le passage de la toile de coton au nylon est le repère principal : les modèles en toile des années 1950 laissent place à des équipements synthétiques dans la seconde moitié des années 1960, puis au système ALICE adopté en 1973, avec ses boucles moulées caractéristiques. Côté soviétique, la toile enduite et la bâche restent la règle jusqu'à la fin, avec des fermetures en bakélite ou en acier peint, tandis que l'aluminium des premières décennies recule devant les matières plastiques.</p>
        <h3>L'ensemble recomposé</h3>
        <p>Le piège dominant est l'ensemble recomposé : un brelage de fabrication récente, deux poches d'origine et une gourde d'un autre pays, vendus comme une dotation. Il faut vérifier que les pièces partagent la même teinte, la même quincaillerie et la même finition de couture, un fabricant changeant rarement de méthode d'une pièce à l'autre. Depuis les années 1990, la demande des reconstituants a fait produire en série des copies de poches et de sacs de l'Est, convaincantes de loin, reconnaissables au fil synthétique brillant et aux œillets trop réguliers. Sur tout ce qui comporte du caoutchouc, la matière durcit et se fend : un article de protection ancien se conserve, il ne s'utilise pas.</p>`,
  },
];

module.exports = { CATEGORIES };
