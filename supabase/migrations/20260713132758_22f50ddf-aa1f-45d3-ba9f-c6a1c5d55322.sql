CREATE OR REPLACE FUNCTION public.mark_device_faulty(
  p_device_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
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
    RAISE EXCEPTION 'You do not have permission to mark devices faulty.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_dev FROM public.stb_inventory
    WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;

  IF v_dev.status = 'faulty' THEN
    RETURN jsonb_build_object('device_id', v_dev.id, 'already', true);
  END IF;
  IF v_dev.status = 'decommissioned' THEN
    RAISE EXCEPTION 'Decommissioned devices cannot be marked faulty.';
  END IF;

  -- If assigned: close open assignment log entry BEFORE flipping status,
  -- so the log records this as a natural close (not orphaned).
  IF v_dev.subscriber_id IS NOT NULL THEN
    UPDATE public.device_assignment_log
       SET closed_at = now(), close_reason = 'faulty', closed_by = v_uid, updated_at = now()
     WHERE user_id = v_uid
       AND subscriber_id = v_dev.subscriber_id
       AND device_serial = v_dev.serial_number
       AND closed_at IS NULL;
  END IF;

  -- Flip inventory FIRST so device_status_log records "assigned -> faulty"
  -- (running the subscriber stb_number clear first would otherwise cause
  -- sync_stb_inventory_on_subscriber_change to log "assigned -> available").
  UPDATE public.stb_inventory
     SET status = 'faulty',
         subscriber_id = NULL,
         notes = COALESCE(NULLIF(btrim(p_reason), ''), notes),
         updated_at = now()
   WHERE id = v_dev.id;

  -- Clear the legacy cached stb_number on the subscriber's row if it
  -- pointed at this device. INV-09: faulty ⇒ subscriber_id IS NULL, and
  -- the customer profile must no longer show this device paired.
  IF v_dev.subscriber_id IS NOT NULL AND v_dev.service_type = 'cable' THEN
    UPDATE public.subscribers
       SET stb_number = NULL, updated_at = now()
     WHERE id = v_dev.subscriber_id
       AND COALESCE(stb_number, '') = v_dev.serial_number;
  END IF;

  RETURN jsonb_build_object(
    'device_id', v_dev.id,
    'serial', v_dev.serial_number,
    'former_subscriber_id', v_dev.subscriber_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_device_faulty(uuid, text) TO authenticated;