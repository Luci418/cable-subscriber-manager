-- ─────────────────────────────────────────────────────────────
-- 1. parser_version on import runs
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.provider_import_runs
  ADD COLUMN IF NOT EXISTS parser_version text;

-- ─────────────────────────────────────────────────────────────
-- 2. Subscription extension bookkeeping
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS extended_from_subscription_id uuid REFERENCES public.subscriptions(id),
  ADD COLUMN IF NOT EXISTS extension_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_extended_at timestamptz;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_cancel_reason_code_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_cancel_reason_code_check
  CHECK (cancel_reason_code = ANY (ARRAY[
    'customer_request','operator_error','provider_migration','non_payment','plan_change','other'
  ]));

-- ─────────────────────────────────────────────────────────────
-- 3. Immutability triggers learn about extend_subscription.
--    INV-41 stands for every direct UPDATE; the ONLY escape is the
--    session flag `app.extend_subscription`, which nothing but the
--    SECURITY DEFINER RPC below ever sets (and only for its own
--    transaction, LOCAL).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscriptions_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  allowed_cols text[] := ARRAY[
    'status','cancelled_at','cancelled_by',
    'cancel_reason_code','cancel_reason_note','refund_amount','updated_at'
  ];
  col text;
  changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Subscription rows are immutable and cannot be deleted (id=%).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(current_setting('app.extend_subscription', true), '') = 'on' THEN
    allowed_cols := allowed_cols || ARRAY[
      'end_date','duration','total_days','total_charged',
      'extension_count','last_extended_at','extended_from_subscription_id'
    ];
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR col IN
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'subscriptions'
    LOOP
      IF col = ANY (allowed_cols) THEN CONTINUE; END IF;
      EXECUTE format('SELECT ($1).%1$I IS DISTINCT FROM ($2).%1$I', col)
        INTO changed USING OLD, NEW;
      IF changed THEN
        RAISE EXCEPTION
          'Subscription column % is immutable after creation (id=%). Use the appropriate RPC (cancel_subscription, extend_subscription) to alter subscription state.',
          col, OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.subscriptions_enforce_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inv_ok boolean;
  v_cash_paid numeric;
  v_extending boolean := COALESCE(current_setting('app.extend_subscription', true), '') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Subscriptions cannot be deleted (INV-43). Use status transitions.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.pack_name_snapshot       IS DISTINCT FROM OLD.pack_name_snapshot
    OR NEW.pack_price_snapshot      IS DISTINCT FROM OLD.pack_price_snapshot
    OR NEW.billing_type_snapshot    IS DISTINCT FROM OLD.billing_type_snapshot
    OR NEW.validity_days_snapshot   IS DISTINCT FROM OLD.validity_days_snapshot
    OR NEW.start_date               IS DISTINCT FROM OLD.start_date
    OR NEW.previous_subscription_id IS DISTINCT FROM OLD.previous_subscription_id
    OR NEW.created_by               IS DISTINCT FROM OLD.created_by
    OR NEW.subscriber_id            IS DISTINCT FROM OLD.subscriber_id
    OR NEW.service_type             IS DISTINCT FROM OLD.service_type THEN
      RAISE EXCEPTION 'Snapshot/identity columns on subscriptions are immutable.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT v_extending THEN
      IF NEW.total_days   IS DISTINCT FROM OLD.total_days
      OR NEW.total_charged IS DISTINCT FROM OLD.total_charged
      OR NEW.duration      IS DISTINCT FROM OLD.duration THEN
        RAISE EXCEPTION 'Duration/charge columns on subscriptions are immutable.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        RAISE EXCEPTION 'end_date cannot be updated directly (INV-41). Use extend_subscription.'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      -- An extension only ever moves the window forward.
      IF NEW.end_date < OLD.end_date THEN
        RAISE EXCEPTION 'An extension cannot shorten a subscription (% -> %).', OLD.end_date, NEW.end_date
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.total_charged < OLD.total_charged THEN
        RAISE EXCEPTION 'An extension cannot reduce total_charged.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
           (OLD.status = 'active'    AND NEW.status IN ('expired','cancelled','superseded','suspended'))
        OR (OLD.status = 'suspended' AND NEW.status IN ('active','cancelled'))
      ) THEN
        RAISE EXCEPTION 'Invalid subscription status transition: % -> %', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.device_serial_snapshot IS DISTINCT FROM OLD.device_serial_snapshot
       AND NEW.device_serial_snapshot IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.stb_inventory
         WHERE user_id = NEW.user_id
           AND serial_number = NEW.device_serial_snapshot
           AND status = 'assigned'
           AND subscriber_id = NEW.subscriber_id
      ) INTO v_inv_ok;
      IF NOT v_inv_ok THEN
        RAISE EXCEPTION
          'Inventory does not agree: device % is not assigned to this subscriber. Use replace_device.',
          NEW.device_serial_snapshot
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.refund_amount IS DISTINCT FROM OLD.refund_amount
       AND NEW.refund_amount IS NOT NULL THEN
      SELECT COALESCE(SUM(pa.amount), 0) INTO v_cash_paid
        FROM public.payment_allocations pa
        JOIN public.transactions t ON t.id = pa.transaction_id
       WHERE pa.subscription_id = NEW.id
         AND t.type = 'payment'
         AND t.status NOT IN ('voided','reversal');
      IF NEW.refund_amount > v_cash_paid THEN
        RAISE EXCEPTION 'Refund (₹%) exceeds cash paid toward this subscription (₹%) (INV-42).',
          NEW.refund_amount, v_cash_paid
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 4. cancel_subscription gains an explicit reason code so a
--    plan change reads as a plan change in the ledger.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cancel_subscription(uuid, text, numeric, text, uuid);

CREATE OR REPLACE FUNCTION public.cancel_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_refund_amount numeric DEFAULT 0,
  p_reason text DEFAULT NULL,
  p_subscription_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_active_subscription_id uuid;
  v_target_device_id uuid;
  v_total_charged numeric;
  v_cash_paid numeric;
  v_refund_tx_id uuid;
  v_code text := COALESCE(NULLIF(btrim(p_reason_code),''), 'customer_request');
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
         cancel_reason_code = v_code,
         refund_amount = p_refund_amount
   WHERE id = v_active_subscription_id;

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
$fn$;

GRANT EXECUTE ON FUNCTION public.cancel_subscription(uuid, text, numeric, text, uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. extend_subscription — renewal in place.
--
--    Same auth pattern as create_subscription (authenticated owner of
--    the row; no extra role gate, matching create_subscription exactly).
--    p_end_date_override is the provider's OWN reported end date, used
--    by sync so the local window mirrors upstream rather than being
--    recomputed locally.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extend_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_pack_id uuid,
  p_periods int DEFAULT 1,
  p_end_date_override date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_pack public.packs;
  v_row public.subscriptions;
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

  SELECT * INTO v_row FROM public.subscriptions
   WHERE subscriber_id = p_subscriber_id
     AND service_type  = p_service_type
     AND status = 'active'
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  -- No active subscription: this is today's "renew after expiry" path and
  -- must not regress — delegate verbatim to create_subscription, then record
  -- the continuity link.
  IF NOT FOUND THEN
    v_res := public.create_subscription(p_subscriber_id, p_service_type, p_pack_id, p_periods, NULL);

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
$fn$;

GRANT EXECUTE ON FUNCTION public.extend_subscription(uuid, text, uuid, int, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. commit_provider_import
--    * routes by bucket (activation / renewal / plan change)
--    * freezes the pack interpretation into results (historical
--      reproducibility invariant)
--    * carries a failed_keys list forward so a row that errored is
--      never silently treated as "already handled" next import
--    * per-bucket summary counts
-- ─────────────────────────────────────────────────────────────
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

  -- Keys that failed in the previous committed run of this provider/report.
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

        -- Historical reproducibility: freeze how this row was understood
        -- AT COMMIT TIME. Re-pointing a pack mapping later must never
        -- change what a past run is read to have meant.
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

        SELECT id INTO v_device_id FROM public.stb_inventory
         WHERE user_id = v_uid AND subscriber_id = v_sid
           AND status = 'assigned' AND COALESCE(service_type,'cable') = 'cable'
           AND (
             upper(COALESCE(vc_id,'')) = upper(COALESCE(NULLIF(v_d->>'vc_id',''),'~'))
             OR upper(serial_number) = upper(COALESCE(NULLIF(v_d->>'stb_no',''),'~'))
           )
         LIMIT 1;

        IF v_bucket = 'renewal' THEN
          -- Extend in place, mirroring the provider's own end date.
          v_sub_res := public.extend_subscription(v_sid, 'cable', v_pack.id, v_duration, v_end);
          v_renewals := v_renewals + 1;
        ELSIF v_bucket = 'plan_change' THEN
          -- TODO: a future change_subscription_pack() should evolve one
          -- subscription row in place. Until then a plan change is the same
          -- cancel + create the manual workflow requires (BUSINESS_RULES §4.3),
          -- labelled so the ledger explains itself.
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

  -- Carry forward: previously failed keys stay flagged until they apply
  -- cleanly once. The next import forces these rows into needs_review even
  -- when the provider's data is byte-identical to this baseline.
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