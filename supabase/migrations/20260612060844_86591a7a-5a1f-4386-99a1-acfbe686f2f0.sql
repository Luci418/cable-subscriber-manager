
-- Phase 3 — Referential integrity (FK migration)
-- Adds DB-level foreign keys for INV-28/30. No data backfill (demo data fresh-start).
-- New nullable region_id / current_pack_id / current_internet_pack_id columns
-- live alongside the existing text columns; Phase 4 will normalize.

-- 1. New FK columns on subscribers (nullable, no backfill)
ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS region_id uuid,
  ADD COLUMN IF NOT EXISTS current_pack_id uuid,
  ADD COLUMN IF NOT EXISTS current_internet_pack_id uuid;

-- 2. Foreign keys on subscribers
ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_region_id_fkey,
  ADD  CONSTRAINT subscribers_region_id_fkey
       FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE RESTRICT;

ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_current_pack_id_fkey,
  ADD  CONSTRAINT subscribers_current_pack_id_fkey
       FOREIGN KEY (current_pack_id) REFERENCES public.packs(id) ON DELETE RESTRICT;

ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_current_internet_pack_id_fkey,
  ADD  CONSTRAINT subscribers_current_internet_pack_id_fkey
       FOREIGN KEY (current_internet_pack_id) REFERENCES public.packs(id) ON DELETE RESTRICT;

ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_cable_provider_id_fkey,
  ADD  CONSTRAINT subscribers_cable_provider_id_fkey
       FOREIGN KEY (cable_provider_id) REFERENCES public.providers(id) ON DELETE RESTRICT;

ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_internet_provider_id_fkey,
  ADD  CONSTRAINT subscribers_internet_provider_id_fkey
       FOREIGN KEY (internet_provider_id) REFERENCES public.providers(id) ON DELETE RESTRICT;

-- 3. Packs → providers
ALTER TABLE public.packs
  DROP CONSTRAINT IF EXISTS packs_provider_id_fkey,
  ADD  CONSTRAINT packs_provider_id_fkey
       FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE RESTRICT;

-- 4. Transactions → subscribers / providers / self (reversal chain)
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_subscriber_id_fkey,
  ADD  CONSTRAINT transactions_subscriber_id_fkey
       FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE RESTRICT;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_provider_id_fkey,
  ADD  CONSTRAINT transactions_provider_id_fkey
       FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_reverses_transaction_id_fkey,
  ADD  CONSTRAINT transactions_reverses_transaction_id_fkey
       FOREIGN KEY (reverses_transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;

-- 5. STB inventory → subscribers (nullable; release on subscriber delete)
ALTER TABLE public.stb_inventory
  DROP CONSTRAINT IF EXISTS stb_inventory_subscriber_id_fkey,
  ADD  CONSTRAINT stb_inventory_subscriber_id_fkey
       FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;

-- 6. Transaction notes → transactions (cascade: notes are children)
ALTER TABLE public.transaction_notes
  DROP CONSTRAINT IF EXISTS transaction_notes_transaction_id_fkey,
  ADD  CONSTRAINT transaction_notes_transaction_id_fkey
       FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

-- 7. Complaints → subscribers (block delete while complaints exist)
ALTER TABLE public.complaints
  DROP CONSTRAINT IF EXISTS complaints_subscriber_id_fkey,
  ADD  CONSTRAINT complaints_subscriber_id_fkey
       FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE RESTRICT;

-- 8. Helpful indexes for the new FK columns (FKs do not auto-index referencing side)
CREATE INDEX IF NOT EXISTS idx_subscribers_region_id              ON public.subscribers(region_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_current_pack_id        ON public.subscribers(current_pack_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_current_internet_pack  ON public.subscribers(current_internet_pack_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_cable_provider_id      ON public.subscribers(cable_provider_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_internet_provider_id   ON public.subscribers(internet_provider_id);
CREATE INDEX IF NOT EXISTS idx_packs_provider_id                  ON public.packs(provider_id);
CREATE INDEX IF NOT EXISTS idx_transactions_subscriber_id         ON public.transactions(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_transactions_provider_id           ON public.transactions(provider_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reverses              ON public.transactions(reverses_transaction_id);
CREATE INDEX IF NOT EXISTS idx_stb_inventory_subscriber_id        ON public.stb_inventory(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_transaction_notes_transaction_id   ON public.transaction_notes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_complaints_subscriber_id           ON public.complaints(subscriber_id);
