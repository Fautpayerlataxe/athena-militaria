-- =====================================================================
-- Correctif du garde d'édition : les connexions d'administration directes
-- (migrations, maintenance) n'ont pas de contexte auth.uid() et étaient
-- rejetées. On les laisse passer : l'API publique reste protégée par les
-- policies RLS (un anonyme ne peut de toute façon UPDATE aucune ligne).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.messages_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Backend (service_role) et connexions directes sans contexte utilisateur
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Champs immuables pour les utilisateurs
  NEW.sender_id   := OLD.sender_id;
  NEW.receiver_id := OLD.receiver_id;
  NEW.created_at  := OLD.created_at;
  NEW.product_id  := OLD.product_id;

  IF auth.uid() = OLD.sender_id THEN
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
    NEW.content := OLD.content;
    NEW.edited  := OLD.edited;
  ELSE
    RAISE EXCEPTION 'Non autorisé';
  END IF;

  RETURN NEW;
END;
$$;
