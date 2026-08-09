-- =====================================================================
-- Un changement de pseudo au maximum tous les 2 mois.
--
-- La règle est posée en base et non dans la page : le navigateur peut
-- appeler l'API directement, un contrôle uniquement côté client se
-- contournerait en quelques secondes.
--
-- Le pseudo choisi à l'inscription ne consomme pas le délai : il arrive
-- par un INSERT, or ce trigger ne surveille que les UPDATE. Idem pour les
-- pseudos attribués automatiquement aux comptes existants, dont la date
-- de dernier changement reste NULL : leur première modification est
-- toujours autorisée.
-- =====================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pseudo_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.profiles_pseudo_change_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pseudo IS DISTINCT FROM OLD.pseudo THEN

    -- Le back-office (service_role) et l'admin ne sont pas soumis au délai :
    -- il faut pouvoir corriger un pseudo insultant sans attendre 2 mois.
    IF auth.role() = 'service_role'
       OR (auth.jwt()->>'email') = 'sayrox.ar@gmail.com' THEN
      NEW.pseudo_changed_at := now();
      RETURN NEW;
    END IF;

    IF OLD.pseudo_changed_at IS NOT NULL
       AND OLD.pseudo_changed_at > now() - interval '2 months' THEN
      -- Message volontairement lisible par la page : le préfixe sert de code
      -- et la date indique quand le prochain changement sera possible.
      RAISE EXCEPTION 'PSEUDO_COOLDOWN %',
        to_char(OLD.pseudo_changed_at + interval '2 months', 'YYYY-MM-DD')
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.pseudo_changed_at := now();

  ELSE
    -- Le pseudo n'a pas bougé : on réimpose l'ancienne date. Sans cette
    -- ligne, un client pourrait remonter son compteur en écrivant lui-même
    -- pseudo_changed_at lors d'une mise à jour anodine, et changer de
    -- pseudo autant de fois qu'il veut.
    NEW.pseudo_changed_at := OLD.pseudo_changed_at;
  END IF;

  RETURN NEW;
END;
$$;

-- Nommé pour passer APRÈS profiles_no_self_unblock : Postgres déclenche les
-- triggers BEFORE d'une même table par ordre alphabétique, et "no" précède
-- "pseudo". Aucun des deux ne touche aux champs de l'autre.
DROP TRIGGER IF EXISTS profiles_pseudo_cooldown ON public.profiles;
CREATE TRIGGER profiles_pseudo_cooldown
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_pseudo_change_limit();
