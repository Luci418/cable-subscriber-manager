# Invariants Sprint — revised plan

User decisions:
- Phase 3 FK migration: **YES** (region_id, pack_id, internet_pack_id, stb FK, providers.service_type).
- Phase 4 normalize `subscriptions` table: **YES**.
- Backfill: **SKIP** — demo data, start fresh. Drop & recreate is acceptable.

## Phases

1. **Phase 1 — Atomic RPCs ✅ DONE**
   - `create_subscription`, `cancel_subscription`, balance trigger is sole writer.

2. **Phase 2 — Hard constraints on `subscribers` (in progress)**
   - CHECK: `services` non-empty, subset of `{cable, internet}`.
   - CHECK: `mobile` format.
   - BEFORE UPDATE trigger blocks while corresponding subscription is active:
     - dropping `cable`/`internet` from `services`
     - changing `stb_number` (cable) / internet device fields
     - changing `cable_provider_id` / `internet_provider_id`
   - BEFORE INSERT/UPDATE: if `cable` ∈ services → `stb_number` required.
   - Map new errors in `dbErrors.ts`.
   - Fix `EditSubscriberDialog` to disable locked fields with clear reasons.

3. **Phase 3 — Referential integrity**
   - `regions.id`, `packs.id` already exist. Add columns `region_id`, `pack_id`, `internet_pack_id` to `subscribers` as FKs.
   - Drop old text columns `region`, `current_pack`, `current_internet_pack` (no backfill — demo reset).
   - Add `providers.service_type` enum; constrain `cable_provider_id` to cable providers, `internet_provider_id` to internet providers.
   - `subscribers.stb_number` validated via trigger against `stb_inventory.serial_number` (per-user).
   - `stb_inventory` CHECK: cannot transition to `assigned` from `faulty`/`decommissioned`.

4. **Phase 4 — Normalize `subscriptions` table**
   - New table `subscriptions(id, subscriber_id, service_type, pack_id, status enum, start_date, end_date, duration, price, provider_id, created_at, cancelled_at, cancel_reason)`.
   - RPCs rewritten to insert/update rows here instead of JSONB.
   - `subscribers.active_cable_subscription_id`, `active_internet_subscription_id` FK (denormalized for read locality).
   - Drop JSONB columns `current_subscription`, `internet_subscription`, history arrays (no backfill).
   - Read-path updates: `useSubscriptions` hook, all components consuming JSONB.

5. **Phase 5 — Transaction validation triggers**
   - INSERT trigger: `service_type` ∈ subscriber `services`; `provider_id` matches per-service provider.
   - Cumulative refunds ≤ cumulative charges per subscription_id.

## Approach

Each phase = one migration + client refactor + CHANGELOG + ADR update. Test in preview between phases.
