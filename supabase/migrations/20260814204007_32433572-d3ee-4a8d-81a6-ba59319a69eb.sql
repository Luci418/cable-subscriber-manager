CREATE OR REPLACE FUNCTION public.commit_provider_import(
  p_run_id uuid,
  p_decisions jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

        -- Reset first: a stale device from a previous row must never leak in.
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
          -- Extend in place, mirroring the provider's own end date. The
          -- resolved device disambiguates multi-STB subscribers.
          v_sub_res := public.extend_subscription(v_sid, 'cable', v_pack.id, v_duration, v_end, v_device_id);
          v_renewals := v_renewals + 1;
        ELSIF v_bucket = 'plan_change' THEN
          IF EXISTS (SELECT 1 FROM public.subscriptions
                      WHERE subscriber_id = v_sid AND service_type = 'cable' AND status = 'active') THEN
            PERFORM public.cancel_subscription(
              v_sid, 'cable', 0, 'Provider plan change: ' || COALESCE(v_d->>'base_plan','—'),
              NULL, 'plan_change');
          END IF;
          v_sub_res := public.create_subscription(v_sid, 'cable', v_pack.id, v_duration, v_device_id);
          v_plan_changes := v_plan_changes + 1;
        ELSE
          v_sub_res := public.create_subscription(v_sid, 'cable', v_pack.id, v_duration, v_device_id);
          v_activations := v_activations + 1;
        END IF;

        v_tx := NULLIF(v_sub_res->>'charge_transaction_id','')::uuid;
        v_amount := COALESCE((v_sub_res->>'charge_amount')::numeric, 0);

        UPDATE public.transactions
           SET source = 'provider_sync',
               description = description || ' · provider sync'
         WHERE id = v_tx;

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
$fn$;

GRANT EXECUTE ON FUNCTION public.commit_provider_import(uuid, jsonb) TO authenticated;
