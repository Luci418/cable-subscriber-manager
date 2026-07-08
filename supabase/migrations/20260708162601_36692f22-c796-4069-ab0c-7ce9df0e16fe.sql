
-- =============================================================
-- Phase 6.5 Batch C — Retire JSONB subscription blob columns.
-- All server logic now reads from the normalised `subscriptions` table.
-- =============================================================

-- ---------- 1. subscribers_enforce_invariants — consult subscriptions ----------
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
  -- Clear stale stb_number if Cable service is removed.
  IF TG_OP = 'UPDATE'
     AND NEW.services IS DISTINCT FROM OLD.services
     AND NOT ('cable' = ANY (NEW.services))
     AND NEW.stb_number IS NOT NULL
     AND btrim(NEW.stb_number) <> '' THEN
    NEW.stb_number := NULL;
  END IF;

  -- Inventory agreement check for stb_number changes.
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

  -- Service-removal and provider-change guards now query the subscriptions
  -- table directly (Batch C — retired legacy JSONB reads).
  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions
       WHERE subscriber_id = OLD.id
         AND service_type = 'cable'
         AND status = 'active'
         AND end_date > CURRENT_DATE
    ) INTO v_has_cable_active;

    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions
       WHERE subscriber_id = OLD.id
         AND service_type = 'internet'
         AND status = 'active'
         AND end_date > CURRENT_DATE
    ) INTO v_has_internet_active;

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

-- ---------- 2. check_subscriber_deletable — consult subscriptions ----------
CREATE OR REPLACE FUNCTION public.check_subscriber_deletable(p_subscriber_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_tx_count int := 0;
  v_stb_count int := 0;
  v_has_cable_active boolean := false;
  v_has_internet_active boolean := false;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_delete', false, 'blockers', jsonb_build_array('Subscriber not found.'));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id
       AND service_type = 'cable'
       AND status = 'active'
       AND end_date > CURRENT_DATE
  ) INTO v_has_cable_active;
  IF v_has_cable_active THEN
    v_blockers := v_blockers || 'Cable subscription is still active — cancel it first.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id
       AND service_type = 'internet'
       AND status = 'active'
       AND end_date > CURRENT_DATE
  ) INTO v_has_internet_active;
  IF v_has_internet_active THEN
    v_blockers := v_blockers || 'Internet subscription is still active — cancel it first.';
  END IF;

  IF COALESCE(v_sub.cable_balance, 0) <> 0 THEN
    v_blockers := v_blockers ||
      ('Outstanding cable balance of ₹' || to_char(abs(v_sub.cable_balance), 'FM999999990.00') ||
       CASE WHEN v_sub.cable_balance > 0 THEN ' is owed by the subscriber.' ELSE ' is held as advance for the subscriber.' END);
  END IF;
  IF COALESCE(v_sub.internet_balance, 0) <> 0 THEN
    v_blockers := v_blockers ||
      ('Outstanding internet balance of ₹' || to_char(abs(v_sub.internet_balance), 'FM999999990.00') ||
       CASE WHEN v_sub.internet_balance > 0 THEN ' is owed by the subscriber.' ELSE ' is held as advance for the subscriber.' END);
  END IF;

  SELECT count(*) INTO v_tx_count FROM public.transactions WHERE subscriber_id = p_subscriber_id;
  IF v_tx_count > 0 THEN
    v_blockers := v_blockers ||
      ('Subscriber has ' || v_tx_count || ' transaction(s) on the immutable ledger. Historical financial records cannot be deleted.');
  END IF;

  SELECT count(*) INTO v_stb_count FROM public.stb_inventory
    WHERE subscriber_id = p_subscriber_id AND status = 'assigned';
  IF v_stb_count > 0 THEN
    v_blockers := v_blockers ||
      ('A device (STB/ONU/Router) is still assigned. Unassign it from inventory first.');
  END IF;

  RETURN jsonb_build_object(
    'can_delete', (array_length(v_blockers, 1) IS NULL),
    'blockers', to_jsonb(v_blockers)
  );
END;
$$;

-- ---------- 3. create_subscription — no more JSONB compat writes ----------
CREATE OR REPLACE FUNCTION public.create_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_pack_id uuid,
  p_duration integer,
  p_device_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_pack public.packs;
  v_provider_name text;
  v_is_prepaid boolean;
  v_validity int;
  v_total_days int;
  v_start date := CURRENT_DATE;
  v_end date;
  v_charge numeric;
  v_device public.stb_inventory;
  v_subscription_id uuid;
  v_prev_subscription_id uuid;
  v_charge_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF p_duration IS NULL OR p_duration < 1 THEN
    RAISE EXCEPTION 'Duration must be >= 1';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF NOT (p_service_type = ANY (COALESCE(v_sub.services, ARRAY['cable']::text[]))) THEN
    RAISE EXCEPTION 'Subscriber does not have % service enabled', p_service_type;
  END IF;

  SELECT * INTO v_pack FROM public.packs
   WHERE id = p_pack_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pack not found'; END IF;
  IF COALESCE(v_pack.service_type,'cable') <> p_service_type THEN
    RAISE EXCEPTION 'Pack service type (%) does not match requested service (%)', v_pack.service_type, p_service_type;
  END IF;

  IF p_device_id IS NOT NULL THEN
    SELECT * INTO v_device FROM public.stb_inventory
     WHERE id = p_device_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;
    IF v_device.status <> 'assigned' OR v_device.subscriber_id IS DISTINCT FROM p_subscriber_id THEN
      RAISE EXCEPTION 'Device % is not currently assigned to this subscriber', v_device.serial_number;
    END IF;
    IF COALESCE(v_device.service_type,'cable') <> p_service_type THEN
      RAISE EXCEPTION 'Device service type (%) does not match requested service (%)', v_device.service_type, p_service_type;
    END IF;
  ELSE
    SELECT * INTO v_device FROM public.stb_inventory
     WHERE user_id = v_uid
       AND subscriber_id = p_subscriber_id
       AND service_type = p_service_type
       AND status = 'assigned'
     ORDER BY updated_at DESC LIMIT 1;
  END IF;

  IF v_device.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.subscriptions
                WHERE device_id = v_device.id AND status = 'active') THEN
      RAISE EXCEPTION 'An active subscription already exists for this device. Cancel it first.';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.subscriptions
                WHERE subscriber_id = p_subscriber_id
                  AND service_type = p_service_type
                  AND status = 'active'
                  AND device_id IS NULL) THEN
      RAISE EXCEPTION 'An active % subscription already exists. Cancel it first.', p_service_type;
    END IF;
  END IF;

  v_is_prepaid := COALESCE(v_pack.billing_type,'postpaid') = 'prepaid';
  v_validity   := COALESCE(v_pack.validity_days, 30);
  v_total_days := v_validity * p_duration;
  v_end        := v_start + v_total_days;
  v_charge     := COALESCE(v_pack.price, 0) * p_duration;

  IF v_pack.provider_id IS NOT NULL THEN
    SELECT name INTO v_provider_name FROM public.providers WHERE id = v_pack.provider_id;
  END IF;

  IF v_device.id IS NOT NULL THEN
    SELECT id INTO v_prev_subscription_id FROM public.subscriptions
     WHERE device_id = v_device.id
     ORDER BY end_date DESC, created_at DESC LIMIT 1;
  ELSE
    SELECT id INTO v_prev_subscription_id FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id AND service_type = p_service_type
     ORDER BY end_date DESC, created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.subscriptions (
    user_id, subscriber_id, service_type,
    device_id, device_serial_snapshot,
    pack_id, provider_id,
    pack_name_snapshot, pack_price_snapshot, billing_type_snapshot, validity_days_snapshot,
    duration, total_days, total_charged,
    start_date, end_date, status,
    previous_subscription_id, created_by
  ) VALUES (
    v_uid, p_subscriber_id, p_service_type,
    v_device.id, v_device.serial_number,
    v_pack.id, v_pack.provider_id,
    v_pack.name, COALESCE(v_pack.price,0), COALESCE(v_pack.billing_type,'postpaid'), v_validity,
    p_duration, v_total_days, v_charge,
    v_start, v_end, 'active',
    v_prev_subscription_id, v_uid
  ) RETURNING id INTO v_subscription_id;

  -- Batch C: no longer maintain JSONB blob columns (dropped in this migration).
  UPDATE public.subscribers
     SET customer_status = CASE WHEN customer_status = 'prospect' THEN 'active' ELSE customer_status END,
         cable_provider_id = CASE WHEN p_service_type = 'cable'
                                  THEN COALESCE(v_pack.provider_id, cable_provider_id)
                                  ELSE cable_provider_id END,
         internet_provider_id = CASE WHEN p_service_type = 'internet'
                                     THEN COALESCE(v_pack.provider_id, internet_provider_id)
                                     ELSE internet_provider_id END,
         updated_at = now()
   WHERE id = p_subscriber_id;

  INSERT INTO public.transactions (
    user_id, subscriber_id, type, amount, service_type, provider_id,
    source, description, date, status, subscription_id
  ) VALUES (
    v_uid, p_subscriber_id, 'charge', v_charge, p_service_type, v_pack.provider_id,
    'subscription_charge',
    initcap(p_service_type) || ' ' ||
      CASE WHEN v_is_prepaid THEN 'recharge' ELSE 'subscription charge' END ||
      ': ' || v_pack.name || ' (' || p_duration ||
      CASE WHEN v_is_prepaid THEN ' × ' || v_validity || 'd)'
           ELSE ' month' || CASE WHEN p_duration > 1 THEN 's)' ELSE ')' END END,
    now(), 'posted', v_subscription_id
  ) RETURNING id INTO v_charge_tx_id;

  RETURN jsonb_build_object(
    'subscription_id', v_subscription_id,
    'charge_transaction_id', v_charge_tx_id,
    'charge_amount', v_charge,
    'end_date', v_end,
    'device_id', v_device.id
  );
END;
$$;

-- ---------- 4. cancel_subscription — no more JSONB compat reads/writes ----------
CREATE OR REPLACE FUNCTION public.cancel_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_refund_amount numeric DEFAULT 0,
  p_reason text DEFAULT NULL,
  p_subscription_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_active_subscription_id uuid;
  v_target_device_id uuid;
  v_total_charged numeric;
  v_cash_paid numeric;
  v_refund_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_cancel_subscription(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to cancel subscriptions. Ask an Owner or Admin.'
      USING ERRCODE = '42501';
  END IF;

  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF COALESCE(p_refund_amount,0) < 0 THEN
    RAISE EXCEPTION 'Refund amount cannot be negative';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF p_subscription_id IS NOT NULL THEN
    SELECT id, total_charged, device_id
      INTO v_active_subscription_id, v_total_charged, v_target_device_id
      FROM public.subscriptions
     WHERE id = p_subscription_id
       AND user_id = v_uid
       AND subscriber_id = p_subscriber_id
       AND service_type  = p_service_type
       AND status = 'active';
    IF v_active_subscription_id IS NULL THEN
      RAISE EXCEPTION 'Subscription % not found or not an active % subscription for this subscriber',
        p_subscription_id, p_service_type;
    END IF;
  ELSE
    SELECT id, total_charged, device_id
      INTO v_active_subscription_id, v_total_charged, v_target_device_id
      FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id
       AND service_type  = p_service_type
       AND status = 'active'
     ORDER BY created_at DESC LIMIT 1;

    IF v_active_subscription_id IS NULL THEN
      RAISE EXCEPTION 'No active % subscription to cancel', p_service_type;
    END IF;
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0) INTO v_cash_paid
    FROM public.payment_allocations pa
    JOIN public.transactions t ON t.id = pa.transaction_id
   WHERE pa.subscription_id = v_active_subscription_id
     AND t.type = 'payment'
     AND t.status NOT IN ('voided','reversal');

  IF p_refund_amount > v_cash_paid THEN
    RAISE EXCEPTION 'Refund (%) exceeds cash paid toward this subscription (%).',
      p_refund_amount, v_cash_paid;
  END IF;

  UPDATE public.subscriptions
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancel_reason_note = NULLIF(btrim(p_reason),''),
         cancel_reason_code = 'customer_request',
         refund_amount = p_refund_amount
   WHERE id = v_active_subscription_id;

  -- Batch C: no more JSONB blob writes.
  UPDATE public.subscribers SET updated_at = now() WHERE id = p_subscriber_id;

  IF p_refund_amount > 0 THEN
    INSERT INTO public.transactions (
      user_id, subscriber_id, type, amount, service_type, provider_id,
      source, description, date, status, subscription_id
    ) VALUES (
      v_uid, p_subscriber_id, 'payment', p_refund_amount, p_service_type,
      CASE WHEN p_service_type='internet' THEN v_sub.internet_provider_id ELSE v_sub.cable_provider_id END,
      'subscription_refund',
      'Refund for cancelled ' || p_service_type || ' subscription'
        || CASE WHEN COALESCE(btrim(p_reason),'') <> '' THEN ' — ' || p_reason ELSE '' END,
      now(), 'posted', v_active_subscription_id
    ) RETURNING id INTO v_refund_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'cancelled_subscription_id', v_active_subscription_id,
    'device_id', v_target_device_id,
    'refund_amount', p_refund_amount,
    'refund_transaction_id', v_refund_tx_id
  );
END;
$$;

-- ---------- 5. expire_lapsed_subscriptions — subscriptions table only ----------
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  affected integer := 0;
  v_count int;
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('expire_lapsed:' || v_uid::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('expire_lapsed_subscriptions', 0));
  END IF;

  WITH upd AS (
    UPDATE public.subscriptions
       SET status = 'expired', updated_at = now()
     WHERE status = 'active'
       AND end_date <= CURRENT_DATE
       AND (v_uid IS NULL OR user_id = v_uid)
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM upd;
  affected := COALESCE(v_count, 0);

  -- Batch C: JSONB blob maintenance loops removed. `subscriptions` is the
  -- single source of truth; views (`v_subscriber_active_subscription`,
  -- `v_subscriber_subscription_timeline`) project it to the UI.

  RETURN affected;
END;
$$;

-- ---------- 6. Drop the legacy JSONB columns ----------
ALTER TABLE public.subscribers
  DROP COLUMN IF EXISTS current_subscription,
  DROP COLUMN IF EXISTS subscription_history,
  DROP COLUMN IF EXISTS internet_subscription,
  DROP COLUMN IF EXISTS internet_subscription_history;
