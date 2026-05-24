
-- 1) Clean up known duplicate STB assignments before applying uniqueness
UPDATE public.subscribers
SET stb_number = NULL
WHERE stb_number = '832B005E756';

-- 2) Drop any obviously invalid mobiles first so the CHECK can be added
--    (no-op if none exist; we keep this idempotent by validating instead of mutating)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.subscribers WHERE mobile !~ '^\d{7,15}$') THEN
    RAISE NOTICE 'Some subscribers have non-conforming mobile numbers; CHECK will be added as NOT VALID.';
  END IF;
END $$;

-- 3) Foreign keys (cascade/set-null) so orphan rows become impossible
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_subscriber_fk
  FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;

ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_subscriber_fk
  FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;

ALTER TABLE public.stb_inventory
  ADD CONSTRAINT stb_inventory_subscriber_fk
  FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;

-- 4) Uniqueness — per-tenant (user_id) where it makes sense
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscribers_user_subscriberid
  ON public.subscribers(user_id, subscriber_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscribers_user_mobile
  ON public.subscribers(user_id, mobile);

-- Same STB number can never be on two subscribers within the same tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscribers_user_stb
  ON public.subscribers(user_id, stb_number)
  WHERE stb_number IS NOT NULL AND stb_number <> '';

-- Inventory: serial number unique per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_stb_inventory_user_serial
  ON public.stb_inventory(user_id, serial_number);

-- One assigned device per (subscriber, service_type) — prevents two STBs on one cable account, etc.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stb_inventory_sub_service
  ON public.stb_inventory(subscriber_id, service_type)
  WHERE subscriber_id IS NOT NULL;

-- Packs unique by name per tenant per service_type (cable vs internet packs may share names across services)
CREATE UNIQUE INDEX IF NOT EXISTS uq_packs_user_name_service
  ON public.packs(user_id, name, service_type);

-- Regions unique per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_regions_user_name
  ON public.regions(user_id, name);

-- 5) CHECK constraints for sanity
ALTER TABLE public.subscribers
  ADD CONSTRAINT subscribers_mobile_format
  CHECK (mobile ~ '^\d{7,15}$') NOT VALID;

ALTER TABLE public.subscribers
  ADD CONSTRAINT subscribers_name_nonblank
  CHECK (length(btrim(name)) > 0) NOT VALID;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_amount_nonneg
  CHECK (amount >= 0) NOT VALID;

ALTER TABLE public.packs
  ADD CONSTRAINT packs_price_nonneg
  CHECK (price >= 0) NOT VALID;

-- 6) Reconciliation trigger — keep stb_inventory in lock-step with subscribers.stb_number
--    Whenever a subscriber's stb_number is set/changed/cleared, flip the matching
--    inventory rows so status + subscriber_id are always consistent.
CREATE OR REPLACE FUNCTION public.sync_stb_inventory_on_subscriber_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Release previously held STB (on UPDATE or DELETE)
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.stb_number IS NOT NULL AND OLD.stb_number <> '' THEN
    UPDATE public.stb_inventory
       SET status = 'available', subscriber_id = NULL, updated_at = now()
     WHERE user_id = OLD.user_id
       AND serial_number = OLD.stb_number
       AND subscriber_id = OLD.id;
  END IF;

  -- Claim new STB (on INSERT or UPDATE)
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.stb_number IS NOT NULL AND NEW.stb_number <> '' THEN
    UPDATE public.stb_inventory
       SET status = 'assigned', subscriber_id = NEW.id, updated_at = now()
     WHERE user_id = NEW.user_id
       AND serial_number = NEW.stb_number;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stb_inventory ON public.subscribers;
CREATE TRIGGER trg_sync_stb_inventory
AFTER INSERT OR UPDATE OF stb_number OR DELETE ON public.subscribers
FOR EACH ROW EXECUTE FUNCTION public.sync_stb_inventory_on_subscriber_change();

-- 7) One-time reconciliation of existing inventory vs subscribers state
UPDATE public.stb_inventory i
   SET status = 'available', subscriber_id = NULL, updated_at = now()
 WHERE i.status = 'assigned'
   AND (i.subscriber_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.subscribers s
                        WHERE s.id = i.subscriber_id
                          AND s.stb_number = i.serial_number));

UPDATE public.stb_inventory i
   SET status = 'assigned', subscriber_id = s.id, updated_at = now()
  FROM public.subscribers s
 WHERE s.user_id = i.user_id
   AND s.stb_number = i.serial_number
   AND (i.subscriber_id IS DISTINCT FROM s.id OR i.status <> 'assigned');
