-- =====================================================================
-- Messagerie : édition des messages (2 minutes) + indicateur de lecture
-- 1. Colonne edited : marque les messages modifiés ("(modifié)" à l'écran).
-- 2. L'expéditeur peut modifier le CONTENU de son message pendant 2 min.
-- 3. Verrouillage par trigger :
--    - le destinataire ne peut changer QUE le drapeau read (correctif :
--      l'ancienne policy lui permettait de réécrire le contenu reçu !) ;
--    - l'expéditeur ne peut changer QUE le contenu, et seulement 2 min ;
--    - les champs d'identité (expéditeur, destinataire, date, annonce)
--      sont immuables pour tout le monde.
-- =====================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited boolean NOT NULL DEFAULT false;

-- L'expéditeur doit pouvoir passer la RLS en UPDATE (le trigger fait le tri fin)
DROP POLICY IF EXISTS "Sender edits own messages" ON public.messages;
CREATE POLICY "Sender edits own messages"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = sender_id);

CREATE OR REPLACE FUNCTION public.messages_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Le backend (service_role) n'est pas contraint
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Champs immuables pour tout le monde
  NEW.sender_id   := OLD.sender_id;
  NEW.receiver_id := OLD.receiver_id;
  NEW.created_at  := OLD.created_at;
  NEW.product_id  := OLD.product_id;

  IF auth.uid() = OLD.sender_id THEN
    -- Expéditeur : contenu modifiable 2 minutes, drapeau read intouchable
    NEW.read := OLD.read;
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      IF OLD.created_at < now() - interval '2 minutes' THEN
        RAISE EXCEPTION 'Modification possible pendant 2 minutes seulement';
      END IF;
      NEW.edited := true;
    ELSE
      NEW.edited := OLD.edited;
    END IF;
  ELSIF auth.uid() = OLD.receiver_id THEN
    -- Destinataire : seul le drapeau read peut changer
    NEW.content := OLD.content;
    NEW.edited  := OLD.edited;
  ELSE
    RAISE EXCEPTION 'Non autorisé';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_guard_update ON public.messages;
CREATE TRIGGER messages_guard_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_guard_update();
