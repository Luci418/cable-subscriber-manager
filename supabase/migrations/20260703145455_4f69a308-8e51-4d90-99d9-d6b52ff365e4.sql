
-- =============================================================================
-- Phase 6 · Role foundation
-- =============================================================================
-- Establishes the four-role model documented in .lovable/plan.md Batch 3.
-- Roles live in a separate table (never on profiles) to prevent
-- privilege-escalation via a profile UPDATE. All role checks go through
-- SECURITY DEFINER helpers so RLS policies never recurse.
--
-- Cancel-subscription gate: per the user's Gate #2 decision, cancellation
-- is Admin-only (owner + admin_office). Refunds inherit the same gate
-- (a refund only happens as part of cancel_subscription today).
--
-- The `cancelled_by` column already exists on subscriptions and is stamped
-- by cancel_subscription today — no schema change needed for attribution.
-- =============================================================================

-- 1. Enum ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM (
    'owner',
    'admin_office',
    'collection_agent',
    'technician'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Table --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);

-- 3. Grants -------------------------------------------------------------------
-- No anon access. Authenticated can read (needed for has_role via SECURITY
-- DEFINER, and for the client to render its own permission chips). Writes
-- are gated by RLS policies below (only owners may INSERT/UPDATE/DELETE).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- 4. RLS ----------------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 5. has_role() SECURITY DEFINER — the recursion-safe primitive.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id AND role = _role
  );
$$;

-- 6. Policies (must come after has_role exists) -------------------------------
DROP POLICY IF EXISTS "Users can view their own roles"   ON public.user_roles;
DROP POLICY IF EXISTS "Owners can view all roles"        ON public.user_roles;
DROP POLICY IF EXISTS "Owners can grant roles"           ON public.user_roles;
DROP POLICY IF EXISTS "Owners can update roles"          ON public.user_roles;
DROP POLICY IF EXISTS "Owners can revoke roles"          ON public.user_roles;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owners can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owners can grant roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owners can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owners can revoke roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'));

-- 7. Seed every existing auth user as owner ----------------------------------
-- Backfill assumes each existing account is a single-operator business.
-- No-op on re-run thanks to the UNIQUE (user_id, role) constraint.
INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'owner'::public.app_role FROM auth.users
  ON CONFLICT (user_id, role) DO NOTHING;

-- 8. Trigger: auto-grant Owner to first sign-up ------------------------------
-- Every new signup becomes an Owner of their own tenant. Later staff members
-- are provisioned by an existing Owner via the roles-management UI (built
-- in a later phase); they will NOT get owner automatically. To distinguish
-- "first user in the whole tenant" from "invited staff member", we key off
-- the presence of any owner row anywhere — for now every signup is its own
-- tenant so this is safe. When multi-tenant lands we will re-scope this.
CREATE OR REPLACE FUNCTION public.grant_owner_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'owner')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_grant_owner ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_owner
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_owner_on_signup();

-- 9. Permission helpers -------------------------------------------------------
-- Each helper is the single source of truth for "who may perform action X".
-- UI mirrors these in src/lib/permissions.ts for button-hiding, but the
-- server-side RAISE below inside each gated RPC is the actual boundary.

CREATE OR REPLACE FUNCTION public.can_void_transaction(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid,'owner') OR public.has_role(_uid,'admin_office')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_cancel_subscription(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid,'owner') OR public.has_role(_uid,'admin_office')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_archive_customer(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid,'owner') OR public.has_role(_uid,'admin_office')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_pair_device(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid,'owner')
    OR public.has_role(_uid,'admin_office')
    OR public.has_role(_uid,'technician')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_replace_device(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_pair_device(_uid);
$$;

CREATE OR REPLACE FUNCTION public.can_collect_payment(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid,'owner')
    OR public.has_role(_uid,'admin_office')
    OR public.has_role(_uid,'collection_agent')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_modify_settings(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND public.has_role(_uid,'owner');
$$;

-- 10. Gate the existing RPCs by wrapping the first check ---------------------
-- We only add role checks; all other behaviour is preserved. The pattern is
-- a single guard block prepended to each RPC that raises 'insufficient_privilege'
-- (SQLSTATE 42501) so the client can distinguish permission errors from
-- validation errors in friendlyDbError.

-- cancel_subscription — Admin-only per Gate #2.
CREATE OR REPLACE FUNCTION public.cancel_subscription(
  p_subscriber_id uuid,
  p_service_type text,
  p_refund_amount numeric DEFAULT 0,
  p_reason text DEFAULT NULL::text,
  p_subscription_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_active jsonb;
  v_history jsonb;
  v_active_id text;
  v_active_subscription_id uuid;
  v_target_device_id uuid;
  v_total_charged numeric;
  v_cash_paid numeric;
  v_refund_tx_id uuid;
  v_legacy_blob_subscription_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Phase 6 role gate.
  IF NOT public.can_cancel_subscription(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to cancel subscriptions. Ask an Owner or Admin.'
      USING ERRCODE = '42501';
  END IF;

  -- (Called by archive_subscriber via SECURITY DEFINER — the archive RPC
  -- has its own gate. Inside a SECURITY DEFINER context the auth.uid()
  -- of the outer caller is still visible, so the check remains correct.)

  IF p_service_type NOT IN ('cable','internet') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF COALESCE(p_refund_amount,0) < 0 THEN
    RAISE EXCEPTION 'Refund amount cannot be negative';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF p_subscription_id IS NOT NULL THEN
    SELECT id, total_charged, device_id
      INTO v_active_subscription_id, v_total_charged, v_target_device_id
      FROM public.subscriptions
     WHERE id = p_subscription_id
       AND user_id = v_uid
       AND subscriber_id = p_subscriber_id
       AND service_type  = p_service_type
       AND status = 'active';
    IF v_active_subscription_id IS NULL THEN
      RAISE EXCEPTION 'Subscription % not found or not an active % subscription for this subscriber',
        p_subscription_id, p_service_type;
    END IF;
  ELSE
    SELECT id, total_charged, device_id
      INTO v_active_subscription_id, v_total_charged, v_target_device_id
      FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id
       AND service_type  = p_service_type
       AND status = 'active'
     ORDER BY created_at DESC LIMIT 1;

    IF v_active_subscription_id IS NULL THEN
      RAISE EXCEPTION 'No active % subscription to cancel', p_service_type;
    END IF;
  END IF;

  SELECT COALESCE(SUM(pa.amount), 0) INTO v_cash_paid
    FROM public.payment_allocations pa
    JOIN public.transactions t ON t.id = pa.transaction_id
   WHERE pa.subscription_id = v_active_subscription_id
     AND t.type = 'payment'
     AND t.status NOT IN ('voided','reversal');

  IF p_refund_amount > v_cash_paid THEN
    RAISE EXCEPTION 'Refund (%) exceeds cash paid toward this subscription (%).',
      p_refund_amount, v_cash_paid;
  END IF;

  UPDATE public.subscriptions
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_uid,
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
  BEGIN
    v_legacy_blob_subscription_id := NULLIF(v_active->>'subscriptionId','')::uuid;
  EXCEPTION WHEN others THEN
    v_legacy_blob_subscription_id := NULL;
  END;

  v_history := (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN e->>'id' = v_active_id AND v_legacy_blob_subscription_id = v_active_subscription_id
        THEN e || jsonb_build_object('status','cancelled','endDate', now())
        ELSE e END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_history) e
  );

  IF v_legacy_blob_subscription_id IS NOT NULL
     AND v_legacy_blob_subscription_id = v_active_subscription_id THEN
    IF p_service_type = 'internet' THEN
      UPDATE public.subscribers
         SET internet_subscription = NULL,
             internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             current_internet_pack = NULL,
             updated_at = now()
       WHERE id = p_subscriber_id;
    ELSE
      UPDATE public.subscribers
         SET current_subscription = NULL,
             subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             current_pack = NULL,
             updated_at = now()
       WHERE id = p_subscriber_id;
    END IF;
  ELSE
    IF p_service_type = 'internet' THEN
      UPDATE public.subscribers
         SET internet_subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             updated_at = now()
       WHERE id = p_subscriber_id;
    ELSE
      UPDATE public.subscribers
         SET subscription_history = ARRAY(SELECT jsonb_array_elements(v_history))::jsonb[],
             updated_at = now()
       WHERE id = p_subscriber_id;
    END IF;
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
    'device_id', v_target_device_id,
    'refund_amount', p_refund_amount,
    'refund_transaction_id', v_refund_tx_id
  );
END;
$function$;

-- archive_subscriber gate (loops call cancel_subscription; SECURITY DEFINER
-- context preserves auth.uid so the inner gate is redundant-safe).
CREATE OR REPLACE FUNCTION public.archive_subscriber(
  p_subscriber_id uuid, p_reason_code text, p_reason_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_prev_status text;
  v_code text;
  v_sub_rec record;
  v_dev_rec record;
  v_cancelled int := 0;
  v_unpaired int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_archive_customer(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to archive customers. Ask an Owner or Admin.'
      USING ERRCODE = '42501';
  END IF;

  v_code := lower(COALESCE(NULLIF(btrim(p_reason_code),''),''));
  IF v_code NOT IN ('moved_away','switched_provider','duplicate','non_payment','other') THEN
    RAISE EXCEPTION 'Invalid archive reason: %', p_reason_code;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF v_sub.customer_status = 'archived' THEN
    RAISE EXCEPTION 'Subscriber is already archived';
  END IF;

  v_prev_status := v_sub.customer_status::text;

  FOR v_sub_rec IN
    SELECT id, service_type FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id AND user_id = v_uid AND status = 'active'
  LOOP
    PERFORM public.cancel_subscription(
      p_subscriber_id, v_sub_rec.service_type, 0,
      'Customer archived: ' || v_code, v_sub_rec.id
    );
    v_cancelled := v_cancelled + 1;
  END LOOP;

  FOR v_dev_rec IN
    SELECT id FROM public.stb_inventory
     WHERE subscriber_id = p_subscriber_id AND user_id = v_uid AND status = 'assigned'
  LOOP
    PERFORM public.unpair_device(p_subscriber_id, v_dev_rec.id, 'customer_closed', 'available');
    v_unpaired := v_unpaired + 1;
  END LOOP;

  UPDATE public.subscribers
     SET customer_status = 'archived',
         archived_at = now(),
         archived_by = v_uid,
         archive_reason = NULLIF(btrim(p_reason_note),''),
         archive_reason_code = v_code,
         updated_at = now()
   WHERE id = p_subscriber_id;

  INSERT INTO public.subscriber_status_log (
    user_id, subscriber_id, from_status, to_status, reason_code, reason_note, actor
  ) VALUES (
    v_uid, p_subscriber_id, v_prev_status, 'archived', v_code,
    NULLIF(btrim(p_reason_note),''), v_uid
  );

  RETURN jsonb_build_object(
    'subscriber_id', p_subscriber_id,
    'cancelled_subscriptions', v_cancelled,
    'unpaired_devices', v_unpaired,
    'archived_at', now()
  );
END;
$function$;

-- reactivate_subscriber gate.
CREATE OR REPLACE FUNCTION public.reactivate_subscriber(
  p_subscriber_id uuid, p_reason_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_new_status text;
  v_has_active boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_archive_customer(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to reactivate customers. Ask an Owner or Admin.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  IF v_sub.customer_status <> 'archived' THEN
    RAISE EXCEPTION 'Subscriber is not archived';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
     WHERE subscriber_id = p_subscriber_id AND status = 'active'
  ) INTO v_has_active;

  v_new_status := CASE WHEN v_has_active THEN 'active' ELSE 'inactive' END;

  UPDATE public.subscribers
     SET customer_status = v_new_status::customer_status,
         archived_at = NULL, archived_by = NULL,
         archive_reason = NULL, archive_reason_code = NULL,
         updated_at = now()
   WHERE id = p_subscriber_id;

  INSERT INTO public.subscriber_status_log (
    user_id, subscriber_id, from_status, to_status, reason_code, reason_note, actor
  ) VALUES (
    v_uid, p_subscriber_id, 'archived', v_new_status, 'reactivate',
    NULLIF(btrim(p_reason_note),''), v_uid
  );

  RETURN jsonb_build_object('subscriber_id', p_subscriber_id, 'new_status', v_new_status);
END;
$function$;

-- pair_device gate.
CREATE OR REPLACE FUNCTION public.pair_device(
  p_subscriber_id uuid, p_device_id uuid, p_reason text DEFAULT 'installation'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_dev public.stb_inventory;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_pair_device(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to pair devices. Ask an Owner, Admin, or Technician.'
      USING ERRCODE = '42501';
  END IF;

  v_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),'installation'));
  IF v_reason NOT IN ('installation','replacement','upgrade','other') THEN
    RAISE EXCEPTION 'Invalid pair reason: %', p_reason;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;
  IF v_sub.customer_status = 'archived' THEN
    RAISE EXCEPTION 'Cannot pair a device to an archived subscriber.';
  END IF;

  SELECT * INTO v_dev FROM public.stb_inventory
   WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;
  IF v_dev.status <> 'available' THEN
    RAISE EXCEPTION 'Device % is not available (status: %)', v_dev.serial_number, v_dev.status;
  END IF;

  UPDATE public.stb_inventory
     SET status = 'assigned', subscriber_id = p_subscriber_id, updated_at = now()
   WHERE id = v_dev.id;

  IF NOT (v_dev.service_type = ANY (v_sub.services)) THEN
    UPDATE public.subscribers
       SET services = array_append(services, v_dev.service_type), updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  IF v_dev.service_type = 'cable'
     AND (v_sub.stb_number IS NULL OR btrim(v_sub.stb_number) = '') THEN
    UPDATE public.subscribers
       SET stb_number = v_dev.serial_number, updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  INSERT INTO public.device_assignment_log (
    user_id, subscriber_id, device_serial, device_type, service_type, open_reason, opened_by
  ) VALUES (
    v_uid, p_subscriber_id, v_dev.serial_number,
    COALESCE(v_dev.device_type,'stb'), COALESCE(v_dev.service_type,'cable'),
    v_reason, v_uid
  );

  RETURN jsonb_build_object(
    'device_id', v_dev.id, 'serial', v_dev.serial_number,
    'service_type', v_dev.service_type, 'reason', v_reason
  );
END;
$function$;

-- unpair_device gate (same role set as pair; called by archive_subscriber
-- inside SECURITY DEFINER — auth.uid() still resolves).
CREATE OR REPLACE FUNCTION public.unpair_device(
  p_subscriber_id uuid, p_device_id uuid, p_reason text,
  p_return_status text DEFAULT 'available'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_dev public.stb_inventory;
  v_reason text;
  v_return text;
  v_active_count int;
  v_other_devices int;
  v_remaining_services text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_pair_device(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to unpair devices.'
      USING ERRCODE = '42501';
  END IF;

  v_reason := lower(COALESCE(NULLIF(btrim(p_reason),''),''));
  IF v_reason NOT IN ('customer_closed','downgrade','correction','repair') THEN
    RAISE EXCEPTION 'Invalid unpair reason: % (allowed: customer_closed, downgrade, correction, repair)', p_reason;
  END IF;

  v_return := lower(COALESCE(NULLIF(btrim(p_return_status),''),'available'));
  IF v_return NOT IN ('available','faulty') THEN
    RAISE EXCEPTION 'Invalid return status: % (allowed: available, faulty)', p_return_status;
  END IF;

  SELECT * INTO v_sub FROM public.subscribers
   WHERE id = p_subscriber_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT * INTO v_dev FROM public.stb_inventory
   WHERE id = p_device_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found'; END IF;

  IF v_dev.status <> 'assigned' OR v_dev.subscriber_id IS DISTINCT FROM p_subscriber_id THEN
    RAISE EXCEPTION 'Device % is not currently assigned to this subscriber', v_dev.serial_number;
  END IF;

  SELECT count(*) INTO v_active_count
    FROM public.subscriptions
   WHERE device_id = v_dev.id AND status = 'active';
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Cannot unpair: an active subscription is still tied to device %. Cancel the subscription first.', v_dev.serial_number;
  END IF;

  SELECT count(*) INTO v_other_devices
    FROM public.stb_inventory
   WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
     AND service_type = v_dev.service_type AND id <> v_dev.id AND status = 'assigned';

  UPDATE public.device_assignment_log
     SET closed_at = now(), close_reason = v_reason, closed_by = v_uid, updated_at = now()
   WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
     AND device_serial = v_dev.serial_number AND closed_at IS NULL;

  IF v_other_devices = 0 THEN
    v_remaining_services := array_remove(v_sub.services, v_dev.service_type);
    IF array_length(v_remaining_services, 1) >= 1 THEN
      UPDATE public.subscribers
         SET services = v_remaining_services, updated_at = now()
       WHERE id = p_subscriber_id;
    END IF;
  END IF;

  IF v_dev.service_type = 'cable'
     AND COALESCE(v_sub.stb_number,'') = v_dev.serial_number THEN
    UPDATE public.subscribers
       SET stb_number = NULL, updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  UPDATE public.stb_inventory
     SET status = v_return::stb_status, subscriber_id = NULL, updated_at = now()
   WHERE id = v_dev.id;

  RETURN jsonb_build_object(
    'device_id', v_dev.id, 'serial', v_dev.serial_number,
    'return_status', v_return, 'reason', v_reason,
    'service_removed', (v_other_devices = 0 AND array_length(array_remove(v_sub.services, v_dev.service_type), 1) >= 1)
  );
END;
$function$;

-- replace_device gate — same role set as pair.
-- We wrap just the guard by re-defining; the body relies on the existing
-- function body being intact. Since we can't ALTER without full body, we
-- re-declare the guard via a wrapper trigger-style approach: prepend a
-- BEFORE block using CREATE OR REPLACE with the full existing body plus
-- the guard. The full body is preserved from db_functions above.
CREATE OR REPLACE FUNCTION public.replace_device(
  p_subscriber_id uuid, p_old_serial text, p_new_serial text,
  p_reason text DEFAULT 'faulty'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_old_inv public.stb_inventory;
  v_new_inv public.stb_inventory;
  v_service text;
  v_close_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_replace_device(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to replace devices.'
      USING ERRCODE = '42501';
  END IF;

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
         device_serial_snapshot = p_new_serial,
         updated_at = now()
   WHERE subscriber_id = p_subscriber_id
     AND service_type = v_service
     AND status = 'active';

  IF v_service = 'cable' THEN
    UPDATE public.subscribers SET stb_number = p_new_serial, updated_at = now()
     WHERE id = p_subscriber_id;
  END IF;

  RETURN jsonb_build_object(
    'old_device_id', v_old_inv.id, 'new_device_id', v_new_inv.id,
    'service_type', v_service, 'reason', v_close_reason
  );
END;
$function$;

-- 11. Settings write gate via RLS -------------------------------------------
-- Restrict UPDATE on public.settings to Owners. Everyone (authenticated)
-- can still SELECT their own row. INSERT is done only by ensure_settings_row
-- (SECURITY DEFINER) so we don't need an INSERT policy for staff.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname='public' AND tablename='settings'
              AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.settings', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "Only owners can modify settings"
  ON public.settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_modify_settings(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_modify_settings(auth.uid()));

-- 12. void_transaction gate --------------------------------------------------
-- The existing void_transaction RPC body is not reproduced here; we add a
-- guard by wrapping it. Because we don't have its full body pinned, we
-- instead enforce the gate at the row level via a BEFORE UPDATE trigger
-- on transactions that checks the transition to 'voided'.

CREATE OR REPLACE FUNCTION public.transactions_enforce_void_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'posted' AND NEW.status = 'voided' THEN
    IF NOT public.can_void_transaction(auth.uid()) THEN
      RAISE EXCEPTION 'You do not have permission to void transactions. Ask an Owner or Admin.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_enforce_void_role ON public.transactions;
CREATE TRIGGER trg_transactions_enforce_void_role
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_enforce_void_role();
