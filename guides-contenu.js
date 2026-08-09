/* Contenu éditorial des guides. Un objet par guide : uniquement du texte.
   Toute la mécanique (balises, données structurées, gabarit) vit dans
   build-guides.js. Ajouter un guide = ajouter un objet ici. */

const GUIDES = [
  {
    slug: "heritage-militaria-que-faire",
    // Accroche volontairement concrète : le chiffre correspond exactement aux
    // six gestes listés dans le guide, il n'est pas décoratif.
    title: "Hériter de militaria : les 6 erreurs qui coûtent cher",
    description:
      "Astiquer, laver, démonter : quelques secondes suffisent à détruire la valeur d'une pièce. La méthode pour identifier, conserver et vendre un héritage.",
    h1: "Hériter d'objets militaires : par où commencer, dans quel ordre",
    datePublication: "2026-08-09",
    dateModification: "2026-08-09",
    chapeau:
      "Une malle au grenier, un uniforme dans une housse, une boîte de médailles au fond d'une armoire. Vous n'avez pas choisi ces objets, vous ne connaissez pas leur histoire, et vous ignorez s'ils ont une valeur. La difficulté n'est pas de trouver de l'information : il y en a beaucoup, souvent contradictoire. La difficulté est de faire les choses dans le bon ordre, parce que certaines erreurs commises la première semaine sont irréversibles.",
    corps: `
<p>Ce guide suit cet ordre : sécuriser, inventorier, identifier, vérifier ce qui doit l'être, puis seulement décider.</p>

<h2>Avant tout : ne nettoyez rien, ne démontez rien</h2>
<p>C'est le réflexe le plus naturel et c'est celui qui coûte le plus cher. Un objet militaire ancien tire une partie de sa valeur de son état d'origine, y compris de ses traces d'usage.</p>

<h3>Les six gestes qui détruisent la valeur</h3>
<ol>
  <li><strong>Astiquer le métal.</strong> Le polissage retire la patine et parfois les poinçons eux-mêmes. Une plaque de ceinturon rendue brillante perd une partie de ce qui permettait de la dater.</li>
  <li><strong>Laver un textile.</strong> L'eau fixe certaines taches, fait rétrécir la laine et efface les marquages à l'encre appliqués à l'intérieur des vêtements, qui sont souvent l'information la plus utile de la pièce.</li>
  <li><strong>Nourrir un cuir avec un produit moderne.</strong> Les graisses siliconées et les cirages colorés pénètrent, assombrissent et tachent de façon irréversible.</li>
  <li><strong>Démonter pour regarder dessous.</strong> Les rivets, coutures et attaches d'origine ne se remontent pas à l'identique.</li>
  <li><strong>Séparer une médaille de son ruban</strong>, ou remplacer un ruban fatigué par un neuf.</li>
  <li><strong>Jeter ce qui semble sans intérêt.</strong> Papiers, enveloppes, boîtes d'origine, livrets, étiquettes. Le contexte documentaire vaut souvent plus que l'objet qu'il accompagne.</li>
</ol>
<p>Si une pièce est sale, elle restera sale le temps que vous ayez compris ce qu'elle est. Le nettoyage, quand il est justifié, se décide après l'identification, jamais avant.</p>

<h3>Mettre les pièces à l'abri en attendant</h3>
<p>Sortez tout du grenier et de la cave. Ce sont les deux pires endroits : écarts de température dans un cas, humidité permanente dans l'autre.</p>
<p>Installez les objets dans une pièce chauffée normalement, à l'abri de la lumière directe. Évitez les sacs plastique fermés et les boîtes hermétiques, qui enferment l'humidité et provoquent de la condensation. Du carton, du papier de soie non acide, une housse en coton suffisent. Évitez le contact prolongé entre métal et cuir : le tanin attaque les métaux.</p>
<p>Enfin, mettez immédiatement à l'écart tout ce qui ressemble à une munition. Le point suivant y revient.</p>

<h2>Faire l'inventaire, la seule étape que personne ne fera à votre place</h2>

<h3>Photographier correctement</h3>
<p>C'est ce qui déterminera la qualité des réponses que vous obtiendrez ensuite, y compris à distance.</p>
<p>Lumière du jour indirecte, fond neutre et uni. Pour chaque pièce : une vue d'ensemble recto, une vue verso, puis des gros plans nets de tous les marquages, tampons, poinçons, étiquettes, intérieurs de coiffe, tranches et doublures. Placez une règle dans le cadre pour donner l'échelle. Photographiez aussi ce que vous jugez illisible : un spécialiste y verra souvent ce que vous n'y voyez pas.</p>

<h3>Noter ce que vous savez de la provenance</h3>
<p>De qui vient l'objet, dans quelle unité cette personne a servi, d'où la pièce a été rapportée, à quelle date. Un livret militaire, une photographie d'époque, une lettre, une citation.</p>
<p>Faites-le maintenant, tant que la mémoire familiale est encore accessible. La provenance documentée est l'un des rares éléments qui ne se reconstitue jamais après coup, et c'est aussi l'un de ceux qui comptent le plus pour un collectionneur.</p>

<h2>Identifier une pièce : quatre questions dans l'ordre</h2>

<h3>Quelle armée, quelle période</h3>
<p>Commencez par le plus large. La forme d'un casque, la coupe d'une vareuse, le type de boutons et le système de fermeture situent généralement une pièce dans un grand ensemble avant même toute lecture de marquage.</p>
<p>Comparer des formes est plus efficace que chercher des mots au hasard. Le catalogue est organisé par période, ce qui permet exactement cela : <a href="/category?cat=1%C3%A8re-Guerre-Mondiale">pièces de la Première Guerre mondiale</a>, <a href="/category?cat=2nde-Guerre-Mondiale">pièces de la Seconde Guerre mondiale</a>, ou <a href="/category">l'ensemble du catalogue</a> si vous ne savez pas encore situer l'objet.</p>

<h3>Que disent les marquages</h3>
<p>Poinçons, tampons d'acceptation, tailles, noms de fabricant, numéros, étiquettes intérieures. Recopiez-les caractère par caractère, sans chercher à les interpréter. Transcrire d'abord, comprendre ensuite. Une lettre mal lue peut renvoyer vers un fabricant, une année ou un pays entièrement différents.</p>

<h3>L'ensemble est-il cohérent</h3>
<p>Une pièce assemblée à partir d'éléments d'époques différentes est très fréquente, sans qu'il y ait toujours intention de tromper. Un casque recoiffé, une vareuse reboutonnée, une médaille remontée sur un ruban récent : ce sont des situations ordinaires.</p>
<p>Regardez la cohérence des usures. Un objet réellement porté s'use aux mêmes endroits : bords, points de frottement, zones de contact avec le corps. Une usure uniforme, ou concentrée là où elle n'a pas de raison d'être, doit attirer votre attention.</p>

<h3>Original, reproduction, ou pièce commémorative</h3>
<p>Le marché de la reconstitution historique produit des reproductions de bonne qualité, qui vieillissent et finissent par se retrouver dans des successions sans que personne ne sache d'où elles viennent. Certains indices sont classiques : régularité excessive, matériaux modernes visibles à l'intérieur, fils synthétiques, absence totale de marquage, ou au contraire marquages trop nets sur une pièce par ailleurs usée.</p>
<p>Le doute n'est pas un problème, l'affirmation approximative en est un. Faites voir la pièce avant d'écrire quoi que ce soit dans une annonce. Un échange avec des collectionneurs expérimentés règle souvent la question en quelques messages : <a href="/community">poser une question à la communauté</a>.</p>

<h2>Ce qui doit être vérifié avant toute autre chose</h2>

<h3>Munitions et objets pyrotechniques</h3>
<p>Obus, grenades, cartouches, détonateurs, fusées éclairantes. Ne les manipulez pas, ne les transportez pas, ne les mettez pas en vente, même si un proche vous assure qu'ils sont vides ou inertes.</p>
<p>La marche à suivre est simple : contactez la gendarmerie ou la police, qui saisira le service de déminage. L'intervention est gratuite et n'entraîne aucune conséquence pour vous. C'est le seul point de ce guide qui relève de la sécurité physique immédiate.</p>

<h3>Armes à feu, y compris neutralisées</h3>
<p>Le droit français classe les armes par catégories, et le statut des armes neutralisées dépend de la date de neutralisation, de la norme appliquée et du certificat qui l'accompagne. Une neutralisation ancienne ne vaut pas certificat valable aujourd'hui, et l'ancienneté d'une arme ne dit rien de son statut.</p>
<p>Nos <a href="/legal">conditions de vente</a> précisent ce qui est admis sur le site : les armes à feu en état de fonctionnement des catégories A, B, C et D1 non neutralisées au sens du règlement d'exécution (UE) 2015/2403 sont interdites à la mise en vente. Les pièces neutralisées sont acceptées sous réserve de la réglementation en vigueur, à condition d'être clairement signalées dans l'annonce. En cas de doute sur une pièce précise, faites confirmer par un armurier ou par les services compétents.</p>

<h3>Armes blanches</h3>
<p>Baïonnettes, sabres, poignards. Leur régime est généralement plus souple que celui des armes à feu, mais la détention, le transport et le port relèvent de règles distinctes : pouvoir détenir un objet ne signifie pas pouvoir le transporter librement. Là encore, vérifiez plutôt que de supposer.</p>

<h3>Insignes et emblèmes de régimes dissous</h3>
<p>Certaines pièces de la période 1933-1945 portent des emblèmes dont le port et l'exhibition en public sont réprimés par l'article R645-1 du code pénal, lequel prévoit une exception liée à l'évocation historique. La façon dont ce cadre s'applique à la détention par un collectionneur et à la vente demande une vérification au cas par cas, auprès d'un professionnel du droit.</p>
<p>Sur le site, la règle est explicite : tout article faisant l'apologie des crimes de guerre, des crimes contre l'humanité, du nazisme ou du terrorisme est interdit à la vente, comme le rappellent nos <a href="/legal">conditions générales</a>.</p>
<p>Sur le fond, ces objets se traitent comme des documents historiques. Ils se décrivent, se datent et se contextualisent. Ils ne se mettent pas en scène et ne se valorisent pas. C'est la ligne que nous appliquons sans exception.</p>

<h2>Estimer : comprendre la méthode plutôt que chercher un chiffre</h2>
<p>Il n'existe pas de cote officielle en militaria. Toute personne qui vous annonce un montant sans avoir vu la pièce, ses marquages et son état vous donne une impression, pas une estimation.</p>
<p>La valeur se construit sur cinq éléments :</p>
<ol>
  <li><strong>L'état</strong>, qui pèse davantage que tout le reste.</li>
  <li><strong>L'originalité et la cohérence</strong> de l'ensemble, une pièce complète et homogène n'ayant rien à voir avec une pièce recomposée.</li>
  <li><strong>La rareté réelle</strong>, qui est rarement celle que la famille imagine.</li>
  <li><strong>La provenance documentée</strong>, quand elle existe.</li>
  <li><strong>La demande du moment</strong> sur ce type précis de pièce.</li>
</ol>
<p>La seule méthode praticable consiste à relever des ventes réellement conclues sur des pièces comparables, à état et variante équivalents. Un prix affiché n'est pas un prix de marché : c'est une demande, parfois maintenue pendant des années sans acheteur.</p>
<p>Méfiez-vous enfin d'une estimation donnée gratuitement par la personne qui souhaite vous racheter l'objet. Elle n'est pas nécessairement malhonnête, mais elle n'est pas neutre. Pour un ensemble important, ou en cas d'indivision, une estimation écrite par un commissaire-priseur ou un expert, généralement payante, a une tout autre portée.</p>

<h2>Vendre : en bloc ou pièce par pièce</h2>
<p>Vendre l'ensemble à un marchand est rapide et simple : un interlocuteur, une transaction. Le prix est nécessairement inférieur, puisque l'acheteur doit se rémunérer sur la revente.</p>
<p>Vendre pièce par pièce entre collectionneurs demande plus de temps, donne un meilleur retour, et présente un avantage moins évident : chaque objet part chez quelqu'un qui sait ce qu'il est et le conservera comme tel.</p>
<p>Ce qui fait une annonce sérieuse tient en trois points : des photographies complètes incluant tous les marquages, une description factuelle sans adjectif, et la mention explicite de ce que vous ignorez. Écrire « je n'ai pas réussi à identifier ce poinçon » inspire davantage confiance qu'une attribution approximative, et vous protège en cas de contestation.</p>
<p>Athena Militaria met en relation des collectionneurs particuliers, avec paiement sécurisé, une commission de 8 % sur le prix de l'article et 0 % sur les frais de port. Le fonctionnement est détaillé dans <a href="/about#how-it-works">comment fonctionne la vente</a>, et la mise en ligne se fait depuis <a href="/sell">déposer une annonce</a>.</p>

<h2>Si vous ne vendez pas</h2>
<p>Conserver est une décision légitime, à condition de la documenter. Écrivez ce que vous savez de l'objet, de qui il vient et par quel chemin il est arrivé jusqu'à vous, puis rangez ce texte avec la pièce. Le don à un musée local ou à une association d'histoire militaire est une autre issue, souvent envisageable pour les pièces documentaires.</p>
<p>Ce qui se perd, dans une succession, ce n'est presque jamais l'objet. C'est l'histoire qui allait avec.</p>
`,
    faq: [
      {
        q: "J'ai trouvé une grenade ou un obus dans une succession, que dois-je faire ?",
        r: "Ne le manipulez pas, ne le déplacez pas et ne le mettez pas en vente, même si on vous a assuré qu'il était inerte. Contactez la gendarmerie ou la police, qui saisira le service de déminage. L'intervention est gratuite et n'entraîne aucune poursuite à votre encontre. Les munitions anciennes restent dangereuses, y compris après plusieurs décennies.",
      },
      {
        q: "Faut-il nettoyer un objet militaire avant de le vendre ?",
        r: "Non, et c'est l'erreur la plus fréquente. Le polissage d'un métal efface la patine et parfois les poinçons, le lavage d'un textile fixe les taches et efface les marquages intérieurs, un produit d'entretien moderne tache le cuir de façon irréversible. Un objet sale mais intact se vend mieux qu'un objet nettoyé à tort.",
      },
      {
        q: "Comment savoir si une pièce est originale ou une reproduction ?",
        r: "Regardez la cohérence de l'ensemble plutôt que la pièce isolément : matériaux visibles à l'intérieur, type de fils, régularité excessive des finitions, présence ou absence de marquages, et répartition des usures. Une pièce réellement portée s'use aux points de frottement, pas uniformément. En cas de doute, faites-la examiner avant d'écrire une attribution dans une annonce.",
      },
      {
        q: "Peut-on vendre en France des objets de la période 1933-1945 ?",
        r: "Une partie de ces objets circule légalement entre collectionneurs, mais certains portent des emblèmes de régimes dissous dont le port et l'exhibition en public sont réprimés par l'article R645-1 du code pénal, lequel prévoit une exception liée à l'évocation historique. L'application de ce cadre à la vente et à la collection demande une vérification au cas par cas. Les conditions de vente du site interdisent par ailleurs tout article faisant l'apologie du nazisme ou des crimes contre l'humanité.",
      },
      {
        q: "Comment estimer une pièce alors qu'il n'existe pas de cote ?",
        r: "Relevez des ventes réellement conclues sur des pièces comparables, à état, variante et complétude équivalents, plutôt que des prix affichés qui ne reflètent qu'une demande du vendeur. Les cinq facteurs déterminants sont l'état, la cohérence de l'ensemble, la rareté réelle, la provenance documentée et la demande actuelle. Pour un ensemble important ou une succession à partager, une estimation écrite par un commissaire-priseur a une tout autre portée qu'une évaluation informelle.",
      },
      {
        q: "Vaut-il mieux vendre le lot en une fois ou pièce par pièce ?",
        r: "La vente en bloc à un marchand est rapide mais se fait nécessairement à un prix inférieur, puisque l'acheteur se rémunère sur la revente. La vente pièce par pièce entre collectionneurs demande du temps et un peu de travail de description, pour un retour sensiblement meilleur. Le choix dépend surtout du temps que vous pouvez y consacrer et du nombre d'objets concernés.",
      },
    ],
  },
  {
    slug: "reconnaitre-un-faux-militaria",
    title: "Reconnaître un faux militaria : 7 vérifications",
    description:
      "Une reproduction vieillie trompe l'oeil, pas la méthode. Sept vérifications concrètes pour distinguer une pièce d'époque d'une copie avant d'acheter.",
    h1: "Reconnaître une reproduction ou un faux : la méthode en sept points",
    datePublication: "2026-08-09",
    dateModification: "2026-08-09",
    chapeau:
      "Le doute est le sentiment le plus courant du collectionneur, et le plus sain. La reconstitution historique produit depuis des décennies des reproductions de bonne facture, qui vieillissent, changent de mains et finissent par arriver sur le marché sans que personne ne sache d'où elles viennent. Aucun détail pris isolément ne prouve quoi que ce soit. C'est le faisceau qui décide.",
    corps: `
<p>Ce guide ne vous apprendra pas à authentifier une pièce à distance, personne ne le peut. Il vous donne l'ordre dans lequel regarder, et les sept points qui, ensemble, font pencher la balance.</p>

<h2>Avant les sept points : la bonne question</h2>
<p>La question n'est pas « est-ce vrai ». Elle est « qu'est-ce que je vois, et est-ce cohérent ». Une pièce peut être authentique dans sa structure et remontée avec des éléments récents. Elle peut être une copie honnête vendue comme telle il y a vingt ans, puis revendue de bonne foi comme une pièce d'époque. Entre l'original intact et la contrefaçon délibérée, il existe toute une zone grise qui représente l'essentiel du marché.</p>
<p>Trois familles à distinguer : la <strong>reproduction</strong>, fabriquée pour la reconstitution et souvent marquée à l'origine, la <strong>pièce composite</strong>, assemblée à partir d'éléments d'époques différentes, et le <strong>faux</strong>, fabriqué ou vieilli pour tromper. La première est fréquente, la deuxième l'est encore plus, la troisième est plus rare qu'on ne le croit sur les pièces courantes, et concentrée sur ce qui vaut cher.</p>

<h2>1. La cohérence des usures</h2>
<p>C'est le point le plus difficile à falsifier et celui qui trahit le plus souvent une pièce vieillie artificiellement.</p>
<p>Un objet réellement porté s'use là où il frotte : bords, arêtes, points de contact avec le corps, zones de préhension, dessous d'une boucle, intérieur d'un col. L'usure est <em>orientée</em> et <em>inégale</em>. Une pièce vieillie au bain chimique ou à l'abrasif présente au contraire une usure homogène, répartie partout de la même façon, y compris là où rien ne frotte jamais.</p>
<p>Demandez-vous systématiquement : cette usure, quel geste l'a produite ? Si vous ne trouvez pas le geste, méfiez-vous.</p>

<h2>2. Ce qu'on voit à l'intérieur</h2>
<p>Le faussaire soigne l'extérieur. L'intérieur est presque toujours le maillon faible, parce qu'il n'est pas censé être vu.</p>
<p>Regardez les doublures, les revers de coutures, l'intérieur d'une coiffe, le dessous d'un rivet, l'arrière d'un insigne. Cherchez des matériaux qui n'existaient pas à l'époque supposée : fil synthétique brillant, colle thermofusible, adhésif moderne, mousse plastique, agrafes de papeterie, peinture acrylique.</p>
<p>Un point simple et souvent décisif : le fil. Le fil de coton et le fil de lin anciens ne brillent pas de la même façon que le polyester. Une couture qui accroche la lumière de façon vive mérite un examen attentif.</p>

<h2>3. La régularité, ce faux ami</h2>
<p>La production industrielle ancienne est régulière, mais pas parfaite. Les points de couture varient légèrement, les emboutis présentent de petites asymétries, les frappes de poinçon ne sont jamais deux fois identiques.</p>
<p>Une pièce d'une régularité irréprochable, aux angles nets et aux espacements exacts, évoque une fabrication moderne, à commande numérique ou à la machine à coudre électronique. Le paradoxe est là : trop beau, c'est suspect.</p>

<h2>4. Les marquages et leur logique</h2>
<p>Poinçons, tampons d'acceptation, noms de fabricant, tailles, numéros de lot. Trois anomalies reviennent constamment.</p>
<ul>
  <li><strong>Le marquage trop net sur une pièce usée.</strong> Si l'objet a vécu, son marquage a vécu aussi. Un tampon d'une fraîcheur parfaite sur un cuir fatigué est incohérent.</li>
  <li><strong>L'absence totale de marquage</strong> sur un type de pièce qui en portait systématiquement.</li>
  <li><strong>Le marquage trop beau pour être vrai</strong>, celui qui coche exactement la case rare que le marché recherche. Les faussaires produisent ce qui se vend.</li>
</ul>
<p>Relevez toujours les marquages caractère par caractère avant de les interpréter. Transcrire d'abord, comprendre ensuite : une lettre mal lue renvoie vers un autre fabricant, une autre année, parfois un autre pays.</p>

<h2>5. Le poids et la matière en main</h2>
<p>C'est le sens qui s'éduque le plus vite et qui se transmet le moins bien par écrit. Les aciers, les cuirs et les laines anciens n'ont pas la densité ni la souplesse de leurs équivalents modernes.</p>
<p>Un cuir ancien est sec, rigide par endroits, souple aux plis d'usage. Un cuir moderne vieilli artificiellement reste uniformément souple. Une laine d'époque est dense et un peu rêche. Manipulez des pièces sûres chaque fois que vous en avez l'occasion : c'est le seul entraînement qui compte.</p>

<h2>6. Les traces de fabrication et de réparation</h2>
<p>Les pièces militaires ont été réparées, retaillées, remises en état par des ateliers militaires. Ces interventions d'époque sont un signe de vie, pas un défaut.</p>
<p>Une pièce sans aucune trace d'entretien, alors que son type en portait presque toujours, mérite une question. À l'inverse, une réparation faite au fil moderne sur une pièce ancienne indique une intervention récente, sans dire pour autant que la pièce est fausse.</p>

<h2>7. La provenance et le récit</h2>
<p>Le dernier point n'est pas sur l'objet, il est autour.</p>
<p>Une provenance vérifiable, même modeste, vaut mieux qu'une histoire spectaculaire. Méfiez-vous des récits trop parfaits, du type pièce rapportée par un aïeul d'une unité prestigieuse, sans le moindre document. Ce récit ajoute de la valeur perçue et ne coûte rien à inventer.</p>
<p>À l'inverse, un vendeur qui écrit « je n'ai pas réussi à identifier ce poinçon » vous donne une information exacte et vous dit quelque chose de sa façon de travailler.</p>

<h2>Ce que vous pouvez faire avant d'acheter</h2>
<p>Demandez des photographies supplémentaires, en particulier de l'intérieur, des marquages et des zones d'usure. Un vendeur sérieux les fournit sans difficulté. Un refus, ou des photos systématiquement floues sur les zones utiles, est en soi une réponse.</p>
<p>Faites relire l'annonce par d'autres collectionneurs avant de vous décider : <a href="/community">poser une question à la communauté</a>. Sur des pièces courantes, quelques avis suffisent souvent à lever le doute.</p>
<p>Comparez enfin avec des pièces du même type et de la même période, ce que le catalogue permet de faire par période : <a href="/category?cat=1%C3%A8re-Guerre-Mondiale">Première Guerre mondiale</a>, <a href="/category?cat=2nde-Guerre-Mondiale">Seconde Guerre mondiale</a>, <a href="/category?cat=Guerre-froide">Guerre froide</a>.</p>

<h2>Si vous vendez, la transparence est votre meilleure protection</h2>
<p>Décrivez ce que vous voyez, pas ce que vous supposez. Photographiez les défauts autant que les qualités. Indiquez explicitement ce que vous n'avez pas pu déterminer. Une annonce prudente se vend un peu moins cher qu'une annonce affirmative, et elle vous protège en cas de contestation.</p>
<p>Sur Athena Militaria, les reproductions et les pièces neutralisées sont acceptées, à condition d'être clairement signalées comme telles dans l'annonce. C'est une règle des <a href="/legal">conditions de vente</a>, et c'est aussi ce qui permet à un marché entre particuliers de tenir dans la durée.</p>
<p>Pour aller plus loin sur le premier tri d'un ensemble : <a href="/guides/heritage-militaria-que-faire">hériter de militaria, par où commencer</a>.</p>
`,
    faq: [
      { q: "Un vendeur peut-il refuser de fournir des photos supplémentaires ?",
        r: "Il peut, mais c'est une information en soi. Sur une pièce de collection, les photographies de l'intérieur, des marquages et des zones d'usure sont exactement celles qui permettent de se décider. Un vendeur sérieux les fournit sans difficulté. Des photos systématiquement absentes ou floues sur les zones utiles justifient de renoncer." },
      { q: "Une reproduction a-t-elle une valeur ?",
        r: "Oui, mais une valeur d'usage, pour la reconstitution ou la décoration, sans rapport avec celle d'une pièce d'époque. Le problème n'est pas la reproduction, c'est la reproduction vendue pour ce qu'elle n'est pas. Une copie clairement annoncée comme telle est une transaction parfaitement légitime." },
      { q: "Comment reconnaître une usure artificielle ?",
        r: "Regardez si l'usure est orientée. Un objet porté s'use aux points de frottement réels : bords, arêtes, zones de contact avec le corps. Une usure homogène répartie partout, y compris là où rien ne frotte, évoque un vieillissement chimique ou abrasif. Posez-vous la question du geste qui aurait produit cette trace." },
      { q: "Les marquages suffisent-ils à authentifier une pièce ?",
        r: "Non. Un marquage se copie, et les faussaires reproduisent en priorité les marquages recherchés. Un marquage trop net sur une pièce usée, ou correspondant exactement à la variante rare que le marché recherche, appelle plus de prudence, pas moins. Le marquage est un indice parmi sept, jamais une preuve isolée." },
      { q: "Qu'est-ce qu'une pièce composite ?",
        r: "Une pièce assemblée à partir d'éléments d'époques ou d'origines différentes : un casque recoiffé, une vareuse reboutonnée, une médaille remontée sur un ruban récent. C'est très fréquent et souvent sans intention de tromper. Cela change la valeur, donc cela doit figurer dans la description." },
      { q: "Faut-il faire expertiser avant d'acheter ?",
        r: "Pour une pièce courante, l'avis de collectionneurs expérimentés suffit généralement. Pour un montant important ou une pièce présentée comme rare, une expertise payante par un professionnel est proportionnée au risque. Le coût d'une expertise est toujours inférieur à celui d'une erreur sur une pièce chère." },
    ],
  },
  {
    slug: "identifier-casque-adrian-1915",
    title: "Casque Adrian 1915 : l'identifier en 5 minutes",
    description:
      "Combien de pièces, quel cimier, quel attribut, quelle coiffe. La méthode pour situer un casque Adrian et le distinguer du modèle 1926 et des copies.",
    h1: "Identifier un casque Adrian modèle 1915",
    datePublication: "2026-08-09",
    dateModification: "2026-08-09",
    chapeau:
      "C'est la pièce que l'on retrouve le plus souvent dans une succession française, et celle sur laquelle circulent le plus d'approximations. Un casque Adrian s'identifie pourtant méthodiquement, en regardant quatre choses dans l'ordre : le nombre de pièces qui le composent, son cimier, son attribut frontal et sa coiffe intérieure.",
    corps: `
<p>Adopté par l'armée française en 1915, le casque Adrian remplace la calotte métallique portée sous le képi au début du conflit. C'est le premier casque de combat français produit en masse, et il a été porté bien au-delà de 1918 et bien au-delà de la France.</p>
<p>Ce guide ne remplace pas l'oeil d'un spécialiste sur une variante rare. Il vous permet de situer une pièce, de la décrire correctement et d'éviter les erreurs les plus coûteuses.</p>

<h2>1. Comptez les pièces : c'est le point qui tranche</h2>
<p>C'est la vérification la plus discriminante, et la plus simple.</p>
<p>Le modèle 1915 est un casque <strong>assemblé</strong>. La bombe, les bords et le cimier sont des éléments distincts, réunis par rivets et sertissages. Regardez la jonction entre la calotte et le bord : sur un Adrian de la Grande Guerre, cette liaison est visible.</p>
<p>Le modèle 1926, qui lui succède, est au contraire emboutit d'<strong>une seule pièce</strong>, cimier rapporté mis à part. Sa silhouette est plus lourde et sa liaison calotte-bord est continue, sans raccord.</p>
<p>Confondre les deux est l'erreur la plus fréquente dans les annonces, et elle a un vrai effet sur la valeur comme sur la datation. Si vous ne deviez retenir qu'un point de ce guide, ce serait celui-là.</p>

<h2>2. Le cimier</h2>
<p>La crête métallique fixée sur le dessus n'est pas décorative : elle recouvre des ouvertures d'aération pratiquées dans la calotte.</p>
<p>Vérifiez qu'il est bien présent, qu'il n'a pas été recollé, et regardez dessous. Un cimier retiré puis remis, un cimier fixé autrement que par le mode d'origine, ou un cimier dont la forme ne correspond pas au reste de la pièce sont des signaux de remontage.</p>
<p>C'est aussi l'un des endroits où la peinture d'origine se conserve le mieux, protégée du frottement. Un cimier repeint alors que le reste ne l'est pas indique une intervention.</p>

<h2>3. L'attribut frontal</h2>
<p>L'insigne fixé à l'avant indique l'arme d'appartenance. C'est ce qui donne son identité au casque et, souvent, l'essentiel de sa valeur.</p>
<p>Les attributs les plus courants correspondent aux grandes armes : la grenade enflammée pour l'infanterie, les canons croisés pour l'artillerie, d'autres emblèmes pour le génie, la cavalerie, le service de santé ou les troupes coloniales. Certains sont très communs, d'autres nettement plus rares.</p>
<p>Trois vérifications concrètes :</p>
<ul>
  <li><strong>Le mode de fixation</strong> et sa cohérence avec les trous de la bombe. Des trous surnuméraires, ou un attribut fixé sur des perçages qui ne correspondent pas, indiquent un changement.</li>
  <li><strong>L'usure comparée</strong> de l'attribut et du casque. Deux pièces qui ont vécu ensemble vieillissent ensemble.</li>
  <li><strong>La netteté du relief.</strong> Un attribut au relief très vif sur un casque fatigué est probablement un ajout récent.</li>
</ul>
<p>C'est précisément sur l'attribut que se concentrent les substitutions, parce qu'un attribut rare change le prix sans changer le casque. Prudence proportionnelle à la rareté annoncée.</p>

<h2>4. La coiffe intérieure et la jugulaire</h2>
<p>Retournez le casque. L'intérieur raconte souvent plus que l'extérieur.</p>
<p>La coiffe d'époque est en cuir, découpée en languettes ajustables, fixée au casque et reliée par un lien de serrage. Elle est presque toujours sèche, craquelée, parfois partiellement manquante. Une coiffe complète, souple et sans altération sur un casque par ailleurs usé est une coiffe de remplacement, souvent moderne.</p>
<p>Regardez le cuir de la jugulaire, ses boucles, la façon dont elle est attachée. Le remplacement d'une jugulaire est extrêmement courant et ne disqualifie pas la pièce, à condition d'être signalé.</p>
<p>Les marquages, quand il y en a, se trouvent le plus souvent sous la coiffe ou à l'intérieur de la bombe. Relevez-les caractère par caractère avant de les interpréter.</p>

<h2>La peinture, à ne surtout pas toucher</h2>
<p>La peinture d'origine est un élément de datation et une part de la valeur. Elle ne se nettoie pas, ne se retouche pas, ne se ravive pas.</p>
<p>Un casque décapé puis repeint, même très proprement, perd l'essentiel de son intérêt pour un collectionneur. Si la peinture est écaillée, laissez-la écaillée. Si de la rouille est active, l'arrêter relève d'un travail de conservation prudent, pas d'un décapage : voir <a href="/guides/entretien-militaria-cuir-textile-metal">entretenir cuir, textile et métal militaires</a>.</p>

<h2>Un casque, plusieurs armées</h2>
<p>L'Adrian n'a pas été porté que par la France. Plusieurs armées alliées l'ont adopté ou reçu pendant et après la Première Guerre mondiale, avec leurs propres attributs. Un casque de forme Adrian portant un emblème non français n'est donc ni une anomalie ni forcément un faux.</p>
<p>Ce point compte pour la description : c'est l'attribut, pas la forme, qui situe l'armée d'emploi.</p>

<h2>Ce que je ne peux pas vous dire ici</h2>
<p>La datation fine par les marquages de fabricant, l'attribution à une unité précise et l'identification des variantes de production demandent une documentation spécialisée et l'examen de la pièce en main. Aucun guide en ligne ne remplace cela.</p>
<p>La bonne pratique, si vous vendez : décrivez ce que vous observez, publiez des photographies nettes de l'intérieur, du cimier, de l'attribut et des marquages, et indiquez ce que vous n'avez pas su déterminer. Cela inspire davantage confiance qu'une attribution assurée, et vous protège.</p>
<p>Pour un avis, <a href="/community">la communauté</a> est le point d'entrée le plus rapide. Pour comparer avec des pièces de la même période, voir les <a href="/category?cat=1%C3%A8re-Guerre-Mondiale">annonces Première Guerre mondiale</a>.</p>
<p>Et si votre casque vient d'un ensemble hérité que vous n'avez pas encore trié, commencez par là : <a href="/guides/heritage-militaria-que-faire">hériter de militaria, par où commencer</a>. Sur les signes de reproduction en général, voir <a href="/guides/reconnaitre-un-faux-militaria">reconnaître un faux militaria</a>.</p>
`,
    faq: [
      { q: "Comment distinguer un casque Adrian 1915 d'un modèle 1926 ?",
        r: "Regardez la liaison entre la calotte et le bord. Le modèle 1915 est assemblé à partir d'éléments distincts, la jonction est visible. Le modèle 1926 est embouti d'une seule pièce, sa liaison est continue et sa silhouette plus lourde. C'est la vérification la plus fiable et la plus rapide, et la confusion entre les deux est l'erreur la plus fréquente dans les annonces." },
      { q: "Que signifie l'insigne fixé à l'avant du casque ?",
        r: "Il indique l'arme d'appartenance : grenade enflammée pour l'infanterie, canons croisés pour l'artillerie, et d'autres emblèmes pour le génie, la cavalerie, le service de santé ou les troupes coloniales. Certains attributs sont très communs, d'autres nettement plus rares, ce qui en fait la pièce la plus souvent substituée sur un casque." },
      { q: "Faut-il nettoyer ou repeindre un casque Adrian ?",
        r: "Non. La peinture d'origine est un élément de datation et une part importante de la valeur. Un casque décapé puis repeint, même proprement, perd l'essentiel de son intérêt pour un collectionneur. Si la peinture est écaillée, laissez-la telle quelle. Seule une rouille active justifie une intervention, et il s'agit alors de conservation prudente, pas de décapage." },
      { q: "La coiffe intérieure d'origine est-elle indispensable ?",
        r: "Elle n'est pas indispensable mais elle compte. La coiffe d'époque est en cuir découpé en languettes, presque toujours sèche et craquelée. Une coiffe complète et souple sur un casque par ailleurs usé est une pièce de remplacement. Un remplacement ne disqualifie pas le casque, à condition d'être signalé dans la description." },
      { q: "Un casque Adrian avec un emblème étranger est-il un faux ?",
        r: "Pas nécessairement. Plusieurs armées alliées ont adopté ou reçu ce casque pendant et après la Première Guerre mondiale, avec leurs propres attributs. C'est l'attribut, et non la forme, qui situe l'armée d'emploi. Un casque de forme Adrian portant un emblème non français est donc une pièce à décrire comme telle." },
      { q: "Où trouver les marquages sur un casque Adrian ?",
        r: "Le plus souvent sous la coiffe ou à l'intérieur de la bombe, quand il y en a. Relevez-les caractère par caractère avant de chercher à les interpréter : une lettre mal lue renvoie vers un autre fabricant ou une autre année. La datation fine par les marquages demande une documentation spécialisée." },
    ],
  },
  {
    slug: "vendre-militaria-legalement-france",
    title: "Vendre du militaria en France : ce qui est permis",
    description:
      "Arme neutralisée, baïonnette, insigne, munition inerte : ce qui se vend, ce qui ne se vend pas, et les points à faire vérifier avant de publier une annonce.",
    h1: "Vendre du militaria en France : ce qui est permis, ce qui ne l'est pas",
    datePublication: "2026-08-09",
    dateModification: "2026-08-09",
    chapeau:
      "C'est la question qui bloque le plus de vendeurs, et sur laquelle il circule le plus d'affirmations péremptoires. Ce guide n'est pas un avis juridique : il pose des repères, indique ce que les conditions de vente du site autorisent, et signale les points qui doivent être vérifiés au cas par cas plutôt que tranchés sur un forum.",
    corps: `
<p>Une précaution d'usage, et elle est sérieuse. Le droit applicable au militaria touche à la réglementation des armes, au code du patrimoine et au code pénal. Il évolue, et son application dépend de la pièce précise que vous avez entre les mains. Rien de ce qui suit ne remplace l'avis d'un professionnel du droit ou des services compétents.</p>

<h2>Le principe : la majorité du militaria se vend librement</h2>
<p>Uniformes, coiffures, équipements de campagne, gamelles, bidons, musettes, brelages, jumelles, documents, photographies, cartes, insignes de régiments, la plus grande partie de ce que contient une succession ne pose aucune difficulté particulière.</p>
<p>Les catégories du catalogue reflètent cette réalité : <a href="/category?cat=1%C3%A8re-Guerre-Mondiale">Première Guerre mondiale</a>, <a href="/category?cat=2nde-Guerre-Mondiale">Seconde Guerre mondiale</a>, <a href="/category?cat=Guerre-froide">Guerre froide</a>, avec des types allant des uniformes aux documents. Les difficultés se concentrent sur trois familles : les armes à feu, les munitions, et les emblèmes de régimes dissous.</p>

<h2>Les armes à feu et les pièces neutralisées</h2>
<p>Le droit français classe les armes par catégories, de A à D. Le statut d'une arme neutralisée dépend de trois éléments : la date à laquelle la neutralisation a été effectuée, la norme appliquée, et le certificat qui l'accompagne.</p>
<p>Deux idées reçues à écarter. L'ancienneté d'une arme ne dit rien de son statut. Et une neutralisation ancienne ne vaut pas certificat valable aujourd'hui : les exigences ont été renforcées avec le règlement d'exécution (UE) 2015/2403.</p>
<p>Sur Athena Militaria, la règle est explicite dans les <a href="/legal">conditions de vente</a> : les armes à feu en état de fonctionnement des catégories A, B, C et D1 non neutralisées au sens de ce règlement sont interdites à la mise en vente. Les pièces neutralisées sont acceptées sous réserve de la réglementation en vigueur, à condition d'être clairement signalées comme telles dans l'annonce.</p>
<p>En pratique, si vous détenez une arme dont vous ignorez le statut : ne la mettez pas en ligne, et faites-la examiner par un armurier ou par les services compétents. C'est le seul moyen d'obtenir une réponse qui vaut pour votre pièce.</p>

<h2>Les munitions : la règle est simple</h2>
<p>Munitions réelles, explosifs, grenades, engins explosifs, y compris inertes non certifiés : interdits à la vente sur le site, sans exception.</p>
<p>Et surtout, ne les manipulez pas. Si vous trouvez un obus, une grenade ou un détonateur dans une succession, contactez la gendarmerie ou la police, qui saisira le service de déminage. L'intervention est gratuite et n'entraîne aucune poursuite. Une munition ancienne reste dangereuse, y compris après plusieurs décennies, et l'assurance donnée par un proche qu'elle est vide n'a aucune valeur.</p>

<h2>Les armes blanches</h2>
<p>Baïonnettes, sabres, poignards, couteaux de combat. Leur régime est généralement plus souple que celui des armes à feu, mais il faut distinguer trois choses que l'on confond souvent : la <strong>détention</strong>, le <strong>transport</strong> et le <strong>port</strong>.</p>
<p>Pouvoir détenir légalement un objet chez soi ne signifie pas pouvoir le transporter librement, ni le porter sur soi. Un transport doit avoir un motif légitime, et une remise en main propre lors d'une vente n'est pas une situation neutre de ce point de vue. L'expédition dans un colis correctement emballé et déclaré est généralement la voie la plus simple.</p>

<h2>Les emblèmes de régimes dissous</h2>
<p>C'est le point le plus délicat, et celui sur lequel les affirmations catégoriques sont les plus fréquentes et les moins fiables.</p>
<p>L'article R645-1 du code pénal réprime le port et l'exhibition en public de certains emblèmes rappelant des organisations déclarées criminelles, avec une exception liée à l'évocation historique. La façon dont ce cadre s'articule avec la détention par un collectionneur et avec la vente entre particuliers demande une vérification au cas par cas, auprès d'un professionnel du droit. Je ne trancherai pas ici, et vous devriez vous méfier de toute source qui le fait en une phrase.</p>
<p>Ce que le site fixe, en revanche, est clair : tout article faisant l'apologie des crimes de guerre, des crimes contre l'humanité, du nazisme ou du terrorisme est interdit à la vente, comme le précisent nos <a href="/legal">conditions générales</a>.</p>
<p>La ligne éditoriale qui en découle est simple. Ces objets se traitent comme des documents historiques : on les décrit, on les date, on les contextualise. On ne les met pas en scène et on ne les valorise pas. Une annonce factuelle, sans emphase et sans mise en scène, est à la fois la plus conforme et la plus crédible.</p>

<h2>Les autres interdictions à connaître</h2>
<ul>
  <li><strong>Objets issus de fouilles archéologiques illégales.</strong> Le sous-sol des anciens champs de bataille est protégé, et la vente d'objets qui en proviennent illicitement est interdite.</li>
  <li><strong>Objets d'origine humaine</strong>, ossements et cheveux compris.</li>
  <li><strong>Décorations officielles encore en vigueur décernées à une personne identifiable</strong>, sans son consentement. C'est un point souvent ignoré : une médaille nominative récente n'est pas un objet de collection comme un autre.</li>
</ul>

<h2>Rédiger une annonce qui vous protège</h2>
<p>Trois réflexes, valables quelle que soit la pièce.</p>
<ol>
  <li><strong>Décrivez, n'affirmez pas.</strong> Écrivez ce que vous observez, et signalez ce que vous n'avez pas pu déterminer. « Je n'ai pas identifié ce poinçon » vaut mieux qu'une attribution approximative.</li>
  <li><strong>Signalez tout ce qui doit l'être :</strong> reproduction, pièce neutralisée, élément remplacé, réparation. C'est une obligation contractuelle sur le site et c'est votre meilleure protection en cas de contestation.</li>
  <li><strong>Photographiez les défauts</strong> autant que les qualités, et joignez les documents dont vous disposez, certificat de neutralisation en particulier.</li>
</ol>
<p>Quand tout est clair, la mise en ligne est gratuite et le paiement sécurisé : <a href="/sell">déposer une annonce</a>. Le fonctionnement détaillé est décrit dans <a href="/about#how-it-works">comment ça marche</a>.</p>
<p>Sur le tri initial d'un ensemble hérité, voir <a href="/guides/heritage-militaria-que-faire">hériter de militaria, par où commencer</a>. Sur l'authenticité des pièces, voir <a href="/guides/reconnaitre-un-faux-militaria">reconnaître un faux militaria</a>.</p>
`,
    faq: [
      { q: "Peut-on vendre une arme neutralisée en France ?",
        r: "Cela dépend de la date de neutralisation, de la norme appliquée et du certificat qui l'accompagne. Une neutralisation ancienne ne vaut pas certificat valable aujourd'hui, les exigences ayant été renforcées avec le règlement d'exécution (UE) 2015/2403. Sur le site, les pièces neutralisées sont acceptées sous réserve de la réglementation en vigueur et à condition d'être clairement signalées. En cas de doute sur une pièce précise, faites-la examiner par un armurier." },
      { q: "Que faire d'une grenade ou d'un obus trouvé dans une succession ?",
        r: "Ne le manipulez pas, ne le transportez pas et ne le mettez pas en vente, même si on vous assure qu'il est inerte. Contactez la gendarmerie ou la police, qui saisira le service de déminage. L'intervention est gratuite et n'entraîne aucune poursuite. Les munitions et engins explosifs, y compris inertes non certifiés, sont interdits à la vente sur le site." },
      { q: "Peut-on vendre une baïonnette ou un sabre ?",
        r: "Le régime des armes blanches est généralement plus souple que celui des armes à feu, mais il faut distinguer la détention, le transport et le port, qui relèvent de règles différentes. Pouvoir détenir un objet ne signifie pas pouvoir le transporter librement. L'expédition dans un colis correctement emballé est généralement la voie la plus simple." },
      { q: "Les objets à emblèmes de régimes dissous sont-ils interdits ?",
        r: "L'article R645-1 du code pénal réprime le port et l'exhibition en public de certains emblèmes, avec une exception liée à l'évocation historique. Son application à la détention par un collectionneur et à la vente demande une vérification au cas par cas auprès d'un professionnel du droit. Les conditions de vente du site interdisent en tout état de cause tout article faisant l'apologie du nazisme ou des crimes contre l'humanité." },
      { q: "Peut-on vendre une médaille militaire nominative ?",
        r: "Les décorations officielles encore en vigueur décernées à une personne identifiable ne peuvent pas être mises en vente sans son consentement. C'est une interdiction souvent ignorée. Les décorations anciennes, non nominatives ou dont l'ordre n'est plus en vigueur relèvent d'un régime différent." },
      { q: "Que risque-t-on à publier une annonce non conforme ?",
        r: "Sur le site, le retrait de l'annonce et, selon la gravité, la suspension du compte, comme le prévoient les conditions générales. Au-delà, les conséquences relèvent du droit applicable à la pièce concernée. La prudence coûte peu : ne publiez pas ce dont vous n'êtes pas sûr, et faites vérifier avant." },
    ],
  },
  {
    slug: "entretien-militaria-cuir-textile-metal",
    title: "Entretenir du militaria sans détruire sa valeur",
    description:
      "Cuir sec, laine mitée, métal rouillé : ce qu'il faut faire, ce qu'il ne faut surtout pas faire, et pourquoi ne rien faire est souvent la bonne décision.",
    h1: "Entretenir cuir, textile et métal militaires : la règle du minimum",
    datePublication: "2026-08-09",
    dateModification: "2026-08-09",
    chapeau:
      "En conservation, le geste le plus rentable est presque toujours celui qu'on ne fait pas. Un objet militaire ancien tire une part de sa valeur de son état d'origine, patine et traces d'usage comprises. L'objectif n'est pas de le rendre beau : c'est de stopper ce qui le dégrade, et rien de plus.",
    corps: `
<p>Ce guide sépare deux choses que l'on confond constamment : le <strong>nettoyage</strong>, qui vise l'apparence et détruit souvent de l'information, et la <strong>conservation</strong>, qui vise à ralentir la dégradation. La seconde est presque toujours justifiée. Le premier presque jamais.</p>

<h2>La règle qui prime sur toutes les autres</h2>
<p>Toute intervention doit être <strong>réversible</strong> et <strong>minimale</strong>. Si un geste ne peut pas être défait, il faut une très bonne raison de le faire.</p>
<p>Trois questions avant de toucher à quoi que ce soit. Est-ce que j'agis contre une dégradation active, ou pour l'apparence ? Est-ce que ce que je m'apprête à retirer peut contenir de l'information, marquage, patine, trace d'usage ? Est-ce que je saurais revenir en arrière ?</p>
<p>Si vous hésitez, l'ordre correct est : stabiliser l'environnement d'abord, identifier ensuite, intervenir en dernier, et seulement si nécessaire.</p>

<h2>L'environnement, qui fait 90 % du travail</h2>
<p>Avant tout produit, il y a l'endroit où l'objet est rangé. C'est le levier le plus efficace et le moins risqué.</p>
<ul>
  <li><strong>Ni grenier ni cave.</strong> Écarts de température d'un côté, humidité permanente de l'autre. Ce sont les deux pires endroits, et ce sont les deux plus courants.</li>
  <li><strong>Une pièce chauffée normalement</strong>, à température et humidité stables. La stabilité compte davantage que la valeur exacte.</li>
  <li><strong>À l'abri de la lumière directe.</strong> Le soleil décolore les textiles et fragilise les fibres, de façon irréversible.</li>
  <li><strong>Pas de plastique fermé.</strong> Sacs hermétiques et boîtes étanches enferment l'humidité et créent de la condensation. Préférez le carton, le papier de soie non acide, une housse en coton.</li>
  <li><strong>Séparez les matières.</strong> Évitez le contact prolongé entre cuir et métal : le tanin attaque les métaux. Évitez aussi le contact direct entre métaux différents.</li>
</ul>
<p>Rien de ce qui précède ne coûte cher, et cela suffit à arrêter la plupart des dégradations en cours.</p>

<h2>Le cuir</h2>
<p>C'est la matière sur laquelle on fait le plus de dégâts, avec les meilleures intentions.</p>
<h3>Ce qu'il ne faut pas faire</h3>
<ul>
  <li><strong>Aucun cirage coloré</strong>, aucun produit pour chaussures. Les pigments pénètrent et ne ressortent pas.</li>
  <li><strong>Aucune graisse siliconée</strong> ni produit moderne pour cuir automobile. Ils assombrissent et laissent un film.</li>
  <li><strong>Pas d'huile alimentaire</strong> : elle rancit et attire les nuisibles.</li>
  <li><strong>Pas d'eau, pas de trempage.</strong> Un cuir ancien mouillé se déforme et durcit en séchant.</li>
  <li><strong>Pas de chaleur pour sécher</strong>, jamais de radiateur ni de sèche-cheveux.</li>
</ul>
<h3>Ce qui est raisonnable</h3>
<p>Dépoussiérer à sec, avec un pinceau doux ou un chiffon de coton sec. C'est tout ce dont un cuir a besoin dans l'immense majorité des cas.</p>
<p>Un cuir très sec et cassant peut justifier un produit de conservation neutre, appliqué en couche très fine, après essai sur une zone cachée. Dans le doute, ne le faites pas : un cuir sec mais intact vaut mieux qu'un cuir nourri et taché.</p>
<p>Une moisissure blanchâtre se traite d'abord en asséchant l'environnement, puis par un brossage à sec très léger, à l'écart des autres pièces.</p>

<h2>Le textile : laine, coton, toile</h2>
<p>Le premier ennemi n'est pas la saleté, ce sont les mites.</p>
<h3>Les mites</h3>
<p>Inspectez régulièrement, en particulier les plis, les coutures et les doublures. À la moindre suspicion, isolez la pièce des autres.</p>
<p>Le froid prolongé est le traitement le moins agressif pour les textiles : plusieurs jours au congélateur, la pièce enfermée dans un sac, permettent d'interrompre un cycle. Laissez ensuite revenir à température ambiante sans ouvrir le sac, pour éviter la condensation.</p>
<p>Évitez la naphtaline et les produits volatils au contact direct du tissu.</p>
<h3>Le lavage</h3>
<p>Ne lavez pas. L'eau fixe certaines taches, fait rétrécir la laine et efface les marquages à l'encre appliqués à l'intérieur des vêtements, qui constituent souvent l'information la plus utile de la pièce.</p>
<p>Un dépoussiérage à l'aspirateur, à faible puissance et à travers une mousseline tendue pour protéger le tissu, est la seule intervention courante justifiée.</p>
<h3>Le rangement</h3>
<p>À plat de préférence, ou sur un cintre large et rembourré pour ne pas marquer les épaules. Rembourrez les plis avec du papier de soie non acide pour éviter les cassures de fibre. Ne suspendez jamais une pièce lourde par une couture fragile.</p>

<h2>Le métal</h2>
<p>Ici, la tentation d'astiquer est presque irrésistible. C'est aussi la plus destructrice.</p>
<h3>Patine et rouille ne sont pas la même chose</h3>
<p>La <strong>patine</strong> est une couche stable, protectrice, qui participe à la datation et à la valeur. On n'y touche pas.</p>
<p>La <strong>rouille active</strong>, orangée, pulvérulente, qui poudre au doigt, progresse et détruit le métal. Elle justifie une intervention.</p>
<p>Savoir distinguer les deux est l'essentiel du sujet. Dans le doute, commencez par assécher l'environnement et observez pendant quelques semaines.</p>
<h3>Ce qu'il ne faut pas faire</h3>
<p>Aucun produit à polir, aucune laine d'acier, aucun abrasif, aucun bain chimique décapant. Le polissage retire la patine et parfois les poinçons eux-mêmes. Une plaque de ceinturon rendue brillante perd une partie de ce qui permettait de la dater, et une bonne part de sa valeur marchande.</p>
<h3>Ce qui est raisonnable</h3>
<p>Contre une rouille active : réduire l'humidité, dépoussiérer à sec, et le cas échéant stopper la progression par un travail très léger et localisé, sur la zone active uniquement. Une pièce peinte, un casque en particulier, ne se décape jamais : la peinture d'origine est un élément de datation et une part de la valeur.</p>
<p>Pour un objet de valeur ou une corrosion étendue, l'avis d'un conservateur-restaurateur est proportionné. Le coût est sans commune mesure avec celui d'une pièce abîmée.</p>

<h2>Papiers et photographies</h2>
<p>Ce sont souvent les éléments les plus fragiles d'une succession, et ceux qui portent le plus d'information.</p>
<p>Manipulez avec des mains propres et sèches. Ne pliez pas, ne dépliez pas de force un document cassant. Retirez trombones et agrafes métalliques, qui rouillent et marquent. Rangez à plat, dans des pochettes sans acide, à l'abri de la lumière. N'utilisez jamais de ruban adhésif pour réparer une déchirure : c'est irréversible et cela tache le papier en vieillissant.</p>

<h2>Avant de vendre</h2>
<p>La question revient toujours : faut-il présenter une pièce nettoyée ? Non. Un acheteur averti préfère une pièce intacte à une pièce embellie, et il repère un nettoyage abusif immédiatement. Ce qui se vend, ce sont des photographies nettes, une description factuelle et l'honnêteté sur l'état.</p>
<p>Photographiez avant toute intervention, quelle qu'elle soit. Si vous décidez d'agir, vous aurez ainsi une trace de l'état antérieur.</p>
<p>Pour la suite : <a href="/guides/heritage-militaria-que-faire">hériter de militaria, par où commencer</a>, <a href="/guides/reconnaitre-un-faux-militaria">reconnaître un faux militaria</a>, et pour publier, <a href="/sell">déposer une annonce</a>.</p>
`,
    faq: [
      { q: "Faut-il nettoyer un objet militaire avant de le vendre ?",
        r: "Non. Un acheteur averti préfère une pièce intacte à une pièce embellie, et il repère un nettoyage abusif immédiatement. Le polissage d'un métal efface la patine et parfois les poinçons, le lavage d'un textile fixe les taches et efface les marquages intérieurs. Ce qui vend, ce sont des photographies nettes et une description honnête de l'état." },
      { q: "Comment nourrir un cuir militaire ancien ?",
        r: "Dans la grande majorité des cas, il ne faut pas. Un dépoussiérage à sec au pinceau doux suffit. Aucun cirage coloré, aucune graisse siliconée, aucun produit pour cuir automobile, aucune huile alimentaire : tous pénètrent, assombrissent ou tachent de façon irréversible. Un cuir très sec peut justifier un produit neutre en couche très fine, après essai sur une zone cachée." },
      { q: "Comment traiter des mites dans un uniforme ?",
        r: "Isolez immédiatement la pièce des autres. Le froid prolongé est le traitement le moins agressif : plusieurs jours au congélateur, la pièce enfermée dans un sac, interrompent le cycle. Laissez revenir à température ambiante sans ouvrir le sac, pour éviter la condensation. Évitez la naphtaline au contact direct du tissu." },
      { q: "Faut-il enlever la rouille sur une pièce militaire ?",
        r: "Il faut distinguer patine et rouille active. La patine est une couche stable qui participe à la datation et à la valeur : on n'y touche pas. La rouille active, orangée et pulvérulente, progresse et détruit le métal : elle justifie une intervention légère et localisée, après avoir asséché l'environnement. Aucun abrasif, aucune laine d'acier, aucun produit à polir." },
      { q: "Où ranger une collection de militaria ?",
        r: "Ni au grenier ni à la cave, qui sont les deux pires endroits. Une pièce chauffée normalement, à température et humidité stables, à l'abri de la lumière directe. Évitez les sacs plastique fermés qui enferment l'humidité, préférez le carton, le papier de soie non acide et les housses en coton. Séparez le cuir du métal, le tanin attaquant les métaux." },
      { q: "Comment conserver des documents et photographies militaires ?",
        r: "À plat, dans des pochettes sans acide, à l'abri de la lumière, avec des mains propres et sèches. Retirez les trombones et agrafes métalliques qui rouillent et marquent le papier. Ne forcez jamais un document cassant et n'utilisez jamais de ruban adhésif pour réparer une déchirure : c'est irréversible et cela tache en vieillissant." },
    ],
  },
];


module.exports = { GUIDES };
