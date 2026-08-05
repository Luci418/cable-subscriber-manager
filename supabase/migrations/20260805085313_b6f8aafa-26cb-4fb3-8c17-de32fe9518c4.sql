
-- Phase 6 — commit an operator-approved provider import review.
-- Insert-only for the ledger (INV-46/47). Operates on an EXISTING draft run.
CREATE OR REPLACE FUNCTION public.commit_provider_import(
  p_run_id uuid,
  p_decisions jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_run public.provider_import_runs;
  v_d jsonb;
  v_sid uuid;
  v_name text;
  v_mobile text;
  v_amount numeric;
  v_tx uuid;
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
    RAISE EXCEPTION 'You do not have permission to commit a provider import';
  END IF;

  SELECT * INTO v_run FROM public.provider_import_runs
   WHERE id = p_run_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import run not found'; END IF;
  IF v_run.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft import run can be committed (this run is %)', v_run.status;
  END IF;

  FOR v_d IN SELECT * FROM jsonb_array_elements(COALESCE(p_decisions, '[]'::jsonb))
  LOOP
    BEGIN
      v_sid := NULLIF(v_d->>'subscriber_id','')::uuid;
      v_name := NULLIF(trim(COALESCE(v_d->>'customer_name','')), '');
      v_mobile := NULLIF(trim(COALESCE(v_d->>'mobile','')), '');

      -- 1. Optional prospect creation for an unmatched row the operator chose.
      IF v_sid IS NULL AND COALESCE((v_d->>'create_prospect')::boolean, false) THEN
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
      IF COALESCE((v_d->>'plan_state')::boolean,false)
         OR COALESCE((v_d->>'provider_status')::boolean,false) THEN
        INSERT INTO public.subscriber_provider_state (
          user_id, subscriber_id, provider_id, provider_customer_number,
          provider_plan_name, provider_plan_start, provider_plan_end,
          provider_status, last_seen_in_snapshot_at, last_import_run_id
        ) VALUES (
          v_uid, v_sid, v_run.provider_id, NULLIF(v_d->>'account_number',''),
          CASE WHEN COALESCE((v_d->>'plan_state')::boolean,false) THEN NULLIF(v_d->>'base_plan','') END,
          CASE WHEN COALESCE((v_d->>'plan_state')::boolean,false) THEN NULLIF(v_d->>'start_date','')::date END,
          CASE WHEN COALESCE((v_d->>'plan_state')::boolean,false) THEN NULLIF(v_d->>'end_date','')::date END,
          CASE WHEN COALESCE((v_d->>'provider_status')::boolean,false) THEN NULLIF(v_d->>'service_status','') END,
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
        v_states := v_states + 1;
      END IF;

      -- 3. Ledger charge. Insert-only, never an update of an existing row.
      v_tx := NULL;
      IF COALESCE((v_d->>'charge')::boolean,false) THEN
        v_amount := ROUND(COALESCE(NULLIF(v_d->>'amount','')::numeric, 0), 2);
        IF v_amount <= 0 THEN
          RAISE EXCEPTION 'Charge amount must be greater than zero';
        END IF;
        INSERT INTO public.transactions (
          user_id, subscriber_id, type, amount, service_type,
          provider_id, source, status, description, date
        ) VALUES (
          v_uid, v_sid, 'charge', v_amount, 'cable',
          v_run.provider_id, 'provider_sync', 'posted',
          'Provider sync: ' || COALESCE(NULLIF(v_d->>'base_plan',''), 'plan') ||
            ' (' || v_run.report_type || ')',
          now()
        ) RETURNING id INTO v_tx;
        v_charges := v_charges + 1;
        v_total := v_total + v_amount;
      END IF;

      v_results := v_results || jsonb_build_object(
        'key', v_d->>'key',
        'outcome', 'applied',
        'subscriber_id', v_sid,
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
    'total_charged', v_total);
END;
$function$;

-- Cancelling a review: the run is marked cancelled and can never be a baseline
-- (the baseline query is status='committed' only). INV-48.
CREATE OR REPLACE FUNCTION public.cancel_provider_import(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.provider_import_runs
     SET status = 'cancelled', updated_at = now()
   WHERE id = p_run_id AND user_id = v_uid AND status = 'draft';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.commit_provider_import(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_provider_import(uuid) TO authenticated;
