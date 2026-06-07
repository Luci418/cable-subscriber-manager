
-- =========================================================
-- C2: Drop unused billing_history table
-- =========================================================
DROP TABLE IF EXISTS public.billing_history CASCADE;

-- =========================================================
-- A2-min: Audit columns on transactions
-- =========================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS edited_at  timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by  uuid;

-- Default created_by to auth.uid() on insert; stamp edited_at/by on update
CREATE OR REPLACE FUNCTION public.transactions_audit_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.edited_at := now();
    NEW.edited_by := COALESCE(auth.uid(), NEW.edited_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_audit_stamp_trg ON public.transactions;
CREATE TRIGGER transactions_audit_stamp_trg
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.transactions_audit_stamp();

-- =========================================================
-- A1: Automatic balance recalculation from the ledger
-- =========================================================
-- Sign convention: charge/refund => +amount (debt), payment => -amount.
CREATE OR REPLACE FUNCTION public.recalc_subscriber_balance(
  p_subscriber_id uuid,
  p_service_type  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_svc     text := COALESCE(p_service_type, 'cable');
BEGIN
  IF p_subscriber_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           CASE WHEN type = 'payment' THEN -amount ELSE amount END
         ), 0)
    INTO v_balance
    FROM public.transactions
   WHERE subscriber_id = p_subscriber_id
     AND COALESCE(service_type, 'cable') = v_svc;

  IF v_svc = 'internet' THEN
    UPDATE public.subscribers
       SET internet_balance = v_balance,
           updated_at = now()
     WHERE id = p_subscriber_id
       AND internet_balance IS DISTINCT FROM v_balance;
  ELSE
    UPDATE public.subscribers
       SET cable_balance = v_balance,
           updated_at = now()
     WHERE id = p_subscriber_id
       AND cable_balance IS DISTINCT FROM v_balance;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.transactions_recalc_balance_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalc_subscriber_balance(NEW.subscriber_id, COALESCE(NEW.service_type, 'cable'));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_subscriber_balance(OLD.subscriber_id, COALESCE(OLD.service_type, 'cable'));
  ELSIF TG_OP = 'UPDATE' THEN
    -- Recompute both the old and new service line in case service_type or subscriber changed.
    PERFORM public.recalc_subscriber_balance(OLD.subscriber_id, COALESCE(OLD.service_type, 'cable'));
    IF NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
       OR COALESCE(NEW.service_type, 'cable') IS DISTINCT FROM COALESCE(OLD.service_type, 'cable') THEN
      PERFORM public.recalc_subscriber_balance(NEW.subscriber_id, COALESCE(NEW.service_type, 'cable'));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS transactions_recalc_balance ON public.transactions;
CREATE TRIGGER transactions_recalc_balance
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.transactions_recalc_balance_trg();

-- One-time backfill: recompute all balances from the ledger.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT subscriber_id, COALESCE(service_type, 'cable') AS svc
      FROM public.transactions
  LOOP
    PERFORM public.recalc_subscriber_balance(r.subscriber_id, r.svc);
  END LOOP;
END $$;

-- =========================================================
-- A4: Concurrent-safe subscriber ID generation
-- =========================================================
CREATE OR REPLACE FUNCTION public.generate_subscriber_id(p_region_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_prefix  text;
  v_first   text;
  v_max     int := 0;
  v_next    int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Build prefix: first whitespace/hyphen/underscore-delimited token,
  -- alphanumeric only, uppercase, max 10 chars (mirrors client logic).
  v_first := split_part(COALESCE(NULLIF(trim(p_region_name), ''), 'DEFAULT'), ' ', 1);
  v_first := split_part(v_first, '-', 1);
  v_first := split_part(v_first, '_', 1);
  v_prefix := upper(regexp_replace(v_first, '[^A-Za-z0-9]', '', 'g'));
  v_prefix := left(COALESCE(NULLIF(v_prefix, ''), 'DEFAULT'), 10);

  -- Per-(user, prefix) advisory lock so two concurrent inserts serialize.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|' || v_prefix, 0)
  );

  SELECT COALESCE(MAX((regexp_match(subscriber_id, '^' || v_prefix || '-(\d+)$'))[1]::int), 0)
    INTO v_max
    FROM public.subscribers
   WHERE user_id = v_user_id
     AND subscriber_id ~ ('^' || v_prefix || '-\d+$');

  v_next := v_max + 1;
  RETURN v_prefix || '-' || lpad(v_next::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_subscriber_id(text) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_subscriber_id(text) TO authenticated;

-- =========================================================
-- I3: Advisory lock in expire_lapsed_subscriptions
-- =========================================================
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  affected integer := 0;
  rec record;
  cur_sub jsonb;
  hist jsonb;
  expired_sub jsonb;
  exists_in_hist boolean;
BEGIN
  -- Serialize concurrent runs (hourly cron + UI trigger) for this transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('expire_lapsed_subscriptions', 0));

  -- Cable subscriptions
  FOR rec IN
    SELECT id, current_subscription, subscription_history
    FROM public.subscribers
    WHERE current_subscription IS NOT NULL
      AND (current_subscription->>'endDate')::timestamptz <= now()
  LOOP
    cur_sub := rec.current_subscription;
    hist := COALESCE(to_jsonb(rec.subscription_history), '[]'::jsonb);
    expired_sub := cur_sub || jsonb_build_object('status', 'expired');

    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(hist) e WHERE e->>'id' = cur_sub->>'id'
    ) INTO exists_in_hist;

    IF exists_in_hist THEN
      hist := (
        SELECT jsonb_agg(CASE WHEN e->>'id' = cur_sub->>'id' THEN expired_sub ELSE e END)
        FROM jsonb_array_elements(hist) e
      );
    ELSE
      hist := hist || jsonb_build_array(expired_sub);
    END IF;

    UPDATE public.subscribers
    SET current_subscription = NULL,
        current_pack = NULL,
        subscription_history = ARRAY(SELECT jsonb_array_elements(hist))::jsonb[],
        updated_at = now()
    WHERE id = rec.id;
    affected := affected + 1;
  END LOOP;

  -- Internet subscriptions
  FOR rec IN
    SELECT id, internet_subscription, internet_subscription_history
    FROM public.subscribers
    WHERE internet_subscription IS NOT NULL
      AND (internet_subscription->>'endDate')::timestamptz <= now()
  LOOP
    cur_sub := rec.internet_subscription;
    hist := COALESCE(to_jsonb(rec.internet_subscription_history), '[]'::jsonb);
    expired_sub := cur_sub || jsonb_build_object('status', 'expired');

    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(hist) e WHERE e->>'id' = cur_sub->>'id'
    ) INTO exists_in_hist;

    IF exists_in_hist THEN
      hist := (
        SELECT jsonb_agg(CASE WHEN e->>'id' = cur_sub->>'id' THEN expired_sub ELSE e END)
        FROM jsonb_array_elements(hist) e
      );
    ELSE
      hist := hist || jsonb_build_array(expired_sub);
    END IF;

    UPDATE public.subscribers
    SET internet_subscription = NULL,
        current_internet_pack = NULL,
        internet_subscription_history = ARRAY(SELECT jsonb_array_elements(hist))::jsonb[],
        updated_at = now()
    WHERE id = rec.id;
    affected := affected + 1;
  END LOOP;

  RETURN affected;
END;
$function$;
