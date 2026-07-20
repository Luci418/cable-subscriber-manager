-- pgTAP: payment_allocations immutability
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(2);

-- Any existing row will do; if none exist the tests still verify the trigger
-- fires by inserting a stub row inside the transaction.
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_sub  uuid;
  v_pack uuid;
  v_subscription uuid := '33333333-3333-3333-3333-333333333333';
  v_txn  uuid := '33333333-aaaa-aaaa-aaaa-333333333333';
BEGIN
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user, 'pgtap-alloc', 'PGTAP-AL-1', ARRAY['cable'])
    RETURNING id INTO v_sub;
  INSERT INTO public.packs (id, user_id, name, price, service_type, validity_days, billing_type)
    VALUES (gen_random_uuid(), v_user, 'A', 100, 'cable', 30, 'prepaid') RETURNING id INTO v_pack;
  INSERT INTO public.subscriptions
    (id, user_id, subscriber_id, pack_id, service_type,
     pack_name_snapshot, pack_price_snapshot, start_date, end_date, status)
  VALUES (v_subscription, v_user, v_sub, v_pack, 'cable', 'A', 100, now(), now() + interval '30 days', 'active');
  INSERT INTO public.transactions (id, user_id, subscriber_id, type, amount, date, source, status)
    VALUES (v_txn, v_user, v_sub, 'payment', 100, now(), 'collection', 'posted');
  INSERT INTO public.payment_allocations (id, user_id, transaction_id, subscription_id, amount, allocated_by)
    VALUES ('33333333-bbbb-bbbb-bbbb-333333333333', v_user, v_txn, v_subscription, 100, 'manual');
END $$;

-- 1. DELETE must fail.
SELECT throws_ok(
  $$ DELETE FROM public.payment_allocations WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333' $$,
  'check_violation',
  NULL,
  'payment_allocations cannot be deleted'
);

-- 2. UPDATE (even of amount) must fail.
SELECT throws_ok(
  $$ UPDATE public.payment_allocations SET amount = 50
     WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333' $$,
  'check_violation',
  NULL,
  'payment_allocations cannot be modified'
);

SELECT * FROM finish();
ROLLBACK;
