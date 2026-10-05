-- =====================================================================
-- Authenticité : l'avis de la modération sur une annonce
--
-- Le 5 octobre 2026, Augustin a demandé de pouvoir marquer depuis l'espace
-- modération une annonce jugée authentique par l'équipe, et que le vendeur
-- en soit prévenu par e-mail.
--
-- CE QUE CETTE MIGRATION POSE :
--
--   - authenticated_at : date de l'avis ; NULL, pas d'avis ;
--   - authenticated_by : l'administrateur qui l'a donné ;
--   - authenticity_notified_at : dernier e-mail envoyé au vendeur, écrit par
--     la fonction edge authenticity-notify, qui s'en sert contre les doublons.
--
-- DEUX GARDES, en base parce que c'est la seule qui tienne face à un appel
-- direct de l'API :
--
--   1. Seul un administrateur (ou le service) écrit ces colonnes. Sans cela,
--      un vendeur pouvait se décerner la mention par une simple requête : la
--      politique « Users can update own products » lui ouvre toute sa ligne.
--
--   2. Si le vendeur change ensuite les photos, le titre ou la description,
--      la mention tombe. L'avis portait sur ce que l'équipe a vu ; une autre
--      photo, c'est peut-être une autre pièce.
--
-- Pas de SECURITY DEFINER : current_user doit rester celui de la requête.
-- Dans une fonction SECURITY DEFINER, il vaut toujours le propriétaire
-- (postgres), et une garde qui le teste laisse alors tout passer. Même choix
-- que products_protect_reserved_qty (20260813000000_stripe_hardening.sql).
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS authenticated_at timestamptz,
  ADD COLUMN IF NOT EXISTS authenticated_by uuid,
  ADD COLUMN IF NOT EXISTS authenticity_notified_at timestamptz;

COMMENT ON COLUMN public.products.authenticated_at IS
  'Date à laquelle la modération a jugé la pièce authentique, sur photos et '
  'description. NULL : aucun avis. Retombe à NULL si le vendeur change les '
  'photos, le titre ou la description.';
COMMENT ON COLUMN public.products.authenticated_by IS
  'Administrateur qui a donné l''avis d''authenticité.';
COMMENT ON COLUMN public.products.authenticity_notified_at IS
  'Dernier e-mail « pièce authentifiée » envoyé au vendeur (fonction '
  'authenticity-notify) : empêche les envois en double.';

CREATE OR REPLACE FUNCTION public.products_garde_authenticite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
BEGIN
  v_admin := current_user IN ('postgres', 'service_role', 'supabase_admin')
          OR coalesce(auth.jwt() ->> 'email', '') = ANY (ARRAY['sayrox.ar@gmail.com', 'renduambroise@gmail.com']);

  IF TG_OP = 'INSERT' THEN
    IF NOT v_admin THEN
      NEW.authenticated_at := NULL;
      NEW.authenticated_by := NULL;
      NEW.authenticity_notified_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_admin THEN
    -- Ce que le vendeur envoie pour ces colonnes est ignoré, sans erreur :
    -- un formulaire qui renvoie la ligne entière ne doit pas échouer pour
    -- autant.
    NEW.authenticated_at := OLD.authenticated_at;
    NEW.authenticated_by := OLD.authenticated_by;
    NEW.authenticity_notified_at := OLD.authenticity_notified_at;

    -- btrim : le formulaire de modification retire les espaces de bord ; un
    -- simple « Enregistrer » sans rien changer ne doit pas coûter la mention.
    IF OLD.authenticated_at IS NOT NULL AND (
         btrim(coalesce(NEW.title, '')) IS DISTINCT FROM btrim(coalesce(OLD.title, ''))
      OR btrim(coalesce(NEW.description, '')) IS DISTINCT FROM btrim(coalesce(OLD.description, ''))
      OR NEW.image_url IS DISTINCT FROM OLD.image_url
      OR NEW.image_urls IS DISTINCT FROM OLD.image_urls
    ) THEN
      NEW.authenticated_at := NULL;
      NEW.authenticated_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Administrateur : la date et l'auteur sont ceux du serveur, pas ceux
  -- qu'envoie le navigateur, et un avis déjà donné garde sa date d'origine.
  IF NEW.authenticated_at IS NULL THEN
    NEW.authenticated_by := NULL;
  ELSIF OLD.authenticated_at IS NULL THEN
    NEW.authenticated_at := now();
    NEW.authenticated_by := coalesce(auth.uid(), NEW.authenticated_by);
  ELSE
    NEW.authenticated_at := OLD.authenticated_at;
    NEW.authenticated_by := OLD.authenticated_by;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS products_garde_authenticite ON public.products;
CREATE TRIGGER products_garde_authenticite
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_garde_authenticite();
