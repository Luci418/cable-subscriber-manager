CREATE OR REPLACE FUNCTION public.cancel_provider_import(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_sync_provider(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to cancel a provider import'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.provider_import_runs
     SET status = 'cancelled', updated_at = now()
   WHERE id = p_run_id AND user_id = v_uid AND status = 'draft';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.commit_provider_import(p_run_id uuid, p_decisions jsonb)
RETURNS jsonb
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
  v_total numeric := 0;
  v_err text;
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

  -- Server-side policy gate. The client's booleans are a request, never an
  -- authority: whatever p_decisions claims, a write the provider's own
  -- sync_policy forbids does not happen. Missing keys resolve to the
  -- documented defaults (INV-50), never to false.
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
      v_tx     := NULL;
      v_sub_res := NULL;

      -- 1. Optional prospect creation for an unmatched row the operator chose.
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

      -- 2. Upstream mirror. Raw provider status stored verbatim (§1.5-G).
      --    provider_customer_number is written whenever we know it: it is the
      --    only durable record that this subscriber IS this provider account,
      --    and the next import's tier-3 match reads it back.
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

      -- 3. Money. A provider charge is a *side effect of a subscription*
      --    (BUSINESS_RULES §4.3), never a bare ledger row: without the
      --    subscriptions row nothing in the app shows the customer as active
      --    and the next renewal has nothing to extend.
      IF COALESCE((v_d->>'charge')::boolean,false) AND v_allow_charges THEN
        SELECT * INTO v_pack FROM public.packs
         WHERE id = NULLIF(v_d->>'pack_id','')::uuid AND user_id = v_uid;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No local pack is mapped for this plan';
        END IF;

        v_start := NULLIF(v_d->>'start_date','')::date;
        v_end   := NULLIF(v_d->>'end_date','')::date;
        v_validity := GREATEST(1, COALESCE(v_pack.validity_days, 30));
        v_days := CASE WHEN v_start IS NOT NULL AND v_end IS NOT NULL AND v_end >= v_start
                       THEN (v_end - v_start) + 1 ELSE v_validity END;
        v_duration := GREATEST(1, ROUND(v_days::numeric / v_validity)::int);

        -- Only a device already paired to this subscriber may be used; sync
        -- never pairs hardware (that stays with pair_device).
        SELECT id INTO v_device_id FROM public.stb_inventory
         WHERE user_id = v_uid AND subscriber_id = v_sid
           AND status = 'assigned' AND COALESCE(service_type,'cable') = 'cable'
           AND (
             upper(COALESCE(vc_id,'')) = upper(COALESCE(NULLIF(v_d->>'vc_id',''),'~'))
             OR upper(serial_number) = upper(COALESCE(NULLIF(v_d->>'stb_no',''),'~'))
           )
         LIMIT 1;

        v_sub_res := public.create_subscription(
          v_sid, 'cable', v_pack.id, v_duration, v_device_id);
        v_tx := NULLIF(v_sub_res->>'charge_transaction_id','')::uuid;
        v_amount := COALESCE((v_sub_res->>'charge_amount')::numeric, 0);

        UPDATE public.transactions
           SET source = 'provider_sync',
               description = description || ' · provider sync'
         WHERE id = v_tx;

        v_charges := v_charges + 1;
        v_total := v_total + v_amount;
      END IF;

      v_results := v_results || jsonb_build_object(
        'key', v_d->>'key',
        'outcome', 'applied',
        'subscriber_id', v_sid,
        'subscription_id', v_sub_res->>'subscription_id',
        'transaction_id', v_tx);

    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_errors := v_errors + 1;
      v_results := v_results || jsonb_build_object(
        'key', v_d->>'key', 'outcome', 'error', 'reason', v_err);
    END;
  END LOOP;

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
    'rows', v_results);
END;
$fn$;