ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS identifier_label text;

COMMENT ON COLUMN public.providers.identifier_label IS
  'UI label for subscriber_provider_state.provider_customer_number (e.g. "Account Number"). NULL falls back to "Account Number".';

-- Identity-tier gate: editing a customer''s provider account number is an
-- identity edit, not a sync action (PERMISSION_MATRIX.md). Same role set as
-- customer lifecycle management: owner + admin_office.
CREATE OR REPLACE FUNCTION public.can_edit_customer_identity(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'owner') OR public.has_role(_uid, 'admin_office')
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_customer_identity(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_provider_account(
  p_subscriber_id uuid,
  p_provider_id uuid,
  p_account_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_value text := NULLIF(btrim(coalesce(p_account_number, '')), '');
  v_clash uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_edit_customer_identity(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to edit customer identity'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner FROM public.subscribers WHERE id = p_subscriber_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Subscriber not found' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Provider not found' USING ERRCODE = '42501';
  END IF;

  -- A provider account number is a deterministic identity key for sync
  -- (INV-52). Two customers claiming one number makes it ambiguous and it
  -- stops matching at all, so refuse the collision at write time.
  IF v_value IS NOT NULL THEN
    SELECT subscriber_id INTO v_clash
    FROM public.subscriber_provider_state
    WHERE user_id = v_uid
      AND provider_id = p_provider_id
      AND subscriber_id <> p_subscriber_id
      AND upper(btrim(provider_customer_number)) = upper(v_value)
    LIMIT 1;
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'Account number % is already linked to another customer for this provider', v_value
        USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.subscriber_provider_state
    (user_id, subscriber_id, provider_id, provider_customer_number)
  VALUES (v_uid, p_subscriber_id, p_provider_id, v_value)
  ON CONFLICT (subscriber_id, provider_id)
  DO UPDATE SET provider_customer_number = EXCLUDED.provider_customer_number,
                updated_at = now();

  RETURN jsonb_build_object('success', true, 'provider_customer_number', v_value);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_provider_account(uuid, uuid, text) TO authenticated;