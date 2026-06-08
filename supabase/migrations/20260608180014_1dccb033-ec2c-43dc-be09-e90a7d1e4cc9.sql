
CREATE OR REPLACE FUNCTION public.check_subscriber_deletable(p_subscriber_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_tx_count int := 0;
  v_stb_count int := 0;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_delete', false, 'blockers', jsonb_build_array('Subscriber not found.'));
  END IF;

  IF v_sub.current_subscription IS NOT NULL
     AND (v_sub.current_subscription->>'endDate')::timestamptz > now() THEN
    v_blockers := v_blockers || 'Cable subscription is still active — cancel it first.';
  END IF;
  IF v_sub.internet_subscription IS NOT NULL
     AND (v_sub.internet_subscription->>'endDate')::timestamptz > now() THEN
    v_blockers := v_blockers || 'Internet subscription is still active — cancel it first.';
  END IF;

  IF COALESCE(v_sub.cable_balance, 0) <> 0 THEN
    v_blockers := v_blockers ||
      ('Outstanding cable balance of ₹' || to_char(abs(v_sub.cable_balance), 'FM999999990.00') ||
       CASE WHEN v_sub.cable_balance > 0 THEN ' is owed by the subscriber.' ELSE ' is held as advance for the subscriber.' END);
  END IF;
  IF COALESCE(v_sub.internet_balance, 0) <> 0 THEN
    v_blockers := v_blockers ||
      ('Outstanding internet balance of ₹' || to_char(abs(v_sub.internet_balance), 'FM999999990.00') ||
       CASE WHEN v_sub.internet_balance > 0 THEN ' is owed by the subscriber.' ELSE ' is held as advance for the subscriber.' END);
  END IF;

  SELECT count(*) INTO v_tx_count FROM public.transactions WHERE subscriber_id = p_subscriber_id;
  IF v_tx_count > 0 THEN
    v_blockers := v_blockers ||
      ('Subscriber has ' || v_tx_count || ' transaction(s) on the immutable ledger. Historical financial records cannot be deleted.');
  END IF;

  SELECT count(*) INTO v_stb_count FROM public.stb_inventory
    WHERE subscriber_id = p_subscriber_id AND status = 'assigned';
  IF v_stb_count > 0 THEN
    v_blockers := v_blockers ||
      ('A device (STB/ONU/Router) is still assigned. Unassign it from inventory first.');
  END IF;

  RETURN jsonb_build_object(
    'can_delete', (array_length(v_blockers, 1) IS NULL),
    'blockers', to_jsonb(v_blockers)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_subscriber_deletable(uuid) TO authenticated;
