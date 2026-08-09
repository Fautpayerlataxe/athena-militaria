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
        <p>
          Le casque Adrian, adopté en 1915, est la pièce emblématique de la période et le
          premier casque moderne distribué à grande échelle dans l'armée française, après
          la cervelière d'acier portée sous le képi à partir de février 1915. L'uniforme bleu horizon s'impose au cours de cette même année 1915,
          en remplacement d'une tenue héritée du siècle précédent. À côté de la dotation
          réglementaire, l'artisanat de tranchée occupe une place particulière : douilles
          repoussées, briquets, bagues et objets façonnés au front, souvent invérifiables
          et pourtant très recherchés.
        </p>
        <p>
          Les documents accompagnent rarement l'objet, et c'est précisément ce qui fait
          leur prix : livret militaire, citations, carte du combattant, photographies de
          groupe. Un ensemble ainsi attribué ancre la pièce dans une unité et dans un
          parcours, et se négocie nettement au-dessus d'une pièce anonyme.
        </p>
        <p>
          Deux vigilances. Les casques ont beaucoup vécu après 1918 : repeints, remontés,
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
        <p>
          Les casques donnent la mesure de cette diversité, du modèle allemand de 1935 au
          casque américain M1 apparu en 1941, chacun décliné en variantes de production
          que les collectionneurs distinguent finement. À côté, les effets de campagne,
          les insignes, les papiers d'unité et les objets de la vie quotidienne du soldat
          constituent l'essentiel de ce qui change de mains.
        </p>
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
        <p>
          L'ouverture des pays de l'Est, après 1989, a déversé sur le marché occidental des
          stocks entiers restés en caisse. Uniformes, effets de campagne, masques à gaz,
          casques, coiffures et documents d'unité circulent aujourd'hui en abondance, aux
          côtés du matériel occidental réformé au fil des changements de dotation, du casque
          français modèle 1951 aux effets de l'armée américaine remplacés dans les années
          1980.
        </p>
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
];

module.exports = { CATEGORIES };
