
-- Batch D — retire subscribers.stb_number.
-- All four device RPCs have parameter DEFAULTs, so a plain CREATE OR REPLACE
-- fails ("cannot remove parameter defaults from existing function"). Drop
-- them explicitly and recreate.

DROP FUNCTION IF EXISTS public.pair_device(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.unpair_device(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.mark_device_faulty(uuid, text);
DROP FUNCTION IF EXISTS public.replace_device(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.subscribers_enforce_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_cable_active boolean := false;
  v_has_internet_active boolean := false;
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
    IF v_has_cable_active AND NEW.cable_provider_id IS DISTINCT FROM OLD.cable_provider_id THEN
      RAISE EXCEPTION 'Cannot change the Cable provider while an active cable subscription exists.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_has_internet_active AND NEW.internet_provider_id IS DISTINCT FROM OLD.internet_provider_id THEN
      RAISE EXCEPTION 'Cannot change the Internet provider while an active internet plan exists.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.pair_device(p_subscriber_id uuid, p_device_id uuid, p_reason text DEFAULT 'installation'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_dev public.stb_inventory;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_pair_device(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to pair devices. Ask an Owner, Admin, or Technician.' USING ERRCODE = '42501';
  END IF;

  v_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),'installation'));
  IF v_reason NOT IN ('installation','replacement','upgrade','other') THEN
    RAISE EXCEPTION 'Invalid pair reason: %', p_reason;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;
  IF v_sub.customer_status = 'archived' THEN
    RAISE EXCEPTION 'Cannot pair a device to an archived subscriber.';
  END IF;

  SELECT * INTO v_dev FROM public.stb_inventory WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;
  IF v_dev.status <> 'available' THEN
    RAISE EXCEPTION 'Device % is not available (status: %)', v_dev.serial_number, v_dev.status;
  END IF;

  UPDATE public.stb_inventory
     SET status = 'assigned', subscriber_id = p_subscriber_id, updated_at = now()
   WHERE id = v_dev.id;

  IF NOT (v_dev.service_type = ANY (v_sub.services)) THEN
    UPDATE public.subscribers
       SET services = array_append(services, v_dev.service_type), updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  INSERT INTO public.device_assignment_log (
    user_id, subscriber_id, device_serial, device_type, service_type, open_reason, opened_by
  ) VALUES (
    v_uid, p_subscriber_id, v_dev.serial_number,
    COALESCE(v_dev.device_type,'stb'), COALESCE(v_dev.service_type,'cable'),
    v_reason, v_uid
  );

  RETURN jsonb_build_object('device_id', v_dev.id, 'serial', v_dev.serial_number,
    'service_type', v_dev.service_type, 'reason', v_reason);
END;
$$;

CREATE FUNCTION public.unpair_device(p_subscriber_id uuid, p_device_id uuid, p_reason text, p_return_status text DEFAULT 'available'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_dev public.stb_inventory;
  v_reason text;
  v_return text;
  v_active_count int;
  v_other_devices int;
  v_remaining_services text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_pair_device(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to unpair devices.' USING ERRCODE = '42501';
  END IF;

  v_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),''));
  IF v_reason NOT IN ('customer_closed','downgrade','correction','repair') THEN
    RAISE EXCEPTION 'Invalid unpair reason: % (allowed: customer_closed, downgrade, correction, repair)', p_reason;
  END IF;

  v_return := lower(COALESCE(NULLIF(btrim(p_return_status),''),'available'));
  IF v_return NOT IN ('available','faulty') THEN
    RAISE EXCEPTION 'Invalid return status: % (allowed: available, faulty)', p_return_status;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT * INTO v_dev FROM public.stb_inventory WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;
  IF v_dev.status <> 'assigned' OR v_dev.subscriber_id IS DISTINCT FROM p_subscriber_id THEN
    RAISE EXCEPTION 'Device % is not currently assigned to this subscriber', v_dev.serial_number;
  END IF;

  SELECT count(*) INTO v_active_count FROM public.subscriptions
   WHERE device_id = v_dev.id AND status = 'active';
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Cannot unpair: an active subscription is still tied to device %. Cancel the subscription first.', v_dev.serial_number;
  END IF;

  SELECT count(*) INTO v_other_devices FROM public.stb_inventory
   WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
     AND service_type = v_dev.service_type AND id <> v_dev.id AND status = 'assigned';

  UPDATE public.device_assignment_log
     SET closed_at = now(), close_reason = v_reason, closed_by = v_uid, updated_at = now()
   WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
     AND device_serial = v_dev.serial_number AND closed_at IS NULL;

  IF v_other_devices = 0 THEN
    v_remaining_services := array_remove(v_sub.services, v_dev.service_type);
    IF array_length(v_remaining_services, 1) >= 1 THEN
      UPDATE public.subscribers SET services = v_remaining_services, updated_at = now() WHERE id = p_subscriber_id;
    END IF;
  END IF;

  UPDATE public.stb_inventory
     SET status = v_return::stb_status, subscriber_id = NULL, updated_at = now()
   WHERE id = v_dev.id;

  RETURN jsonb_build_object('device_id', v_dev.id, 'serial', v_dev.serial_number,
    'return_status', v_return, 'reason', v_reason,
    'service_removed', (v_other_devices = 0 AND array_length(array_remove(v_sub.services, v_dev.service_type), 1) >= 1));
END;
$$;

CREATE FUNCTION public.mark_device_faulty(p_device_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev public.stb_inventory;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_replace_device(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to mark devices faulty.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_dev FROM public.stb_inventory WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;

  IF v_dev.status = 'faulty' THEN
    RETURN jsonb_build_object('device_id', v_dev.id, 'already', true);
  END IF;
  IF v_dev.status = 'decommissioned' THEN
    RAISE EXCEPTION 'Decommissioned devices cannot be marked faulty.';
  END IF;

  IF v_dev.subscriber_id IS NOT NULL THEN
    UPDATE public.device_assignment_log
       SET closed_at = now(), close_reason = 'faulty', closed_by = v_uid, updated_at = now()
     WHERE user_id = v_uid AND subscriber_id = v_dev.subscriber_id
       AND device_serial = v_dev.serial_number AND closed_at IS NULL;
  END IF;

  UPDATE public.stb_inventory
     SET status = 'faulty', subscriber_id = NULL,
         notes = COALESCE(NULLIF(btrim(p_reason), ''), notes),
         updated_at = now()
   WHERE id = v_dev.id;

  RETURN jsonb_build_object('device_id', v_dev.id, 'serial', v_dev.serial_number,
    'former_subscriber_id', v_dev.subscriber_id);
END;
$$;

CREATE FUNCTION public.replace_device(p_subscriber_id uuid, p_old_serial text, p_new_serial text, p_reason text DEFAULT 'faulty'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_old_inv public.stb_inventory;
  v_new_inv public.stb_inventory;
  v_service text;
  v_close_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_replace_device(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to replace devices.' USING ERRCODE = '42501';
  END IF;

  IF p_old_serial IS NULL OR btrim(p_old_serial) = '' THEN RAISE EXCEPTION 'Old device serial is required'; END IF;
  IF p_new_serial IS NULL OR btrim(p_new_serial) = '' THEN RAISE EXCEPTION 'New device serial is required'; END IF;
  IF p_old_serial = p_new_serial THEN RAISE EXCEPTION 'Old and new device serials must differ'; END IF;

  v_close_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),'faulty'));
  IF v_close_reason NOT IN ('faulty','upgraded','returned','replaced','other') THEN
    RAISE EXCEPTION 'Invalid replacement reason: %', p_reason;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT * INTO v_old_inv FROM public.stb_inventory
   WHERE user_id = v_uid AND serial_number = p_old_serial FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Old device % not found', p_old_serial; END IF;
  IF v_old_inv.status <> 'assigned' OR v_old_inv.subscriber_id IS DISTINCT FROM p_subscriber_id THEN
    RAISE EXCEPTION 'Old device % is not currently assigned to this subscriber', p_old_serial;
  END IF;

  SELECT * INTO v_new_inv FROM public.stb_inventory
   WHERE user_id = v_uid AND serial_number = p_new_serial FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'New device % not found', p_new_serial; END IF;
  IF v_new_inv.status <> 'available' THEN
    RAISE EXCEPTION 'New device % is not available (status: %)', p_new_serial, v_new_inv.status;
  END IF;
  IF COALESCE(v_new_inv.service_type,'cable') IS DISTINCT FROM COALESCE(v_old_inv.service_type,'cable') THEN
    RAISE EXCEPTION 'New device service type does not match old device';
  END IF;

  v_service := COALESCE(v_old_inv.service_type,'cable');

  UPDATE public.stb_inventory SET status='faulty', subscriber_id=NULL, updated_at=now() WHERE id = v_old_inv.id;
  UPDATE public.stb_inventory SET status='assigned', subscriber_id=p_subscriber_id, updated_at=now() WHERE id = v_new_inv.id;

  UPDATE public.device_assignment_log
     SET closed_at = now(), close_reason = v_close_reason, closed_by = v_uid, updated_at = now()
   WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
     AND device_serial = p_old_serial AND closed_at IS NULL;

  INSERT INTO public.device_assignment_log (
    user_id, subscriber_id, device_serial, device_type, service_type, open_reason, opened_by
  ) VALUES (
    v_uid, p_subscriber_id, p_new_serial,
    COALESCE(v_new_inv.device_type,'stb'), v_service, 'replacement', v_uid
  );

  UPDATE public.subscriptions
     SET device_id = v_new_inv.id, device_serial_snapshot = p_new_serial, updated_at = now()
   WHERE subscriber_id = p_subscriber_id AND service_type = v_service AND status = 'active';

  RETURN jsonb_build_object('old_device_id', v_old_inv.id, 'new_device_id', v_new_inv.id,
    'service_type', v_service, 'reason', v_close_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pair_device(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pair_device(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.unpair_device(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_device(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_device_faulty(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_device_faulty(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_device(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_device(uuid, text, text, text) TO service_role;

-- Drop sync triggers, sync fn, obsolete reconciler, and finally the column.
DROP TRIGGER IF EXISTS trg_subscribers_sync_stb ON public.subscribers;
DROP TRIGGER IF EXISTS trg_sync_stb_inventory  ON public.subscribers;
DROP FUNCTION IF EXISTS public.sync_stb_inventory_on_subscriber_change() CASCADE;
DROP FUNCTION IF EXISTS public.reconcile_stb_inventory() CASCADE;
ALTER TABLE public.subscribers DROP COLUMN IF EXISTS stb_number;
