ALTER TABLE public.payment_allocations DROP CONSTRAINT payment_allocations_allocated_by_check;
ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_allocated_by_check
  CHECK (allocated_by = ANY (ARRAY['fifo_trigger'::text, 'manual'::text, 'opening_balance'::text, 'targeted_bill'::text]));