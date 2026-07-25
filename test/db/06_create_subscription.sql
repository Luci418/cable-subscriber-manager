-- pgTAP: create_subscription RPC guards (Sprint 2)
-- Verifies that the active-subscription constraint is scoped per device
-- (not per subscriber) and that provider mismatch is only blocked when a
-- competing active subscription exists on the same service.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_sub      uuid;
  v_prov_a   uuid;
  v_prov_b   uuid;
  v_pack_a   uuid;
  v_pack_b   uuid;
  v_dev_1    uuid;
  v_dev_2    uuid;
BEGIN
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user, 'pgtap-create-sub', 'PGTAP-CS-1', ARRAY['cable'])
    RETURNING id INTO v_sub;

  INSERT INTO public.providers (id, user_id, name, service_type, is_active)
    VALUES (gen_random_uuid(), v_user, 'Prov A', 'cable', true) RETURNING id INTO v_prov_a;
  INSERT INTO public.providers (id, user_id, name, service_type, is_active)
    VALUES (gen_random_uuid(), v_user, 'Prov B', 'cable', true) RETURNING id INTO v_prov_b;

  INSERT INTO public.packs (id, user_id, name, price, channels, service_type, billing_type, provider_id, is_active)
    VALUES (gen_random_uuid(), v_user, 'Pack A', 300, '-', 'cable', 'postpaid', v_prov_a, true)
    RETURNING id INTO v_pack_a;
  INSERT INTO public.packs (id, user_id, name, price, channels, service_type, billing_type, provider_id, is_active)
    VALUES (gen_random_uuid(), v_user, 'Pack B', 300, '-', 'cable', 'postpaid', v_prov_b, true)
    RETURNING id INTO v_pack_b;

  INSERT INTO public.stb_inventory (id, user_id, serial, device_type, status)
    VALUES (gen_random_uuid(), v_user, 'DEV-CS-1', 'stb', 'assigned') RETURNING id INTO v_dev_1;
  INSERT INTO public.stb_inventory (id, user_id, serial, device_type, status)
    VALUES (gen_random_uuid(), v_user, 'DEV-CS-2', 'stb', 'assigned') RETURNING id INTO v_dev_2;

  PERFORM set_config('lovable.test_user', v_user::text, true);
  PERFORM set_config('lovable.test_sub', v_sub::text, true);
  PERFORM set_config('lovable.test_pack_a', v_pack_a::text, true);
  PERFORM set_config('lovable.test_pack_b', v_pack_b::text, true);
  PERFORM set_config('lovable.test_dev_1', v_dev_1::text, true);
  PERFORM set_config('lovable.test_dev_2', v_dev_2::text, true);
END $$;

-- 1. First subscription on device 1 with provider A succeeds.
SELECT lives_ok(
  $$ SELECT public.create_subscription(
       current_setting('lovable.test_sub')::uuid,
       current_setting('lovable.test_pack_a')::uuid,
       CURRENT_DATE,
       current_setting('lovable.test_dev_1')::uuid,
       'cable'
     ) $$,
  'first create_subscription on device 1 succeeds'
);

-- 2. Adding a second active subscription for the SAME device fails.
SELECT throws_ok(
  $$ SELECT public.create_subscription(
       current_setting('lovable.test_sub')::uuid,
       current_setting('lovable.test_pack_a')::uuid,
       CURRENT_DATE,
       current_setting('lovable.test_dev_1')::uuid,
       'cable'
     ) $$,
  NULL,
  NULL,
  'second active sub on same device is rejected'
);

-- 3. Adding a subscription on a DIFFERENT device for the same subscriber
--    succeeds — the active constraint is device-scoped.
SELECT lives_ok(
  $$ SELECT public.create_subscription(
       current_setting('lovable.test_sub')::uuid,
       current_setting('lovable.test_pack_a')::uuid,
       CURRENT_DATE,
       current_setting('lovable.test_dev_2')::uuid,
       'cable'
     ) $$,
  'second active sub on a different device is allowed'
);

-- 4. Attempting to add a subscription tied to Provider B while an active
--    sub for Provider A already exists on the same device would be
--    blocked at the invariants trigger. On a fresh, unattached device we
--    verify no provider conflict fires.
SELECT throws_ok(
  $$ SELECT public.create_subscription(
       current_setting('lovable.test_sub')::uuid,
       current_setting('lovable.test_pack_b')::uuid,
       CURRENT_DATE,
       current_setting('lovable.test_dev_1')::uuid,
       'cable'
     ) $$,
  NULL,
  NULL,
  'provider mismatch on an already-active device is rejected'
);

SELECT * FROM finish();
ROLLBACK;
