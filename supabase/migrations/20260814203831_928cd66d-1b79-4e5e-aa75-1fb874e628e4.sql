-- extend_subscription: device-targeted renewal for multi-connection subscribers.
DROP FUNCTION IF EXISTS public.extend_subscription(uuid, text, uuid, int, date);

CREATE OR REPLACE FUNCTION public.extend_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_pack_id uuid,
  p_periods integer DEFAULT 1,
  p_end_date_override date DEFAULT NULL,
  p_device_id uuid DEFAULT NULL
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
  v_row public.subscriptions;
  v_active_count int;
  v_validity int;
  v_new_end date;
  v_added_days int;
  v_charge numeric;
  v_tx uuid;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF p_periods IS NULL OR p_periods < 1 THEN
    RAISE EXCEPTION 'Periods must be >= 1';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT * INTO v_pack FROM public.packs WHERE id = p_pack_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pack not found'; END IF;
  IF COALESCE(v_pack.service_type,'cable') <> p_service_type THEN
    RAISE EXCEPTION 'Pack service type (%) does not match requested service (%)',
      v_pack.service_type, p_service_type;
  END IF;

  SELECT count(*) INTO v_active_count FROM public.subscriptions
   WHERE subscriber_id = p_subscriber_id
     AND service_type  = p_service_type
     AND status = 'active';

  IF v_active_count > 1 THEN
    -- Multiple simultaneous connections: the device is the only thing that
    -- says which physical box the renewal is about. Never guess (INV-41 spirit).
    IF p_device_id IS NULL THEN
      RAISE EXCEPTION 'Subscriber has % active % subscriptions; a device is required to identify which one to extend.',
        v_active_count, p_service_type;
    END IF;
    SELECT * INTO v_row FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id
       AND service_type  = p_service_type
       AND status = 'active'
       AND device_id = p_device_id
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No active % subscription is attached to the reported device for this subscriber.', p_service_type;
    END IF;
  ELSE
    SELECT * INTO v_row FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id
       AND service_type  = p_service_type
       AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
  END IF;

  -- No active subscription: this is today's "renew after expiry" path and
  -- must not regress — delegate verbatim to create_subscription, then record
  -- the continuity link.
  IF v_row.id IS NULL THEN
    v_res := public.create_subscription(p_subscriber_id, p_service_type, p_pack_id, p_periods, p_device_id);

    SELECT id INTO v_row.id FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id AND service_type = p_service_type
       AND status <> 'active'
     ORDER BY end_date DESC, created_at DESC LIMIT 1;

    IF v_row.id IS NOT NULL THEN
      PERFORM set_config('app.extend_subscription','on', true);
      UPDATE public.subscriptions
         SET extended_from_subscription_id = v_row.id, updated_at = now()
       WHERE id = (v_res->>'subscription_id')::uuid;
      PERFORM set_config('app.extend_subscription','off', true);
    END IF;

    RETURN v_res || jsonb_build_object('mode','created');
  END IF;

  IF v_row.pack_id IS DISTINCT FROM p_pack_id THEN
    RAISE EXCEPTION 'This is a plan change, not an extension. Cancel the current subscription and create the new pack.';
  END IF;

  v_validity := GREATEST(1, COALESCE(v_pack.validity_days, 30));
  v_new_end := COALESCE(
    p_end_date_override,
    GREATEST(v_row.end_date, CURRENT_DATE) + (p_periods * v_validity)
  );
  IF v_new_end < v_row.end_date THEN
    RAISE EXCEPTION 'Requested end date (%) is earlier than the current end date (%).',
      v_new_end, v_row.end_date;
  END IF;
  v_added_days := v_new_end - v_row.end_date;
  v_charge := COALESCE(v_pack.price, 0) * p_periods;

  PERFORM set_config('app.extend_subscription','on', true);
  UPDATE public.subscriptions
     SET end_date         = v_new_end,
         duration         = duration + p_periods,
         total_days       = total_days + GREATEST(v_added_days, 0),
         total_charged    = total_charged + v_charge,
         extension_count  = extension_count + 1,
         last_extended_at = now(),
         updated_at       = now()
   WHERE id = v_row.id;
  PERFORM set_config('app.extend_subscription','off', true);

  INSERT INTO public.transactions (
    user_id, subscriber_id, type, amount, service_type, provider_id,
    source, description, date, status, subscription_id
  ) VALUES (
    v_uid, p_subscriber_id, 'charge', v_charge, p_service_type, v_pack.provider_id,
    'subscription_charge',
    initcap(p_service_type) || ' extension: ' || v_pack.name ||
      ' (' || p_periods || ' × ' || v_validity || 'd → ' || v_new_end || ')',
    now(), 'posted', v_row.id
  ) RETURNING id INTO v_tx;

  UPDATE public.subscribers
     SET customer_status = CASE WHEN customer_status = 'prospect' THEN 'active' ELSE customer_status END,
         updated_at = now()
   WHERE id = p_subscriber_id;

  RETURN jsonb_build_object(
    'mode','extended',
    'subscription_id', v_row.id,
    'charge_transaction_id', v_tx,
    'charge_amount', v_charge,
    'end_date', v_new_end,
    'device_id', v_row.device_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.extend_subscription(uuid, text, uuid, int, date, uuid) TO authenticated;

-- commit_provider_import: pass the device resolved from the report into the renewal.
CREATE OR REPLACE FUNCTION public.commit_provider_import(p_run_id uuid, p_decisions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $patched$
BEGIN
  RAISE EXCEPTION 'placeholder';
END;
$patched$;
