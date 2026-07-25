-- pgTAP: FIFO payment allocation (Sprint 2)
-- Seed a subscriber with two active cable subscriptions with distinct
-- start_dates. A default (non-targeted) payment must allocate to the
-- OLDER subscription first (FIFO by start_date).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(2);

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_sub   uuid;
  v_prov  uuid;
  v_pack  uuid;
  v_dev_a uuid;
  v_dev_b uuid;
  v_sub_a uuid;
  v_sub_b uuid;
  v_tx    uuid;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner, 'owner');

  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_owner, 'pgtap-fifo', 'PGTAP-FIFO-1', ARRAY['cable'])
    RETURNING id INTO v_sub;
  INSERT INTO public.providers (id, user_id, name, service_type, is_active)
    VALUES (gen_random_uuid(), v_owner, 'Prov', 'cable', true) RETURNING id INTO v_prov;
  INSERT INTO public.packs (id, user_id, name, price, channels, service_type, billing_type, provider_id, is_active)
    VALUES (gen_random_uuid(), v_owner, 'Pack', 300, '-', 'cable', 'postpaid', v_prov, true)
    RETURNING id INTO v_pack;

  INSERT INTO public.stb_inventory (id, user_id, serial, device_type, status, current_subscriber_id)
    VALUES (gen_random_uuid(), v_owner, 'DEV-F-A', 'stb', 'assigned', v_sub) RETURNING id INTO v_dev_a;
  INSERT INTO public.stb_inventory (id, user_id, serial, device_type, status, current_subscriber_id)
    VALUES (gen_random_uuid(), v_owner, 'DEV-F-B', 'stb', 'assigned', v_sub) RETURNING id INTO v_dev_b;

  -- Older subscription (should receive the payment first).
  INSERT INTO public.subscriptions
    (id, user_id, subscriber_id, pack_id, service_type, device_id, status, start_date, monthly_charge)
    VALUES (gen_random_uuid(), v_owner, v_sub, v_pack, 'cable', v_dev_a, 'active',
            CURRENT_DATE - INTERVAL '30 days', 300)
    RETURNING id INTO v_sub_a;
  -- Newer subscription.
  INSERT INTO public.subscriptions
    (id, user_id, subscriber_id, pack_id, service_type, device_id, status, start_date, monthly_charge)
    VALUES (gen_random_uuid(), v_owner, v_sub, v_pack, 'cable', v_dev_b, 'active',
            CURRENT_DATE - INTERVAL '5 days', 300)
    RETURNING id INTO v_sub_b;

  INSERT INTO public.transactions
    (id, user_id, subscriber_id, type, amount, date, source, status, description, payment_method)
    VALUES (gen_random_uuid(), v_owner, v_sub, 'payment', 300, now(),
            'collection', 'posted', 'fifo-test', 'cash')
    RETURNING id INTO v_tx;

  PERFORM set_config('lovable.sub_a', v_sub_a::text, true);
  PERFORM set_config('lovable.sub_b', v_sub_b::text, true);
  PERFORM set_config('lovable.tx',    v_tx::text,    true);
END $$;

-- 1. An allocation row exists against the OLDER subscription.
SELECT ok(
  (SELECT EXISTS (
     SELECT 1 FROM public.payment_allocations
      WHERE transaction_id = current_setting('lovable.tx')::uuid
        AND subscription_id = current_setting('lovable.sub_a')::uuid
   )),
  'FIFO: allocation lands on the older subscription'
);

-- 2. The newer subscription received nothing (payment of 300 fully
--    consumed by the older one whose charge is 300).
SELECT is(
  (SELECT count(*) FROM public.payment_allocations
    WHERE transaction_id = current_setting('lovable.tx')::uuid
      AND subscription_id = current_setting('lovable.sub_b')::uuid),
  0::bigint,
  'FIFO: newer subscription is not allocated when the older one absorbs the full payment'
);

SELECT * FROM finish();
ROLLBACK;
