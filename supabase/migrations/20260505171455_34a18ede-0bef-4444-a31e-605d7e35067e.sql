ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'postpaid',
  ADD COLUMN IF NOT EXISTS validity_days INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packs_billing_type_check') THEN
    ALTER TABLE public.packs ADD CONSTRAINT packs_billing_type_check CHECK (billing_type IN ('prepaid','postpaid'));
  END IF;
END $$;
