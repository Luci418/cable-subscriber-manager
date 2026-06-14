
-- 1. settings table (one row per operator)
CREATE TABLE public.settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  backdating_window_days integer NOT NULL DEFAULT 7
    CHECK (backdating_window_days >= 0 AND backdating_window_days <= 90),
  operator_upi_vpa text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own settings"
  ON public.settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. transactions.payment_method (nullable; legacy rows = NULL)
ALTER TABLE public.transactions
  ADD COLUMN payment_method text
    CHECK (payment_method IS NULL OR payment_method IN ('cash','upi','other'));

COMMENT ON COLUMN public.transactions.payment_method IS
  'Operator-selected payment method on Collect Payment (Phase 5). NULL on legacy rows and on auto-generated subscription_charge/subscription_refund rows.';
