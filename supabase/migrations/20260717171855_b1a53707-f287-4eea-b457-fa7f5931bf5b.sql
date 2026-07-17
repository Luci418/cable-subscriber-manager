-- ============================================================
-- Block 1 — retire bootstrap owner trigger
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created_grant_owner ON auth.users;
DROP FUNCTION IF EXISTS public.grant_owner_on_signup();

-- ============================================================
-- Block 3 — balance_audit table + reconcile RPCs (ADR-003)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.balance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  service_type text NOT NULL CHECK (service_type IN ('cable','internet')),
  stored_balance numeric(12,2) NOT NULL,
  computed_balance numeric(12,2) NOT NULL,
  drift_amount numeric(12,2) NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by uuid NOT NULL,
  scope text NOT NULL DEFAULT 'single' CHECK (scope IN ('single','bulk'))
);

GRANT SELECT, INSERT ON public.balance_audit TO authenticated;
GRANT ALL ON public.balance_audit TO service_role;

ALTER TABLE public.balance_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their balance audit"
  ON public.balance_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND public.has_role(auth.uid(),'owner'));

CREATE POLICY "System inserts via RPC only"
  ON public.balance_audit FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_balance_audit_subscriber ON public.balance_audit(subscriber_id, reconciled_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_audit_drift ON public.balance_audit(user_id, reconciled_at DESC) WHERE drift_amount <> 0;

-- ---- reconcile_subscriber_balance ---------------------------
CREATE OR REPLACE FUNCTION public.reconcile_subscriber_balance(p_subscriber_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_svc text;
  v_stored numeric(12,2);
  v_computed numeric(12,2);
  v_drift numeric(12,2);
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(v_uid,'owner') THEN
    RAISE EXCEPTION 'Only Owners can reconcile balances.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
    WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  FOREACH v_svc IN ARRAY ARRAY['cable','internet'] LOOP
    v_stored := CASE v_svc WHEN 'cable' THEN COALESCE(v_sub.cable_balance,0)
                          ELSE COALESCE(v_sub.internet_balance,0) END;

    SELECT COALESCE(SUM(
      CASE
        WHEN type = 'charge'     THEN amount
        WHEN type = 'payment'    THEN -amount
        WHEN type = 'refund'     THEN amount
        WHEN type = 'adjustment' THEN -amount
        ELSE 0
      END
    ),0)
    INTO v_computed
    FROM public.transactions
    WHERE subscriber_id = p_subscriber_id
      AND COALESCE(service_type,'cable') = v_svc
      AND status NOT IN ('voided','reversal');

    v_drift := v_computed - v_stored;

    IF v_drift <> 0 THEN
      IF v_svc = 'cable' THEN
        UPDATE public.subscribers SET cable_balance = v_computed, updated_at = now()
         WHERE id = p_subscriber_id;
      ELSE
        UPDATE public.subscribers SET internet_balance = v_computed, updated_at = now()
         WHERE id = p_subscriber_id;
      END IF;
    END IF;

    INSERT INTO public.balance_audit
      (user_id, subscriber_id, service_type, stored_balance, computed_balance, drift_amount, reconciled_by, scope)
    VALUES (v_uid, p_subscriber_id, v_svc, v_stored, v_computed, v_drift, v_uid, 'single');

    v_result := v_result || jsonb_build_object(
      'service_type', v_svc,
      'stored', v_stored,
      'computed', v_computed,
      'drift', v_drift
    );
  END LOOP;

  RETURN jsonb_build_object('subscriber_id', p_subscriber_id, 'services', v_result);
END;
$$;

-- ---- reconcile_all_balances --------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_all_balances()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_checked int := 0;
  v_drifted int := 0;
  v_total_drift numeric(12,2) := 0;
  v_stored numeric(12,2);
  v_computed numeric(12,2);
  v_drift numeric(12,2);
  v_svc text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(v_uid,'owner') THEN
    RAISE EXCEPTION 'Only Owners can reconcile balances.' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT id, cable_balance, internet_balance FROM public.subscribers WHERE user_id = v_uid
  LOOP
    FOREACH v_svc IN ARRAY ARRAY['cable','internet'] LOOP
      v_stored := CASE v_svc WHEN 'cable' THEN COALESCE(v_row.cable_balance,0)
                            ELSE COALESCE(v_row.internet_balance,0) END;
      SELECT COALESCE(SUM(
        CASE
          WHEN type='charge' THEN amount
          WHEN type='payment' THEN -amount
          WHEN type='refund' THEN amount
          WHEN type='adjustment' THEN -amount
          ELSE 0
        END
      ),0)
      INTO v_computed
      FROM public.transactions
      WHERE subscriber_id = v_row.id
        AND COALESCE(service_type,'cable') = v_svc
        AND status NOT IN ('voided','reversal');
      v_drift := v_computed - v_stored;
      v_checked := v_checked + 1;
      IF v_drift <> 0 THEN
        v_drifted := v_drifted + 1;
        v_total_drift := v_total_drift + abs(v_drift);
        IF v_svc = 'cable' THEN
          UPDATE public.subscribers SET cable_balance = v_computed, updated_at = now()
           WHERE id = v_row.id;
        ELSE
          UPDATE public.subscribers SET internet_balance = v_computed, updated_at = now()
           WHERE id = v_row.id;
        END IF;
        INSERT INTO public.balance_audit
          (user_id, subscriber_id, service_type, stored_balance, computed_balance, drift_amount, reconciled_by, scope)
        VALUES (v_uid, v_row.id, v_svc, v_stored, v_computed, v_drift, v_uid, 'bulk');
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'checked', v_checked,
    'drifted', v_drifted,
    'total_drift_absolute', v_total_drift
  );
END;
$$;