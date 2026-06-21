CREATE OR REPLACE FUNCTION public.transactions_fifo_allocate_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  v_remaining numeric;
  v_owed numeric;
  v_alloc numeric;
  v_target_total numeric;
  v_target_allocated numeric;
  v_target_owed numeric;
  v_target_service text;
  v_target_subscriber uuid;
BEGIN
  IF NEW.type NOT IN ('payment','adjustment') THEN RETURN NEW; END IF;
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF NEW.subscriber_id IS NULL THEN RETURN NEW; END IF;

  v_remaining := NEW.amount;

  -- Targeted allocation path: Collect Payment dialog pins a payment to one
  -- specific subscription. Honor operator intent; no FIFO spill.
  IF NEW.source = 'subscription_payment' AND NEW.subscription_id IS NOT NULL THEN
    SELECT s.subscriber_id, s.service_type, s.total_charged
      INTO v_target_subscriber, v_target_service, v_target_total
      FROM public.subscriptions s
     WHERE s.id = NEW.subscription_id;

    IF v_target_subscriber IS NULL THEN
      RAISE EXCEPTION 'subscription_payment: target subscription % not found', NEW.subscription_id;
    END IF;
    IF v_target_subscriber <> NEW.subscriber_id THEN
      RAISE EXCEPTION 'subscription_payment: target subscription does not belong to subscriber';
    END IF;
    IF v_target_service <> COALESCE(NEW.service_type, 'cable') THEN
      RAISE EXCEPTION 'subscription_payment: service_type mismatch with target subscription';
    END IF;

    SELECT COALESCE(SUM(pa.amount), 0) INTO v_target_allocated
      FROM public.payment_allocations pa
     WHERE pa.subscription_id = NEW.subscription_id;

    v_target_owed := v_target_total - v_target_allocated;

    -- Cases 1-3: bill has outstanding -> allocate up to owed, remainder is
    -- advance credit captured by the transaction amount alone (no extra row).
    -- Case 4: owed <= 0 -> no allocation row; entire amount is advance.
    IF v_target_owed > 0 THEN
      v_alloc := LEAST(NEW.amount, v_target_owed);
      INSERT INTO public.payment_allocations
        (user_id, transaction_id, subscription_id, amount, allocated_by)
      VALUES (NEW.user_id, NEW.id, NEW.subscription_id, v_alloc, 'targeted_bill');
    END IF;

    RETURN NEW;
  END IF;

  -- Default FIFO path (unchanged): oldest unpaid subscription first.
  FOR rec IN
    SELECT s.id,
           s.total_charged,
           COALESCE((
             SELECT SUM(pa.amount) FROM public.payment_allocations pa
              WHERE pa.subscription_id = s.id
           ), 0) AS allocated
      FROM public.subscriptions s
     WHERE s.subscriber_id = NEW.subscriber_id
       AND s.service_type  = COALESCE(NEW.service_type, 'cable')
       AND s.status IN ('active','expired','cancelled','superseded')
     ORDER BY s.start_date ASC, s.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_owed := rec.total_charged - rec.allocated;
    IF v_owed <= 0 THEN CONTINUE; END IF;
    v_alloc := LEAST(v_remaining, v_owed);
    INSERT INTO public.payment_allocations
      (user_id, transaction_id, subscription_id, amount, allocated_by)
    VALUES (NEW.user_id, NEW.id, rec.id, v_alloc, 'fifo_trigger');
    v_remaining := v_remaining - v_alloc;
  END LOOP;

  RETURN NEW;
END;
$function$;