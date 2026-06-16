CREATE OR REPLACE FUNCTION public.create_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_pack_id uuid,
  p_duration integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT * INTO v_device FROM public.stb_inventory
   WHERE user_id = v_uid
     AND subscriber_id = p_subscriber_id
     AND service_type = p_service_type
     AND status = 'assigned'
   ORDER BY updated_at DESC LIMIT 1;

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

  -- BUG FIX: upgrade prospect subscriber to active on first subscription creation
  UPDATE public.subscribers
     SET customer_status = 'active',
         updated_at = now()
   WHERE id = p_subscriber_id
     AND customer_status = 'prospect';

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
    'end_date', v_end
  );
END;
$$;
