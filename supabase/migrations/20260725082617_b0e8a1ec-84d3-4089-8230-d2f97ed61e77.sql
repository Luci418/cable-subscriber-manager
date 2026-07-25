ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS hathway_customer_nbr text;

COMMENT ON COLUMN public.subscribers.hathway_customer_nbr IS
  'Hathway-assigned customer reference for import reconciliation. Nullable. Mirrors gtpl_customer_nbr.';