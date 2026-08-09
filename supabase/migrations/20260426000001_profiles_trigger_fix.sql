-- =====================================================================
-- Correctif : le trigger profiles_prevent_self_unblock bloquait aussi
-- les écritures du service_role, ce qui rendait tout le flux Stripe
-- Connect inopérant (connect-onboard ne pouvait pas stocker
-- stripe_account_id, et le webhook account.updated ne pouvait pas
-- mettre stripe_onboarded à true).
--
-- Cause : auth.jwt()->>'email' est NULL pour service_role, et
-- (NULL IS DISTINCT FROM 'sayrox.ar@gmail.com') = TRUE → le trigger
-- repassait toujours les champs Stripe à OLD.* avant l'UPDATE.
--
-- Correctif : autoriser explicitement service_role à modifier les
-- champs sensibles (et conserver l'autorisation pour l'admin).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.profiles_prevent_self_unblock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Le service_role (edge functions backend) et l'admin peuvent
  -- modifier les champs sensibles sans restriction.
  IF auth.role() = 'service_role'
     OR (auth.jwt()->>'email') = 'sayrox.ar@gmail.com' THEN
    RETURN NEW;
  END IF;

  -- Pour tous les autres : on bloque la modification des champs sensibles
  -- en réécrivant NEW.* = OLD.*
  NEW.blocked := OLD.blocked;
  NEW.blocked_at := OLD.blocked_at;
  NEW.blocked_by := OLD.blocked_by;
  NEW.block_reason := OLD.block_reason;
  NEW.email := OLD.email;
  NEW.created_at := OLD.created_at;
  NEW.stripe_account_id := OLD.stripe_account_id;
  NEW.stripe_onboarded := OLD.stripe_onboarded;
  NEW.stripe_onboarded_at := OLD.stripe_onboarded_at;

  RETURN NEW;
END;
$$;
