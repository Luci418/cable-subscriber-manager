
-- =====================================================================
-- Phase 1: Atomic write paths for subscription lifecycle
-- =====================================================================
-- Eliminates the "client writes balance + then inserts transaction" race
-- by wrapping both steps in a single SECURITY DEFINER function. The
-- existing transactions_recalc_balance trigger remains the sole writer
-- of cable_balance / internet_balance.

-- ---------------------------------------------------------------------
-- create_subscription
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_subscription(
  p_subscriber_id uuid,
  p_service_type  text,
  p_pack_id       uuid,
  p_duration      int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_sub          public.subscribers;
  v_pack         public.packs;
  v_provider_name text;
  v_is_prepaid   boolean;
  v_validity     int;
  v_start        timestamptz := now();
  v_end          timestamptz;
  v_charge       numeric;
  v_new_sub      jsonb;
  v_sub_id_text  text;
  v_history      jsonb;
  v_existing     jsonb;
  v_sub_col      text;
  v_hist_col     text;
  v_pack_col     text;
  v_prov_col     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF p_duration IS NULL OR p_duration < 1 THEN
    RAISE EXCEPTION 'Duration must be >= 1';
  END IF;

  -- Lock the subscriber row for the duration of the txn
  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscriber not found';
  END IF;

  -- Subscriber must have this service enabled
  IF NOT (p_service_type = ANY (COALESCE(v_sub.services, ARRAY['cable']::text[]))) THEN
    RAISE EXCEPTION 'Subscriber does not have % service enabled', p_service_type;
  END IF;

  -- Pack must exist and match service
  SELECT * INTO v_pack FROM public.packs
   WHERE id = p_pack_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pack not found';
  END IF;
  IF COALESCE(v_pack.service_type, 'cable') <> p_service_type THEN
    RAISE EXCEPTION 'Pack service type (%) does not match requested service (%)', v_pack.service_type, p_service_type;
  END IF;

  IF p_service_type = 'internet' THEN
    v_sub_col := 'internet_subscription';
    v_hist_col := 'internet_subscription_history';
    v_pack_col := 'current_internet_pack';
    v_prov_col := 'internet_provider_id';
    v_existing := to_jsonb(v_sub.internet_subscription);
    v_history  := COALESCE(to_jsonb(v_sub.internet_subscription_history), '[]'::jsonb);
  ELSE
    v_sub_col := 'current_subscription';
    v_hist_col := 'subscription_history';
    v_pack_col := 'current_pack';
    v_prov_col := 'cable_provider_id';
    v_existing := to_jsonb(v_sub.current_subscription);
    v_history  := COALESCE(to_jsonb(v_sub.subscription_history), '[]'::jsonb);
  END IF;

  -- Refuse if active subscription exists for this service
  IF v_existing IS NOT NULL
     AND v_existing <> 'null'::jsonb
     AND (v_existing->>'endDate')::timestamptz > now()
     AND COALESCE(v_existing->>'status','active') = 'active' THEN
    RAISE EXCEPTION 'An active % subscription already exists. Cancel it first.', p_service_type;
  END IF;

  v_is_prepaid := COALESCE(v_pack.billing_type, 'postpaid') = 'prepaid';
  v_validity   := COALESCE(v_pack.validity_days, 30);

  IF v_is_prepaid THEN
    v_end := v_start + make_interval(days => v_validity * p_duration);
  ELSE
    v_end := v_start + make_interval(months => p_duration);
  END IF;

  v_charge := COALESCE(v_pack.price, 0) * p_duration;

  IF v_pack.provider_id IS NOT NULL THEN
    SELECT name INTO v_provider_name FROM public.providers WHERE id = v_pack.provider_id;
  END IF;

  v_sub_id_text := 'sub-' || extract(epoch from now())::bigint::text || '-' || substr(md5(random()::text), 1, 6);

  v_new_sub := jsonb_build_object(
    'id', v_sub_id_text,
    'packName', v_pack.name,
    'packPrice', v_pack.price,
    'startDate', v_start,
    'endDate', v_end,
    'duration', p_duration,
    'status', 'active',
    'subscribedAt', v_start,
    'providerId', v_pack.provider_id,
    'providerName', v_provider_name
  );

  -- Mark prior history entries as expired, then append this new one
  v_history := (
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status', 'expired')), '[]'::jsonb)
    FROM jsonb_array_elements(v_history) e
  );
  v_history := v_history || jsonb_build_array(v_new_sub);

  -- Update subscriber columns (no balance write — trigger handles it)
  IF p_service_type = 'internet' THEN
    UPDATE public.subscribers
       SET internet_subscription         = v_new_sub,
           internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_internet_pack         = v_pack.name,
           internet_provider_id          = COALESCE(v_pack.provider_id, internet_provider_id),
           updated_at                    = now()
     WHERE id = p_subscriber_id;
  ELSE
    UPDATE public.subscribers
       SET current_subscription   = v_new_sub,
           subscription_history   = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_pack           = v_pack.name,
           cable_provider_id      = COALESCE(v_pack.provider_id, cable_provider_id),
           updated_at             = now()
     WHERE id = p_subscriber_id;
  END IF;

  -- Insert the charge on the ledger; balance trigger will recalc
  INSERT INTO public.transactions (
    user_id, subscriber_id, type, amount, service_type, provider_id,
    source, description, date, status
  ) VALUES (
    v_uid, p_subscriber_id, 'charge', v_charge, p_service_type, v_pack.provider_id,
    'subscription_charge',
    initcap(p_service_type) || ' ' ||
      CASE WHEN v_is_prepaid THEN 'recharge' ELSE 'subscription charge' END ||
      ': ' || v_pack.name || ' (' || p_duration ||
      CASE WHEN v_is_prepaid THEN ' × ' || v_validity || 'd)' ELSE ' month' || CASE WHEN p_duration > 1 THEN 's)' ELSE ')' END END,
    now(), 'posted'
  );

  RETURN jsonb_build_object(
    'subscription_id', v_sub_id_text,
    'charge_amount', v_charge,
    'end_date', v_end
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_subscription(uuid, text, uuid, int) TO authenticated;

-- ---------------------------------------------------------------------
-- cancel_subscription
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_subscription(
  p_subscriber_id uuid,
  p_service_type  text,
  p_refund_amount numeric DEFAULT 0,
  p_reason        text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_sub       public.subscribers;
  v_active    jsonb;
  v_history   jsonb;
  v_active_id text;
  v_total_charged numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF COALESCE(p_refund_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Refund amount cannot be negative';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscriber not found';
  END IF;

  IF p_service_type = 'internet' THEN
    v_active  := to_jsonb(v_sub.internet_subscription);
    v_history := COALESCE(to_jsonb(v_sub.internet_subscription_history), '[]'::jsonb);
  ELSE
    v_active  := to_jsonb(v_sub.current_subscription);
    v_history := COALESCE(to_jsonb(v_sub.subscription_history), '[]'::jsonb);
  END IF;

  IF v_active IS NULL OR v_active = 'null'::jsonb THEN
    RAISE EXCEPTION 'No active % subscription to cancel', p_service_type;
  END IF;

  v_active_id := v_active->>'id';
  v_total_charged := COALESCE((v_active->>'packPrice')::numeric, 0)
                   * COALESCE((v_active->>'duration')::numeric, 1);
  IF p_refund_amount > v_total_charged THEN
    RAISE EXCEPTION 'Refund (₹%) cannot exceed total charged (₹%)', p_refund_amount, v_total_charged;
  END IF;

  -- Mark the matching history entry as cancelled
  v_history := (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN e->>'id' = v_active_id
        THEN e || jsonb_build_object('status','cancelled','endDate', now())
        ELSE e
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_history) e
  );

  IF p_service_type = 'internet' THEN
    UPDATE public.subscribers
       SET internet_subscription         = NULL,
           internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_internet_pack         = NULL,
           updated_at                    = now()
     WHERE id = p_subscriber_id;
  ELSE
    UPDATE public.subscribers
       SET current_subscription   = NULL,
           subscription_history   = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_pack           = NULL,
           updated_at             = now()
     WHERE id = p_subscriber_id;
  END IF;

  -- Insert refund as a payment row on the ledger (trigger recalcs balance)
  IF p_refund_amount > 0 THEN
    INSERT INTO public.transactions (
      user_id, subscriber_id, type, amount, service_type, provider_id,
      source, description, date, status
    ) VALUES (
      v_uid, p_subscriber_id, 'payment', p_refund_amount, p_service_type,
      CASE WHEN p_service_type = 'internet' THEN v_sub.internet_provider_id ELSE v_sub.cable_provider_id END,
      'subscription_refund',
      'Refund for cancelled ' || p_service_type || ' subscription: ' || COALESCE(v_active->>'packName','(pack)')
        || CASE WHEN COALESCE(btrim(p_reason),'') <> '' THEN ' — ' || p_reason ELSE '' END,
      now(), 'posted'
    );
  END IF;

  RETURN jsonb_build_object(
    'cancelled_subscription_id', v_active_id,
    'refund_amount', p_refund_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_subscription(uuid, text, numeric, text) TO authenticated;
