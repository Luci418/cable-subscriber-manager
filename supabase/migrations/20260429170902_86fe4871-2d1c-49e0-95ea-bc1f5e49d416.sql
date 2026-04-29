-- Enable required extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function: eagerly expire subscriptions whose endDate has passed.
-- Moves expired current_subscription into subscription_history with status='expired'
-- and clears current_pack/current_subscription. Runs across ALL users (no RLS bypass needed for service role / definer).
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
  rec record;
  cur_sub jsonb;
  hist jsonb;
  expired_sub jsonb;
  exists_in_hist boolean;
BEGIN
  FOR rec IN
    SELECT id, current_subscription, subscription_history
    FROM public.subscribers
    WHERE current_subscription IS NOT NULL
      AND (current_subscription->>'endDate')::timestamptz <= now()
  LOOP
    cur_sub := rec.current_subscription;
    hist := COALESCE(to_jsonb(rec.subscription_history), '[]'::jsonb);

    expired_sub := cur_sub || jsonb_build_object('status', 'expired');

    -- Check if this subscription id already exists in history
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(hist) e
      WHERE e->>'id' = cur_sub->>'id'
    ) INTO exists_in_hist;

    IF exists_in_hist THEN
      -- Replace the matching entry
      hist := (
        SELECT jsonb_agg(
          CASE WHEN e->>'id' = cur_sub->>'id' THEN expired_sub ELSE e END
        )
        FROM jsonb_array_elements(hist) e
      );
    ELSE
      hist := hist || jsonb_build_array(expired_sub);
    END IF;

    UPDATE public.subscribers
    SET
      current_subscription = NULL,
      current_pack = NULL,
      subscription_history = ARRAY(SELECT jsonb_array_elements(hist))::jsonb[],
      updated_at = now()
    WHERE id = rec.id;

    affected := affected + 1;
  END LOOP;

  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_lapsed_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscriptions() TO service_role;

-- Schedule it to run every hour
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-lapsed-subscriptions-hourly') THEN
    PERFORM cron.unschedule('expire-lapsed-subscriptions-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'expire-lapsed-subscriptions-hourly',
  '0 * * * *',
  $$ SELECT public.expire_lapsed_subscriptions(); $$
);