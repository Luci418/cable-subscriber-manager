CREATE TABLE public.device_status_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  device_id    uuid NOT NULL REFERENCES public.stb_inventory(id) ON DELETE CASCADE,
  device_serial text NOT NULL,
  from_status  public.stb_status,
  to_status    public.stb_status NOT NULL,
  reason       text,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  changed_by   uuid
);

GRANT SELECT, INSERT ON public.device_status_log TO authenticated;
GRANT ALL ON public.device_status_log TO service_role;

ALTER TABLE public.device_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own device status log"
  ON public.device_status_log FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own device status log"
  ON public.device_status_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX device_status_log_device_idx
  ON public.device_status_log (device_id, changed_at DESC);
CREATE INDEX device_status_log_serial_idx
  ON public.device_status_log (device_serial, changed_at DESC);

CREATE OR REPLACE FUNCTION public.device_status_log_enforce_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'device_status_log is append-only.'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER device_status_log_immutable_trg
  BEFORE UPDATE OR DELETE ON public.device_status_log
  FOR EACH ROW EXECUTE FUNCTION public.device_status_log_enforce_immutability();

CREATE OR REPLACE FUNCTION public.stb_inventory_log_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.device_status_log (
      user_id, device_id, device_serial, from_status, to_status, reason, changed_by
    ) VALUES (
      NEW.user_id, NEW.id, NEW.serial_number, OLD.status, NEW.status,
      CASE WHEN NEW.notes IS DISTINCT FROM OLD.notes THEN NEW.notes ELSE NULL END,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stb_inventory_status_change_trg
  AFTER UPDATE ON public.stb_inventory
  FOR EACH ROW EXECUTE FUNCTION public.stb_inventory_log_status_change();