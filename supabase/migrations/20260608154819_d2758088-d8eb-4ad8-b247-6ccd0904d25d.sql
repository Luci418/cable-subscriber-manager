
-- ============================================================
-- 1. Source enum + column
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.transaction_source AS ENUM (
    'manual_charge',
    'manual_payment',
    'subscription_charge',
    'subscription_refund',
    'reversal',
    'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source public.transaction_source;

-- Backfill: reversals first (status = 'reversal'), then subscription rows
-- (descriptions written by AddPackageSubscriptionDialog / CancelSubscriptionDialog),
-- then everything else falls back to manual_*.
UPDATE public.transactions
   SET source = 'reversal'
 WHERE source IS NULL AND status = 'reversal';

UPDATE public.transactions
   SET source = 'subscription_charge'
 WHERE source IS NULL
   AND type = 'charge'
   AND (description ILIKE '%subscription charge%'
        OR description ILIKE '%recharge:%'
        OR description ILIKE 'Cable %: %'
        OR description ILIKE 'Internet %: %');

UPDATE public.transactions
   SET source = 'subscription_refund'
 WHERE source IS NULL
   AND type IN ('payment','refund')
   AND description ILIKE 'Refund for cancelled%';

UPDATE public.transactions
   SET source = CASE
     WHEN type = 'payment' THEN 'manual_payment'::public.transaction_source
     WHEN type = 'refund'  THEN 'manual_payment'::public.transaction_source
     ELSE 'manual_charge'::public.transaction_source
   END
 WHERE source IS NULL;

ALTER TABLE public.transactions
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'manual_charge';

-- ============================================================
-- 2. Void accountability columns + reason enum
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.void_reason_code AS ENUM (
    'data_entry_error',
    'duplicate',
    'wrong_subscriber',
    'wrong_amount',
    'customer_dispute',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason_code public.void_reason_code;

-- ============================================================
-- 3. Tighter immutability: freeze description + source too
-- ============================================================
CREATE OR REPLACE FUNCTION public.transactions_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Transactions cannot be deleted. Use the Void action to reverse a transaction.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.amount        IS DISTINCT FROM OLD.amount
    OR NEW.type          IS DISTINCT FROM OLD.type
    OR NEW.service_type  IS DISTINCT FROM OLD.service_type
    OR NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
    OR NEW.provider_id   IS DISTINCT FROM OLD.provider_id
    OR NEW.date          IS DISTINCT FROM OLD.date
    OR NEW.reverses_transaction_id IS DISTINCT FROM OLD.reverses_transaction_id
    OR NEW.description   IS DISTINCT FROM OLD.description
    OR NEW.source        IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'Transaction rows are immutable. Use Void + replacement to correct; use transaction_notes for additional context.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.status = 'posted' AND NEW.status = 'voided' AND NEW.void_reason IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid transaction status transition (% -> %). Use the Void action.', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- ============================================================
-- 4. Updated void_transaction RPC:
--    - blocks voiding subscription-sourced rows + reversals
--    - requires reason_code (enum), stores voided_by / voided_at
--    - clean reversal description (no UUID)
-- ============================================================
DROP FUNCTION IF EXISTS public.void_transaction(uuid, text);

CREATE OR REPLACE FUNCTION public.void_transaction(
  p_transaction_id uuid,
  p_reason_code public.void_reason_code,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_orig public.transactions;
  v_reversal_id uuid;
  v_opposite_type text;
  v_reason text;
  v_reason_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_reason_code IS NULL THEN
    RAISE EXCEPTION 'A reason code is required to void a transaction';
  END IF;
  v_reason := btrim(COALESCE(p_reason, ''));

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

  -- Hard block: subscription-sourced rows and reversals are not directly voidable.
  IF v_orig.source IN ('subscription_charge','subscription_refund','reversal') THEN
    RAISE EXCEPTION 'This transaction was generated by a subscription action (source=%). Undo it through the subscription lifecycle (cancel / refund) instead of voiding the ledger row directly.', v_orig.source
      USING ERRCODE = 'check_violation';
  END IF;

  v_opposite_type := CASE v_orig.type
    WHEN 'payment' THEN 'charge'
    WHEN 'charge'  THEN 'payment'
    WHEN 'refund'  THEN 'charge'
    ELSE v_orig.type
  END;

  v_reason_label := replace(p_reason_code::text, '_', ' ');

  INSERT INTO public.transactions (
    user_id, subscriber_id, type, amount,
    description, date, service_type, provider_id,
    status, reverses_transaction_id,
    void_reason, void_reason_code, source
  ) VALUES (
    v_orig.user_id, v_orig.subscriber_id, v_opposite_type, v_orig.amount,
    'Reversal — ' || v_reason_label || CASE WHEN v_reason <> '' THEN ' (' || v_reason || ')' ELSE '' END,
    now(), v_orig.service_type, v_orig.provider_id,
    'reversal', v_orig.id,
    NULLIF(v_reason, ''), p_reason_code, 'reversal'
  )
  RETURNING id INTO v_reversal_id;

  UPDATE public.transactions
     SET status = 'voided',
         void_reason = NULLIF(v_reason, ''),
         void_reason_code = p_reason_code,
         voided_by = v_uid,
         voided_at = now()
   WHERE id = v_orig.id;

  RETURN v_reversal_id;
END;
$fn$;

-- ============================================================
-- 5. Append-only transaction_notes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transaction_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  author_id uuid NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_notes_txn_idx
  ON public.transaction_notes(transaction_id, created_at DESC);

GRANT SELECT, INSERT ON public.transaction_notes TO authenticated;
GRANT ALL ON public.transaction_notes TO service_role;

ALTER TABLE public.transaction_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own transaction notes" ON public.transaction_notes;
CREATE POLICY "Users select own transaction notes"
  ON public.transaction_notes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own transaction notes" ON public.transaction_notes;
CREATE POLICY "Users insert own transaction notes"
  ON public.transaction_notes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND auth.uid() = author_id);

-- Hard-block edits / deletes at the DB level (append-only).
CREATE OR REPLACE FUNCTION public.transaction_notes_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'Transaction notes are append-only. Add a new note instead of editing or deleting.'
    USING ERRCODE = 'check_violation';
END;
$fn$;

DROP TRIGGER IF EXISTS transaction_notes_no_update ON public.transaction_notes;
CREATE TRIGGER transaction_notes_no_update
  BEFORE UPDATE OR DELETE ON public.transaction_notes
  FOR EACH ROW EXECUTE FUNCTION public.transaction_notes_enforce_immutability();
