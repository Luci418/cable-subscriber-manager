
CREATE OR REPLACE FUNCTION public.payment_allocations_enforce_immutability()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'payment_allocations are append-only (INV-44). Insert a reversal row instead.'
    USING ERRCODE = 'check_violation';
END;
$$;
