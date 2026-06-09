
-- 1) Attach the cable STB sync trigger (function already exists).
DROP TRIGGER IF EXISTS trg_subscribers_sync_stb ON public.subscribers;
CREATE TRIGGER trg_subscribers_sync_stb
AFTER INSERT OR UPDATE OF stb_number OR DELETE ON public.subscribers
FOR EACH ROW EXECUTE FUNCTION public.sync_stb_inventory_on_subscriber_change();

-- 2) Reconcile current state for cable STBs (one-time heal).
-- a) Mark inventory rows referenced by a subscriber as 'assigned' with the correct subscriber_id.
UPDATE public.stb_inventory i
   SET status = 'assigned',
       subscriber_id = s.id,
       updated_at = now()
  FROM public.subscribers s
 WHERE i.user_id = s.user_id
   AND s.stb_number IS NOT NULL
   AND s.stb_number <> ''
   AND i.serial_number = s.stb_number
   AND (i.status <> 'assigned' OR i.subscriber_id IS DISTINCT FROM s.id);

-- b) Release inventory rows whose subscriber_id no longer matches any live assignment.
UPDATE public.stb_inventory i
   SET status = 'available',
       subscriber_id = NULL,
       updated_at = now()
 WHERE i.status = 'assigned'
   AND i.device_type = 'stb'
   AND NOT EXISTS (
       SELECT 1 FROM public.subscribers s
        WHERE s.user_id = i.user_id
          AND s.stb_number = i.serial_number
   );

-- 3) Reusable reconcile function for operators / future cron.
CREATE OR REPLACE FUNCTION public.reconcile_stb_inventory()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_assigned int := 0;
  v_released int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH upd AS (
    UPDATE public.stb_inventory i
       SET status = 'assigned',
           subscriber_id = s.id,
           updated_at = now()
      FROM public.subscribers s
     WHERE i.user_id = v_uid
       AND s.user_id = v_uid
       AND s.stb_number IS NOT NULL AND s.stb_number <> ''
       AND i.serial_number = s.stb_number
       AND (i.status <> 'assigned' OR i.subscriber_id IS DISTINCT FROM s.id)
     RETURNING 1
  ) SELECT count(*) INTO v_assigned FROM upd;

  WITH upd AS (
    UPDATE public.stb_inventory i
       SET status = 'available',
           subscriber_id = NULL,
           updated_at = now()
     WHERE i.user_id = v_uid
       AND i.status = 'assigned'
       AND i.device_type = 'stb'
       AND NOT EXISTS (
           SELECT 1 FROM public.subscribers s
            WHERE s.user_id = v_uid AND s.stb_number = i.serial_number
       )
     RETURNING 1
  ) SELECT count(*) INTO v_released FROM upd;

  RETURN jsonb_build_object('assigned_fixed', v_assigned, 'released_fixed', v_released);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_stb_inventory() TO authenticated;
