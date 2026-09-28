/* Contexte historique propre à chaque page de catégorie.

   Pourquoi ce fichier existe. category.html est un fichier unique servi pour
   toutes les périodes : /category?cat=Guerre-froide et
   /category?cat=2nde-Guerre-Mondiale renvoyaient le même document, au bit
   près, le tri étant fait dans le navigateur. Deux adresses distinctes pour
   un seul contenu, donc rien qui distingue une période d'une autre aux yeux
   d'un moteur, et une page vide de sens quand la catégorie ne contient
   aucune annonce.
   build-categories.cjs produit ici une copie de category.html par entrée, avec
   ce texte inséré dans le corps du document. Le texte est donc servi par le
   serveur, pas ajouté après coup par un script : c'est la seule forme qui
   compte pour ce à quoi il sert.

   Ajouter une catégorie ne demande qu'une entrée ici : category.php la
   trouve d'après inc/categories.json, écrit par build-categories.cjs.

   On n'écrit une entrée que pour une catégorie qui contient réellement des
   annonces : une catégorie vide est marquée noindex par script.js, son texte
   ne serait jamais lu.

   `periode` et `type` reprennent EXACTEMENT les valeurs enregistrées en base
   (taxonomie.js) : c'est sur elles que category.php choisit la copie à
   servir, quelle que soit l'adresse. */

const CATEGORIES = [
  {
    slug: "guerre-napoleonienne",
    periode: "Guerre Napoléonienne",
    titre: "Collectionner le militaria de la Révolution et du Premier Empire",
    corps: `
        <p>
          Pour le collectionneur, la période s'ouvre avec les guerres de la Révolution, en
          1792, et se referme à Waterloo. Armées de la République, du Consulat puis de
          l'Empire se succèdent sans rupture matérielle : le fusil modèle 1777, corrigé
          en l'an IX, arme les unes comme les autres, et les mêmes manufactures les
          équipent d'un régime à l'autre.
        </p>
        <p>
          Plus de deux siècles séparent le collectionneur d'aujourd'hui de ces campagnes.
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
    titre_en: "Collecting Revolutionary and First Empire militaria",
    corps_en: `
        <p>
          For the collector, the period opens with the wars of the Revolution in 1792 and
          closes at Waterloo. The armies of the Republic, the Consulate and then the Empire
          follow one another without any material break: the model 1777 musket, corrected
          in Year IX, arms them all, and the same factories equip them from one regime to
          the next.
        </p>
        <p>
          More than two centuries separate today's collector from these campaigns. That is
          the fact that governs everything else. With a piece from this period, the question
          is never whether it is beautiful, but whether it has come through two hundred years,
          a souvenir industry born as early as the nineteenth century, and the centenary
          commemorations. Rarity is real here, prices follow, and so do forgeries.
        </p>
        <h3>What has survived</h3>
        <p>
          Time has sorted the materials. Metal and paper survive, textiles far more rarely:
          the great uniform ensembles are held in public collections, and genuine items of
          clothing appear only in small numbers, with a few specialist dealers and at public
          auction, at high prices. What commonly circulates under that name is most often
          reproduction made for re-enactment. What you actually meet are edged weapons,
          firearms, regimental buttons, shako plates, decorations and, above all, documents:
          discharge papers, service records, award certificates, soldiers' letters.
        </p>
        <h3>Reading a piece, establishing a provenance</h3>
        <p>
          French edged weapons of the period frequently carry, on the back of the blade, the
          name of the factory that made them. Klingenthal, in Alsace, and Versailles are the
          two names met most often. These markings, the shape of the blade and the mounting of
          the hilt cross-check one another: it is the whole that authenticates a piece, never a
          single clue.
        </p>
        <p>
          For this period more than any other, provenance is worth as much as the object. A
          piece that comes with its history, an old invoice or a documented auction appearance
          can be defended; the same piece with nothing is argued over endlessly. Paper remains
          the most accessible and least risky way in. Our advice on
          <a href="/guides/reconnaitre-un-faux-militaria">spotting fake militaria</a> applies here
          with particular force, and <a href="/guides/entretien-militaria-cuir-textile-metal">caring
          for leather, textile and metal</a> becomes a conservation question in its own right.
        </p>
`,
  },
  {
    slug: "1ere-guerre-mondiale",
    periode: "1ère Guerre Mondiale",
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
          parcours, et se négocie nettement au-dessus d'une pièce anonyme. Pour retrouver les décorations d'un soldat, voyez
          <a href="/guides/titulaires-croix-de-guerre-14-18">retrouver les décorations d'un soldat de 14-18</a>.
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
    titre_en: "Collecting Great War militaria",
    corps_en: `
        <p>
          From 1914 to 1918, France mobilised some eight million men. No earlier war had
          equipped so many combatants, nor produced so many standardised objects: it was the
          first conflict to leave behind mass-produced equipment, made in series and marked as
          such. A century later, that abundance is still felt on the market, despite salvage,
          melting down and the wear of time.
        </p>
        <h3>The emblematic pieces</h3>
        <p>
          The Adrian helmet, adopted in 1915, is the emblematic piece of the period and the
          first modern helmet issued on a large scale in the French army, after the steel
          skullcap worn under the kepi from February 1915. The horizon-blue uniform took over
          during that same year, replacing a dress inherited from the previous century.
          Alongside regulation issue, trench art holds a special place: embossed shell cases,
          lighters, rings and objects made at the front, often impossible to verify and yet
          much sought after.
        </p>
        <h3>Documents and points of caution</h3>
        <p>
          Documents rarely stay with the object, and that is precisely what makes them
          valuable: service book, citations, veteran's card, group photographs. A group
          attributed in this way anchors the piece in a unit and a service history, and sells
          well above an anonymous piece. To trace a soldier's decorations, see
          <a href="/guides/titulaires-croix-de-guerre-14-18">tracing a French WW1 soldier's decorations</a>.
        </p>
        <p>
          Helmets had a long life after 1918: repainted, reassembled, refitted with badges that
          are not their own, they call for a careful examination. Our guide to
          <a href="/guides/identifier-casque-adrian-1915">identifying a 1915 Adrian helmet</a>
          sets out the points to check. And trench art went on being made long after the war,
          for the souvenir market: dating it rests on style and provenance, rarely on a marking.
        </p>
`,
  },
  {
    slug: "2nde-guerre-mondiale",
    periode: "2nde Guerre Mondiale",
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
    titre_en: "Collecting Second World War militaria",
    corps_en: `
        <p>
          It is the most collected field, and therefore the most faked. The reason lies in the
          nature of the conflict: between 1939 and 1945, several armies followed and crossed one
          another on French soil, so that a single département may have seen French, German,
          British and American equipment pass through. The field is immense, the ways in are
          many, and the literature is abundant.
        </p>
        <h3>A very wide field</h3>
        <p>
          Helmets give the measure of this diversity, from the German 1935 model to the American
          M1 introduced in 1941, each produced in variants that collectors distinguish closely.
          Alongside them, field equipment, insignia, unit papers and the everyday objects of the
          soldier's life make up most of what changes hands.
        </p>
        <h3>Authenticity and the legal framework</h3>
        <p>
          The price of this popularity is a long-established and skilled reproduction industry.
          Insignia are the first affected, because they are small, expensive by weight and easy
          to produce. Maker's marks, where they exist, give a first reference, but many period
          pieces carry none and the marks themselves are copied. An unmarked piece is therefore
          not suspect in principle: it is the consistency of the whole, material, weave or
          striking, finish, wear and provenance, that decides. The story of the providential
          attic is not proof. Our guide to <a href="/guides/reconnaitre-un-faux-militaria">spotting
          fake militaria</a> sets out this method in detail.
        </p>
        <p>
          Part of this material bears the insignia of regimes that no longer exist. On Athena
          Militaria, such pieces are presented strictly as collection and memory items, with no
          ideological value, and their circulation is subject to a precise legal framework,
          detailed in our guide to <a href="/guides/vendre-militaria-legalement-france">selling
          militaria legally in France</a>.
        </p>
`,
  },
  {
    slug: "guerre-froide",
    periode: "Guerre froide",
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
    titre_en: "Collecting Cold War militaria",
    corps_en: `
        <p>
          From 1947 to 1991, Europe lived through forty years of confrontation without a general
          war. The Atlantic Alliance on one side and the Warsaw Pact on the other maintained and
          re-equipped, without interruption, conscript armies numbering millions of men. For the
          collector, the period has a direct consequence: equipment was produced in considerable
          quantities and, for the most part, never saw combat. That is what makes the Cold War
          more affordable than the two world wars, and why it is often a first collection.
        </p>
        <h3>What circulates today</h3>
        <p>
          The opening of the Eastern bloc after 1989 poured entire stocks, still in their crates,
          onto the Western market. Uniforms, field equipment, gas masks, helmets, headgear and
          unit documents circulate in abundance today, alongside Western equipment struck off as
          issue changed, from the French model 1951 helmet to American items replaced in the
          1980s.
        </p>
        <h3>Reading markings, avoiding traps</h3>
        <p>
          The first reflex with a piece from this period is to look for markings. Eastern bloc
          production is almost always marked, but each country has its own code: the USSR and
          Poland usually stamp the full year next to the factory mark, Czechoslovakia two crossed
          swords followed by the last two digits of the year, while East Germany used a year
          letter from 1968, which is confusing when you are looking for figures. These marks are
          found inside the headgear, under a flap or on the back of a strap. Western issue
          equipment frequently carries, from the 1960s, a thirteen-digit NATO stock number that
          identifies the item precisely.
        </p>
        <p>
          Two traps to know. Wear says nothing about age: a large share of what is sold is new
          old stock, never worn, and an immaculate object is not therefore recent. And the most
          sought-after pieces, insignia and headgear first, are widely reproduced. Our guide to
          <a href="/guides/reconnaitre-un-faux-militaria">spotting fake militaria</a> details the
          checks to make before buying. For regulated items, deactivated weapons included, see
          the guide to <a href="/guides/vendre-militaria-legalement-france">selling militaria
          legally in France</a>.
        </p>
`,
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
    periode: "Guerre Napoléonienne",
    type: "Uniformes",
    titre: "Collectionner les effets d'uniforme du Premier Empire",
    corps: `
        <p>Une part de ce qui se vend sous cette rubrique sort du sol. Les plaques de shako, les boutons et les plaques de giberne présentés par les maisons spécialisées sont souvent donnés comme trouvailles de champ de bataille ou de bivouac, et leur aspect s'en ressent : fragments plutôt que pièces entières, laiton corrodé et cassant, reliefs adoucis, dorure disparue. Une pièce annoncée comme trouvaille mais dont la surface reste régulière, sans piqûres ni différence de patine entre les creux et les arêtes, demande à être expliquée avant tout le reste.</p>
        <h3>Lire une plaque de shako</h3>
        <p>La plaque de shako dite modèle 1810 de l'infanterie de ligne est l'exemple le plus instructif. Losangique, en laiton estampé, elle porte le numéro du régiment au centre, dans un encadrement mouluré. Le modèle étant générique et le numéro seul distinctif, la tentation de transformer un régiment banal en régiment recherché existe depuis longtemps. Il faut donc regarder le revers avant l'avers. L'estampage d'origine laisse au dos le négatif exact du relief visible devant : un numéro rapporté, regravé ou soudé ne trouve pas son correspondant au verso. Les traces de brasure autour des pattes de fixation et la répartition de l'usure se lisent de la même façon.</p>
        <h3>Boutons et effets textiles</h3>
        <p>Pour les boutons, la forme, le diamètre et le type d'attache renseignent plus sûrement que le décor. Le marquage de fabricant au revers ne se généralise qu'après la période impériale : son absence n'est pas un défaut, sa présence demande à être expliquée. Une pièce estampée ne se confond pas avec une copie de fonte, dont le relief reste mou et la surface granuleuse. Sur les habits, la difficulté tient moins au tissu qu'à l'ensemble : beaucoup sont des remontages associant une base ancienne à des boutons et des passementeries rapportés.</p>`,
    titre_en: "Collecting First Empire uniform items",
    corps_en: `
        <p>Part of what is sold under this heading comes out of the ground. The shako plates, buttons and cartridge-box plates offered by specialist dealers are often presented as battlefield or bivouac finds, and their appearance shows it: fragments rather than whole pieces, corroded and brittle brass, softened relief, gilding gone. A piece described as a find whose surface remains even, with no pitting and no difference in patina between hollows and edges, needs explaining before anything else.</p>
        <h3>Reading a shako plate</h3>
        <p>The so-called model 1810 shako plate of the line infantry is the most instructive example. Lozenge-shaped, in stamped brass, it carries the regiment's number in the centre, within a moulded frame. Since the model is generic and the number alone distinctive, the temptation to turn an ordinary regiment into a sought-after one has existed for a long time. So look at the back before the front. The original stamping leaves on the reverse the exact negative of the relief visible on the front: a number that has been added, re-engraved or soldered has no counterpart on the back. Traces of brazing around the fixing lugs and the distribution of wear are read the same way.</p>
        <h3>Buttons and textile items</h3>
        <p>For buttons, shape, diameter and type of shank say more than the design. A maker's mark on the back only became widespread after the imperial period: its absence is not a flaw, its presence needs explaining. A stamped piece is not to be confused with a cast copy, whose relief stays soft and whose surface is grainy. With coats, the difficulty lies less in the cloth than in the whole: many are reassemblies combining an old base with added buttons and lace.</p>
`,
  },
  {
    slug: "guerre-napoleonienne-armes",
    periode: "Guerre Napoléonienne",
    type: "Armes (neutralisées/maquettes)",
    titre: "Collectionner les armes des guerres napoléoniennes",
    corps: `
        <p>L'arme à feu réglementaire domine cette catégorie, et un modèle y revient sans cesse : le fusil d'infanterie modèle 1777 corrigé an IX, produit à plus d'un million d'exemplaires par les manufactures de Charleville, Saint-Étienne, Maubeuge et Tulle. Cette abondance change la logique d'achat. Le modèle n'est pas rare en lui-même. Ce qui l'est, c'est un exemplaire complet, cohérent, resté dans sa configuration d'origine.</p>
        <h3>Dater par la platine et les poinçons</h3>
        <p>La platine porte le nom de la manufacture, et c'est par là que commence la datation. Le même fusil a été fabriqué sous l'Empire puis sous la Restauration, la mention impériale cédant la place à la mention royale. Une platine royale sur une arme vendue comme napoléonienne n'est pas une anomalie : elle situe la production après l'Empire, ce qui n'est pas la même chose. Les poinçons de contrôle frappés sur le canon, la platine et les garnitures doivent former un ensemble homogène. Des marquages d'aspect, de style et de profondeur très différents signalent un assemblage de pièces d'origines diverses, cas de loin le plus fréquent sur ce marché.</p>
        <h3>Le piège de la remise à silex</h3>
        <p>Le piège le plus courant reste la remise à silex. Beaucoup de ces armes ont été transformées à percussion au milieu du XIXe siècle, puis ramenées au silex bien plus tard pour satisfaire les collectionneurs. Il faut chercher autour de la lumière et du bassinet : un trou rebouché, une soudure reprise, un bois recreusé puis comblé le long de la platine, des vis dont les fentes n'ont pas l'usure du reste de l'arme. Un chien ou une batterie récents se repèrent à la vivacité des arêtes et à la régularité de la surface. Les mêmes réserves valent pour les pistolets et les mousquetons de cavalerie, souvent raccourcis, réassemblés ou complétés avec des pièces postérieures.</p>`,
    titre_en: "Collecting Napoleonic Wars weapons",
    corps_en: `
        <p>The regulation firearm dominates this category, and one model comes up again and again: the model 1777 infantry musket corrected in Year IX, produced in more than a million examples by the factories of Charleville, Saint-Étienne, Maubeuge and Tulle. That abundance changes the logic of buying. The model is not rare in itself. What is rare is a complete, consistent example that has kept its original configuration.</p>
        <h3>Dating by the lock and the proof marks</h3>
        <p>The lock carries the name of the factory, and that is where dating begins. The same musket was made under the Empire and then under the Restoration, the imperial inscription giving way to the royal one. A royal lock on a weapon sold as Napoleonic is not an anomaly: it places production after the Empire, which is not the same thing. The inspection marks struck on the barrel, the lock and the furniture should form a consistent set. Markings very different in appearance, style and depth indicate an assembly of parts from different sources, by far the most frequent case on this market.</p>
        <h3>The flintlock reconversion trap</h3>
        <p>The commonest trap remains reconversion to flintlock. Many of these weapons were converted to percussion in the middle of the nineteenth century, then turned back to flint much later to please collectors. Look around the touch hole and the pan: a plugged hole, reworked welding, wood recut and then filled along the lock, screws whose slots lack the wear of the rest of the weapon. A recent cock or frizzen shows in the sharpness of its edges and the regularity of its surface. The same reservations apply to pistols and cavalry carbines, often shortened, reassembled or completed with later parts.</p>
`,
  },
  {
    slug: "guerre-napoleonienne-documents",
    periode: "Guerre Napoléonienne",
    type: "Documents",
    titre: "Collectionner les documents du Premier Empire",
    corps: `
        <p>Un document se juge d'abord comme objet matériel, avant d'être lu. Le papier de la période est le plus souvent un vergé : tenu à contre-jour, il laisse voir les vergeures serrées et les pontuseaux plus espacés de la forme, parfois un filigrane. L'encre ferro-gallique brunit en vieillissant et mord la fibre, au point d'être perceptible au revers de la feuille. Une écriture restée noire, posée en surface sur un papier uniformément clair, n'appartient pas à cette époque.</p>
        <h3>Imprimé, manuscrit et cachets</h3>
        <p>Beaucoup de ces pièces sont des formulaires imprimés remplis à la main, avec un en-tête gravé où reviennent les trophées d'armes, l'aigle et les couronnes de laurier. L'imprimé et le manuscrit doivent avoir vieilli ensemble : un écart de ton entre les deux, ou une encre déposée par-dessus des plis déjà formés, appellent un examen plus long. Le timbre sec, la cire, les marques postales et le sens des pliures font partie de la lecture au même titre que le texte.</p>
        <h3>La signature, la plus imitée</h3>
        <p>La signature demande le plus de prudence. Les actes émis au nom de l'Empereur portent très majoritairement une signature de secrétaire ou une griffe, et c'est le contreseing du ministre qui les valide. Une signature impériale autographe relève d'un autre marché, et reste la plus imitée de toutes. Un fac-similé lithographié se trahit à la régularité mécanique du trait, à l'épaisseur constante des pleins et des déliés, et à une encre qui reste posée sur la surface sans mordre la fibre.</p>
        <p>L'intérêt d'un congé ou d'un état de service tient enfin au nom qu'il porte. Les contrôles de troupes conservés au Service historique de la Défense et les dossiers de Légion d'honneur numérisés dans la base Léonore permettent souvent de retrouver l'homme, son unité et ses campagnes. Un document recoupé vaut nettement plus qu'un document isolé.</p>`,
    titre_en: "Collecting First Empire documents",
    corps_en: `
        <p>A document is judged first as a physical object, before it is read. Paper of the period is most often laid paper: held against the light, it shows the close chain lines and the more widely spaced laid lines of the mould, sometimes a watermark. Iron gall ink browns with age and bites into the fibre, to the point of showing through on the back of the sheet. Writing that has stayed black, sitting on the surface of a uniformly pale paper, does not belong to this period.</p>
        <h3>Print, manuscript and seals</h3>
        <p>Many of these pieces are printed forms filled in by hand, with an engraved heading featuring trophies of arms, the eagle and laurel wreaths. Print and handwriting should have aged together: a difference in tone between the two, or ink laid over folds that had already formed, calls for a longer examination. The blind stamp, the wax, the postal marks and the direction of the folds are part of the reading just as much as the text.</p>
        <h3>The signature, the most imitated</h3>
        <p>The signature calls for the most caution. Documents issued in the Emperor's name overwhelmingly carry a secretary's signature or a stamped one, and it is the minister's countersignature that validates them. An autograph imperial signature belongs to another market, and remains the most imitated of all. A lithographed facsimile gives itself away through the mechanical regularity of the line, the constant thickness of the strokes, and ink that sits on the surface without biting into the fibre.</p>
        <p>Finally, the interest of a discharge paper or a service record lies in the name it bears. The muster rolls kept at the Service historique de la Défense and the Legion of Honour files digitised in the Léonore database often make it possible to find the man, his unit and his campaigns. A cross-checked document is worth much more than an isolated one.</p>
`,
  },
  {
    slug: "1ere-guerre-mondiale-uniformes",
    periode: "1ère Guerre Mondiale",
    type: "Uniformes",
    titre: "Collectionner les uniformes bleu horizon de 1914-1918",
    corps: `
        <p>La capote de troupe reste la pièce la plus présente sur le marché, devant la vareuse, le pantalon et les coiffures. Les effets d'officier, taillés chez un civil aux frais de l'intéressé, varient beaucoup d'un exemplaire à l'autre et suivent le règlement de façon souple. Les tenues complètes et homogènes, où toutes les pièces viennent du même homme, sont rares : la plupart des ensembles proposés ont été reconstitués pièce par pièce, ce qui n'est pas un défaut en soi mais doit être annoncé.</p>
        <h3>Ce que dit l'intérieur</h3>
        <p>L'examen commence par l'intérieur. La doublure de toile porte les tampons de fabrication et de réception, la taille, parfois un millésime, souvent délavés jusqu'à la limite du lisible. Le drap lui-même renseigne : le bleu horizon est obtenu par mélange de laines de teintes différentes, ce qui donne de près un aspect chiné que les tissus modernes rendent mal. Viennent ensuite les boutons, la nature des coutures, la reprise des poches, et surtout la cohérence des usures entre le col, les coudes et le bas des manches.</p>
        <h3>Les productions d'après-guerre</h3>
        <p>Le bleu horizon est resté en service longtemps après l'armistice, et des capotes ou vareuses fabriquées dans les années 1920 sont régulièrement présentées comme des effets de guerre. Les reproductions destinées à la reconstitution et au cinéma circulent depuis des décennies, parfois vieillies pour tromper. Enfin, la patte de collet se découd et se remplace en quelques minutes : un numéro de régiment recherché cousu sur une capote banale est une manipulation fréquente. Notre guide pour <a href="/guides/dater-uniforme-militaire-francais">dater une vareuse ou une capote française</a> détaille la méthode.</p>
        <p>Une capote de troupe en état moyen reste abordable. Les effets de chasseurs, de troupes coloniales, d'aviation ou de chars, et plus généralement toute pièce datée, marquée et non retouchée, se situent à un autre niveau.</p>`,
    titre_en: "Collecting 1914-1918 horizon-blue uniforms",
    corps_en: `
        <p>The other ranks' greatcoat remains the piece most present on the market, ahead of the tunic, the trousers and the headgear. Officers' items, tailored privately at the officer's own expense, vary a great deal from one example to another and follow the regulations loosely. Complete, homogeneous uniforms, where every piece comes from the same man, are rare: most of the groups offered have been reassembled piece by piece, which is not a flaw in itself but must be stated.</p>
        <h3>What the inside tells you</h3>
        <p>Examination begins with the inside. The canvas lining carries the manufacturing and acceptance stamps, the size, sometimes a year, often faded to the edge of legibility. The cloth itself is informative: horizon blue is obtained by mixing wools of different shades, which gives a flecked look up close that modern fabrics reproduce poorly. Then come the buttons, the type of stitching, the reworking of the pockets and, above all, the consistency of wear between the collar, the elbows and the cuffs.</p>
        <h3>Post-war production</h3>
        <p>Horizon blue stayed in service long after the armistice, and greatcoats or tunics made in the 1920s are regularly presented as wartime items. Reproductions made for re-enactment and film have circulated for decades, sometimes aged to deceive. Finally, a collar tab can be unpicked and replaced in a few minutes: a sought-after regimental number sewn onto an ordinary greatcoat is a frequent manipulation. Our guide to <a href="/guides/dater-uniforme-militaire-francais">dating a French tunic or greatcoat</a> sets out the method.</p>
        <p>An other ranks' greatcoat in average condition remains affordable. Items from chasseurs, colonial troops, aviation or tanks, and more generally any piece that is dated, marked and untouched, are on another level.</p>
`,
  },
  {
    slug: "1ere-guerre-mondiale-armes",
    periode: "1ère Guerre Mondiale",
    type: "Armes (neutralisées/maquettes)",
    titre: "Collectionner les armes de la Grande Guerre",
    corps: `
        <p>Le fusil Lebel modèle 1886 modifié 1893 et les Berthier, fusil 1907-15, modèle 1916 et mousquetons, forment l'essentiel de l'offre française en armes longues. Viennent les revolvers réglementaires, les pistolets de fabrication espagnole achetés en masse pendant le conflit, et les armes blanches : baïonnettes, poignards, couteaux de tranchée. Le statut légal dépend du modèle et du calibre, et se vérifie avant l'achat.</p>
        <h3>Lire les marquages</h3>
        <p>Les armes réglementaires sont bavardes, à condition de lire au bon endroit. Le boîtier de culasse porte le nom de la manufacture d'État, Saint-Étienne, Châtellerault ou Tulle, et le modèle, mais pas la date : l'année de fabrication se lit sur le canon, précédée de l'initiale de la manufacture. Le numéro de série est repris sur plusieurs éléments, et sa concordance entre canon, boîtier, culasse mobile et garnitures est le premier point à contrôler. Le cartouche frappé dans la crosse complète la lecture quand le bois n'a pas été poncé.</p>
        <h3>Remaniements et pièces douteuses</h3>
        <p>Ces armes ont servi bien au-delà de 1918 et sont largement passées en atelier : reprises, raccourcies, rebronzées, parfois renumérotées. Une arme aux numéros dépareillés est un assemblage, courant sur le marché. Sur les baïonnettes, la suppression du quillon a été pratiquée pendant la guerre mais aussi longtemps après, et poignées comme fourreaux se remplacent sans laisser de trace. Notre guide pour <a href="/guides/identifier-baionnette-francaise">reconnaître une baïonnette française</a> présente les modèles et leurs numéros.</p>
        <p>Le couteau de tranchée reste le cas le plus délicat. Le seul modèle réglementaire français, le poignard modèle 1916, porte au talon de lame la mention Le Vengeur de 1870 d'un côté et le nom du fabricant de l'autre. Plusieurs couteliers privés l'ont produit, et les marquages varient d'un exemplaire à l'autre sans que cela soit suspect. Il est resté en service jusqu'à la guerre suivante, et les exemplaires tardifs se vendent comme pièces de 1914-1918. Le reste relève de la fabrication d'atelier ou de fortune, qui se copie sans difficulté.</p>`,
    titre_en: "Collecting Great War weapons",
    corps_en: `
        <p>The Lebel model 1886 modified 1893 rifle and the Berthiers, the 1907-15 rifle, the model 1916 and the carbines, make up most of the French offer in long arms. Then come the regulation revolvers, the Spanish-made pistols bought in bulk during the conflict, and edged weapons: bayonets, daggers, trench knives. Legal status depends on the model and calibre, and should be checked before buying.</p>
        <h3>Reading the markings</h3>
        <p>Regulation weapons are talkative, provided you read in the right place. The receiver carries the name of the state factory, Saint-Étienne, Châtellerault or Tulle, and the model, but not the date: the year of manufacture is read on the barrel, preceded by the factory's initial. The serial number is repeated on several parts, and its match between barrel, receiver, bolt and furniture is the first point to check. The cartouche stamped into the stock completes the reading when the wood has not been sanded.</p>
        <h3>Reworked and doubtful pieces</h3>
        <p>These weapons served well beyond 1918 and went through workshops extensively: reworked, shortened, reblued, sometimes renumbered. A weapon with mismatched numbers is an assembly, common on the market. On bayonets, removal of the quillon was carried out during the war but also long afterwards, and grips and scabbards can be replaced without leaving a trace. Our guide to <a href="/guides/identifier-baionnette-francaise">recognising a French bayonet</a> covers the models and their numbers.</p>
        <p>The trench knife remains the trickiest case. The only French regulation model, the model 1916 dagger, carries on the ricasso the words Le Vengeur de 1870 on one side and the maker's name on the other. Several private cutlers produced it, and the markings vary from one example to another without being suspect. It stayed in service until the next war, and late examples are sold as 1914-1918 pieces. The rest is workshop or improvised production, which is copied without difficulty.</p>
`,
  },
  {
    slug: "1ere-guerre-mondiale-medailles",
    periode: "1ère Guerre Mondiale",
    type: "Médailles & décorations",
    seoDescription: "Médailles de guerre 14-18 à vendre entre collectionneurs : croix de guerre, médaille militaire, commémoratives, Verdun. Photos détaillées, état décrit.",
    titre: "Collectionner les médailles et décorations de 1914-1918",
    corps: `
        <p>Deux familles se croisent sur le marché. D'un côté les décorations attribuées pour un fait précis, Légion d'honneur, Médaille militaire, Croix de guerre. De l'autre les commémoratives, remises à tous les ayants droit : la médaille commémorative de la Grande Guerre, créée en 1920, et la médaille interalliée dite de la Victoire, créée en 1922. Frappées en très grand nombre, ces dernières restent parmi les objets les plus accessibles de la période, et leur intérêt tient presque entièrement à ce qui les accompagne.</p>
        <h3>Deux décorations à savoir lire</h3>
        <p>La croix de guerre, instituée en avril 1915, porte au revers les dates du conflit tel qu'il durait : 1914-1915 d'abord, puis 1914-1916, 1914-1917 et 1914-1918. Le millésime situe la frappe, pas nécessairement la citation. Le ruban compte autant que la croix : étoile de bronze pour une citation à l'ordre du régiment ou de la brigade, étoile d'argent pour la division, étoile de vermeil pour le corps d'armée, palme pour l'armée. Une croix séparée de son ruban perd l'essentiel de ce qu'elle dit. Pour retrouver le soldat qui l'a reçue, voyez <a href="/guides/titulaires-croix-de-guerre-14-18">retrouver les décorations d'un soldat de 14-18</a>.</p>
        <p>La médaille interalliée française existe en modèle officiel, gravé par Morlon et frappé à la Monnaie de Paris, et en plusieurs modèles de fabricants privés, de style différent et signés d'autres graveurs. Ce ne sont pas des copies mais des variantes d'époque, et elles se collectionnent comme telles.</p>
        <h3>Ce qui trompe : le montage</h3>
        <p>Ce qui trompe tient rarement à la médaille elle-même. Rubans remontés, étoiles ajoutées, barrettes composées par un vendeur pour étoffer un ensemble : la vérification consiste à rapprocher les décorations des citations et des états de service. Sans document, un groupe reste une hypothèse commode.</p>`,
    titre_en: "Collecting 1914-1918 medals and decorations",
    corps_en: `
        <p>Two families meet on the market. On one side, decorations awarded for a specific act: the Legion of Honour, the Médaille militaire, the Croix de guerre. On the other, commemorative medals given to everyone entitled: the Great War commemorative medal, created in 1920, and the Inter-Allied medal known as the Victory medal, created in 1922. Struck in very large numbers, the latter remain among the most accessible objects of the period, and their interest lies almost entirely in what comes with them.</p>
        <h3>Two decorations worth knowing how to read</h3>
        <p>The Croix de guerre, instituted in April 1915, carries on its reverse the dates of the conflict as it stood: first 1914-1915, then 1914-1916, 1914-1917 and 1914-1918. The date places the striking, not necessarily the citation. The ribbon counts as much as the cross: bronze star for a citation in regimental or brigade orders, silver star for division, silver-gilt star for army corps, palm for army. A cross separated from its ribbon loses most of what it says. To trace the soldier who earned it, see <a href="/guides/titulaires-croix-de-guerre-14-18">tracing a French WW1 soldier's decorations</a>.</p>
        <p>The French Inter-Allied medal exists in an official model, engraved by Morlon and struck at the Paris Mint, and in several private makers' models, different in style and signed by other engravers. These are not copies but period variants, and they are collected as such.</p>
        <h3>What deceives: the mounting</h3>
        <p>What deceives rarely lies in the medal itself. Remounted ribbons, added stars, bars made up by a seller to fill out a group: checking means comparing the decorations with the citations and the service records. Without documents, a group remains a convenient hypothesis.</p>
`,
  },
  {
    slug: "2nde-guerre-mondiale-uniformes",
    periode: "2nde Guerre Mondiale",
    type: "Uniformes",
    titre: "Collectionner les uniformes de la Seconde Guerre mondiale",
    corps: `
        <p>La tenue complète d'un même homme est l'exception. Ce qui change de mains, ce sont des pièces isolées, vestes de campagne allemandes, battle-dress britanniques, effets américains, plus rarement des vareuses françaises de 1939, que l'acheteur réunit ensuite. Un ensemble dont les tailles, la coupe et l'usure concordent vaut nettement plus qu'une addition de bonnes pièces sans rapport entre elles, et c'est là que se joue l'essentiel de l'écart de prix.</p>
        <h3>Dater par l'intérieur</h3>
        <p>La datation passe par l'intérieur du vêtement. Sur les effets allemands, on lit des tampons d'intendance, des indications de taille et, jusqu'au début des années 1940, un nom de fabricant; à partir de 1943, ce nom cède la place à un numéro d'entreprise attribué à l'échelle du Reich. Le drap parle autant que l'étiquette: laine dense et régulière en début de guerre, mélanges de plus en plus chargés en fibres artificielles ensuite, teinte qui tire vers le gris terne. Côté britannique, la coupe de 1937 aux boutonnages dissimulés se distingue de la version simplifiée de 1940, aux boutons apparents. Les étiquettes de contrat américaines donnent souvent la lecture la plus directe.</p>
        <h3>Les pièces recomposées</h3>
        <p>La manipulation la plus fréquente ne consiste pas à fabriquer un faux vêtement, mais à enrichir un vrai. La veste est d'époque, les pattes de col et les écussons ajoutés ne le sont pas. Il faut regarder le fil, le pas de couture, le tissu resté plus clair sous un insigne déposé, les anciens trous d'aiguille. Enfin, les tailles portées à l'époque sont petites, les trous de mite banals sur la laine, et les reproductions destinées à la reconstitution ont parfois quarante ans de vieillissement derrière elles.</p>`,
    titre_en: "Collecting Second World War uniforms",
    corps_en: `
        <p>A complete uniform from a single man is the exception. What changes hands are single pieces, German field tunics, British battledress, American items, more rarely French 1939 tunics, which the buyer then brings together. A group whose sizes, cut and wear match is worth much more than a sum of good pieces with no connection between them, and that is where most of the price difference lies.</p>
        <h3>Dating from the inside</h3>
        <p>Dating goes through the inside of the garment. On German items you read depot stamps, size indications and, until the early 1940s, a maker's name; from 1943, that name gives way to a firm number allocated across the Reich. The cloth says as much as the label: dense, even wool early in the war, blends increasingly loaded with artificial fibres later, a shade drifting towards a dull grey. On the British side, the 1937 pattern with concealed buttons is distinguished from the simplified 1940 version with exposed buttons. American contract labels often give the most direct reading.</p>
        <h3>Recomposed pieces</h3>
        <p>The most frequent manipulation is not making a fake garment but enhancing a real one. The tunic is period, the collar patches and badges added to it are not. Look at the thread, the stitch length, the cloth left paler under a removed insignia, old needle holes. Finally, the sizes worn at the time are small, moth holes are commonplace in wool, and reproductions made for re-enactment sometimes have forty years of ageing behind them.</p>
`,
  },
  {
    slug: "2nde-guerre-mondiale-armes",
    periode: "2nde Guerre Mondiale",
    type: "Armes (neutralisées/maquettes)",
    titre: "Collectionner les armes de la Seconde Guerre mondiale",
    corps: `
        <p>Le mot recouvre des réalités juridiques très différentes. Les armes blanches de la période, baïonnettes en tête, s'acquièrent et se détiennent librement en France par une personne majeure. Les armes à feu relèvent d'un classement, et l'arme neutralisée elle-même n'est pas en vente libre : sa cession passe par un armurier et une déclaration, avec le certificat et le marquage de neutralisation qui doivent l'accompagner. Vérifier ce statut avant l'achat fait partie de l'examen de l'objet, au même titre que celui du métal.</p>
        <h3>Lire une baïonnette</h3>
        <p>Sur une baïonnette allemande, la lecture commence au talon de la lame. Le nom du fabricant y est frappé jusqu'en 1940, année où un code de trois lettres minuscules le remplace ; le millésime sur deux chiffres et les poinçons de réception militaire complètent l'ensemble. La concordance des numéros entre la lame et le fourreau pèse lourd sur le prix : une paire assortie se paie nettement plus cher, ce qui explique que des numéros aient été refrappés pour en constituer.</p>
        <h3>Les dagues, les plus copiées</h3>
        <p>Les dagues de sortie allemandes comptent parmi les objets les plus reproduits de tout le militaria. Leur fabrication s'arrête en 1945, mais la copie démarre dans les années 1960, à Solingen même puis à Toledo, et bien plus tard en Asie ; les logos de fabricant sont reproduits au passage. S'y ajoutent les lames repolies puis regravées et les pièces remontées à partir d'éléments d'origines diverses. Du côté des armes d'épaule, la confusion la plus banale oppose les productions de guerre aux fabrications ou remises en état d'après-guerre, dont les modèles restent très proches. Sur les armes américaines, un assemblage de pièces de fournisseurs et de dates différentes est la règle plutôt que l'anomalie, la révision en arsenal ayant été systématique.</p>`,
    titre_en: "Collecting Second World War weapons",
    corps_en: `
        <p>The word covers very different legal realities. In France, edged weapons of the period, bayonets first, can be acquired and kept freely by an adult. Firearms are subject to a classification, and even a deactivated weapon is not freely sold: its transfer goes through a gunsmith and a declaration, with the deactivation certificate and marking that must accompany it. Checking that status before buying is part of examining the object, just like examining the metal.</p>
        <h3>Reading a bayonet</h3>
        <p>On a German bayonet, reading starts at the ricasso. The maker's name is stamped there until 1940, the year a three-letter lower-case code replaced it; the two-digit year and the military acceptance stamps complete the set. Matching numbers between blade and scabbard weigh heavily on the price: a matched pair sells for much more, which explains why numbers have been restruck to create them.</p>
        <h3>Daggers, the most copied</h3>
        <p>German dress daggers are among the most reproduced objects in all of militaria. Their production stopped in 1945, but copying began in the 1960s, in Solingen itself and then in Toledo, and much later in Asia; makers' logos are reproduced along the way. Added to that are blades repolished and then re-etched, and pieces reassembled from parts of different origins. For long arms, the most common confusion is between wartime production and post-war manufacture or refurbishment, whose models remain very close. On American weapons, an assembly of parts from different suppliers and dates is the rule rather than the anomaly, arsenal overhaul having been systematic.</p>
`,
  },
  {
    slug: "2nde-guerre-mondiale-objets-divers",
    periode: "2nde Guerre Mondiale",
    type: "Objets divers",
    titre: "Collectionner les objets divers de la Seconde Guerre mondiale",
    corps: `
        <p>C'est par cette catégorie que l'on entre dans la collection sans y engager de grosses sommes, et c'est elle qui documente le mieux la vie matérielle du soldat : gamelles, bidons, quarts, étuis, lampes, boussoles, mais aussi papiers militaires, courrier, photographies et petits effets personnels. Les prix restent accessibles tant que la pièce est anonyme ; ils changent d'échelle dès qu'un nom, une unité et une date se recoupent sur plusieurs objets d'un même ensemble.</p>
        <h3>Dater par la matière</h3>
        <p>Le matériel de campagne se date par la matière autant que par le marquage. Les bidons allemands ont un corps en aluminium jusqu'au début des années 1940, puis en acier peint ou émaillé quand l'aluminium est réservé à d'autres usages. La même logique d'appauvrissement se lit sur les accessoires : la housse de feutre laisse place à une matière de substitution en fibres pressées imprégnées de résine, les sangles de cuir à du tissu tissé, les ferrures deviennent plus grossières. Un objet de fin de guerre mal fini n'est donc pas suspect par sa grossièreté même.</p>
        <h3>Ce qui trompe</h3>
        <p>Deux pièges dominent. Le premier tient à la continuité d'après-guerre : bien des modèles américains ont été refabriqués à l'identique jusque dans les années 1950 et 1960, et seule la date portée sur la pièce sépare le matériel de guerre du suivant. Le second concerne les papiers, où l'ajout d'un tampon, d'une mention ou d'une affectation prestigieuse sur un livret authentique demande peu de moyens. Il faut y comparer les encres, les écritures et la cohérence des dates entre elles. Enfin, les objets de fouille, corrodés et souvent remontés, ne se comparent pas aux pièces sorties de stock, et le petit artisanat à partir de douilles s'est poursuivi longtemps après 1945.</p>`,
    titre_en: "Collecting Second World War miscellaneous items",
    corps_en: `
        <p>This category is the way into collecting without committing large sums, and it documents the soldier's material life best: mess tins, canteens, cups, cases, lamps, compasses, but also military papers, mail, photographs and small personal belongings. Prices stay accessible as long as the piece is anonymous; they change scale as soon as a name, a unit and a date cross-check across several objects of the same group.</p>
        <h3>Dating by the material</h3>
        <p>Field equipment is dated by its material as much as by its marking. German canteens have an aluminium body until the early 1940s, then painted or enamelled steel once aluminium was reserved for other uses. The same logic of impoverishment shows on accessories: the felt cover gives way to a substitute material of pressed fibres impregnated with resin, leather straps to woven webbing, fittings become cruder. A poorly finished late-war object is therefore not suspect because of its crudeness alone.</p>
        <h3>What deceives</h3>
        <p>Two traps dominate. The first is post-war continuity: many American models were remade identically into the 1950s and 1960s, and only the date on the piece separates wartime equipment from what followed. The second concerns papers, where adding a stamp, a note or a prestigious posting to a genuine service book takes little effort. Compare the inks, the handwriting and the consistency of the dates. Finally, excavated objects, corroded and often reassembled, do not compare with pieces from stock, and small crafts made from shell cases went on long after 1945.</p>
`,
  },
  {
    slug: "guerre-froide-uniformes",
    periode: "Guerre froide",
    type: "Uniformes",
    titre: "Collectionner les uniformes de la Guerre froide (1947-1991)",
    corps: `
        <p>Le marché sépare deux familles. D'un côté les tenues de service et de sortie, en drap ou en gabardine, avec passepoils d'arme et pattes d'épaule amovibles, surtout venues de l'Est et encore complètes. De l'autre les tenues de combat, dont la valeur tient au modèle plus qu'à l'état. Le treillis français modèle 1947 et ses variantes, puis le satin 300 et le modèle F1, couvrent à eux seuls presque toute la période. Les tenues de travail américaines en coton vert olive cèdent la place au camouflage boisé au début des années 1980.</p>
        <h3>Dater par la coupe</h3>
        <p>La coupe date mieux qu'une étiquette. L'armée soviétique abandonne en 1969 la gimnastiorka, tunique enfilée par la tête et fermée par une courte patte de boutonnage, au profit d'une vareuse boutonnée sur toute la hauteur. Une tunique du premier type appartient donc au début de la période, le remplacement s'étant étalé sur quelques années. En République démocratique allemande, le camouflage à traits verticaux dit Strichtarn remplace à partir de 1965 un motif à taches en service depuis la fin des années 1950. La matière compte autant : le coton pur domine les deux premières décennies, les mélanges synthétiques et les fermetures à glissière en plastique se généralisent ensuite.</p>
        <h3>Ce qui trompe</h3>
        <p>Trois pièges reviennent. Les insignes et les pattes d'épaule se rapportent sans difficulté sur une tenue vierge : il faut regarder l'envers du tissu, la couleur du fil et la décoloration autour de l'emplacement. Les tenues d'officier soviétiques ont été largement remontées après 1991 à partir d'éléments d'origine, avec des grades et des couleurs d'arme choisis pour la vente. Enfin, les tailles de l'Est suivent des tables nationales étrangères aux tailles françaises : il faut demander les mesures à plat, épaules, poitrine et longueur de manche, plutôt que se fier au chiffre inscrit.</p>`,
    titre_en: "Collecting Cold War uniforms (1947-1991)",
    corps_en: `
        <p>The market separates two families. On one side, service and walking-out dress, in cloth or gabardine, with arm-of-service piping and removable shoulder boards, mostly from the East and still complete. On the other, combat dress, whose value lies in the model more than the condition. The French model 1947 fatigues and their variants, then the satin 300 and the F1 model, cover almost the whole period on their own. American olive green cotton work uniforms gave way to woodland camouflage in the early 1980s.</p>
        <h3>Dating by the cut</h3>
        <p>The cut dates better than a label. In 1969 the Soviet army abandoned the gymnastyorka, a pullover tunic closed by a short buttoned placket, for a tunic buttoned all the way down. A tunic of the first type therefore belongs to the early part of the period, the replacement having been spread over a few years. In East Germany, the vertical-line camouflage known as Strichtarn replaced from 1965 a spot pattern in service since the late 1950s. Material counts as much: pure cotton dominates the first two decades, synthetic blends and plastic zips become general afterwards.</p>
        <h3>What deceives</h3>
        <p>Three traps recur. Insignia and shoulder boards are easily added to a plain uniform: look at the reverse of the cloth, the colour of the thread and the fading around the spot. Soviet officers' uniforms were widely made up after 1991 from original parts, with ranks and arm-of-service colours chosen to sell. Finally, Eastern sizes follow national tables unrelated to Western sizes: ask for flat measurements, shoulders, chest and sleeve length, rather than trusting the number inside.</p>
`,
  },
  {
    slug: "guerre-froide-documents",
    periode: "Guerre froide",
    type: "Documents",
    titre: "Collectionner les documents militaires de la Guerre froide (1947-1991)",
    corps: `
        <p>Le papier est la part la moins chère et la plus documentaire de la période. Circulent en nombre les livrets individuels et les fascicules de mobilisation français, les billets militaires soviétiques que chaque appelé conservait à vie, les livrets de service est-allemands, les titres de permission, les ordres de mission et les feuilles de route. À côté de ces pièces nominatives vient la littérature de service : manuels techniques, règlements d'emploi, notices d'armement et mémentos d'instruction, tirés à des dizaines de milliers d'exemplaires, donc peu coûteux, mais utiles pour identifier un matériel ou dater une dotation.</p>
        <h3>Le cas des cartes</h3>
        <p>La cartographie forme une famille à part. Le service topographique de l'état-major soviétique a cartographié la quasi-totalité des terres émergées aux échelles moyennes, et l'Europe jusqu'aux échelles les plus détaillées, sur des feuilles portant une mention de classification ; le démantèlement des dépôts après 1991 en a mis beaucoup en circulation. Une feuille se lit en marge : année d'établissement, année de mise à jour, service producteur et nomenclature de découpage y figurent. C'est un des rares documents de la période dont la datation ne demande aucune expertise.</p>
        <h3>Authentifier par la cohérence</h3>
        <p>L'authentification tient à la cohérence interne. Un livret réellement utilisé montre plusieurs écritures et plusieurs encres, des tampons appliqués à des dates éloignées et donc d'usure inégale, des pliures et un jaunissement réguliers sur toute l'épaisseur. Le faux courant n'est pas un document fabriqué de toutes pièces mais un exemplaire vierge, disponible par cartons, rempli après coup au nom d'une unité qui fait vendre : troupes aéroportées, formations stationnées à Berlin, services spécialisés. Un tampon net et une écriture unique sur un papier par ailleurs sali doivent arrêter l'achat. Un ensemble nominatif complet, livret, photographies et effets d'un même homme, vaut nettement plus que la somme de ses éléments : le disperser détruit sa valeur.</p>`,
    titre_en: "Collecting Cold War military documents (1947-1991)",
    corps_en: `
        <p>Paper is the cheapest and most documentary part of the period. Circulating in numbers are French individual service books and mobilisation booklets, the Soviet military cards every conscript kept for life, East German service books, leave passes, mission orders and travel warrants. Alongside these named pieces comes service literature: technical manuals, operating regulations, weapon handbooks and training notes, printed in tens of thousands of copies, so inexpensive, but useful for identifying equipment or dating an issue.</p>
        <h3>The case of maps</h3>
        <p>Cartography forms a family of its own. The Soviet general staff's topographic service mapped almost all the world's land at medium scales, and Europe down to the most detailed scales, on sheets carrying a classification marking; the break-up of depots after 1991 put many into circulation. A sheet is read in its margin: year of compilation, year of revision, producing service and sheet numbering all appear there. It is one of the few documents of the period whose dating requires no expertise.</p>
        <h3>Authenticating by consistency</h3>
        <p>Authentication rests on internal consistency. A service book that was really used shows several hands and several inks, stamps applied at distant dates and so unevenly worn, folds and yellowing that are even through the whole thickness. The common fake is not a document made from scratch but a blank example, available by the box, filled in afterwards in the name of a unit that sells: airborne troops, formations stationed in Berlin, specialist services. A crisp stamp and a single hand on paper that is otherwise soiled should stop the purchase. A complete named group, service book, photographs and effects of one man, is worth far more than the sum of its parts: splitting it destroys its value.</p>
`,
  },
  {
    slug: "guerre-froide-equipements",
    periode: "Guerre froide",
    type: "Équipements",
    titre: "Collectionner les équipements de campagne de la Guerre froide (1947-1991)",
    corps: `
        <p>L'équipement recouvre ici le portage et le nécessaire individuel : ceinturons et brelages, porte-chargeurs, musettes, sacs à dos, gourdes et quarts, gamelles, étuis d'outil de retranchement, trousses d'entretien. Ces effets étant distribués par dotations complètes, il reste possible de reconstituer un paquetage entier plutôt que d'aligner des pièces isolées. Les écarts internes sont pourtant nets : les modèles des premières années, retirés tôt, se rencontrent beaucoup moins que ceux des années 1970 et 1980, restés en service jusqu'à la dissolution des armées qui les employaient.</p>
        <h3>Dater par la matière</h3>
        <p>La matière date mieux que l'aspect. Côté américain, le passage de la toile de coton au nylon est le repère principal : les modèles en toile des années 1950 laissent place à des équipements synthétiques dans la seconde moitié des années 1960, puis au système ALICE adopté en 1973, avec ses boucles moulées caractéristiques. Côté soviétique, la toile enduite et la bâche restent la règle jusqu'à la fin, avec des fermetures en bakélite ou en acier peint, tandis que l'aluminium des premières décennies recule devant les matières plastiques.</p>
        <h3>L'ensemble recomposé</h3>
        <p>Le piège dominant est l'ensemble recomposé : un brelage de fabrication récente, deux poches d'origine et une gourde d'un autre pays, vendus comme une dotation. Il faut vérifier que les pièces partagent la même teinte, la même quincaillerie et la même finition de couture, un fabricant changeant rarement de méthode d'une pièce à l'autre. Depuis les années 1990, la demande des reconstituants a fait produire en série des copies de poches et de sacs de l'Est, convaincantes de loin, reconnaissables au fil synthétique brillant et aux œillets trop réguliers. Sur tout ce qui comporte du caoutchouc, la matière durcit et se fend : un article de protection ancien se conserve, il ne s'utilise pas.</p>`,
    titre_en: "Collecting Cold War field equipment (1947-1991)",
    corps_en: `
        <p>Equipment here means load carrying and individual kit: belts and harnesses, magazine pouches, haversacks, rucksacks, canteens and cups, mess tins, entrenching tool carriers, cleaning kits. Since these items were issued as complete sets, it is still possible to rebuild a whole kit rather than lining up single pieces. Yet the internal differences are marked: models from the early years, withdrawn early, are met far less often than those of the 1970s and 1980s, which stayed in service until the armies using them were dissolved.</p>
        <h3>Dating by the material</h3>
        <p>Material dates better than appearance. On the American side, the change from cotton canvas to nylon is the main reference point: the canvas models of the 1950s give way to synthetic equipment in the second half of the 1960s, then to the ALICE system adopted in 1973, with its characteristic moulded buckles. On the Soviet side, coated canvas and tarpaulin remain the rule to the end, with Bakelite or painted steel fastenings, while the aluminium of the early decades gives way to plastics.</p>
        <h3>The recomposed set</h3>
        <p>The dominant trap is the recomposed set: a recently made harness, two original pouches and a canteen from another country, sold as an issue set. Check that the pieces share the same shade, the same hardware and the same stitching finish, a maker rarely changing method from one piece to the next. Since the 1990s, demand from re-enactors has led to series production of copies of Eastern pouches and packs, convincing from a distance, recognisable by their shiny synthetic thread and over-regular eyelets. On anything containing rubber, the material hardens and cracks: an old protective item is kept, not used.</p>
`,
  },
];

module.exports = { CATEGORIES };
