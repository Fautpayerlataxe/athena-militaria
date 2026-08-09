-- =====================================================================
-- Rattachement rétroactif (demandé) : la conversation de test
-- « avez-vous des photos ? » concerne l'annonce n°7
-- (« Veste authentique us air force de la seconde guerre mondiale. »).
-- On lie tous les messages sans annonce échangés entre ces deux comptes.
-- =====================================================================

WITH pair AS (
  SELECT sender_id, receiver_id
    FROM public.messages
   WHERE content LIKE 'Bonjour, je suis intéressé par votre annonce%'
   ORDER BY created_at ASC
   LIMIT 1
)
UPDATE public.messages m
   SET product_id = 7
  FROM pair p
 WHERE m.product_id IS NULL
   AND ((m.sender_id = p.sender_id AND m.receiver_id = p.receiver_id)
     OR (m.sender_id = p.receiver_id AND m.receiver_id = p.sender_id));
