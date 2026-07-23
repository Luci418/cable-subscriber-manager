
CREATE OR REPLACE FUNCTION public.subscribers_enforce_invariants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_cable_active boolean := false;
  v_has_internet_active boolean := false;
  v_conflict_cable boolean := false;
  v_conflict_internet boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (SELECT 1 FROM public.subscriptions
       WHERE subscriber_id = OLD.id AND service_type = 'cable'
         AND status = 'active' AND end_date > CURRENT_DATE) INTO v_has_cable_active;
    SELECT EXISTS (SELECT 1 FROM public.subscriptions
       WHERE subscriber_id = OLD.id AND service_type = 'internet'
         AND status = 'active' AND end_date > CURRENT_DATE) INTO v_has_internet_active;

    IF v_has_cable_active AND NOT ('cable' = ANY (NEW.services)) THEN
      RAISE EXCEPTION 'Cannot remove the Cable service while an active cable subscription exists. Cancel the subscription first.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_has_internet_active AND NOT ('internet' = ANY (NEW.services)) THEN
      RAISE EXCEPTION 'Cannot remove the Internet service while an active internet plan exists. Cancel it first.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Provider guard: only block when at least one active subscription for
    -- this service uses a DIFFERENT provider than the new value. First-time
    -- provider assignments (OLD IS NULL) and updates that match the active
    -- subscription's own provider are allowed. This lets create_subscription
    -- write the pinned provider on the subscriber row in the same
    -- transaction after inserting the subscription.
    IF NEW.cable_provider_id IS DISTINCT FROM OLD.cable_provider_id THEN
      SELECT EXISTS (
        SELECT 1 FROM public.subscriptions
         WHERE subscriber_id = OLD.id
           AND service_type = 'cable'
           AND status = 'active'
           AND end_date > CURRENT_DATE
           AND provider_id IS DISTINCT FROM NEW.cable_provider_id
      ) INTO v_conflict_cable;
      IF v_conflict_cable THEN
        RAISE EXCEPTION 'Cannot change the Cable provider: an active cable subscription is tied to a different provider. Cancel that subscription first.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.internet_provider_id IS DISTINCT FROM OLD.internet_provider_id THEN
      SELECT EXISTS (
        SELECT 1 FROM public.subscriptions
         WHERE subscriber_id = OLD.id
           AND service_type = 'internet'
           AND status = 'active'
           AND end_date > CURRENT_DATE
           AND provider_id IS DISTINCT FROM NEW.internet_provider_id
      ) INTO v_conflict_internet;
      IF v_conflict_internet THEN
        RAISE EXCEPTION 'Cannot change the Internet provider: an active internet plan is tied to a different provider. Cancel that subscription first.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_device_repaired(p_device_id uuid, p_repair_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_device stb_inventory%ROWTYPE;
  v_notes text;
BEGIN
  IF NOT public.can_replace_device(auth.uid()) THEN
    RAISE EXCEPTION 'permission denied: mark_device_repaired'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_device FROM public.stb_inventory WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device % not found', p_device_id USING ERRCODE = 'P0002';
  END IF;

  IF v_device.status <> 'faulty' THEN
    RAISE EXCEPTION 'Device % is not currently faulty (status: %)',
      v_device.serial_number, v_device.status
      USING ERRCODE = 'P0001';
  END IF;

  v_notes := NULLIF(btrim(COALESCE(p_repair_notes, '')), '');

  UPDATE public.stb_inventory
     SET status = 'available',
         notes  = COALESCE(v_notes, notes)
   WHERE id = p_device_id;

  INSERT INTO public.device_status_log
    (device_id, device_serial, from_status, to_status, reason, changed_by)
  VALUES
    (p_device_id, v_device.serial_number, 'faulty', 'available',
     COALESCE(v_notes, 'Repaired'), auth.uid());
END;
$function$;
