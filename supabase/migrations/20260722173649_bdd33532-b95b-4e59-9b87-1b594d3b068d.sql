
-- =====================================================================
-- Batch: pre-deploy cleanup
--   1. settings_audit — append-only diff log of settings changes.
--   2. mark_device_repaired RPC + device_status_log entry with notes.
-- =====================================================================

-- 1. Settings audit trail --------------------------------------------
CREATE TABLE public.settings_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,             -- settings row owner
  changed_by   UUID,                      -- auth.uid() at the time
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  field_name   TEXT NOT NULL,
  old_value    TEXT,
  new_value    TEXT
);

CREATE INDEX settings_audit_user_idx  ON public.settings_audit(user_id, changed_at DESC);

GRANT SELECT ON public.settings_audit TO authenticated;
GRANT ALL    ON public.settings_audit TO service_role;

ALTER TABLE public.settings_audit ENABLE ROW LEVEL SECURITY;

-- Owner-only read; nobody may write directly — inserts happen inside the
-- SECURITY DEFINER trigger below.
CREATE POLICY "Owners read own settings audit"
  ON public.settings_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND public.has_role(auth.uid(), 'owner'));

-- Diff trigger: emit one row per column whose value actually changed.
CREATE OR REPLACE FUNCTION public.settings_audit_diff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  col      RECORD;
  old_val  TEXT;
  new_val  TEXT;
  actor    UUID := auth.uid();
  o_json   JSONB := to_jsonb(OLD);
  n_json   JSONB := to_jsonb(NEW);
BEGIN
  FOR col IN
    SELECT key FROM jsonb_object_keys(n_json) AS k(key)
    WHERE key NOT IN ('updated_at','created_at','user_id','settings_version')
  LOOP
    old_val := o_json ->> col.key;
    new_val := n_json ->> col.key;
    IF old_val IS DISTINCT FROM new_val THEN
      INSERT INTO public.settings_audit (user_id, changed_by, field_name, old_value, new_value)
      VALUES (NEW.user_id, actor, col.key, old_val, new_val);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settings_audit_diff ON public.settings;
CREATE TRIGGER trg_settings_audit_diff
  AFTER UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.settings_audit_diff();

-- 2. mark_device_repaired RPC ----------------------------------------
CREATE OR REPLACE FUNCTION public.mark_device_repaired(
  p_device_id     UUID,
  p_repair_notes  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_device stb_inventory%ROWTYPE;
BEGIN
  -- Permission gate — same role set as mark_device_faulty.
  IF NOT public.can_replace_device(auth.uid()) THEN
    RAISE EXCEPTION 'permission denied: mark_device_repaired'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_device FROM public.stb_inventory WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device % not found', p_device_id USING ERRCODE = 'P0002';
  END IF;

  IF v_device.status <> 'faulty' THEN
    RAISE EXCEPTION 'Device % is not currently faulty (status: %)',
      v_device.serial_number, v_device.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.stb_inventory
     SET status = 'available',
         notes  = COALESCE(p_repair_notes, notes)
   WHERE id = p_device_id;

  -- Explicit status-log entry with repair notes. The trigger on
  -- stb_inventory also logs the transition, but our own row carries the
  -- operator-supplied notes for auditability.
  INSERT INTO public.device_status_log
    (device_id, device_serial, from_status, to_status, reason, changed_by)
  VALUES
    (p_device_id, v_device.serial_number, 'faulty', 'available',
     COALESCE(p_repair_notes, 'Repaired'), auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.mark_device_repaired(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_device_repaired(UUID, TEXT) TO authenticated;
