-- pgTAP: subscriptions immutability
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_sub  uuid;
  v_pack uuid;
BEGIN
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user, 'pgtap-sub', 'PGTAP-SUB-1', ARRAY['cable'])
    RETURNING id INTO v_sub;
  INSERT INTO public.packs (id, user_id, name, price, service_type, validity_days, billing_type)
    VALUES (gen_random_uuid(), v_user, 'Test Pack', 300, 'cable', 30, 'prepaid')
    RETURNING id INTO v_pack;
  INSERT INTO public.subscriptions
    (id, user_id, subscriber_id, pack_id, service_type,
     pack_name_snapshot, pack_price_snapshot, start_date, end_date, status)
  VALUES ('22222222-2222-2222-2222-222222222222', v_user, v_sub, v_pack, 'cable',
          'Test Pack', 300, now(), now() + interval '30 days', 'active');
END $$;

-- 1. DELETE must fail.
SELECT throws_ok(
  $$ DELETE FROM public.subscriptions WHERE id = '22222222-2222-2222-2222-222222222222' $$,
  'check_violation',
  NULL,
  'subscriptions cannot be deleted'
);

-- 2. UPDATE of protected column (pack_price_snapshot) must fail.
SELECT throws_ok(
  $$ UPDATE public.subscriptions SET pack_price_snapshot = 999
     WHERE id = '22222222-2222-2222-2222-222222222222' $$,
  'check_violation',
  NULL,
  'pack_price_snapshot is immutable'
);

-- 3. UPDATE of whitelisted lifecycle column (status) must succeed.
SELECT lives_ok(
  $$ UPDATE public.subscriptions
       SET status = 'cancelled', cancelled_at = now(), refund_amount = 0
     WHERE id = '22222222-2222-2222-2222-222222222222' $$,
  'lifecycle columns are mutable'
);

SELECT * FROM finish();
ROLLBACK;
