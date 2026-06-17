
-- =========================================================================
-- Phase 5.1: pair_device / unpair_device RPCs
-- =========================================================================

CREATE OR REPLACE FUNCTION public.pair_device(
  p_subscriber_id uuid,
  p_device_id uuid,
  p_reason text DEFAULT 'installation'
)
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

  v_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),'installation'));
  IF v_reason NOT IN ('installation','replacement','upgrade','other') THEN
    RAISE EXCEPTION 'Invalid pair reason: %', p_reason;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;
  IF v_sub.customer_status = 'archived' THEN
    RAISE EXCEPTION 'Cannot pair a device to an archived subscriber.';
  END IF;

  SELECT * INTO v_dev FROM public.stb_inventory
   WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;
  IF v_dev.status <> 'available' THEN
    RAISE EXCEPTION 'Device % is not available (status: %)', v_dev.serial_number, v_dev.status;
  END IF;

  -- 1. Assign in inventory FIRST so the subscribers_enforce_invariants
  --    trigger sees an agreeing inventory row on any downstream UPDATE.
  UPDATE public.stb_inventory
     SET status = 'assigned', subscriber_id = p_subscriber_id, updated_at = now()
   WHERE id = v_dev.id;

  -- 2. Auto-declare service capability if missing. For cable, also set
  --    stb_number when empty so the cable-STB invariant stays satisfied.
  IF NOT (v_dev.service_type = ANY (v_sub.services)) THEN
    UPDATE public.subscribers
       SET services = array_append(services, v_dev.service_type),
           updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  IF v_dev.service_type = 'cable'
     AND (v_sub.stb_number IS NULL OR btrim(v_sub.stb_number) = '') THEN
    UPDATE public.subscribers
       SET stb_number = v_dev.serial_number, updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  -- 3. Open assignment log entry.
  INSERT INTO public.device_assignment_log (
    user_id, subscriber_id, device_serial, device_type, service_type,
    open_reason, opened_by
  ) VALUES (
    v_uid, p_subscriber_id, v_dev.serial_number,
    COALESCE(v_dev.device_type,'stb'), COALESCE(v_dev.service_type,'cable'),
    v_reason, v_uid
  );

  RETURN jsonb_build_object(
    'device_id', v_dev.id,
    'serial', v_dev.serial_number,
    'service_type', v_dev.service_type,
    'reason', v_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pair_device(uuid, uuid, text) TO authenticated;

-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.unpair_device(
  p_subscriber_id uuid,
  p_device_id uuid,
  p_reason text,
  p_return_status text DEFAULT 'available'
)
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),''));
  IF v_reason NOT IN ('customer_closed','downgrade','correction','repair') THEN
    RAISE EXCEPTION 'Invalid unpair reason: % (allowed: customer_closed, downgrade, correction, repair)', p_reason;
  END IF;

  v_return := lower(COALESCE(NULLIF(btrim(p_return_status),''),'available'));
  IF v_return NOT IN ('available','faulty') THEN
    RAISE EXCEPTION 'Invalid return status: % (allowed: available, faulty)', p_return_status;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT * INTO v_dev FROM public.stb_inventory
   WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;

  IF v_dev.status <> 'assigned' OR v_dev.subscriber_id IS DISTINCT FROM p_subscriber_id THEN
    RAISE EXCEPTION 'Device % is not currently assigned to this subscriber', v_dev.serial_number;
  END IF;

  -- Refuse while an active subscription still references this device.
  SELECT count(*) INTO v_active_count
    FROM public.subscriptions
   WHERE device_id = v_dev.id AND status = 'active';
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Cannot unpair: an active subscription is still tied to device %. Cancel the subscription first.', v_dev.serial_number;
  END IF;

  -- 1. Close the open device_assignment_log row.
  UPDATE public.device_assignment_log
     SET closed_at = now(), close_reason = v_reason, closed_by = v_uid, updated_at = now()
   WHERE user_id = v_uid
     AND subscriber_id = p_subscriber_id
     AND device_serial = v_dev.serial_number
     AND closed_at IS NULL;

  -- 2. Clear subscribers.stb_number first (if this was the cable STB) so
  --    the inventory-sync trigger releases the row BEFORE we set the final
  --    return status. Otherwise the trigger would overwrite a 'faulty'
  --    return back to 'available'.
  IF v_dev.service_type = 'cable'
     AND COALESCE(v_sub.stb_number,'') = v_dev.serial_number THEN
    UPDATE public.subscribers
       SET stb_number = NULL, updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  -- 3. Final inventory state (overrides whatever the trigger may have set).
  UPDATE public.stb_inventory
     SET status = v_return::stb_status,
         subscriber_id = NULL,
         updated_at = now()
   WHERE id = v_dev.id;

  RETURN jsonb_build_object(
    'device_id', v_dev.id,
    'serial', v_dev.serial_number,
    'return_status', v_return,
    'reason', v_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unpair_device(uuid, uuid, text, text) TO authenticated;
