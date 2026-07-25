-- pgTAP: mark_device_faulty and mark_device_repaired (Sprint 2)
-- mark_device_faulty must close the assignment log and leave the
-- subscription row untouched. mark_device_repaired must accept an empty
-- repair note (regression from an earlier bug).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_sub   uuid;
  v_prov  uuid;
  v_pack  uuid;
  v_dev   uuid;
  v_sub_id uuid;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner, 'owner');

  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_owner, 'pgtap-md', 'PGTAP-MD-1', ARRAY['cable'])
    RETURNING id INTO v_sub;
  INSERT INTO public.providers (id, user_id, name, service_type, is_active)
    VALUES (gen_random_uuid(), v_owner, 'Prov', 'cable', true) RETURNING id INTO v_prov;
  INSERT INTO public.packs (id, user_id, name, price, channels, service_type, billing_type, provider_id, is_active)
    VALUES (gen_random_uuid(), v_owner, 'Pack', 300, '-', 'cable', 'postpaid', v_prov, true)
    RETURNING id INTO v_pack;
  INSERT INTO public.stb_inventory (id, user_id, serial, device_type, status, current_subscriber_id)
    VALUES (gen_random_uuid(), v_owner, 'DEV-MD-1', 'stb', 'assigned', v_sub) RETURNING id INTO v_dev;

  INSERT INTO public.device_assignment_log
    (id, user_id, device_id, subscriber_id, opened_at, opened_by, open_reason)
    VALUES (gen_random_uuid(), v_owner, v_dev, v_sub, now(), v_owner, 'installation');

  INSERT INTO public.subscriptions
    (id, user_id, subscriber_id, pack_id, service_type, device_id, status, start_date, monthly_charge)
    VALUES (gen_random_uuid(), v_owner, v_sub, v_pack, 'cable', v_dev, 'active', CURRENT_DATE, 300)
    RETURNING id INTO v_sub_id;

  PERFORM public.mark_device_faulty(v_dev, 'test-fault');

  PERFORM set_config('lovable.test_sub_id', v_sub_id::text, true);
  PERFORM set_config('lovable.test_dev', v_dev::text, true);
END $$;

-- 1. Subscription row is untouched — status still 'active'.
SELECT is(
  (SELECT status FROM public.subscriptions
   WHERE id = current_setting('lovable.test_sub_id')::uuid),
  'active',
  'mark_device_faulty does not change subscription status'
);

-- 2. Assignment log for this device is closed (closed_at IS NOT NULL).
SELECT ok(
  (SELECT bool_and(closed_at IS NOT NULL)
   FROM public.device_assignment_log
   WHERE device_id = current_setting('lovable.test_dev')::uuid),
  'mark_device_faulty closes the open assignment log row'
);

-- 3. mark_device_repaired accepts NULL / empty repair notes.
SELECT lives_ok(
  $$ SELECT public.mark_device_repaired(current_setting('lovable.test_dev')::uuid, '') $$,
  'mark_device_repaired accepts empty repair notes'
);

SELECT * FROM finish();
ROLLBACK;
