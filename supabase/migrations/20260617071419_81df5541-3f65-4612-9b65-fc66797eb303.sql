
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
  v_other_devices int;
  v_remaining_services text[];
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

  SELECT count(*) INTO v_active_count
    FROM public.subscriptions
   WHERE device_id = v_dev.id AND status = 'active';
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Cannot unpair: an active subscription is still tied to device %. Cancel the subscription first.', v_dev.serial_number;
  END IF;

  -- Count OTHER devices of the SAME service still paired to this subscriber.
  -- If this is the last one, we must also drop the service from services[]
  -- (the cable-STB invariant trigger requires stb_number to exist while
  --  'cable' is in services). subscribers.services has a CHECK constraint
  -- requiring at least one element, so if removing leaves an empty array
  -- we leave services unchanged — operator will see a state inconsistency
  -- they can resolve by pairing a new device.
  SELECT count(*) INTO v_other_devices
    FROM public.stb_inventory
   WHERE user_id = v_uid
     AND subscriber_id = p_subscriber_id
     AND service_type = v_dev.service_type
     AND id <> v_dev.id
     AND status = 'assigned';

  -- 1. Close the open device_assignment_log row.
  UPDATE public.device_assignment_log
     SET closed_at = now(), close_reason = v_reason, closed_by = v_uid, updated_at = now()
   WHERE user_id = v_uid
     AND subscriber_id = p_subscriber_id
     AND device_serial = v_dev.serial_number
     AND closed_at IS NULL;

  -- 2. If last device of this service, drop service from services[] first
  --    (but only if it leaves at least one service enrolled).
  IF v_other_devices = 0 THEN
    v_remaining_services := array_remove(v_sub.services, v_dev.service_type);
    IF array_length(v_remaining_services, 1) >= 1 THEN
      UPDATE public.subscribers
         SET services = v_remaining_services, updated_at = now()
       WHERE id = p_subscriber_id;
    END IF;
  END IF;

  -- 3. Clear subscribers.stb_number first (if this was the cable STB) so
  --    the inventory-sync trigger releases the row BEFORE we set the final
  --    return status. Otherwise the trigger would overwrite a 'faulty'
  --    return back to 'available'.
  IF v_dev.service_type = 'cable'
     AND COALESCE(v_sub.stb_number,'') = v_dev.serial_number THEN
    UPDATE public.subscribers
       SET stb_number = NULL, updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  -- 4. Final inventory state.
  UPDATE public.stb_inventory
     SET status = v_return::stb_status,
         subscriber_id = NULL,
         updated_at = now()
   WHERE id = v_dev.id;

  RETURN jsonb_build_object(
    'device_id', v_dev.id,
    'serial', v_dev.serial_number,
    'return_status', v_return,
    'reason', v_reason,
    'service_removed', (v_other_devices = 0 AND array_length(array_remove(v_sub.services, v_dev.service_type), 1) >= 1)
  );
END;
$$;
