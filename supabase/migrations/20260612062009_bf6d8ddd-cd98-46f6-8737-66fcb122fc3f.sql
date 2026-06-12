
-- ============================================================
-- Phase 3.6 — Device assignment log + replace_device RPC
-- ============================================================

-- 1) device_assignment_log table
CREATE TABLE IF NOT EXISTS public.device_assignment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  device_serial text NOT NULL,
  device_type text NOT NULL,        -- 'stb' | 'onu' | 'router'
  service_type text NOT NULL,       -- 'cable' | 'internet'
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  open_reason text,                 -- 'initial_assignment' | 'replacement' | 'reassignment'
  close_reason text,                -- 'faulty' | 'upgraded' | 'returned' | 'cancelled' | 'replaced' | 'other'
  opened_by uuid,
  closed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_assignment_log TO authenticated;
GRANT ALL ON public.device_assignment_log TO service_role;

ALTER TABLE public.device_assignment_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own device assignment log"
  ON public.device_assignment_log
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_device_assignment_log_subscriber
  ON public.device_assignment_log (subscriber_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_assignment_log_serial
  ON public.device_assignment_log (user_id, device_serial);
CREATE INDEX IF NOT EXISTS idx_device_assignment_log_open
  ON public.device_assignment_log (user_id, subscriber_id) WHERE closed_at IS NULL;

CREATE TRIGGER trg_device_assignment_log_updated_at
  BEFORE UPDATE ON public.device_assignment_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Retire the legacy STB-change block and add an inventory-agreement check.
CREATE OR REPLACE FUNCTION public.subscribers_enforce_invariants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_cable_active boolean := false;
  v_has_internet_active boolean := false;
  v_check_stb boolean := false;
  v_inv_ok boolean := false;
BEGIN
  -- Service ↔ STB consistency
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

  -- INVENTORY-AGREEMENT CHECK (replaces the old "block STB change while active sub" rule).
  -- If stb_number is being set to a non-null value, the inventory row for that
  -- serial must already be assigned to THIS subscriber. Inventory is the authority.
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

  -- Service-removal-while-active and provider-change-while-active guards remain.
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

-- 3) replace_device RPC — the only path that satisfies the inventory-agreement check
--    when swapping a cable STB on a subscriber that already has an active subscription.
CREATE OR REPLACE FUNCTION public.replace_device(
  p_subscriber_id uuid,
  p_old_serial text,
  p_new_serial text,
  p_reason text DEFAULT 'faulty'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_old_inv public.stb_inventory;
  v_new_inv public.stb_inventory;
  v_service text;
  v_close_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_old_serial IS NULL OR btrim(p_old_serial) = '' THEN
    RAISE EXCEPTION 'Old device serial is required';
  END IF;
  IF p_new_serial IS NULL OR btrim(p_new_serial) = '' THEN
    RAISE EXCEPTION 'New device serial is required';
  END IF;
  IF p_old_serial = p_new_serial THEN
    RAISE EXCEPTION 'Old and new device serials must differ';
  END IF;

  v_close_reason := lower(COALESCE(NULLIF(btrim(p_reason), ''), 'faulty'));
  IF v_close_reason NOT IN ('faulty','upgraded','returned','replaced','other') THEN
    RAISE EXCEPTION 'Invalid replacement reason: %', p_reason;
  END IF;

  -- Lock subscriber
  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscriber not found';
  END IF;

  -- Verify old device assignment
  SELECT * INTO v_old_inv FROM public.stb_inventory
   WHERE user_id = v_uid AND serial_number = p_old_serial
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Old device % not found in inventory', p_old_serial;
  END IF;
  IF v_old_inv.status <> 'assigned' OR v_old_inv.subscriber_id IS DISTINCT FROM p_subscriber_id THEN
    RAISE EXCEPTION 'Old device % is not currently assigned to this subscriber', p_old_serial;
  END IF;

  -- Verify new device is available and same service line
  SELECT * INTO v_new_inv FROM public.stb_inventory
   WHERE user_id = v_uid AND serial_number = p_new_serial
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'New device % not found in inventory', p_new_serial;
  END IF;
  IF v_new_inv.status <> 'available' THEN
    RAISE EXCEPTION 'New device % is not available (status: %)', p_new_serial, v_new_inv.status;
  END IF;
  IF COALESCE(v_new_inv.service_type, 'cable') IS DISTINCT FROM COALESCE(v_old_inv.service_type, 'cable') THEN
    RAISE EXCEPTION 'New device service type (%) does not match old device (%)',
      v_new_inv.service_type, v_old_inv.service_type;
  END IF;

  v_service := COALESCE(v_old_inv.service_type, 'cable');

  -- 1) Old device → faulty, unassigned
  UPDATE public.stb_inventory
     SET status = 'faulty', subscriber_id = NULL, updated_at = now()
   WHERE id = v_old_inv.id;

  -- 2) New device → assigned to this subscriber
  UPDATE public.stb_inventory
     SET status = 'assigned', subscriber_id = p_subscriber_id, updated_at = now()
   WHERE id = v_new_inv.id;

  -- 3) Close the old log entry (if any open) and open a new one
  UPDATE public.device_assignment_log
     SET closed_at = now(),
         close_reason = v_close_reason,
         closed_by = v_uid,
         updated_at = now()
   WHERE user_id = v_uid
     AND subscriber_id = p_subscriber_id
     AND device_serial = p_old_serial
     AND closed_at IS NULL;

  INSERT INTO public.device_assignment_log (
    user_id, subscriber_id, device_serial, device_type, service_type,
    open_reason, opened_by
  ) VALUES (
    v_uid, p_subscriber_id, p_new_serial,
    COALESCE(v_new_inv.device_type, 'stb'),
    v_service,
    'replacement', v_uid
  );

  -- 4) Update active subscription blob's device reference (cable only)
  IF v_service = 'cable' AND v_sub.current_subscription IS NOT NULL THEN
    UPDATE public.subscribers
       SET current_subscription = v_sub.current_subscription
           || jsonb_build_object('stbNumber', p_new_serial),
           updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  -- 5) Mirror onto subscribers.stb_number for cable. Inventory now agrees → trigger passes.
  IF v_service = 'cable' THEN
    UPDATE public.subscribers
       SET stb_number = p_new_serial, updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  RETURN jsonb_build_object(
    'subscriber_id', p_subscriber_id,
    'service_type', v_service,
    'old_serial', p_old_serial,
    'new_serial', p_new_serial,
    'close_reason', v_close_reason
  );
END;
$function$;
