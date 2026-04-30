
-- 1. SUBSCRIBERS: services array, rename balance, add internet fields
ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT ARRAY['cable']::TEXT[];

ALTER TABLE public.subscribers
  RENAME COLUMN balance TO cable_balance;

ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS internet_balance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_internet_pack TEXT,
  ADD COLUMN IF NOT EXISTS internet_subscription JSONB,
  ADD COLUMN IF NOT EXISTS internet_subscription_history JSONB[] DEFAULT ARRAY[]::JSONB[];

-- 2. PACKS: service type
ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'cable'
    CHECK (service_type IN ('cable', 'internet'));

-- 3. TRANSACTIONS: service type
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'cable'
    CHECK (service_type IN ('cable', 'internet'));

-- 4. STB_INVENTORY: device type + service type
ALTER TABLE public.stb_inventory
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'stb'
    CHECK (device_type IN ('stb', 'onu', 'router')),
  ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'cable'
    CHECK (service_type IN ('cable', 'internet'));

-- 5. Update is_pack_in_use to consider both cable and internet packs
CREATE OR REPLACE FUNCTION public.is_pack_in_use(pack_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.subscribers
    WHERE (current_pack = pack_name OR current_internet_pack = pack_name)
      AND user_id = auth.uid()
  )
$function$;

-- 6. Update expire_lapsed_subscriptions to handle internet subs as well
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer := 0;
  rec record;
  cur_sub jsonb;
  hist jsonb;
  expired_sub jsonb;
  exists_in_hist boolean;
BEGIN
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
