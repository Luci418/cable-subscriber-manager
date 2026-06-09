
-- Phase 2: hard constraints + invariant trigger on subscribers
-- ADR-012: DB-enforced invariants.

-- 1) services array must be non-empty and a subset of {cable, internet}
ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_services_valid;
ALTER TABLE public.subscribers
  ADD CONSTRAINT subscribers_services_valid
  CHECK (
    services IS NOT NULL
    AND array_length(services, 1) >= 1
    AND services <@ ARRAY['cable','internet']::text[]
  );

-- 2) BEFORE INSERT/UPDATE: invariants around active subscriptions and required STB.
CREATE OR REPLACE FUNCTION public.subscribers_enforce_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_cable_active boolean := false;
  v_has_internet_active boolean := false;
BEGIN
  -- Required STB when cable is enabled
  IF 'cable' = ANY (NEW.services) THEN
    IF NEW.stb_number IS NULL OR btrim(NEW.stb_number) = '' THEN
      RAISE EXCEPTION 'An STB number is required when the Cable service is enabled.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- If cable is NOT in services, stb_number must be empty (consistency)
    IF NEW.stb_number IS NOT NULL AND btrim(NEW.stb_number) <> '' THEN
      NEW.stb_number := NULL;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_has_cable_active := OLD.current_subscription IS NOT NULL
      AND (OLD.current_subscription->>'endDate')::timestamptz > now()
      AND COALESCE(OLD.current_subscription->>'status','active') = 'active';
    v_has_internet_active := OLD.internet_subscription IS NOT NULL
      AND (OLD.internet_subscription->>'endDate')::timestamptz > now()
      AND COALESCE(OLD.internet_subscription->>'status','active') = 'active';

    -- Block dropping a service while its subscription is active
    IF v_has_cable_active AND NOT ('cable' = ANY (NEW.services)) THEN
      RAISE EXCEPTION 'Cannot remove the Cable service while an active cable subscription exists. Cancel the subscription first.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_has_internet_active AND NOT ('internet' = ANY (NEW.services)) THEN
      RAISE EXCEPTION 'Cannot remove the Internet service while an active internet plan exists. Cancel it first.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Block STB swap/clear while cable subscription is active
    IF v_has_cable_active
       AND COALESCE(NEW.stb_number,'') IS DISTINCT FROM COALESCE(OLD.stb_number,'') THEN
      RAISE EXCEPTION 'Cannot change the STB while an active cable subscription exists. Cancel the subscription first, then reassign the device.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Block provider change while corresponding subscription is active
    IF v_has_cable_active
       AND NEW.cable_provider_id IS DISTINCT FROM OLD.cable_provider_id THEN
      RAISE EXCEPTION 'Cannot change the Cable provider while an active cable subscription exists.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_has_internet_active
       AND NEW.internet_provider_id IS DISTINCT FROM OLD.internet_provider_id THEN
      RAISE EXCEPTION 'Cannot change the Internet provider while an active internet plan exists.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscribers_enforce_invariants ON public.subscribers;
CREATE TRIGGER trg_subscribers_enforce_invariants
  BEFORE INSERT OR UPDATE ON public.subscribers
  FOR EACH ROW EXECUTE FUNCTION public.subscribers_enforce_invariants();
