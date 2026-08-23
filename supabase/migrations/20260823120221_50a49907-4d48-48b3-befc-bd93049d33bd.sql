-- Add p_source to create_subscription / extend_subscription so sync-created
-- charges are tagged at INSERT time (never UPDATEd afterwards, which the
-- transactions immutability trigger forbids).

DROP FUNCTION IF EXISTS public.create_subscription(uuid, text, uuid, integer, uuid);
DROP FUNCTION IF EXISTS public.extend_subscription(uuid, text, uuid, integer, date, uuid);

CREATE OR REPLACE FUNCTION public.create_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_pack_id uuid,
  p_duration integer,
  p_device_id uuid DEFAULT NULL::uuid,
  p_source public.transaction_source DEFAULT 'subscription_charge'
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
  IF p_source NOT IN ('subscription_charge','provider_sync') THEN
    RAISE EXCEPTION 'Invalid charge source for a subscription: %', p_source;
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
    p_source,
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

CREATE OR REPLACE FUNCTION public.extend_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_pack_id uuid,
  p_periods integer DEFAULT 1,
  p_end_date_override date DEFAULT NULL::date,
  p_device_id uuid DEFAULT NULL::uuid,
  p_source public.transaction_source DEFAULT 'subscription_charge'
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
  IF p_source NOT IN ('subscription_charge','provider_sync') THEN
    RAISE EXCEPTION 'Invalid charge source for a subscription: %', p_source;
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

  IF v_row.id IS NULL THEN
    v_res := public.create_subscription(p_subscriber_id, p_service_type, p_pack_id, p_periods, p_device_id, p_source);

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
    p_source,
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

-- commit_provider_import: pass the sync source through instead of relying on a
-- post-hoc note. The note is kept (audit trail of which run posted the charge).
CREATE OR REPLACE FUNCTION public.commit_provider_import(p_run_id uuid, p_decisions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_run public.provider_import_runs;
  v_policy jsonb;
  v_allow_charges boolean;
  v_allow_prospects boolean;
  v_allow_plan boolean;
  v_allow_status boolean;
  v_d jsonb;
  v_sid uuid;
  v_name text;
  v_mobile text;
  v_bucket text;
  v_pack public.packs;
  v_start date;
  v_end date;
  v_days int;
  v_validity int;
  v_duration int;
  v_device_id uuid;
  v_sub_res jsonb;
  v_tx uuid;
  v_amount numeric;
  v_want_plan boolean;
  v_want_status boolean;
  v_results jsonb := '[]'::jsonb;
  v_charges int := 0;
  v_states int := 0;
  v_prospects int := 0;
  v_errors int := 0;
  v_activations int := 0;
  v_renewals int := 0;
  v_plan_changes int := 0;
  v_total numeric := 0;
  v_err text;
  v_prev_failed jsonb := '[]'::jsonb;
  v_failed text[] := ARRAY[]::text[];
  v_applied text[] := ARRAY[]::text[];
  v_carry text[];
  v_snapshot jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_sync_provider(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to commit a provider import'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run FROM public.provider_import_runs
   WHERE id = p_run_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import run not found'; END IF;
  IF v_run.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft import run can be committed (this run is %)', v_run.status;
  END IF;

  SELECT COALESCE(results->'failed_keys', '[]'::jsonb) INTO v_prev_failed
    FROM public.provider_import_runs
   WHERE user_id = v_uid
     AND provider_id = v_run.provider_id
     AND report_type = v_run.report_type
     AND status = 'committed'
   ORDER BY imported_at DESC LIMIT 1;
  v_prev_failed := COALESCE(v_prev_failed, '[]'::jsonb);

  SELECT COALESCE(sync_policy, '{}'::jsonb) INTO v_policy
    FROM public.providers WHERE id = v_run.provider_id;
  v_policy          := COALESCE(v_policy, '{}'::jsonb);
  v_allow_charges   := COALESCE((v_policy->>'create_charges')::boolean, true);
  v_allow_prospects := COALESCE((v_policy->>'create_prospects')::boolean, true);
  v_allow_plan      := COALESCE((v_policy->>'update_plan_state')::boolean, true);
  v_allow_status    := COALESCE((v_policy->>'update_provider_status')::boolean, true);

  FOR v_d IN SELECT * FROM jsonb_array_elements(COALESCE(p_decisions, '[]'::jsonb))
  LOOP
    BEGIN
      v_sid    := NULLIF(v_d->>'subscriber_id','')::uuid;
      v_name   := NULLIF(trim(COALESCE(v_d->>'customer_name','')), '');
      v_mobile := NULLIF(trim(COALESCE(v_d->>'mobile','')), '');
      v_bucket := COALESCE(v_d->>'bucket','');
      v_tx     := NULL;
      v_sub_res := NULL;
      v_snapshot := NULL;

      IF v_sid IS NULL AND COALESCE((v_d->>'create_prospect')::boolean, false) THEN
        IF NOT v_allow_prospects THEN
          v_results := v_results || jsonb_build_object(
            'key', v_d->>'key', 'outcome', 'skipped',
            'reason', 'provider policy forbids creating customers');
          CONTINUE;
        END IF;
        INSERT INTO public.subscribers (
          user_id, subscriber_id, name, mobile, services,
          customer_status, cable_balance, internet_balance,
          cable_provider_id, hathway_customer_nbr
        ) VALUES (
          v_uid,
          public.generate_subscriber_id(NULL),
          COALESCE(v_name, 'Provider import'),
          COALESCE(v_mobile, '0000000000'),
          ARRAY['cable']::text[],
          'prospect', 0, 0,
          v_run.provider_id,
          NULLIF(v_d->>'account_number','')
        ) RETURNING id INTO v_sid;
        v_prospects := v_prospects + 1;
      END IF;

      IF v_sid IS NULL THEN
        v_results := v_results || jsonb_build_object(
          'key', v_d->>'key', 'outcome', 'skipped', 'reason', 'no subscriber');
        CONTINUE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.subscribers WHERE id = v_sid AND user_id = v_uid) THEN
        RAISE EXCEPTION 'Subscriber not found for this account';
      END IF;

      v_want_plan   := COALESCE((v_d->>'plan_state')::boolean,false)     AND v_allow_plan;
      v_want_status := COALESCE((v_d->>'provider_status')::boolean,false) AND v_allow_status;

      IF v_want_plan OR v_want_status OR NULLIF(v_d->>'account_number','') IS NOT NULL THEN
        INSERT INTO public.subscriber_provider_state (
          user_id, subscriber_id, provider_id, provider_customer_number,
          provider_plan_name, provider_plan_start, provider_plan_end,
          provider_status, last_seen_in_snapshot_at, last_import_run_id
        ) VALUES (
          v_uid, v_sid, v_run.provider_id, NULLIF(v_d->>'account_number',''),
          CASE WHEN v_want_plan   THEN NULLIF(v_d->>'base_plan','') END,
          CASE WHEN v_want_plan   THEN NULLIF(v_d->>'start_date','')::date END,
          CASE WHEN v_want_plan   THEN NULLIF(v_d->>'end_date','')::date END,
          CASE WHEN v_want_status THEN NULLIF(v_d->>'service_status','') END,
          now(), p_run_id
        )
        ON CONFLICT (subscriber_id, provider_id) DO UPDATE SET
          provider_customer_number = COALESCE(EXCLUDED.provider_customer_number, public.subscriber_provider_state.provider_customer_number),
          provider_plan_name  = COALESCE(EXCLUDED.provider_plan_name,  public.subscriber_provider_state.provider_plan_name),
          provider_plan_start = COALESCE(EXCLUDED.provider_plan_start, public.subscriber_provider_state.provider_plan_start),
          provider_plan_end   = COALESCE(EXCLUDED.provider_plan_end,   public.subscriber_provider_state.provider_plan_end),
          provider_status     = COALESCE(EXCLUDED.provider_status,     public.subscriber_provider_state.provider_status),
          last_seen_in_snapshot_at = now(),
          last_import_run_id  = p_run_id,
          updated_at = now();
        IF v_want_plan OR v_want_status THEN
          v_states := v_states + 1;
        END IF;
      END IF;

      IF COALESCE((v_d->>'charge')::boolean,false) AND v_allow_charges THEN
        SELECT * INTO v_pack FROM public.packs
         WHERE id = NULLIF(v_d->>'pack_id','')::uuid AND user_id = v_uid;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No local pack is mapped for this plan';
        END IF;

        v_snapshot := jsonb_build_object(
          'provider_plan_key', v_d->>'provider_plan_key',
          'provider_plan_label', v_d->>'base_plan',
          'pack_id', v_pack.id,
          'pack_name', v_pack.name,
          'pack_price', v_pack.price,
          'provider_cost', v_pack.provider_cost,
          'validity_days', v_pack.validity_days,
          'parser_version', v_run.parser_version);

        v_start := NULLIF(v_d->>'start_date','')::date;
        v_end   := NULLIF(v_d->>'end_date','')::date;
        v_validity := GREATEST(1, COALESCE(v_pack.validity_days, 30));
        v_days := CASE WHEN v_start IS NOT NULL AND v_end IS NOT NULL AND v_end >= v_start
                       THEN (v_end - v_start) + 1 ELSE v_validity END;
        v_duration := GREATEST(1, ROUND(v_days::numeric / v_validity)::int);

        v_device_id := NULL;
        SELECT id INTO v_device_id FROM public.stb_inventory
         WHERE user_id = v_uid AND subscriber_id = v_sid
           AND status = 'assigned' AND COALESCE(service_type,'cable') = 'cable'
           AND (
             upper(COALESCE(vc_id,'')) = upper(COALESCE(NULLIF(v_d->>'vc_id',''),'~'))
             OR upper(serial_number) = upper(COALESCE(NULLIF(v_d->>'stb_no',''),'~'))
           )
         LIMIT 1;

        IF v_bucket = 'renewal' THEN
          v_sub_res := public.extend_subscription(v_sid, 'cable', v_pack.id, v_duration, v_end, v_device_id, 'provider_sync');
          v_renewals := v_renewals + 1;
        ELSIF v_bucket = 'plan_change' THEN
          IF EXISTS (SELECT 1 FROM public.subscriptions
                      WHERE subscriber_id = v_sid AND service_type = 'cable' AND status = 'active') THEN
            PERFORM public.cancel_subscription(
              v_sid, 'cable', 0, 'Provider plan change: ' || COALESCE(v_d->>'base_plan','—'),
              NULL, 'plan_change');
          END IF;
          v_sub_res := public.create_subscription(v_sid, 'cable', v_pack.id, v_duration, v_device_id, 'provider_sync');
          v_plan_changes := v_plan_changes + 1;
        ELSE
          v_sub_res := public.create_subscription(v_sid, 'cable', v_pack.id, v_duration, v_device_id, 'provider_sync');
          v_activations := v_activations + 1;
        END IF;

        v_tx := NULLIF(v_sub_res->>'charge_transaction_id','')::uuid;
        v_amount := COALESCE((v_sub_res->>'charge_amount')::numeric, 0);

        IF v_tx IS NOT NULL THEN
          INSERT INTO public.transaction_notes (transaction_id, user_id, author_id, note)
          VALUES (v_tx, v_uid, v_uid, 'Posted by provider sync run ' || p_run_id::text);
        END IF;

        v_charges := v_charges + 1;
        v_total := v_total + v_amount;
      END IF;

      v_applied := v_applied || (v_d->>'key');
      v_results := v_results || jsonb_build_object(
        'key', v_d->>'key',
        'bucket', v_bucket,
        'outcome', 'applied',
        'subscriber_id', v_sid,
        'subscription_id', v_sub_res->>'subscription_id',
        'mode', v_sub_res->>'mode',
        'transaction_id', v_tx,
        'frozen', v_snapshot);

    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_errors := v_errors + 1;
      v_failed := v_failed || (v_d->>'key');
      v_results := v_results || jsonb_build_object(
        'key', v_d->>'key', 'bucket', v_bucket, 'outcome', 'error', 'reason', v_err);
    END;
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT k), ARRAY[]::text[]) INTO v_carry
    FROM (
      SELECT jsonb_array_elements_text(v_prev_failed) AS k
      UNION
      SELECT unnest(v_failed)
    ) s
   WHERE k IS NOT NULL AND NOT (k = ANY (v_applied));

  UPDATE public.provider_import_runs
     SET status = 'committed',
         committed_at = now(),
         committed_by = v_uid,
         results = jsonb_build_object(
           'charges_created', v_charges,
           'states_updated', v_states,
           'prospects_created', v_prospects,
           'errors', v_errors,
           'total_charged', v_total,
           'by_bucket', jsonb_build_object(
             'new_activation', v_activations,
             'renewal', v_renewals,
             'plan_change', v_plan_changes,
             'prospects_created', v_prospects),
           'failed_keys', to_jsonb(v_carry),
           'parser_version', v_run.parser_version,
           'rows', v_results),
         updated_at = now()
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'charges_created', v_charges,
    'states_updated', v_states,
    'prospects_created', v_prospects,
    'errors', v_errors,
    'total_charged', v_total,
    'by_bucket', jsonb_build_object(
      'new_activation', v_activations,
      'renewal', v_renewals,
      'plan_change', v_plan_changes,
      'prospects_created', v_prospects),
    'failed_keys', to_jsonb(v_carry),
    'rows', v_results);
END;
$function$;