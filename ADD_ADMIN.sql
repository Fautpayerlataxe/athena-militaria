-- =========================================================================
-- ATHENA MILITARIA — Ajout d'un nouvel administrateur
-- À exécuter dans SQL Editor de Supabase : copie tout, colle, RUN
--
-- Ce script autorise 2 admins : sayrox.ar@gmail.com + renduambroise@gmail.com
-- Pour ajouter d'autres admins plus tard, édite la liste dans chaque policy.
-- =========================================================================

-- ============== 1. PROFILES (gestion utilisateurs) ==============

DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
CREATE POLICY "Admin can read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

DROP POLICY IF EXISTS "Admin can update profiles" ON public.profiles;
CREATE POLICY "Admin can update profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;
CREATE POLICY "Admin can delete profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

-- Trigger anti-auto-déblocage : autoriser les 2 admins
CREATE OR REPLACE FUNCTION public.profiles_prevent_self_unblock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (auth.jwt()->>'email') NOT IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com') THEN
    NEW.blocked := OLD.blocked;
    NEW.blocked_at := OLD.blocked_at;
    NEW.blocked_by := OLD.blocked_by;
    NEW.block_reason := OLD.block_reason;
    NEW.email := OLD.email;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

-- ============== 2. REPORTS (signalements) ==============

DROP POLICY IF EXISTS "Admin can view all reports" ON public.reports;
CREATE POLICY "Admin can view all reports"
  ON public.reports FOR SELECT
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

DROP POLICY IF EXISTS "Admin can update reports" ON public.reports;
CREATE POLICY "Admin can update reports"
  ON public.reports FOR UPDATE
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

-- ============== 3. PRODUCTS (modération articles) ==============

DROP POLICY IF EXISTS "Admin can delete any product" ON public.products;
CREATE POLICY "Admin can delete any product"
  ON public.products FOR DELETE
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

DROP POLICY IF EXISTS "Admin can update any product" ON public.products;
CREATE POLICY "Admin can update any product"
  ON public.products FOR UPDATE
  TO authenticated
  USING (auth.jwt()->>'email' IN ('sayrox.ar@gmail.com', 'renduambroise@gmail.com'));

-- =========================================================================
-- NOTE : le compte renduambroise@gmail.com doit d'abord être créé
-- (inscription via le site) pour que ses politiques s'appliquent.
-- Une fois créé, il aura immédiatement accès au panneau admin.
-- =========================================================================
