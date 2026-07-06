-- ============================================================
-- Phase 6.5 Batch A — architectural correctness
-- ============================================================

-- 1. is_pack_in_use — canonical check against subscriptions.pack_id.
--    Legacy label check on subscribers.current_* is kept as a fallback
--    while those columns still exist (Batch B removes them).
CREATE OR REPLACE FUNCTION public.is_pack_in_use(pack_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS (
      SELECT 1
        FROM public.subscriptions s
        JOIN public.packs p ON p.id = s.pack_id
       WHERE p.name = pack_name
         AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.subscribers
       WHERE (current_pack = pack_name OR current_internet_pack = pack_name)
         AND user_id = auth.uid()
    );
$$;

-- 2. check_device_deletable — a device may only be hard-deleted if it has
--    NO row in device_assignment_log and is currently 'available'. Any
--    assignment history means the device is retained for audit; the
--    operator must retire it in a future lifecycle iteration instead.
CREATE OR REPLACE FUNCTION public.check_device_deletable(p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev public.stb_inventory;
  v_hist_count int := 0;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_dev FROM public.stb_inventory
   WHERE id = p_device_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_delete', false,
      'blockers', jsonb_build_array('Device not found.'));
  END IF;

  IF v_dev.status = 'assigned' THEN
    v_blockers := v_blockers ||
      'Device is currently assigned to a subscriber. Unpair it first.';
  END IF;

  SELECT count(*) INTO v_hist_count
    FROM public.device_assignment_log
   WHERE user_id = v_uid AND device_serial = v_dev.serial_number;

  IF v_hist_count > 0 THEN
    v_blockers := v_blockers ||
      ('Device has ' || v_hist_count || ' historical assignment(s) on the immutable log and cannot be deleted. It must be retired instead (feature coming in Asset Lifecycle).');
  END IF;

  RETURN jsonb_build_object(
    'can_delete', (array_length(v_blockers, 1) IS NULL),
    'blockers', to_jsonb(v_blockers)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_device_deletable(uuid) TO authenticated;

-- 3. Immutability triggers
-- ------------------------------------------------------------

-- 3a. subscriptions: block DELETE, allow UPDATE only on lifecycle columns.
CREATE OR REPLACE FUNCTION public.subscriptions_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  ALLOWED_COLS constant text[] := ARRAY[
    'status',
    'cancelled_at', 'cancelled_by',
    'cancel_reason_code', 'cancel_reason_note',
    'refund_amount',
    'updated_at'
  ];
  col text;
  changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Subscription rows are immutable and cannot be deleted (id=%).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR col IN
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'subscriptions'
    LOOP
      IF col = ANY (ALLOWED_COLS) THEN
        CONTINUE;
      END IF;
      EXECUTE format(
        'SELECT ($1).%1$I IS DISTINCT FROM ($2).%1$I', col
      ) INTO changed USING OLD, NEW;
      IF changed THEN
        RAISE EXCEPTION
          'Subscription column % is immutable after creation (id=%). Use the appropriate RPC (cancel_subscription, etc.) to alter subscription state.',
          col, OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_enforce_immutability_trg ON public.subscriptions;
CREATE TRIGGER subscriptions_enforce_immutability_trg
  BEFORE UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_enforce_immutability();

-- 3b. payment_allocations: fully immutable (no UPDATE, no DELETE).
CREATE OR REPLACE FUNCTION public.payment_allocations_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment allocations are immutable and cannot be deleted (id=%).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Payment allocations are immutable and cannot be modified (id=%).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS payment_allocations_enforce_immutability_trg ON public.payment_allocations;
CREATE TRIGGER payment_allocations_enforce_immutability_trg
  BEFORE UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.payment_allocations_enforce_immutability();

-- 3c. device_assignment_log: block DELETE, allow UPDATE only on
--     close-lifecycle columns (matches replace_device / unpair_device).
CREATE OR REPLACE FUNCTION public.device_assignment_log_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  ALLOWED_COLS constant text[] := ARRAY[
    'closed_at', 'close_reason', 'closed_by',
    'updated_at'
  ];
  col text;
  changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Device assignment log rows are immutable and cannot be deleted (id=%).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR col IN
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'device_assignment_log'
    LOOP
      IF col = ANY (ALLOWED_COLS) THEN
        CONTINUE;
      END IF;
      EXECUTE format(
        'SELECT ($1).%1$I IS DISTINCT FROM ($2).%1$I', col
      ) INTO changed USING OLD, NEW;
      IF changed THEN
        RAISE EXCEPTION
          'Device assignment log column % is immutable after creation (id=%). Only lifecycle closure fields may be updated.',
          col, OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS device_assignment_log_enforce_immutability_trg ON public.device_assignment_log;
CREATE TRIGGER device_assignment_log_enforce_immutability_trg
  BEFORE UPDATE OR DELETE ON public.device_assignment_log
  FOR EACH ROW EXECUTE FUNCTION public.device_assignment_log_enforce_immutability();
