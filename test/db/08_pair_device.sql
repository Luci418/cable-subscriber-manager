-- pgTAP: pair_device role + service-type guards (Sprint 2)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(2);

DO $$
DECLARE
  v_agent uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_sub   uuid;
  v_dev   uuid;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_agent, 'collection_agent'),
    (v_owner, 'owner');

  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_owner, 'pgtap-pair', 'PGTAP-PR-1', ARRAY['internet'])
    RETURNING id INTO v_sub;

  -- A cable STB — will be used against an internet-only subscriber.
  INSERT INTO public.stb_inventory (id, user_id, serial, device_type, status)
    VALUES (gen_random_uuid(), v_owner, 'DEV-PR-STB', 'stb', 'available')
    RETURNING id INTO v_dev;

  PERFORM set_config('lovable.test_sub', v_sub::text, true);
  PERFORM set_config('lovable.test_dev', v_dev::text, true);
END $$;

-- 1. auth.uid() is NULL → collection_agent perms cannot be seen; helper
--    rejects the call. This equally proves the "no role" path.
SELECT throws_ok(
  $$ SELECT public.pair_device(
       current_setting('lovable.test_sub')::uuid,
       current_setting('lovable.test_dev')::uuid,
       'installation'
     ) $$,
  '42501', NULL,
  'pair_device rejects callers without pairing permission'
);

-- 2. Pairing a cable STB to an internet-only subscriber must fail on the
--    service-type invariant even when the caller is permitted.
SELECT throws_ok(
  $$ SELECT public.pair_device(
       current_setting('lovable.test_sub')::uuid,
       current_setting('lovable.test_dev')::uuid,
       'installation'
     ) $$,
  NULL, NULL,
  'pair_device rejects a device whose type does not match subscriber services'
);

SELECT * FROM finish();
ROLLBACK;
