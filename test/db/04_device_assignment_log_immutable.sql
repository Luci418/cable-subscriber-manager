-- pgTAP: device_assignment_log immutability + credential freeze after close
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_sub  uuid;
  v_dev  uuid;
BEGIN
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user, 'pgtap-dev', 'PGTAP-DEV-1', ARRAY['cable'])
    RETURNING id INTO v_sub;
  INSERT INTO public.stb_inventory (id, user_id, serial_number, device_type, status)
    VALUES (gen_random_uuid(), v_user, 'PGTAP-STB-1', 'stb', 'assigned')
    RETURNING id INTO v_dev;
  INSERT INTO public.device_assignment_log
    (id, user_id, subscriber_id, device_id, serial_number, device_type, service_type, opened_at)
  VALUES ('44444444-4444-4444-4444-444444444444', v_user, v_sub, v_dev,
          'PGTAP-STB-1', 'stb', 'cable', now());
END $$;

-- 1. DELETE must fail.
SELECT throws_ok(
  $$ DELETE FROM public.device_assignment_log WHERE id = '44444444-4444-4444-4444-444444444444' $$,
  'check_violation',
  NULL,
  'device assignment log cannot be deleted'
);

-- 2. UPDATE of a protected column (serial_number) must fail.
SELECT throws_ok(
  $$ UPDATE public.device_assignment_log SET serial_number = 'HACK'
     WHERE id = '44444444-4444-4444-4444-444444444444' $$,
  'check_violation',
  NULL,
  'serial_number is immutable'
);

-- 3. Credential update on an OPEN row must succeed.
SELECT lives_ok(
  $$ UPDATE public.device_assignment_log SET wifi_ssid = 'HomeNet'
     WHERE id = '44444444-4444-4444-4444-444444444444' $$,
  'credentials can be edited while assignment is open'
);

-- 4. After closing, credential update must fail.
DO $$ BEGIN
  UPDATE public.device_assignment_log
     SET closed_at = now(), close_reason = 'test'
   WHERE id = '44444444-4444-4444-4444-444444444444';
END $$;

SELECT throws_ok(
  $$ UPDATE public.device_assignment_log SET wifi_ssid = 'AfterClose'
     WHERE id = '44444444-4444-4444-4444-444444444444' $$,
  'check_violation',
  NULL,
  'credentials are frozen once assignment is closed'
);

SELECT * FROM finish();
ROLLBACK;
