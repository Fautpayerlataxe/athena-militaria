-- =====================================================================
-- Les messages mémorisent l'annonce dont ils parlent : permet d'afficher
-- le titre de l'annonce comme intitulé de conversation dans la messagerie.
-- (Les anciens messages restent sans annonce : affichage du pseudo en repli.)
-- =====================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS product_id bigint;

CREATE INDEX IF NOT EXISTS idx_messages_product ON public.messages (product_id);
