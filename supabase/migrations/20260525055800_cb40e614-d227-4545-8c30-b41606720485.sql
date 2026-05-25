
-- 1) Validate previously NOT VALID checks (data is clean)
ALTER TABLE public.subscribers VALIDATE CONSTRAINT subscribers_mobile_format;
ALTER TABLE public.subscribers VALIDATE CONSTRAINT subscribers_name_nonblank;
ALTER TABLE public.transactions VALIDATE CONSTRAINT transactions_amount_nonneg;
ALTER TABLE public.packs VALIDATE CONSTRAINT packs_price_nonneg;

-- 2) Drop duplicate FKs created in the previous migration; the original *_id_fkey constraints remain
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_subscriber_fk;
ALTER TABLE public.complaints   DROP CONSTRAINT IF EXISTS complaints_subscriber_fk;

-- 3) Packs: prepaid must declare a positive validity period; postpaid stays open
ALTER TABLE public.packs
  ADD CONSTRAINT packs_prepaid_validity
  CHECK (billing_type <> 'prepaid' OR (validity_days IS NOT NULL AND validity_days > 0));

-- 4) Inventory: keep device_type and service_type in agreement
ALTER TABLE public.stb_inventory
  ADD CONSTRAINT stb_inventory_device_service_match
  CHECK (
    (device_type = 'stb' AND service_type = 'cable') OR
    (device_type IN ('onu','router') AND service_type = 'internet')
  );

-- 5) Complaints: non-blank description; resolved must carry a resolved_date
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_description_nonblank
  CHECK (length(btrim(description)) > 0);

ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_resolved_has_date
  CHECK (status <> 'resolved' OR resolved_date IS NOT NULL);

-- 6) Billing history: YYYY-MM format and non-negative totals
ALTER TABLE public.billing_history
  ADD CONSTRAINT billing_history_month_format
  CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$');

ALTER TABLE public.billing_history
  ADD CONSTRAINT billing_history_totals_nonneg
  CHECK (total_revenue >= 0 AND total_subscribers >= 0);
