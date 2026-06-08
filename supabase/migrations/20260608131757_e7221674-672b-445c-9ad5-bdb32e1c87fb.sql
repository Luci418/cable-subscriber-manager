-- ADR-011: Append-only transaction ledger — void / reversal model
-- Additive only. No data loss. Existing rows default to status='posted'.

-- 1. Status enum
DO $$ BEGIN
  CREATE TYPE public.transaction_status AS ENUM ('posted', 'voided', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. New columns on transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS status public.transaction_status NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS reverses_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE INDEX IF NOT EXISTS idx_transactions_reverses ON public.transactions(reverses_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status   ON public.transactions(status);

-- 3. Balance trigger: exclude voided rows from the running balance.
CREATE OR REPLACE FUNCTION public.recalc_subscriber_balance(p_subscriber_id uuid, p_service_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
  v_svc     text := COALESCE(p_service_type, 'cable');
BEGIN
  IF p_subscriber_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           CASE WHEN type = 'payment' THEN -amount ELSE amount END
         ), 0)
    INTO v_balance
    FROM public.transactions
   WHERE subscriber_id = p_subscriber_id
     AND COALESCE(service_type, 'cable') = v_svc
     AND status <> 'voided';

  IF v_svc = 'internet' THEN
    UPDATE public.subscribers
       SET internet_balance = v_balance,
           updated_at = now()
     WHERE id = p_subscriber_id
       AND internet_balance IS DISTINCT FROM v_balance;
  ELSE
    UPDATE public.subscribers
       SET cable_balance = v_balance,
           updated_at = now()
     WHERE id = p_subscriber_id
       AND cable_balance IS DISTINCT FROM v_balance;
  END IF;
END;
$function$;

-- 4. Void RPC. Inserts an offsetting reversal row and marks the original 'voided'.
--    SECURITY DEFINER but enforces ownership via auth.uid().
CREATE OR REPLACE FUNCTION public.void_transaction(p_transaction_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_orig public.transactions;
  v_reversal_id uuid;
  v_opposite_type text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required to void a transaction';
  END IF;

  SELECT * INTO v_orig
    FROM public.transactions
   WHERE id = p_transaction_id
     AND user_id = v_uid
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or not owned by current user';
  END IF;

  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted transactions can be voided (current status: %)', v_orig.status;
  END IF;

  -- Opposite type for the offsetting row. 'refund' offsets like a 'payment' would
  -- a 'charge', so we treat refund as the inverse of charge.
  v_opposite_type := CASE v_orig.type
    WHEN 'payment' THEN 'charge'
    WHEN 'charge'  THEN 'payment'
    WHEN 'refund'  THEN 'charge'
    ELSE v_orig.type
  END;

  INSERT INTO public.transactions (
    user_id, subscriber_id, type, amount, description, date,
    service_type, provider_id, status, reverses_transaction_id, void_reason
  ) VALUES (
    v_orig.user_id, v_orig.subscriber_id, v_opposite_type, v_orig.amount,
    'Void reversal of ' || v_orig.id::text || ' — ' || p_reason,
    now(),
    v_orig.service_type, v_orig.provider_id,
    'reversal', v_orig.id, p_reason
  )
  RETURNING id INTO v_reversal_id;

  UPDATE public.transactions
     SET status = 'voided',
         void_reason = p_reason
   WHERE id = v_orig.id;

  RETURN v_reversal_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.void_transaction(uuid, text) TO authenticated;

-- 5. Recompute all balances once so the new exclusion of 'voided' takes effect.
--    (No rows are 'voided' yet, but this is harmless and keeps the migration
--    self-contained / idempotent.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT subscriber_id, COALESCE(service_type,'cable') AS svc
             FROM public.transactions WHERE subscriber_id IS NOT NULL
  LOOP
    PERFORM public.recalc_subscriber_balance(r.subscriber_id, r.svc);
  END LOOP;
END $$;