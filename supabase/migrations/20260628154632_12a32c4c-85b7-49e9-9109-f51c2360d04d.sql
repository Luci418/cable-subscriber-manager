-- 1. Tighten reconcile_stb_inventory permissions: no frontend caller, admin/maintenance only.
REVOKE EXECUTE ON FUNCTION public.reconcile_stb_inventory() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.reconcile_stb_inventory() TO service_role;

-- expire_lapsed_subscriptions intentionally retains EXECUTE TO authenticated
-- because useSubscribers calls it as lazy cleanup on every subscriber list load.

-- 2. Add the opening_balance source for the historical/paper-ledger cutover path
--    specified in BUSINESS_MODEL.md (§1631, row 2019). payment_allocations.allocated_by
--    already accepts 'opening_balance'; this aligns transactions.source with it.
ALTER TYPE public.transaction_source ADD VALUE IF NOT EXISTS 'opening_balance';