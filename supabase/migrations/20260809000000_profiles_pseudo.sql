-- =====================================================================
-- Pseudo public choisi à l'inscription
--
-- Constat de départ : la colonne "pseudo" existait déjà mais n'était
-- jamais renseignée, et surtout la table profiles n'est lisible que par
-- son propriétaire et par l'admin. Résultat : messagerie et fiche produit
-- recevaient une réponse vide et retombaient sur « Utilisateur ».
--
-- Ce fichier : normalise et rend le pseudo unique, le renseigne à la
-- création du compte, remplit les comptes existants, et expose une vue
-- publique ne contenant QUE les champs destinés à être vus par tous.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes attendues par la fiche produit mais absentes de la table.
--    product.js les demandait déjà : la requête échouait en entier, donc
--    même "membre depuis" ne s'affichait pas.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location text;

-- ---------------------------------------------------------------------
-- 2. Normalisation : on ne garde que des caractères sûrs pour un
--    identifiant public affiché partout (pas d'espace, pas de HTML).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_pseudo(src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    substring(regexp_replace(coalesce(src, ''), '[^A-Za-z0-9_-]', '', 'g') from 1 for 20),
    ''
  );
$$;

-- Renvoie un pseudo libre dérivé de "base", en suffixant un compteur
-- tant que la casse insensible entre en collision.
CREATE OR REPLACE FUNCTION public.unique_pseudo(base text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  root      text := coalesce(public.normalize_pseudo(base), '');
  candidate text;
  n         int := 0;
BEGIN
  -- Trop court (ou vide, cas d'une adresse e-mail exotique) : socle neutre.
  IF length(root) < 3 THEN
    root := 'membre' || root;
  END IF;
  root := substring(root from 1 for 20);

  candidate := root;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(pseudo) = lower(candidate)) LOOP
    n := n + 1;
    candidate := substring(root from 1 for 20 - length(n::text)) || n::text;
  END LOOP;

  RETURN candidate;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Comptes existants : tout le monde doit finir avec un pseudo valide et
--    unique, sinon la contrainte et l'index de l'étape 4 échoueraient et la
--    migration entière serait annulée.
--
--    Boucles ligne à ligne volontairement : chaque UPDATE est une commande
--    distincte, donc unique_pseudo voit les pseudos attribués juste avant.
--    Un seul gros UPDATE travaillerait sur un instantané figé et pourrait
--    régénérer les doublons qu'on cherche à supprimer.
-- ---------------------------------------------------------------------

-- 3a. Pseudo absent ou non conforme (espaces, accents, trop court...).
--     On part du pseudo existant s'il y en a un, sinon de l'e-mail.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, email, pseudo FROM public.profiles
            WHERE pseudo IS NULL
               OR pseudo !~ '^[A-Za-z0-9_-]{3,20}$' LOOP
    UPDATE public.profiles
       SET pseudo = public.unique_pseudo(
             coalesce(
               public.normalize_pseudo(r.pseudo),
               split_part(coalesce(r.email, ''), '@', 1)
             ))
     WHERE id = r.id;
  END LOOP;
END $$;

-- 3b. Doublons éventuels parmi les pseudos déjà valides : le plus ancien
--     compte garde le sien, les suivants sont suffixés.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, pseudo FROM (
      SELECT id, pseudo,
             row_number() OVER (PARTITION BY lower(pseudo) ORDER BY created_at, id) AS rang
        FROM public.profiles
       WHERE pseudo IS NOT NULL
    ) t WHERE t.rang > 1
  LOOP
    UPDATE public.profiles
       SET pseudo = public.unique_pseudo(r.pseudo)
     WHERE id = r.id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. Règles définitives : format et unicité insensible à la casse.
--    Posées APRÈS le remplissage, sinon les lignes existantes vides
--    feraient échouer la contrainte.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_pseudo_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pseudo_format
  CHECK (pseudo IS NULL OR pseudo ~ '^[A-Za-z0-9_-]{3,20}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_pseudo_unique_idx
  ON public.profiles (lower(pseudo))
  WHERE pseudo IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. Création de compte : le pseudo saisi dans le formulaire arrive dans
--    raw_user_meta_data. Absent (connexion Google/Apple/Facebook) : on
--    retombe sur l'adresse e-mail. Le compte n'est jamais sans pseudo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wanted text;
BEGIN
  wanted := public.normalize_pseudo(NEW.raw_user_meta_data->>'pseudo');
  IF wanted IS NULL OR length(wanted) < 3 THEN
    wanted := split_part(coalesce(NEW.email, ''), '@', 1);
  END IF;

  INSERT INTO public.profiles (id, email, pseudo, created_at)
  VALUES (NEW.id, NEW.email, public.unique_pseudo(wanted), NEW.created_at)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- 6. Lecture publique, strictement limitée aux champs affichables.
--    On n'ouvre PAS profiles en lecture : la table contient l'e-mail,
--    le statut de blocage et les identifiants Stripe. Une policy RLS ne
--    filtre que des lignes, jamais des colonnes, d'où la vue.
--    security_invoker = off : la vue interroge profiles avec les droits
--    de son propriétaire, ce qui contourne volontairement la RLS pour
--    ces colonnes-là uniquement.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
  SELECT id, pseudo, avatar_url, location, created_at
    FROM public.profiles;

ALTER VIEW public.public_profiles SET (security_invoker = off);

GRANT SELECT ON public.public_profiles TO anon, authenticated;
