-- =====================================================================
-- Un avis suppose un achat
--
-- La règle en vigueur était : WITH CHECK (auth.uid() = reviewer_id). Elle
-- garantit qu'on ne signe pas un avis du nom d'un autre, et rien de plus.
-- N'importe quel compte pouvait donc noter n'importe quelle annonce sans
-- l'avoir jamais achetée.
--
-- Sur une place de marché, c'est la réputation qui décide de la vente. Un
-- vendeur pouvait se donner cinq étoiles depuis un second compte, ou en mettre
-- une à un concurrent. Pour le coût d'une inscription.
--
-- Constaté en production par une tentative réelle, dans une transaction
-- annulée : l'insertion aboutissait.
--
-- La règle devient : il faut une commande, à son nom, sur cette annonce, dont
-- la réception a été confirmée. Le même fait qui ouvre le versement au vendeur
-- ouvre le droit à l'avis, ce qui évite d'inventer un second critère.
--
-- L'unicité (product_id, reviewer_id) existait déjà : un achat, un avis.
-- =====================================================================

/* Rappel de ce qui est déjà en place et qu'on ne touche pas :
     « Anyone can read reviews »  SELECT  USING (true)
     index unique reviews_product_id_reviewer_id_key                        */

DROP POLICY IF EXISTS "Users create own reviews" ON public.reviews;

CREATE POLICY "Un avis suppose un achat confirmé"
  ON public.reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = reviewer_id
    AND EXISTS (
      SELECT 1
        FROM public.orders o
       WHERE o.product_id = reviews.product_id
         AND o.buyer_id = auth.uid()
         -- La confirmation de réception par l'acheteur, ou une commande menée
         -- à son terme. Une commande payée mais jamais reçue ne suffit pas :
         -- l'avis porte sur l'objet reçu, pas sur le paiement.
         AND (o.confirmed_at IS NOT NULL OR o.status IN ('delivered', 'completed'))
    )
  );

/* --------------------------------------------------------------------- *
 * Modification et suppression
 *
 * Aucune politique d'UPDATE ni de DELETE n'existait : RLS refusait donc déjà
 * les deux, et un acheteur ne pouvait pas corriger son propre avis. On lui en
 * donne le droit, sur le sien uniquement, et sans pouvoir le déplacer vers une
 * autre annonce ou un autre auteur.
 * --------------------------------------------------------------------- */

DROP POLICY IF EXISTS "Un acheteur corrige son propre avis" ON public.reviews;
CREATE POLICY "Un acheteur corrige son propre avis"
  ON public.reviews
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = reviewer_id)
  WITH CHECK (auth.uid() = reviewer_id);

DROP POLICY IF EXISTS "Un acheteur retire son propre avis" ON public.reviews;
CREATE POLICY "Un acheteur retire son propre avis"
  ON public.reviews
  FOR DELETE
  TO authenticated
  USING (auth.uid() = reviewer_id);

/* Un avis ne doit pas pouvoir changer d'annonce ni d'auteur après coup : la
   politique d'UPDATE ci-dessus vérifie l'auteur, mais rien n'empêcherait de
   déplacer l'avis vers une annonce jamais achetée. Un déclencheur fige les
   deux colonnes, comme ailleurs dans ce schéma pour les champs sensibles. */
CREATE OR REPLACE FUNCTION public.reviews_freeze_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Le back-office garde la main pour corriger ou modérer.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  NEW.product_id  := OLD.product_id;
  NEW.reviewer_id := OLD.reviewer_id;
  NEW.created_at  := OLD.created_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reviews_guard_target ON public.reviews;
CREATE TRIGGER reviews_guard_target
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_freeze_target();

/* L'administration doit pouvoir retirer un avis diffamatoire. */
DROP POLICY IF EXISTS "Admin can moderate reviews" ON public.reviews;
CREATE POLICY "Admin can moderate reviews"
  ON public.reviews
  FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'email') = ANY (ARRAY['sayrox.ar@gmail.com', 'renduambroise@gmail.com']));

COMMENT ON TABLE public.reviews IS
  'Avis sur les annonces. Un avis exige une commande confirmée du même acheteur '
  'sur la même annonce : sans cela la réputation, qui décide des ventes, '
  's''achèterait au prix d''une inscription.';
