
-- 1. Drop the internal QA test log table (publicly readable, no longer needed)
DROP TABLE IF EXISTS public.__qa_run_log;

-- 2. Pin search_path on the two helpers that were missing it
ALTER FUNCTION public.is_pack_in_use(text) SET search_path = public;
ALTER FUNCTION public.is_region_in_use(text) SET search_path = public;
ALTER FUNCTION public.transaction_notes_enforce_immutability() SET search_path = public;

-- 3. Revoke EXECUTE from anon/authenticated/public on SECURITY DEFINER functions
--    that are trigger bodies or purely internal helpers. They run via triggers
--    or other SECURITY DEFINER functions; they must never be callable via the
--    PostgREST API.
DO $$
DECLARE
  fn text;
  internal_fns text[] := ARRAY[
    'public.handle_new_user()',
    'public.update_updated_at_column()',
    'public.transactions_enforce_immutability()',
    'public.transactions_audit_stamp()',
    'public.transactions_fifo_allocate_trg()',
    'public.transactions_recalc_balance_trg()',
    'public.subscriptions_enforce_invariants()',
    'public.subscribers_enforce_invariants()',
    'public.sync_stb_inventory_on_subscriber_change()',
    'public.payment_allocations_enforce_immutability()',
    'public.transaction_notes_enforce_immutability()',
    'public.recalc_subscriber_balance(uuid, text)'
  ];
BEGIN
  FOREACH fn IN ARRAY internal_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- 4. Revoke from anon on RPCs that require an authenticated session. They
--    all check auth.uid() internally but should not even appear callable to
--    unauthenticated clients.
REVOKE ALL ON FUNCTION public.cancel_subscription(uuid, text, numeric, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_subscription(uuid, text, uuid, integer, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pair_device(uuid, uuid, text)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unpair_device(uuid, uuid, text, text)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_device(uuid, text, text, text)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_transaction(uuid, void_reason_code, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_settings_row()                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_subscriber_id(text)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_subscriber_deletable(uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_provider_in_use(uuid)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_pack_in_use(text)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_region_in_use(text)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reconcile_stb_inventory()                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_lapsed_subscriptions()                          FROM PUBLIC, anon;

-- Ensure authenticated users can still call the operator-facing RPCs
GRANT EXECUTE ON FUNCTION public.cancel_subscription(uuid, text, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_subscription(uuid, text, uuid, integer, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.pair_device(uuid, uuid, text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_device(uuid, uuid, text, text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_device(uuid, text, text, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_transaction(uuid, void_reason_code, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_settings_row()                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_subscriber_id(text)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_subscriber_deletable(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_provider_in_use(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pack_in_use(text)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_region_in_use(text)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stb_inventory()                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscriptions()                          TO authenticated;
