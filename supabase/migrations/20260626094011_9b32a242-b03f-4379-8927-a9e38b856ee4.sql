
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS name             text    NOT NULL DEFAULT 'My Cable Company',
  ADD COLUMN IF NOT EXISTS address          text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone            text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email            text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS enabled_services text[]  NOT NULL DEFAULT ARRAY['cable']::text[],
  ADD COLUMN IF NOT EXISTS receipt_prefix   text    NOT NULL DEFAULT 'RCP',
  ADD COLUMN IF NOT EXISTS receipt_footer   text    NOT NULL DEFAULT 'Thank you for your business.',
  ADD COLUMN IF NOT EXISTS default_currency text    NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS default_timezone text    NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS settings_version integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_enabled_services_check'
  ) THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_enabled_services_check
      CHECK (
        array_length(enabled_services, 1) >= 1
        AND enabled_services <@ ARRAY['cable','internet']::text[]
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_settings_row()
RETURNS public.settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.settings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.settings WHERE user_id = v_uid;
  IF NOT FOUND THEN
    INSERT INTO public.settings (user_id) VALUES (v_uid)
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_settings_row() TO authenticated;
