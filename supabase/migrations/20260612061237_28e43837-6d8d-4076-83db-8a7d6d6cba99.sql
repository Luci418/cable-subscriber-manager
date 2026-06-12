
-- Phase 3.5 — Customer status enum (INV-02: operator-set, never trigger-overwritten)

-- 1. Enum type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_status') THEN
    CREATE TYPE public.customer_status AS ENUM ('prospect', 'active', 'archived');
  END IF;
END$$;

-- 2. Column with default 'prospect'
ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS customer_status public.customer_status NOT NULL DEFAULT 'prospect';

-- 3. One-time seed: anything that has touched a subscription becomes 'active';
--    leave everything else as the default 'prospect'. Archived must be operator-set.
UPDATE public.subscribers
   SET customer_status = 'active'
 WHERE customer_status = 'prospect'
   AND (
        current_subscription IS NOT NULL
     OR internet_subscription IS NOT NULL
     OR COALESCE(array_length(subscription_history, 1), 0) > 0
     OR COALESCE(array_length(internet_subscription_history, 1), 0) > 0
   );

-- 4. Helpful index for filtering subscriber lists by status
CREATE INDEX IF NOT EXISTS idx_subscribers_customer_status
  ON public.subscribers(user_id, customer_status);
