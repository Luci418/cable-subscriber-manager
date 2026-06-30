
-- 1. Subscribers: archive metadata
ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS archived_at         timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by         uuid,
  ADD COLUMN IF NOT EXISTS archive_reason      text,
  ADD COLUMN IF NOT EXISTS archive_reason_code text;

-- 2. Subscriptions: cancelled_by attribution
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

-- 3. subscriber_status_log — append-only audit
CREATE TABLE IF NOT EXISTS public.subscriber_status_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  from_status   text NOT NULL,
  to_status     text NOT NULL,
  reason_code   text,
  reason_note   text,
  actor         uuid,
  at            timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.subscriber_status_log TO authenticated;
GRANT ALL ON public.subscriber_status_log TO service_role;

ALTER TABLE public.subscriber_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriber_status_log owner read"
  ON public.subscriber_status_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "subscriber_status_log owner insert"
  ON public.subscriber_status_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS subscriber_status_log_subscriber_idx
  ON public.subscriber_status_log (subscriber_id, at DESC);

-- Append-only enforcement (mirrors transaction_notes pattern)
CREATE OR REPLACE FUNCTION public.subscriber_status_log_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'subscriber_status_log is append-only.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS subscriber_status_log_no_update ON public.subscriber_status_log;
CREATE TRIGGER subscriber_status_log_no_update
  BEFORE UPDATE OR DELETE ON public.subscriber_status_log
  FOR EACH ROW EXECUTE FUNCTION public.subscriber_status_log_enforce_immutability();

-- 4. Stamp cancelled_by inside cancel_subscription (preserves all other logic)
CREATE OR REPLACE FUNCTION public.cancel_subscription(p_subscriber_id uuid, p_service_type text, p_refund_amount numeric DEFAULT 0, p_reason text DEFAULT NULL::text, p_subscription_id uuid DEFAULT NULL::uuid)
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
    IF p_service_type = 'internet' THEN
      UPDATE public.subscribers
         SET internet_subscription = NULL,
             internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             current_internet_pack = NULL,
             updated_at = now()
       WHERE id = p_subscriber_id;
    ELSE
      UPDATE public.subscribers
         SET current_subscription = NULL,
             subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             current_pack = NULL,
             updated_at = now()
       WHERE id = p_subscriber_id;
    END IF;
  ELSE
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

-- 5. archive_subscriber RPC
CREATE OR REPLACE FUNCTION public.archive_subscriber(
  p_subscriber_id uuid,
  p_reason_code   text,
  p_reason_note   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_prev_status text;
  v_code text;
  v_sub_rec record;
  v_dev_rec record;
  v_cancelled int := 0;
  v_unpaired int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_code := lower(COALESCE(NULLIF(btrim(p_reason_code),''),''));
  IF v_code NOT IN ('moved_away','switched_provider','duplicate','non_payment','other') THEN
    RAISE EXCEPTION 'Invalid archive reason: %', p_reason_code;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF v_sub.customer_status = 'archived' THEN
    RAISE EXCEPTION 'Subscriber is already archived';
  END IF;

  v_prev_status := v_sub.customer_status::text;

  -- Cancel every active subscription (no refunds here — the UI must
  -- collect refunds via the existing CancelSubscriptionDialog before
  -- invoking archive_subscriber; this RPC only closes whatever is left).
  FOR v_sub_rec IN
    SELECT id, service_type FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id
       AND user_id = v_uid
       AND status = 'active'
  LOOP
    PERFORM public.cancel_subscription(
      p_subscriber_id, v_sub_rec.service_type, 0,
      'Customer archived: ' || v_code, v_sub_rec.id
    );
    v_cancelled := v_cancelled + 1;
  END LOOP;

  -- Unpair every assigned device.
  FOR v_dev_rec IN
    SELECT id FROM public.stb_inventory
     WHERE subscriber_id = p_subscriber_id
       AND user_id = v_uid
       AND status = 'assigned'
  LOOP
    PERFORM public.unpair_device(p_subscriber_id, v_dev_rec.id, 'customer_closed', 'available');
    v_unpaired := v_unpaired + 1;
  END LOOP;

  UPDATE public.subscribers
     SET customer_status = 'archived',
         archived_at = now(),
         archived_by = v_uid,
         archive_reason = NULLIF(btrim(p_reason_note),''),
         archive_reason_code = v_code,
         updated_at = now()
   WHERE id = p_subscriber_id;

  INSERT INTO public.subscriber_status_log (
    user_id, subscriber_id, from_status, to_status, reason_code, reason_note, actor
  ) VALUES (
    v_uid, p_subscriber_id, v_prev_status, 'archived', v_code,
    NULLIF(btrim(p_reason_note),''), v_uid
  );

  RETURN jsonb_build_object(
    'subscriber_id', p_subscriber_id,
    'cancelled_subscriptions', v_cancelled,
    'unpaired_devices', v_unpaired,
    'archived_at', now()
  );
END;
$$;

-- 6. reactivate_subscriber RPC
CREATE OR REPLACE FUNCTION public.reactivate_subscriber(
  p_subscriber_id uuid,
  p_reason_note   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_new_status text;
  v_has_active boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF v_sub.customer_status <> 'archived' THEN
    RAISE EXCEPTION 'Subscriber is not archived';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id AND status = 'active'
  ) INTO v_has_active;

  v_new_status := CASE WHEN v_has_active THEN 'active' ELSE 'inactive' END;

  UPDATE public.subscribers
     SET customer_status = v_new_status::customer_status,
         archived_at = NULL,
         archived_by = NULL,
         archive_reason = NULL,
         archive_reason_code = NULL,
         updated_at = now()
   WHERE id = p_subscriber_id;

  INSERT INTO public.subscriber_status_log (
    user_id, subscriber_id, from_status, to_status, reason_code, reason_note, actor
  ) VALUES (
    v_uid, p_subscriber_id, 'archived', v_new_status, 'reactivate',
    NULLIF(btrim(p_reason_note),''), v_uid
  );

  RETURN jsonb_build_object(
    'subscriber_id', p_subscriber_id,
    'new_status', v_new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_subscriber(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_subscriber(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_subscriber(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_subscriber(uuid, text) TO authenticated;
