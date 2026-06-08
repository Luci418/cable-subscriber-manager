-- ADR-011 (revised): drop the 5-minute grace window. Transactions are immutable
-- the moment they are saved. Corrections happen exclusively via void_transaction.

CREATE OR REPLACE FUNCTION public.transactions_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Transactions cannot be deleted. Use the Void action to reverse a transaction.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Financial fields are frozen the moment a row is written.
    IF NEW.amount        IS DISTINCT FROM OLD.amount
    OR NEW.type          IS DISTINCT FROM OLD.type
    OR NEW.service_type  IS DISTINCT FROM OLD.service_type
    OR NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
    OR NEW.provider_id   IS DISTINCT FROM OLD.provider_id
    OR NEW.date          IS DISTINCT FROM OLD.date
    OR NEW.reverses_transaction_id IS DISTINCT FROM OLD.reverses_transaction_id THEN
      RAISE EXCEPTION 'Financial fields of a transaction are immutable. Void the transaction and post a replacement instead.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Status may only transition posted -> voided, and only via void_transaction
    -- (which sets void_reason in the same statement).
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.status = 'posted' AND NEW.status = 'voided' AND NEW.void_reason IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid transaction status transition (% -> %). Use the Void action.', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS transactions_immutability_trg ON public.transactions;
CREATE TRIGGER transactions_immutability_trg
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_enforce_immutability();
