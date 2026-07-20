-- pgTAP: transactions immutability
-- Run against a throwaway DB with migrations applied.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- Seed a subscriber + a posted transaction owned by a synthetic user.
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_sub  uuid;
BEGIN
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user, 'pgtap-tx', 'PGTAP-TX-1', ARRAY['cable'])
    RETURNING id INTO v_sub;
  INSERT INTO public.transactions (id, user_id, subscriber_id, type, amount, date, source, status, description)
    VALUES ('11111111-1111-1111-1111-111111111111', v_user, v_sub,
            'payment', 100, now(), 'collection', 'posted', 'seed');
END $$;

-- 1. DELETE must fail.
SELECT throws_ok(
  $$ DELETE FROM public.transactions WHERE id = '11111111-1111-1111-1111-111111111111' $$,
  'check_violation',
  NULL,
  'transactions cannot be deleted'
);

-- 2. UPDATE of protected column (amount) must fail.
SELECT throws_ok(
  $$ UPDATE public.transactions SET amount = 999
     WHERE id = '11111111-1111-1111-1111-111111111111' $$,
  'check_violation',
  NULL,
  'transactions.amount is immutable'
);

-- 3. Status jump to something other than voided must fail.
SELECT throws_ok(
  $$ UPDATE public.transactions SET status = 'reversal'
     WHERE id = '11111111-1111-1111-1111-111111111111' $$,
  'check_violation',
  NULL,
  'only posted → voided is allowed'
);

-- 4. posted → voided (with reason) must succeed IF the caller has the role.
--    Called with auth.uid() = NULL, the void-role trigger will raise 42501.
SELECT throws_ok(
  $$ UPDATE public.transactions
       SET status = 'voided', void_reason = 'test void'
     WHERE id = '11111111-1111-1111-1111-111111111111' $$,
  '42501',
  NULL,
  'void requires can_void_transaction'
);

SELECT * FROM finish();
ROLLBACK;
