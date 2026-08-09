-- =====================================================================
-- Nettoyage ponctuel demandé : suppression de la conversation de test
-- du 25 avril 2026 (« Tu reçois ? »).
-- Ciblage prudent : uniquement les messages échangés entre les deux
-- comptes de cette conversation ET datant de plus de 7 jours
-- (la conversation récente ne peut pas être affectée).
-- =====================================================================

WITH pair AS (
  SELECT sender_id, receiver_id
    FROM public.messages
   WHERE content = 'Tu reçois ?'
   ORDER BY created_at ASC
   LIMIT 1
)
DELETE FROM public.messages m
USING pair p
WHERE ((m.sender_id = p.sender_id AND m.receiver_id = p.receiver_id)
    OR (m.sender_id = p.receiver_id AND m.receiver_id = p.sender_id))
  AND m.created_at < now() - interval '7 days';
