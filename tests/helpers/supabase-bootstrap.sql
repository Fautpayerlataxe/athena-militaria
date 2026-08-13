-- =====================================================================
-- Reconstitution locale de ce que Supabase fournit avant nos migrations.
--
-- Sans cela, aucune migration du projet ne peut s'exécuter hors de Supabase :
-- toutes s'appuient sur le schéma auth, sur les rôles anon / authenticated /
-- service_role, et sur les fonctions auth.uid(), auth.jwt(), auth.role().
--
-- Ce fichier reproduit le comportement documenté de ces éléments :
--   - request.jwt.claims porte les revendications du jeton courant
--   - auth.uid() renvoie le sub, auth.role() le role, auth.jwt() l'objet entier
--   - PostgREST exécute chaque requête après SET ROLE vers anon, authenticated
--     ou service_role, et service_role contourne RLS (BYPASSRLS)
--
-- Ce n'est pas une simulation approximative : ce sont les mêmes primitives,
-- posées sur un vrai Postgres. Ce que les tests observent ensuite est le
-- comportement réel de Postgres, pas une réimplémentation.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Rôles PostgREST
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- BYPASSRLS : c'est bien ainsi que Supabase configure ce rôle, et c'est
    -- pourquoi les edge functions qui l'utilisent doivent porter elles-mêmes
    -- leurs contrôles d'autorisation.
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'postgres';
  END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;

-- ---------------------------------------------------------------------
-- Schéma auth
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(auth.jwt()->>'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(auth.jwt()->>'role', ''), current_setting('role', true));
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(auth.jwt()->>'email', '');
$$;

GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role(), auth.email()
  TO anon, authenticated, service_role;

-- L'API d'administration utilisée par les edge functions
-- (supabase.auth.admin.getUserById) lit cette table.
GRANT SELECT ON auth.users TO service_role;

-- ---------------------------------------------------------------------
-- Extensions indisponibles hors Supabase : pg_cron et pg_net
--
-- On installe des doublures qui enregistrent les appels au lieu de les
-- exécuter. Les tests peuvent ainsi vérifier QUE la tâche est planifiée avec
-- la bonne expression et le bon corps, sans dépendre d'un ordonnanceur.
-- La tâche elle-même (checkout_expire_stale) est testée directement.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid    bigserial PRIMARY KEY,
  jobname  text UNIQUE,
  schedule text NOT NULL,
  command  text NOT NULL
);

CREATE OR REPLACE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION cron.unschedule(p_name text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = p_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not find valid entry for job %', p_name;
  END IF;
  RETURN true;
END $$;

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.http_calls (id bigserial PRIMARY KEY, url text, called_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION net.http_get(url text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO net.http_calls (url) VALUES (url) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}'::jsonb, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO net.http_calls (url) VALUES (url) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- `CREATE EXTENSION pg_cron` / `pg_net` échouerait : on neutralise ces
-- instructions en déclarant les extensions comme déjà satisfaites via des
-- schémas homonymes. La migration sitemap_cron les appelle malgré tout, d'où
-- le filtrage côté harnais (voir migrate.mjs).

-- ---------------------------------------------------------------------
-- Publication logique utilisée par Supabase Realtime. La migration des
-- réactions y ajoute sa table ; sans elle, la migration s'arrête.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Droits par défaut sur public, comme chez Supabase
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
