-- =====================================================================
-- Newsletter : passage en opt-in strict (RGPD)
-- 1. À la création d'un profil, la préférence cochée à l'inscription
--    (metadata newsletter_opt_in) décide de l'abonnement.
--    Pas de choix exprimé = pas d'envoi.
-- 2. Les comptes existants n'ont jamais consenti : désinscrits,
--    sauf le compte administrateur (conserve les envois de test).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.profiles_apply_newsletter_pref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE pref text;
BEGIN
  SELECT u.raw_user_meta_data->>'newsletter_opt_in'
    INTO pref
    FROM auth.users u
   WHERE u.id = NEW.id;

  -- Opt-in strict : seul un consentement explicite ('true') active l'envoi
  NEW.newsletter_opt_out := (pref IS DISTINCT FROM 'true');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_newsletter_pref ON public.profiles;
CREATE TRIGGER profiles_newsletter_pref
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_apply_newsletter_pref();

-- Comptes existants : désinscrits (aucun consentement recueilli),
-- sauf l'administrateur.
UPDATE public.profiles
   SET newsletter_opt_out = true
 WHERE email IS DISTINCT FROM 'sayrox.ar@gmail.com';
