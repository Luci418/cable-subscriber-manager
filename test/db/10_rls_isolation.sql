-- pgTAP: RLS cross-user isolation (Sprint 2)
-- User A must not see or mutate user B's subscribers, subscriptions or
-- transactions. We simulate auth.uid() with local settings and switch to
-- the "authenticated" role for RLS to apply.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_sub_b  uuid;
  v_tx_b   uuid;
BEGIN
  -- Seed user B's data as postgres (bypass RLS).
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user_b, 'user-b-sub', 'PGTAP-RLS-B', ARRAY['cable'])
    RETURNING id INTO v_sub_b;
  INSERT INTO public.transactions
    (id, user_id, subscriber_id, type, amount, date, source, status, description)
    VALUES (gen_random_uuid(), v_user_b, v_sub_b, 'payment', 100, now(), 'collection', 'posted', 'b-only')
    RETURNING id INTO v_tx_b;

  PERFORM set_config('lovable.user_a', v_user_a::text, true);
  PERFORM set_config('lovable.user_b', v_user_b::text, true);
  PERFORM set_config('lovable.sub_b',  v_sub_b::text,  true);
  PERFORM set_config('lovable.tx_b',   v_tx_b::text,   true);
END $$;

-- Impersonate user A via request.jwt.claims (Supabase-compatible).
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('lovable.user_a'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

-- 1. As user A, we cannot see user B's subscriber row.
SELECT is(
  (SELECT count(*) FROM public.subscribers
     WHERE id = current_setting('lovable.sub_b')::uuid),
  0::bigint,
  'user A cannot read user B subscribers under RLS'
);

-- 2. As user A, we cannot see user B's transaction row.
SELECT is(
  (SELECT count(*) FROM public.transactions
     WHERE id = current_setting('lovable.tx_b')::uuid),
  0::bigint,
  'user A cannot read user B transactions under RLS'
);

-- 3. Attempting to insert a subscriber row impersonating user B fails.
SELECT throws_ok(
  $$ INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
     VALUES (gen_random_uuid(),
             current_setting('lovable.user_b')::uuid,
             'a-tries-b', 'PGTAP-RLS-EVIL', ARRAY['cable']) $$,
  '42501', NULL,
  'user A cannot insert a row owned by user B'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
