-- =========================================================================
-- ATHENA MILITARIA — Setup Profils utilisateurs + Modération comptes
-- À exécuter dans SQL Editor de Supabase : copie tout, colle, RUN
--
-- Ce script :
--   1. Crée la table public.profiles (1 ligne par utilisateur)
--   2. Crée un trigger qui crée automatiquement un profil à chaque inscription
--   3. Remplit profiles avec les utilisateurs existants
--   4. Ajoute les politiques RLS (utilisateurs lisent/modifient leur profil,
--      admin lit/modifie tous les profils)
--   5. Empêche les utilisateurs bloqués de publier des annonces
-- =========================================================================

-- 1. Table des profils
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  pseudo text,
  blocked boolean NOT NULL DEFAULT false,
  blocked_at timestamptz,
  blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  block_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_blocked_idx ON public.profiles(blocked);
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles(email);

-- 2. Trigger : à chaque nouvel utilisateur dans auth.users → on crée son profil
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, created_at)
  VALUES (NEW.id, NEW.email, NEW.created_at)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Backfill : insérer un profil pour chaque utilisateur existant
INSERT INTO public.profiles (id, email, created_at)
SELECT id, email, created_at FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 4. Activer RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4a. L'utilisateur lit son propre profil
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 4b. L'admin lit tous les profils
DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
CREATE POLICY "Admin can read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.jwt()->>'email' = 'sayrox.ar@gmail.com');

-- 4c. L'admin met à jour n'importe quel profil (block / unblock)
DROP POLICY IF EXISTS "Admin can update profiles" ON public.profiles;
CREATE POLICY "Admin can update profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.jwt()->>'email' = 'sayrox.ar@gmail.com');

-- 4d. L'admin supprime un profil (cascade sur auth.users impossible depuis SQL
--     côté client : la suppression complète d'un compte se fait via RPC ou
--     via le dashboard Supabase — voir note plus bas)
DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;
CREATE POLICY "Admin can delete profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (auth.jwt()->>'email' = 'sayrox.ar@gmail.com');

-- 4e. L'utilisateur peut modifier son pseudo (mais PAS le champ "blocked")
--     Note : Postgres ne permet pas de restreindre par colonne dans une
--     policy UPDATE. On utilise un trigger pour empêcher le user de se
--     débloquer lui-même.
CREATE OR REPLACE FUNCTION public.profiles_prevent_self_unblock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si ce n'est pas l'admin, on interdit toute modif des champs sensibles
  IF (auth.jwt()->>'email') IS DISTINCT FROM 'sayrox.ar@gmail.com' THEN
    NEW.blocked := OLD.blocked;
    NEW.blocked_at := OLD.blocked_at;
    NEW.blocked_by := OLD.blocked_by;
    NEW.block_reason := OLD.block_reason;
    NEW.email := OLD.email; -- email vient de auth.users
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_no_self_unblock ON public.profiles;
CREATE TRIGGER profiles_no_self_unblock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_prevent_self_unblock();

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- =========================================================================
-- 5. EMPÊCHER LES UTILISATEURS BLOQUÉS DE POSTER DES ANNONCES
-- =========================================================================
-- On ajoute une politique RLS sur products qui refuse l'INSERT si le
-- profil de l'utilisateur a blocked=true.
-- =========================================================================

DROP POLICY IF EXISTS "Block insert if user blocked" ON public.products;
CREATE POLICY "Block insert if user blocked"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND blocked = true
    )
  );

-- =========================================================================
-- NOTE : SUPPRESSION COMPLÈTE D'UN COMPTE
-- ---------------------------------------------------------------------------
-- Supprimer un profil ne supprime PAS l'utilisateur dans auth.users
-- (il pourra recréer un compte avec le même email). Pour vraiment supprimer
-- un compte, il faut soit :
--   a) Le faire à la main dans le dashboard Supabase
--      (Authentication → Users → ... → Delete user)
--   b) Créer une Edge Function qui appelle l'admin API Supabase
--      (auth.admin.deleteUser) avec la SERVICE_ROLE_KEY
--
-- Pour l'instant, l'admin peut BLOQUER un compte (le compte ne peut plus
-- vendre, mais existe encore). C'est généralement préférable pour garder
-- une trace et empêcher la recréation immédiate.
-- =========================================================================

-- =========================================================================
-- NOTE : Si tu changes l'email admin, mets à jour les 4 policies ci-dessus
-- ET le fichier admin.js (constante ADMIN_EMAILS).
-- =========================================================================
