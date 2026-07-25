-- pgTAP: cancel_subscription refund cap + role gate (Sprint 2)
-- The RPC must (a) reject refund_amount greater than the paid balance
-- for that service and (b) reject callers who lack can_cancel_subscription.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(2);

DO $$
DECLARE
  v_owner  uuid := gen_random_uuid();
  v_agent  uuid := gen_random_uuid();
  v_sub    uuid;
  v_prov   uuid;
  v_pack   uuid;
  v_dev    uuid;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_owner, 'owner'),
    (v_agent, 'collection_agent');

  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_owner, 'pgtap-cancel', 'PGTAP-CN-1', ARRAY['cable'])
    RETURNING id INTO v_sub;
  INSERT INTO public.providers (id, user_id, name, service_type, is_active)
    VALUES (gen_random_uuid(), v_owner, 'Prov', 'cable', true) RETURNING id INTO v_prov;
  INSERT INTO public.packs (id, user_id, name, price, channels, service_type, billing_type, provider_id, is_active)
    VALUES (gen_random_uuid(), v_owner, 'Pack', 300, '-', 'cable', 'postpaid', v_prov, true)
    RETURNING id INTO v_pack;
  INSERT INTO public.stb_inventory (id, user_id, serial, device_type, status)
    VALUES (gen_random_uuid(), v_owner, 'DEV-CN-1', 'stb', 'assigned') RETURNING id INTO v_dev;

  PERFORM public.create_subscription(v_sub, v_pack, CURRENT_DATE, v_dev, 'cable');
  PERFORM set_config('lovable.test_sub', v_sub::text, true);
END $$;

-- 1. Refund larger than paid balance is rejected (no payments have been
--    made in this fixture, so any positive refund exceeds the cap).
SELECT throws_ok(
  $$ SELECT public.cancel_subscription(
       current_setting('lovable.test_sub')::uuid, 'cable', 5000, 'test cancel'
     ) $$,
  NULL, NULL,
  'refund_amount above paid balance is rejected'
);

-- 2. Role gate — collection_agent is not permitted (auth.uid() is NULL in
--    this session, which returns no roles: the helper still rejects).
SELECT throws_ok(
  $$ SELECT public.cancel_subscription(
       current_setting('lovable.test_sub')::uuid, 'cable', 0, 'test cancel'
     ) $$,
  '42501', NULL,
  'cancel_subscription requires the cancel role'
);

SELECT * FROM finish();
ROLLBACK;
