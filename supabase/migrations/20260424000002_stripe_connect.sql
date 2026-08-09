-- Stripe Connect : infos du compte vendeur pour recevoir les paiements
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_onboarded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_onboarded_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_stripe_account_idx ON public.profiles (stripe_account_id);

-- Permettre aux RPC / edge functions (service role) de lire ces infos,
-- et à l'utilisateur concerné de voir ses propres infos Stripe
-- (les policies "Users can read own profile" + "Admin can read all profiles"
--  couvrent déjà ces cas)

-- Protéger les champs Stripe contre modification directe par l'utilisateur :
-- seul l'edge function (service_role) peut les écrire.
CREATE OR REPLACE FUNCTION public.profiles_prevent_self_unblock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (auth.jwt()->>'email') IS DISTINCT FROM 'sayrox.ar@gmail.com' THEN
    NEW.blocked := OLD.blocked;
    NEW.blocked_at := OLD.blocked_at;
    NEW.blocked_by := OLD.blocked_by;
    NEW.block_reason := OLD.block_reason;
    NEW.email := OLD.email;
    NEW.created_at := OLD.created_at;
    -- Stripe Connect : seul le backend (service_role, donc pas d'auth.jwt) peut modifier
    NEW.stripe_account_id := OLD.stripe_account_id;
    NEW.stripe_onboarded := OLD.stripe_onboarded;
    NEW.stripe_onboarded_at := OLD.stripe_onboarded_at;
  END IF;
  RETURN NEW;
END;
$$;
