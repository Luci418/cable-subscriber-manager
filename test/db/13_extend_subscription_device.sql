-- pgTAP: extend_subscription device targeting for multi-connection subscribers.
--
-- Rules under test:
--   1. Single active subscription  → unchanged behaviour, device optional.
--   2. Multiple active subscriptions → the reported device selects the row.
--   3. Multiple active subscriptions + unresolved/foreign device → raises,
--      so commit_provider_import's per-row handler pushes it to failed_keys
--      instead of extending an arbitrary subscription.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_sub    uuid;
  v_prov   uuid;
  v_pack   uuid;
  v_dev_1  uuid;
  v_dev_2  uuid;
  v_dev_3  uuid;
BEGIN
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user, 'pgtap-extend', 'PGTAP-EX-1', ARRAY['cable'])
    RETURNING id INTO v_sub;

  INSERT INTO public.providers (id, user_id, name, service_type, is_active)
    VALUES (gen_random_uuid(), v_user, 'Prov X', 'cable', true) RETURNING id INTO v_prov;

  INSERT INTO public.packs (id, user_id, name, price, channels, service_type, billing_type, provider_id, is_active, validity_days)
    VALUES (gen_random_uuid(), v_user, 'Pack X', 300, '-', 'cable', 'postpaid', v_prov, true, 30)
    RETURNING id INTO v_pack;

  INSERT INTO public.stb_inventory (id, user_id, serial_number, device_type, service_type, status, subscriber_id)
    VALUES (gen_random_uuid(), v_user, 'DEV-EX-1', 'stb', 'cable', 'assigned', v_sub) RETURNING id INTO v_dev_1;
  INSERT INTO public.stb_inventory (id, user_id, serial_number, device_type, service_type, status, subscriber_id)
    VALUES (gen_random_uuid(), v_user, 'DEV-EX-2', 'stb', 'cable', 'assigned', v_sub) RETURNING id INTO v_dev_2;
  -- A device the subscriber does NOT hold a subscription on.
  INSERT INTO public.stb_inventory (id, user_id, serial_number, device_type, service_type, status)
    VALUES (gen_random_uuid(), v_user, 'DEV-EX-3', 'stb', 'cable', 'available') RETURNING id INTO v_dev_3;

  PERFORM set_config('lovable.test_user', v_user::text, true);
  PERFORM set_config('lovable.test_sub',  v_sub::text,  true);
  PERFORM set_config('lovable.test_pack', v_pack::text, true);
  PERFORM set_config('lovable.test_dev_1', v_dev_1::text, true);
  PERFORM set_config('lovable.test_dev_2', v_dev_2::text, true);
  PERFORM set_config('lovable.test_dev_3', v_dev_3::text, true);
END $$;

-- Baseline: one active subscription on device 1.
SELECT lives_ok(
  $$ SELECT public.create_subscription(
       current_setting('lovable.test_sub')::uuid, 'cable',
       current_setting('lovable.test_pack')::uuid, 1,
       current_setting('lovable.test_dev_1')::uuid) $$,
  'setup: first subscription created on device 1'
);

-- 1. Single active subscription: no device needed (today's behaviour).
SELECT lives_ok(
  $$ SELECT public.extend_subscription(
       current_setting('lovable.test_sub')::uuid, 'cable',
       current_setting('lovable.test_pack')::uuid, 1, NULL, NULL) $$,
  'single active subscription extends without a device (no regression)'
);

-- Second connection → subscriber now has two active cable subscriptions.
SELECT lives_ok(
  $$ SELECT public.create_subscription(
       current_setting('lovable.test_sub')::uuid, 'cable',
       current_setting('lovable.test_pack')::uuid, 1,
       current_setting('lovable.test_dev_2')::uuid) $$,
  'setup: second active subscription created on device 2'
);

-- 2/3. With two active subscriptions the device must disambiguate.
SELECT throws_ok(
  $$ SELECT public.extend_subscription(
       current_setting('lovable.test_sub')::uuid, 'cable',
       current_setting('lovable.test_pack')::uuid, 1, NULL,
       current_setting('lovable.test_dev_3')::uuid) $$,
  NULL,
  'multi-connection extend with an unmatched device raises instead of guessing'
);

SELECT * FROM finish();
ROLLBACK;
