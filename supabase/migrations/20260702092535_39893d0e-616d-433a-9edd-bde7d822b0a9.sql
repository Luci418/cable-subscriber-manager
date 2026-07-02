CREATE OR REPLACE FUNCTION public.subscribers_enforce_invariants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_cable_active boolean := false;
  v_has_internet_active boolean := false;
  v_inv_ok boolean := false;
BEGIN
  -- Phase 5.1+: services[] is a "declared intent" cache, decoupled from device pairing.
  -- Devices live in stb_inventory and are attached via pair_device / unpair_device.
  -- We no longer require an stb_number just because 'cable' is in services[] —
  -- that blocked the legitimate "add service, then pair a device" workflow
  -- (e.g. adding Cable TV to an internet-only customer, importing prospects,
  -- bulk provisioning). See docs/BUSINESS_MODEL.md.
  --
  -- We still clear a stale stb_number if the Cable service is removed, to keep
  -- the legacy column from drifting out of sync with reality.
  IF TG_OP = 'UPDATE'
     AND NEW.services IS DISTINCT FROM OLD.services
     AND NOT ('cable' = ANY (NEW.services))
     AND NEW.stb_number IS NOT NULL
     AND btrim(NEW.stb_number) <> '' THEN
    NEW.stb_number := NULL;
  END IF;

  -- Inventory-agreement check: if stb_number is being set to a non-null value,
  -- the inventory row for that serial must already be assigned to THIS subscriber.
  -- Inventory is the authority.
  IF NEW.stb_number IS NOT NULL AND btrim(NEW.stb_number) <> '' THEN
    IF TG_OP = 'INSERT'
       OR COALESCE(NEW.stb_number,'') IS DISTINCT FROM COALESCE(OLD.stb_number,'') THEN
      SELECT EXISTS (
        SELECT 1 FROM public.stb_inventory
         WHERE user_id = NEW.user_id
           AND serial_number = NEW.stb_number
           AND status = 'assigned'
           AND subscriber_id = NEW.id
      ) INTO v_inv_ok;

      IF NOT v_inv_ok THEN
        RAISE EXCEPTION
          'Inventory does not agree: device % is not assigned to this subscriber. Use the replace_device workflow to swap devices.',
          NEW.stb_number
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Service-removal-while-active and provider-change-while-active guards.
  -- TODO: retire the legacy JSONB reads (current_subscription / internet_subscription)
  -- once Batch B/C legacy column cleanup ships; replace with a lookup against the
  -- normalised subscriptions table.
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
$function$;