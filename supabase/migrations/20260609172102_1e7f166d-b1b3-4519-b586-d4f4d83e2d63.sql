-- 1. Scope the STB-required invariant so it doesn't fire on unrelated updates
CREATE OR REPLACE FUNCTION public.subscribers_enforce_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_cable_active boolean := false;
  v_has_internet_active boolean := false;
  v_check_stb boolean := false;
BEGIN
  -- Only check STB requirement on INSERT or when services/stb_number actually change.
  IF TG_OP = 'INSERT' THEN
    v_check_stb := true;
  ELSIF TG_OP = 'UPDATE' THEN
    v_check_stb := (NEW.services IS DISTINCT FROM OLD.services)
                OR (COALESCE(NEW.stb_number,'') IS DISTINCT FROM COALESCE(OLD.stb_number,''));
  END IF;

  IF v_check_stb THEN
    IF 'cable' = ANY (NEW.services) THEN
      IF NEW.stb_number IS NULL OR btrim(NEW.stb_number) = '' THEN
        RAISE EXCEPTION 'An STB number is required when the Cable service is enabled.'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF NEW.stb_number IS NOT NULL AND btrim(NEW.stb_number) <> '' THEN
        NEW.stb_number := NULL;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_has_cable_active := OLD.current_subscription IS NOT NULL
      AND (OLD.current_subscription->>'endDate')::timestamptz > now()
      AND COALESCE(OLD.current_subscription->>'status','active') = 'active';
    v_has_internet_active := OLD.internet_subscription IS NOT NULL
      AND (OLD.internet_subscription->>'endDate')::timestamptz > now()
      AND COALESCE(OLD.internet_subscription->>'status','active') = 'active';

    IF v_has_cable_active AND NOT ('cable' = ANY (NEW.services)) THEN
      RAISE EXCEPTION 'Cannot remove the Cable service while an active cable subscription exists. Cancel the subscription first.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_has_internet_active AND NOT ('internet' = ANY (NEW.services)) THEN
      RAISE EXCEPTION 'Cannot remove the Internet service while an active internet plan exists. Cancel it first.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_has_cable_active
       AND COALESCE(NEW.stb_number,'') IS DISTINCT FROM COALESCE(OLD.stb_number,'') THEN
      RAISE EXCEPTION 'Cannot change the STB while an active cable subscription exists. Cancel the subscription first, then reassign the device.'
        USING ERRCODE = 'check_violation';
    END IF;

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

-- 2. Balance trigger: exclude both voided originals AND their reversal counterparts.
CREATE OR REPLACE FUNCTION public.recalc_subscriber_balance(p_subscriber_id uuid, p_service_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_balance numeric := 0;
  v_col text;
BEGIN
  IF p_subscriber_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN type = 'charge'  THEN amount
      WHEN type = 'payment' THEN -amount
      WHEN type = 'refund'  THEN amount
      ELSE 0
    END
  ), 0)
  INTO v_balance
  FROM public.transactions
  WHERE subscriber_id = p_subscriber_id
    AND COALESCE(service_type, 'cable') = p_service_type
    AND status NOT IN ('voided', 'reversal');

  v_col := CASE p_service_type WHEN 'internet' THEN 'internet_balance' ELSE 'cable_balance' END;

  EXECUTE format('UPDATE public.subscribers SET %I = $1 WHERE id = $2', v_col)
    USING v_balance, p_subscriber_id;
END;
$fn$;

-- 3. Heal previously inflated balances.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT subscriber_id, COALESCE(service_type, 'cable') AS svc
      FROM public.transactions
     WHERE subscriber_id IS NOT NULL
  LOOP
    PERFORM public.recalc_subscriber_balance(r.subscriber_id, r.svc);
  END LOOP;
END $$;