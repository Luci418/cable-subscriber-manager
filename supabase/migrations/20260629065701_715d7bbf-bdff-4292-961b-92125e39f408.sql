CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  affected integer := 0;
  rec record;
  cur_sub jsonb;
  hist jsonb;
  expired_sub jsonb;
  exists_in_hist boolean;
  v_count int;
BEGIN
  -- Execution model:
  --   * Authenticated operator call (v_uid IS NOT NULL): scoped to that
  --     tenant's rows only. Every read and write filters by user_id = v_uid.
  --   * Maintenance call with no auth context (v_uid IS NULL): full
  --     cross-tenant sweep. Reserved for future scheduled jobs (cron /
  --     edge function running as service_role with no JWT). EXECUTE is
  --     currently granted to authenticated + service_role; do NOT grant
  --     to anon, since an anon caller would also hit the unscoped path.
  IF v_uid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('expire_lapsed:' || v_uid::text, 0)
    );
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended('expire_lapsed_subscriptions', 0)
    );
  END IF;

  WITH upd AS (
    UPDATE public.subscriptions
       SET status = 'expired', updated_at = now()
     WHERE status = 'active'
       AND end_date <= CURRENT_DATE
       AND (v_uid IS NULL OR user_id = v_uid)
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM upd;
  affected := affected + COALESCE(v_count, 0);

  -- TODO(legacy-cleanup Batch B/C): the loops below maintain the legacy
  -- JSONB compatibility columns (current_subscription, subscription_history,
  -- current_pack, current_pack_id and their internet equivalents). Once
  -- those columns are retired per docs/LEGACY_COLUMN_AUDIT_2026-06.md, drop
  -- both loops — the subscriptions UPDATE above is the authoritative state.

  FOR rec IN
    SELECT id, current_subscription, subscription_history FROM public.subscribers
     WHERE current_subscription IS NOT NULL
       AND (current_subscription->>'endDate')::timestamptz <= now()
       AND (v_uid IS NULL OR user_id = v_uid)
  LOOP
    cur_sub := rec.current_subscription;
    hist := COALESCE(to_jsonb(rec.subscription_history), '[]'::jsonb);
    expired_sub := cur_sub || jsonb_build_object('status','expired');

    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(hist) e WHERE e->>'id' = cur_sub->>'id')
      INTO exists_in_hist;

    IF exists_in_hist THEN
      hist := (SELECT jsonb_agg(CASE WHEN e->>'id' = cur_sub->>'id' THEN expired_sub ELSE e END)
                 FROM jsonb_array_elements(hist) e);
    ELSE
      hist := hist || jsonb_build_array(expired_sub);
    END IF;

    UPDATE public.subscribers
       SET current_subscription = NULL,
           current_pack = NULL,
           current_pack_id = NULL,
           subscription_history = ARRAY(SELECT jsonb_array_elements(hist))::jsonb[],
           updated_at = now()
     WHERE id = rec.id
       AND (v_uid IS NULL OR user_id = v_uid);
  END LOOP;

  FOR rec IN
    SELECT id, internet_subscription, internet_subscription_history FROM public.subscribers
     WHERE internet_subscription IS NOT NULL
       AND (internet_subscription->>'endDate')::timestamptz <= now()
       AND (v_uid IS NULL OR user_id = v_uid)
  LOOP
    cur_sub := rec.internet_subscription;
    hist := COALESCE(to_jsonb(rec.internet_subscription_history), '[]'::jsonb);
    expired_sub := cur_sub || jsonb_build_object('status','expired');

    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(hist) e WHERE e->>'id' = cur_sub->>'id')
      INTO exists_in_hist;

    IF exists_in_hist THEN
      hist := (SELECT jsonb_agg(CASE WHEN e->>'id' = cur_sub->>'id' THEN expired_sub ELSE e END)
                 FROM jsonb_array_elements(hist) e);
    ELSE
      hist := hist || jsonb_build_array(expired_sub);
    END IF;

    UPDATE public.subscribers
       SET internet_subscription = NULL,
           current_internet_pack = NULL,
           current_internet_pack_id = NULL,
           internet_subscription_history = ARRAY(SELECT jsonb_array_elements(hist))::jsonb[],
           updated_at = now()
     WHERE id = rec.id
       AND (v_uid IS NULL OR user_id = v_uid);
  END LOOP;

  RETURN affected;
END;
$function$;

-- Permissions unchanged from the prior corrective migration:
--   authenticated -> scoped path (UI lazy cleanup)
--   service_role  -> unscoped maintenance path
-- Re-assert explicitly so the grant state is obvious in this migration.
REVOKE EXECUTE ON FUNCTION public.expire_lapsed_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscriptions() TO authenticated, service_role;