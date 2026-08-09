-- =====================================================================
-- Réactions emoji sur les messages (table dédiée : plus sûr et plus
-- simple à sécuriser qu'une colonne JSON modifiable à plusieurs).
-- Une réaction = (message, utilisateur, emoji). Un même utilisateur ne
-- peut poser qu'une seule fois le même emoji sur un message.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         bigserial PRIMARY KEY,
  message_id bigint NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid   NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  emoji      text   NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON public.message_reactions (message_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- Lecture : uniquement les réactions des messages de MES conversations
DROP POLICY IF EXISTS "Read reactions of own conversations" ON public.message_reactions;
CREATE POLICY "Read reactions of own conversations"
  ON public.message_reactions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = message_reactions.message_id
       AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())
  ));

-- Ajout : je ne peux réagir qu'en mon nom, et sur un message qui me concerne
DROP POLICY IF EXISTS "Add own reaction" ON public.message_reactions;
CREATE POLICY "Add own reaction"
  ON public.message_reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_reactions.message_id
         AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())
    )
  );

-- Retrait : uniquement mes propres réactions
DROP POLICY IF EXISTS "Remove own reaction" ON public.message_reactions;
CREATE POLICY "Remove own reaction"
  ON public.message_reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Diffusion temps réel des réactions
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;

-- Horodatage de lecture : permet d'afficher « Lu à 14:32 »
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Le garde d'édition doit connaître read_at : seul le destinataire le pose
-- (l'expéditeur ne peut pas déclarer son propre message « lu »).
CREATE OR REPLACE FUNCTION public.messages_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.sender_id   := OLD.sender_id;
  NEW.receiver_id := OLD.receiver_id;
  NEW.created_at  := OLD.created_at;
  NEW.product_id  := OLD.product_id;

  IF auth.uid() = OLD.sender_id THEN
    NEW.read    := OLD.read;
    NEW.read_at := OLD.read_at;
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      IF OLD.created_at < now() - interval '2 minutes' THEN
        RAISE EXCEPTION 'Modification possible pendant 2 minutes seulement';
      END IF;
      NEW.edited := true;
    ELSE
      NEW.edited := OLD.edited;
    END IF;
  ELSIF auth.uid() = OLD.receiver_id THEN
    NEW.content := OLD.content;
    NEW.edited  := OLD.edited;
    -- Horodate automatiquement le passage à « lu »
    IF NEW.read AND NOT OLD.read THEN
      NEW.read_at := COALESCE(NEW.read_at, now());
    END IF;
  ELSE
    RAISE EXCEPTION 'Non autorisé';
  END IF;

  RETURN NEW;
END;
$$;
