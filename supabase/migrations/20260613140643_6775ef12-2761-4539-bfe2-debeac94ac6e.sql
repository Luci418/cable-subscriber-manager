
-- ============================================================================
-- Phase 4a: Normalize subscriptions + payment_allocations
-- ============================================================================

-- 0. Demo-data wipe (bypass immutability triggers for this one-time reset)
SET LOCAL session_replication_role = 'replica';
DELETE FROM public.transaction_notes;
DELETE FROM public.transactions;
DELETE FROM public.device_assignment_log;
SET LOCAL session_replication_role = 'origin';

UPDATE public.subscribers
   SET current_subscription = NULL,
       subscription_history = ARRAY[]::jsonb[],
       internet_subscription = NULL,
       internet_subscription_history = ARRAY[]::jsonb[],
       current_pack = NULL,
       current_internet_pack = NULL,
       current_pack_id = NULL,
       current_internet_pack_id = NULL,
       cable_balance = 0,
       internet_balance = 0;

-- ============================================================================
-- 1. subscriptions table
-- ============================================================================
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE RESTRICT,
  service_type text NOT NULL CHECK (service_type IN ('cable','internet')),

  device_id uuid REFERENCES public.stb_inventory(id) ON DELETE RESTRICT,
  device_serial_snapshot text,

  pack_id uuid REFERENCES public.packs(id) ON DELETE RESTRICT,
  provider_id uuid REFERENCES public.providers(id) ON DELETE RESTRICT,

  pack_name_snapshot text NOT NULL,
  pack_price_snapshot numeric(12,2) NOT NULL CHECK (pack_price_snapshot >= 0),
  billing_type_snapshot text NOT NULL CHECK (billing_type_snapshot IN ('prepaid','postpaid')),
  validity_days_snapshot int NOT NULL CHECK (validity_days_snapshot > 0),

  duration int NOT NULL CHECK (duration >= 1),
  total_days int NOT NULL CHECK (total_days > 0),
  total_charged numeric(12,2) NOT NULL CHECK (total_charged >= 0),

  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','cancelled','superseded','suspended')),

  cancel_reason_code text
    CHECK (cancel_reason_code IN ('customer_request','operator_error','provider_migration','non_payment','other')),
  cancel_reason_note text,
  cancelled_at timestamptz,
  refund_amount numeric(12,2) CHECK (refund_amount IS NULL OR refund_amount >= 0),

  previous_subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,

  suspended_at timestamptz,
  days_remaining_at_suspend int,
  resumed_at timestamptz,
  auto_resume_by timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own subscriptions"
  ON public.subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_subscriptions_subscriber_status_end
  ON public.subscriptions (subscriber_id, status, end_date);
CREATE INDEX idx_subscriptions_user_status_end
  ON public.subscriptions (user_id, status, end_date);
CREATE INDEX idx_subscriptions_subscriber_service_status
  ON public.subscriptions (subscriber_id, service_type, status);
CREATE INDEX idx_subscriptions_previous
  ON public.subscriptions (previous_subscription_id);
CREATE INDEX idx_subscriptions_pack ON public.subscriptions (pack_id);
CREATE INDEX idx_subscriptions_provider ON public.subscriptions (provider_id);

CREATE UNIQUE INDEX idx_subscriptions_one_active_per_device
  ON public.subscriptions (device_id)
  WHERE status = 'active' AND device_id IS NOT NULL;

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.subscriptions_enforce_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_ok boolean;
  v_cash_paid numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Subscriptions cannot be deleted (INV-43). Use status transitions.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.pack_name_snapshot       IS DISTINCT FROM OLD.pack_name_snapshot
    OR NEW.pack_price_snapshot      IS DISTINCT FROM OLD.pack_price_snapshot
    OR NEW.billing_type_snapshot    IS DISTINCT FROM OLD.billing_type_snapshot
    OR NEW.validity_days_snapshot   IS DISTINCT FROM OLD.validity_days_snapshot
    OR NEW.total_days               IS DISTINCT FROM OLD.total_days
    OR NEW.total_charged            IS DISTINCT FROM OLD.total_charged
    OR NEW.start_date               IS DISTINCT FROM OLD.start_date
    OR NEW.duration                 IS DISTINCT FROM OLD.duration
    OR NEW.previous_subscription_id IS DISTINCT FROM OLD.previous_subscription_id
    OR NEW.created_by               IS DISTINCT FROM OLD.created_by
    OR NEW.subscriber_id            IS DISTINCT FROM OLD.subscriber_id
    OR NEW.service_type             IS DISTINCT FROM OLD.service_type THEN
      RAISE EXCEPTION 'Snapshot/identity columns on subscriptions are immutable.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
      RAISE EXCEPTION 'end_date cannot be updated directly in v1 (INV-41).'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
           (OLD.status = 'active'    AND NEW.status IN ('expired','cancelled','superseded','suspended'))
        OR (OLD.status = 'suspended' AND NEW.status IN ('active','cancelled'))
      ) THEN
        RAISE EXCEPTION 'Invalid subscription status transition: % -> %', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.device_serial_snapshot IS DISTINCT FROM OLD.device_serial_snapshot
       AND NEW.device_serial_snapshot IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.stb_inventory
         WHERE user_id = NEW.user_id
           AND serial_number = NEW.device_serial_snapshot
           AND status = 'assigned'
           AND subscriber_id = NEW.subscriber_id
      ) INTO v_inv_ok;
      IF NOT v_inv_ok THEN
        RAISE EXCEPTION
          'Inventory does not agree: device % is not assigned to this subscriber. Use replace_device.',
          NEW.device_serial_snapshot
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.refund_amount IS DISTINCT FROM OLD.refund_amount
       AND NEW.refund_amount IS NOT NULL THEN
      SELECT COALESCE(SUM(pa.amount), 0) INTO v_cash_paid
        FROM public.payment_allocations pa
        JOIN public.transactions t ON t.id = pa.transaction_id
       WHERE pa.subscription_id = NEW.id
         AND t.type = 'payment'
         AND t.status NOT IN ('voided','reversal');
      IF NEW.refund_amount > v_cash_paid THEN
        RAISE EXCEPTION 'Refund (₹%) exceeds cash paid toward this subscription (₹%) (INV-42).',
          NEW.refund_amount, v_cash_paid
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_subscriptions_enforce_invariants
  BEFORE UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_enforce_invariants();

-- ============================================================================
-- 2. payment_allocations
-- ============================================================================
CREATE TABLE public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  allocated_by text NOT NULL CHECK (allocated_by IN ('fifo_trigger','manual','opening_balance')),
  created_by uuid DEFAULT auth.uid()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own payment allocations"
  ON public.payment_allocations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_payment_alloc_subscription ON public.payment_allocations (subscription_id);
CREATE INDEX idx_payment_alloc_transaction  ON public.payment_allocations (transaction_id);
CREATE INDEX idx_payment_alloc_user         ON public.payment_allocations (user_id);

CREATE OR REPLACE FUNCTION public.payment_allocations_enforce_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_allocations are append-only (INV-44). Insert a reversal row instead.'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER trg_payment_allocations_immutable
  BEFORE UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.payment_allocations_enforce_immutability();

-- ============================================================================
-- 3. transactions.subscription_id + updated immutability list
-- ============================================================================
ALTER TABLE public.transactions
  ADD COLUMN subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_subscription_id ON public.transactions (subscription_id);

CREATE OR REPLACE FUNCTION public.transactions_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Transactions cannot be deleted. Use the Void action to reverse a transaction.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.amount        IS DISTINCT FROM OLD.amount
    OR NEW.type          IS DISTINCT FROM OLD.type
    OR NEW.service_type  IS DISTINCT FROM OLD.service_type
    OR NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
    OR NEW.provider_id   IS DISTINCT FROM OLD.provider_id
    OR NEW.date          IS DISTINCT FROM OLD.date
    OR NEW.reverses_transaction_id IS DISTINCT FROM OLD.reverses_transaction_id
    OR NEW.description   IS DISTINCT FROM OLD.description
    OR NEW.source        IS DISTINCT FROM OLD.source
    OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
      RAISE EXCEPTION 'Transaction rows are immutable. Use Void + replacement to correct; use transaction_notes for additional context.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.status = 'posted' AND NEW.status = 'voided' AND NEW.void_reason IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid transaction status transition (% -> %). Use the Void action.', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================================
-- 4. FIFO allocation trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transactions_fifo_allocate_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_remaining numeric;
  v_owed numeric;
  v_alloc numeric;
BEGIN
  IF NEW.type NOT IN ('payment','adjustment') THEN RETURN NEW; END IF;
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF NEW.subscriber_id IS NULL THEN RETURN NEW; END IF;

  v_remaining := NEW.amount;

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
$$;

CREATE TRIGGER trg_transactions_fifo_allocate
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_fifo_allocate_trg();

-- ============================================================================
-- 5. create_subscription (dual-write)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_pack_id uuid,
  p_duration integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_pack public.packs;
  v_provider_name text;
  v_is_prepaid boolean;
  v_validity int;
  v_total_days int;
  v_start date := CURRENT_DATE;
  v_end date;
  v_charge numeric;
  v_new_sub jsonb;
  v_sub_id_text text;
  v_history jsonb;
  v_existing jsonb;
  v_device public.stb_inventory;
  v_subscription_id uuid;
  v_prev_subscription_id uuid;
  v_charge_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF p_duration IS NULL OR p_duration < 1 THEN
    RAISE EXCEPTION 'Duration must be >= 1';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF NOT (p_service_type = ANY (COALESCE(v_sub.services, ARRAY['cable']::text[]))) THEN
    RAISE EXCEPTION 'Subscriber does not have % service enabled', p_service_type;
  END IF;

  SELECT * INTO v_pack FROM public.packs
   WHERE id = p_pack_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pack not found'; END IF;
  IF COALESCE(v_pack.service_type,'cable') <> p_service_type THEN
    RAISE EXCEPTION 'Pack service type (%) does not match requested service (%)', v_pack.service_type, p_service_type;
  END IF;

  SELECT * INTO v_device FROM public.stb_inventory
   WHERE user_id = v_uid
     AND subscriber_id = p_subscriber_id
     AND service_type = p_service_type
     AND status = 'assigned'
   ORDER BY updated_at DESC LIMIT 1;

  IF v_device.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.subscriptions
                WHERE device_id = v_device.id AND status = 'active') THEN
      RAISE EXCEPTION 'An active subscription already exists for this device. Cancel it first.';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.subscriptions
                WHERE subscriber_id = p_subscriber_id
                  AND service_type = p_service_type
                  AND status = 'active'
                  AND device_id IS NULL) THEN
      RAISE EXCEPTION 'An active % subscription already exists. Cancel it first.', p_service_type;
    END IF;
  END IF;

  v_is_prepaid := COALESCE(v_pack.billing_type,'postpaid') = 'prepaid';
  v_validity   := COALESCE(v_pack.validity_days, 30);
  v_total_days := v_validity * p_duration;
  v_end        := v_start + v_total_days;
  v_charge     := COALESCE(v_pack.price, 0) * p_duration;

  IF v_pack.provider_id IS NOT NULL THEN
    SELECT name INTO v_provider_name FROM public.providers WHERE id = v_pack.provider_id;
  END IF;

  IF v_device.id IS NOT NULL THEN
    SELECT id INTO v_prev_subscription_id FROM public.subscriptions
     WHERE device_id = v_device.id
     ORDER BY end_date DESC, created_at DESC LIMIT 1;
  ELSE
    SELECT id INTO v_prev_subscription_id FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id AND service_type = p_service_type
     ORDER BY end_date DESC, created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.subscriptions (
    user_id, subscriber_id, service_type,
    device_id, device_serial_snapshot,
    pack_id, provider_id,
    pack_name_snapshot, pack_price_snapshot, billing_type_snapshot, validity_days_snapshot,
    duration, total_days, total_charged,
    start_date, end_date, status,
    previous_subscription_id, created_by
  ) VALUES (
    v_uid, p_subscriber_id, p_service_type,
    v_device.id, v_device.serial_number,
    v_pack.id, v_pack.provider_id,
    v_pack.name, COALESCE(v_pack.price,0), COALESCE(v_pack.billing_type,'postpaid'), v_validity,
    p_duration, v_total_days, v_charge,
    v_start, v_end, 'active',
    v_prev_subscription_id, v_uid
  ) RETURNING id INTO v_subscription_id;

  v_sub_id_text := 'sub-' || extract(epoch from now())::bigint::text || '-' || substr(md5(random()::text),1,6);

  v_new_sub := jsonb_build_object(
    'id', v_sub_id_text,
    'subscriptionId', v_subscription_id,
    'packName', v_pack.name,
    'packPrice', v_pack.price,
    'startDate', v_start::timestamptz,
    'endDate', v_end::timestamptz,
    'duration', p_duration,
    'status', 'active',
    'subscribedAt', now(),
    'providerId', v_pack.provider_id,
    'providerName', v_provider_name
  );

  IF p_service_type = 'internet' THEN
    v_existing := to_jsonb(v_sub.internet_subscription);
    v_history  := COALESCE(to_jsonb(v_sub.internet_subscription_history), '[]'::jsonb);
  ELSE
    v_existing := to_jsonb(v_sub.current_subscription);
    v_history  := COALESCE(to_jsonb(v_sub.subscription_history), '[]'::jsonb);
  END IF;

  v_history := (
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status','expired')), '[]'::jsonb)
      FROM jsonb_array_elements(v_history) e
  );
  v_history := v_history || jsonb_build_array(v_new_sub);

  IF p_service_type = 'internet' THEN
    UPDATE public.subscribers
       SET internet_subscription = v_new_sub,
           internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_internet_pack = v_pack.name,
           current_internet_pack_id = v_pack.id,
           internet_provider_id = COALESCE(v_pack.provider_id, internet_provider_id),
           updated_at = now()
     WHERE id = p_subscriber_id;
  ELSE
    UPDATE public.subscribers
       SET current_subscription = v_new_sub,
           subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_pack = v_pack.name,
           current_pack_id = v_pack.id,
           cable_provider_id = COALESCE(v_pack.provider_id, cable_provider_id),
           updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  INSERT INTO public.transactions (
    user_id, subscriber_id, type, amount, service_type, provider_id,
    source, description, date, status, subscription_id
  ) VALUES (
    v_uid, p_subscriber_id, 'charge', v_charge, p_service_type, v_pack.provider_id,
    'subscription_charge',
    initcap(p_service_type) || ' ' ||
      CASE WHEN v_is_prepaid THEN 'recharge' ELSE 'subscription charge' END ||
      ': ' || v_pack.name || ' (' || p_duration ||
      CASE WHEN v_is_prepaid THEN ' × ' || v_validity || 'd)'
           ELSE ' month' || CASE WHEN p_duration > 1 THEN 's)' ELSE ')' END END,
    now(), 'posted', v_subscription_id
  ) RETURNING id INTO v_charge_tx_id;

  RETURN jsonb_build_object(
    'subscription_id', v_subscription_id,
    'charge_transaction_id', v_charge_tx_id,
    'charge_amount', v_charge,
    'end_date', v_end
  );
END;
$$;

-- ============================================================================
-- 6. cancel_subscription (dual-write)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_refund_amount numeric DEFAULT 0,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_active jsonb;
  v_history jsonb;
  v_active_id text;
  v_active_subscription_id uuid;
  v_total_charged numeric;
  v_cash_paid numeric;
  v_refund_tx_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF COALESCE(p_refund_amount,0) < 0 THEN
    RAISE EXCEPTION 'Refund amount cannot be negative';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT id, total_charged INTO v_active_subscription_id, v_total_charged
    FROM public.subscriptions
   WHERE subscriber_id = p_subscriber_id
     AND service_type  = p_service_type
     AND status = 'active'
   ORDER BY created_at DESC LIMIT 1;

  IF v_active_subscription_id IS NULL THEN
    RAISE EXCEPTION 'No active % subscription to cancel', p_service_type;
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0) INTO v_cash_paid
    FROM public.payment_allocations pa
    JOIN public.transactions t ON t.id = pa.transaction_id
   WHERE pa.subscription_id = v_active_subscription_id
     AND t.type = 'payment'
     AND t.status NOT IN ('voided','reversal');

  IF p_refund_amount > v_cash_paid THEN
    RAISE EXCEPTION 'Refund (₹%) exceeds cash paid toward this subscription (₹%).',
      p_refund_amount, v_cash_paid;
  END IF;

  UPDATE public.subscriptions
     SET status = 'cancelled',
         cancelled_at = now(),
         cancel_reason_note = NULLIF(btrim(p_reason),''),
         cancel_reason_code = 'customer_request',
         refund_amount = p_refund_amount
   WHERE id = v_active_subscription_id;

  IF p_service_type = 'internet' THEN
    v_active  := to_jsonb(v_sub.internet_subscription);
    v_history := COALESCE(to_jsonb(v_sub.internet_subscription_history), '[]'::jsonb);
  ELSE
    v_active  := to_jsonb(v_sub.current_subscription);
    v_history := COALESCE(to_jsonb(v_sub.subscription_history), '[]'::jsonb);
  END IF;

  v_active_id := COALESCE(v_active->>'id','');

  v_history := (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN e->>'id' = v_active_id
        THEN e || jsonb_build_object('status','cancelled','endDate', now())
        ELSE e END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_history) e
  );

  IF p_service_type = 'internet' THEN
    UPDATE public.subscribers
       SET internet_subscription = NULL,
           internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_internet_pack = NULL,
           current_internet_pack_id = NULL,
           updated_at = now()
     WHERE id = p_subscriber_id;
  ELSE
    UPDATE public.subscribers
       SET current_subscription = NULL,
           subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
           current_pack = NULL,
           current_pack_id = NULL,
           updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  IF p_refund_amount > 0 THEN
    INSERT INTO public.transactions (
      user_id, subscriber_id, type, amount, service_type, provider_id,
      source, description, date, status, subscription_id
    ) VALUES (
      v_uid, p_subscriber_id, 'payment', p_refund_amount, p_service_type,
      CASE WHEN p_service_type='internet' THEN v_sub.internet_provider_id ELSE v_sub.cable_provider_id END,
      'subscription_refund',
      'Refund for cancelled ' || p_service_type || ' subscription'
        || CASE WHEN COALESCE(btrim(p_reason),'') <> '' THEN ' — ' || p_reason ELSE '' END,
      now(), 'posted', v_active_subscription_id
    ) RETURNING id INTO v_refund_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'cancelled_subscription_id', v_active_subscription_id,
    'refund_amount', p_refund_amount,
    'refund_transaction_id', v_refund_tx_id
  );
END;
$$;

-- ============================================================================
-- 7. expire_lapsed_subscriptions (dual)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
  rec record;
  cur_sub jsonb;
  hist jsonb;
  expired_sub jsonb;
  exists_in_hist boolean;
  v_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('expire_lapsed_subscriptions', 0));

  WITH upd AS (
    UPDATE public.subscriptions
       SET status = 'expired', updated_at = now()
     WHERE status = 'active'
       AND end_date <= CURRENT_DATE
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM upd;
  affected := affected + COALESCE(v_count, 0);

  FOR rec IN
    SELECT id, current_subscription, subscription_history FROM public.subscribers
     WHERE current_subscription IS NOT NULL
       AND (current_subscription->>'endDate')::timestamptz <= now()
  LOOP
    cur_sub := rec.current_subscription;
    hist := COALESCE(to_jsonb(rec.subscription_history), '[]'::jsonb);
    expired_sub := cur_sub || jsonb_build_object('status','expired');

    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(hist) e WHERE e->>'id' = cur_sub->>'id')
      INTO exists_in_hist;

    IF exists_in_hist THEN
      hist := (SELECT jsonb_agg(CASE WHEN e->>'id' = cur_sub->>'id' THEN expired_sub ELSE e END)
                 FROM jsonb_array_elements(hist) e);
    ELSE
      hist := hist || jsonb_build_array(expired_sub);
    END IF;

    UPDATE public.subscribers
       SET current_subscription = NULL,
           current_pack = NULL,
           current_pack_id = NULL,
           subscription_history = ARRAY(SELECT jsonb_array_elements(hist))::jsonb[],
           updated_at = now()
     WHERE id = rec.id;
  END LOOP;

  FOR rec IN
    SELECT id, internet_subscription, internet_subscription_history FROM public.subscribers
     WHERE internet_subscription IS NOT NULL
       AND (internet_subscription->>'endDate')::timestamptz <= now()
  LOOP
    cur_sub := rec.internet_subscription;
    hist := COALESCE(to_jsonb(rec.internet_subscription_history), '[]'::jsonb);
    expired_sub := cur_sub || jsonb_build_object('status','expired');

    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(hist) e WHERE e->>'id' = cur_sub->>'id')
      INTO exists_in_hist;

    IF exists_in_hist THEN
      hist := (SELECT jsonb_agg(CASE WHEN e->>'id' = cur_sub->>'id' THEN expired_sub ELSE e END)
                 FROM jsonb_array_elements(hist) e);
    ELSE
      hist := hist || jsonb_build_array(expired_sub);
    END IF;

    UPDATE public.subscribers
       SET internet_subscription = NULL,
           current_internet_pack = NULL,
           current_internet_pack_id = NULL,
           internet_subscription_history = ARRAY(SELECT jsonb_array_elements(hist))::jsonb[],
           updated_at = now()
     WHERE id = rec.id;
  END LOOP;

  RETURN affected;
END;
$$;

-- ============================================================================
-- 8. replace_device — also patch subscriptions device pointer + snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION public.replace_device(
  p_subscriber_id uuid,
  p_old_serial text,
  p_new_serial text,
  p_reason text DEFAULT 'faulty'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_old_inv public.stb_inventory;
  v_new_inv public.stb_inventory;
  v_service text;
  v_close_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_old_serial IS NULL OR btrim(p_old_serial) = '' THEN RAISE EXCEPTION 'Old device serial is required'; END IF;
  IF p_new_serial IS NULL OR btrim(p_new_serial) = '' THEN RAISE EXCEPTION 'New device serial is required'; END IF;
  IF p_old_serial = p_new_serial THEN RAISE EXCEPTION 'Old and new device serials must differ'; END IF;

  v_close_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),'faulty'));
  IF v_close_reason NOT IN ('faulty','upgraded','returned','replaced','other') THEN
    RAISE EXCEPTION 'Invalid replacement reason: %', p_reason;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT * INTO v_old_inv FROM public.stb_inventory
   WHERE user_id = v_uid AND serial_number = p_old_serial FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Old device % not found', p_old_serial; END IF;
  IF v_old_inv.status <> 'assigned' OR v_old_inv.subscriber_id IS DISTINCT FROM p_subscriber_id THEN
    RAISE EXCEPTION 'Old device % is not currently assigned to this subscriber', p_old_serial;
  END IF;

  SELECT * INTO v_new_inv FROM public.stb_inventory
   WHERE user_id = v_uid AND serial_number = p_new_serial FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'New device % not found', p_new_serial; END IF;
  IF v_new_inv.status <> 'available' THEN
    RAISE EXCEPTION 'New device % is not available (status: %)', p_new_serial, v_new_inv.status;
  END IF;
  IF COALESCE(v_new_inv.service_type,'cable') IS DISTINCT FROM COALESCE(v_old_inv.service_type,'cable') THEN
    RAISE EXCEPTION 'New device service type does not match old device';
  END IF;

  v_service := COALESCE(v_old_inv.service_type,'cable');

  UPDATE public.stb_inventory SET status='faulty', subscriber_id=NULL, updated_at=now() WHERE id = v_old_inv.id;
  UPDATE public.stb_inventory SET status='assigned', subscriber_id=p_subscriber_id, updated_at=now() WHERE id = v_new_inv.id;

  UPDATE public.device_assignment_log
     SET closed_at = now(), close_reason = v_close_reason, closed_by = v_uid, updated_at = now()
   WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
     AND device_serial = p_old_serial AND closed_at IS NULL;

  INSERT INTO public.device_assignment_log (
    user_id, subscriber_id, device_serial, device_type, service_type, open_reason, opened_by
  ) VALUES (
    v_uid, p_subscriber_id, p_new_serial,
    COALESCE(v_new_inv.device_type,'stb'), v_service, 'replacement', v_uid
  );

  UPDATE public.subscriptions
     SET device_id = v_new_inv.id,
         device_serial_snapshot = p_new_serial
   WHERE user_id = v_uid
     AND status = 'active'
     AND (device_id = v_old_inv.id
          OR (device_id IS NULL AND subscriber_id = p_subscriber_id AND service_type = v_service));

  IF v_service = 'cable' AND v_sub.current_subscription IS NOT NULL THEN
    UPDATE public.subscribers
       SET current_subscription = v_sub.current_subscription || jsonb_build_object('stbNumber', p_new_serial),
           updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  IF v_service = 'cable' THEN
    UPDATE public.subscribers SET stb_number = p_new_serial, updated_at = now() WHERE id = p_subscriber_id;
  END IF;

  RETURN jsonb_build_object(
    'subscriber_id', p_subscriber_id,
    'service_type', v_service,
    'old_serial', p_old_serial,
    'new_serial', p_new_serial,
    'close_reason', v_close_reason
  );
END;
$$;
