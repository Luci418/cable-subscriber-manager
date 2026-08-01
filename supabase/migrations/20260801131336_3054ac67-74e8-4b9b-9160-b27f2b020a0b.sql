-- 1. Enum value for sync-created charges
ALTER TYPE public.transaction_source ADD VALUE IF NOT EXISTS 'provider_sync';

-- 2. Permission gate
CREATE OR REPLACE FUNCTION public.can_sync_provider(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'owner') OR public.has_role(_uid, 'admin_office');
$$;

-- 3. providers.sync_policy
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS sync_policy jsonb NOT NULL DEFAULT '{
    "create_charges": true,
    "create_prospects": true,
    "update_plan_state": true,
    "update_provider_status": true,
    "update_identity_name": false,
    "update_identity_mobile": false,
    "update_identity_address": false,
    "auto_pair_devices": false
  }'::jsonb;

-- 4. stb_inventory.vc_id
ALTER TABLE public.stb_inventory
  ADD COLUMN IF NOT EXISTS vc_id text;

CREATE UNIQUE INDEX IF NOT EXISTS stb_inventory_user_vc_id_key
  ON public.stb_inventory (user_id, vc_id)
  WHERE vc_id IS NOT NULL;

-- 5. provider_import_runs
CREATE TABLE public.provider_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  report_type text NOT NULL,
  file_name text,
  status text NOT NULL DEFAULT 'draft',
  row_count integer NOT NULL DEFAULT 0,
  snapshot_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  events_detected jsonb NOT NULL DEFAULT '[]'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_import_runs_status_chk CHECK (status IN ('draft','committed','cancelled')),
  CONSTRAINT provider_import_runs_report_type_chk CHECK (report_type IN ('customer_master','dashboard_status'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_import_runs TO authenticated;
GRANT ALL ON public.provider_import_runs TO service_role;
ALTER TABLE public.provider_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own provider import runs"
  ON public.provider_import_runs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX provider_import_runs_baseline_idx
  ON public.provider_import_runs (provider_id, report_type, imported_at DESC)
  WHERE status = 'committed';

-- 6. provider_pack_mappings
CREATE TABLE public.provider_pack_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  provider_plan_key text NOT NULL,
  provider_plan_label text,
  pack_id uuid REFERENCES public.packs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_pack_mappings_unique UNIQUE (user_id, provider_id, provider_plan_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_pack_mappings TO authenticated;
GRANT ALL ON public.provider_pack_mappings TO service_role;
ALTER TABLE public.provider_pack_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own provider pack mappings"
  ON public.provider_pack_mappings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 7. subscriber_provider_state
CREATE TABLE public.subscriber_provider_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  provider_customer_number text,
  provider_plan_name text,
  provider_plan_start date,
  provider_plan_end date,
  provider_status text,
  last_seen_in_snapshot_at timestamptz,
  last_import_run_id uuid REFERENCES public.provider_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriber_provider_state_unique UNIQUE (subscriber_id, provider_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriber_provider_state TO authenticated;
GRANT ALL ON public.subscriber_provider_state TO service_role;
ALTER TABLE public.subscriber_provider_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own subscriber provider state"
  ON public.subscriber_provider_state FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX subscriber_provider_state_provider_customer_idx
  ON public.subscriber_provider_state (user_id, provider_id, provider_customer_number);

-- 8. updated_at triggers
CREATE TRIGGER update_provider_import_runs_updated_at
  BEFORE UPDATE ON public.provider_import_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_provider_pack_mappings_updated_at
  BEFORE UPDATE ON public.provider_pack_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subscriber_provider_state_updated_at
  BEFORE UPDATE ON public.subscriber_provider_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Immutability of committed runs (INV-48)
CREATE OR REPLACE FUNCTION public.provider_import_runs_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'committed' THEN
      RAISE EXCEPTION 'Committed provider import runs cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'committed' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.results::text IS DISTINCT FROM OLD.results::text
       OR NEW.snapshot_data::text IS DISTINCT FROM OLD.snapshot_data::text
       OR NEW.events_detected::text IS DISTINCT FROM OLD.events_detected::text
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.report_type IS DISTINCT FROM OLD.report_type
       OR NEW.committed_at IS DISTINCT FROM OLD.committed_at THEN
      RAISE EXCEPTION 'Committed provider import runs are immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_import_runs_immutability
  BEFORE UPDATE OR DELETE ON public.provider_import_runs
  FOR EACH ROW EXECUTE FUNCTION public.provider_import_runs_enforce_immutability();