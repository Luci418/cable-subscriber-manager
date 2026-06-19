-- Phase 5.1 follow-up: add optional device/subscription targeting to the
-- create_subscription and cancel_subscription RPCs. This fixes the
-- multi-device routing bug where Renew/Cancel buttons on per-device cards
-- always operated on the most-recent subscription/device for the service,
-- regardless of which device's button was clicked.
--
-- Backward compatibility: both new parameters default to NULL. When NULL,
-- the functions retain the existing "pick latest for (subscriber, service)"
-- behavior, so existing callers (analytics, scripts, older code paths) keep
-- working unchanged.

-- --------------------------------------------------------------------
-- 1. create_subscription: add optional p_device_id
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_subscription(uuid, text, uuid, integer);

CREATE OR REPLACE FUNCTION public.create_subscription(
  p_subscriber_id uuid,
  p_service_type  text,
  p_pack_id       uuid,
  p_duration      integer,
  p_device_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_new_sub jsonb;
  v_sub_id_text text;
  v_history jsonb;
  v_existing jsonb;
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

  -- Device resolution: if caller passed an explicit device, use it (after
  -- validating ownership/assignment); otherwise fall back to the legacy
  -- "pick the most-recently-updated assigned device" heuristic.
  IF p_device_id IS NOT NULL THEN
    SELECT * INTO v_device FROM public.stb_inventory
     WHERE id = p_device_id AND user_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Device not found';
    END IF;
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

  -- Prospect -> active upgrade on first subscription creation
  UPDATE public.subscribers
     SET customer_status = 'active', updated_at = now()
   WHERE id = p_subscriber_id AND customer_status = 'prospect';

  v_sub_id_text := 'sub-' || extract(epoch from now())::bigint::text || '-' || substr(md5(random()::text),1,6);

  v_new_sub := jsonb_build_object(
    'id', v_sub_id_text,
    'subscriptionId', v_subscription_id,
    'packName', v_pack.name,
    'packPrice', v_pack.price,
    'startDate', v_start::timestamptz,
    'endDate', v_end::timestamptz,
    'duration', p_duration,
    'status', 'active',
    'subscribedAt', now(),
    'providerId', v_pack.provider_id,
    'providerName', v_provider_name
  );

  IF p_service_type = 'internet' THEN
    v_existing := to_jsonb(v_sub.internet_subscription);
    v_history  := COALESCE(to_jsonb(v_sub.internet_subscription_history), '[]'::jsonb);
  ELSE
    v_existing := to_jsonb(v_sub.current_subscription);
    v_history  := COALESCE(to_jsonb(v_sub.subscription_history), '[]'::jsonb);
  END IF;

  v_history := (
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status','expired')), '[]'::jsonb)
      FROM jsonb_array_elements(v_history) e
  );
  v_history := v_history || jsonb_build_array(v_new_sub);

  IF p_service_type = 'internet' THEN
    UPDATE public.subscribers
       SET internet_subscription = v_new_sub,
           internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_internet_pack = v_pack.name,
           current_internet_pack_id = v_pack.id,
           internet_provider_id = COALESCE(v_pack.provider_id, internet_provider_id),
           updated_at = now()
     WHERE id = p_subscriber_id;
  ELSE
    UPDATE public.subscribers
       SET current_subscription = v_new_sub,
           subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_pack = v_pack.name,
           current_pack_id = v_pack.id,
           cable_provider_id = COALESCE(v_pack.provider_id, cable_provider_id),
           updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

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
$function$;

-- --------------------------------------------------------------------
-- 2. cancel_subscription: add optional p_subscription_id
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_subscription(uuid, text, numeric, text);

CREATE OR REPLACE FUNCTION public.cancel_subscription(
  p_subscriber_id   uuid,
  p_service_type    text,
  p_refund_amount   numeric DEFAULT 0,
  p_reason          text    DEFAULT NULL,
  p_subscription_id uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_active jsonb;
  v_history jsonb;
  v_active_id text;
  v_active_subscription_id uuid;
  v_target_device_id uuid;
  v_total_charged numeric;
  v_cash_paid numeric;
  v_refund_tx_id uuid;
  v_remaining_active int;
  v_legacy_blob_subscription_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF COALESCE(p_refund_amount,0) < 0 THEN
    RAISE EXCEPTION 'Refund amount cannot be negative';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  -- Target resolution: if caller passed an explicit subscription id, use it
  -- (after validating ownership/service/status); otherwise fall back to the
  -- legacy "latest active for (subscriber, service)" behavior.
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
    RAISE EXCEPTION 'Refund (₹%) exceeds cash paid toward this subscription (₹%).',
      p_refund_amount, v_cash_paid;
  END IF;

  UPDATE public.subscriptions
     SET status = 'cancelled',
         cancelled_at = now(),
         cancel_reason_note = NULLIF(btrim(p_reason),''),
         cancel_reason_code = 'customer_request',
         refund_amount = p_refund_amount
   WHERE id = v_active_subscription_id;

  -- Legacy JSONB blob maintenance.
  -- The blob holds ONE subscription per service. Only clear/update the blob
  -- if the cancelled subscription is the one currently reflected there.
  -- Otherwise we'd wipe the blob for a sibling device's still-active sub.
  IF p_service_type = 'internet' THEN
    v_active  := to_jsonb(v_sub.internet_subscription);
    v_history := COALESCE(to_jsonb(v_sub.internet_subscription_history), '[]'::jsonb);
  ELSE
    v_active  := to_jsonb(v_sub.current_subscription);
    v_history := COALESCE(to_jsonb(v_sub.subscription_history), '[]'::jsonb);
  END IF;

  v_active_id := COALESCE(v_active->>'id','');
  BEGIN
    v_legacy_blob_subscription_id := NULLIF(v_active->>'subscriptionId','')::uuid;
  EXCEPTION WHEN others THEN
    v_legacy_blob_subscription_id := NULL;
  END;

  -- Mark history entries cancelled where applicable (match by legacy id).
  v_history := (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN e->>'id' = v_active_id AND v_legacy_blob_subscription_id = v_active_subscription_id
        THEN e || jsonb_build_object('status','cancelled','endDate', now())
        ELSE e END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_history) e
  );

  IF v_legacy_blob_subscription_id IS NOT NULL
     AND v_legacy_blob_subscription_id = v_active_subscription_id THEN
    -- The blob represented the subscription we just cancelled — clear it.
    IF p_service_type = 'internet' THEN
      UPDATE public.subscribers
         SET internet_subscription = NULL,
             internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             current_internet_pack = NULL,
             current_internet_pack_id = NULL,
             updated_at = now()
       WHERE id = p_subscriber_id;
    ELSE
      UPDATE public.subscribers
         SET current_subscription = NULL,
             subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             current_pack = NULL,
             current_pack_id = NULL,
             updated_at = now()
       WHERE id = p_subscriber_id;
    END IF;
  ELSE
    -- Blob represents a sibling subscription that's still active — leave it.
    -- Still persist history changes (which may be a no-op for this row).
    IF p_service_type = 'internet' THEN
      UPDATE public.subscribers
         SET internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             updated_at = now()
       WHERE id = p_subscriber_id;
    ELSE
      UPDATE public.subscribers
         SET subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             updated_at = now()
       WHERE id = p_subscriber_id;
    END IF;
  END IF;

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
$function$;