# Invariants Sprint — revised plan (post BUSINESS_MODEL v3.0)

**Authoritative spec:** [docs/BUSINESS_MODEL.md](../docs/BUSINESS_MODEL.md)
**Invariant matrix:** Part 12 (INV-01 … INV-33)
**Build order:** Part 13

## Guiding principle (the J1 pattern)

> Every bug that triggered this audit shares one root cause:
> **a business object changed state through one workflow but a related
> object didn't, because the invariant wasn't enforced at the lowest level.**
>
> Therefore: enforce at the **database** (constraints, triggers, RPCs as the
> sole write path), not at the UI. UI guards are a UX nicety, not a
> correctness boundary. Every invariant in Part 12 must have a DB-level
> enforcement point before its UI is built.

## Revised phase order

1. **Phase 1 — Atomic RPCs ✅ DONE**
2. **Phase 2 — Subscriber hard constraints ✅ DONE** (revisit C4 portability per BUSINESS_MODEL §B/C — trigger over-restricts)
3. **Phase 3 — Referential integrity (FK migration) ✅ DONE (2026-06-12)** —
   FKs added for subscribers↔regions/packs/providers, packs↔providers,
   transactions↔subscribers/providers/self, stb_inventory↔subscribers,
   transaction_notes↔transactions (CASCADE), complaints↔subscribers.
   New nullable `region_id`, `current_pack_id`, `current_internet_pack_id`
   on subscribers; text columns retained for now (Phase 4 retires them).
   No backfill — demo data reseed.
4. **Phase 3.5 — Customer status & archive ✅ DONE (2026-06-12)** —
   `customer_status` enum (prospect/active/archived) on subscribers,
   default `prospect`. Existing rows with any subscription history
   seeded as `active`. Operator-set only; no trigger ever overwrites it
   (INV-02). DB does not gate actions on archived yet — UI gate in Phase 5.
5. **Phase 3.6 — Device assignment log + `replace_device` RPC.**
   - Retire the current `stb_number`-change block in
     `subscribers_enforce_invariants`. It guards the wrong thing.
   - Replace with an **inventory-agreement check**: if `stb_number` is being
     set to a non-null value, a row must exist in `stb_inventory` with
     `serial_number = NEW.stb_number`, `status = 'assigned'`,
     `subscriber_id = NEW.id`. Inventory is the authority; the subscriber
     row can only mirror what inventory already confirms.
   - `replace_device(p_subscriber_id, p_old_serial, p_new_serial, p_reason)`
     runs in one txn, in this order:
     1. verify old device is assigned to this subscriber
     2. verify new device exists, `status='available'`, service_type matches
     3. set old → `faulty`, `subscriber_id = NULL`
     4. set new → `assigned`, `subscriber_id = subscriber`
     5. write `device_assignment_log` (close old, open new, reason)
     6. update active subscription blob's device reference
     7. update `subscribers.stb_number` → trigger sees inventory agrees → pass
   - No session flag, no SECURITY DEFINER bypass, no caller awareness.
     Ordering inside the RPC + the data-consistency trigger = workflow gate.
     Any other path (UI, console, raw SQL) fails the trigger because
     inventory wasn't updated first.
   - Add `device_assignment_log` table here (subscriber_id, device serial,
     opened_at, closed_at, close_reason enum, opened_by, closed_by).
6. **Phase 3.7 — `adjustment` transaction type** — first-class, separated
   from cash payments in reports; tracks credit origin (D3/D4).
7. **Phase 4 — Normalize `subscriptions` table** — informed by §1.1 immutability;
   columns shaped by Part 8 (statement view, next-action chip).
8. **Phase 5 — Transaction validation triggers + passbook UI + next-action chip.**

## Open items confirmed closed in v3.0

- OQ-1 outage compensation → **adjustment credit only**, never end_date extension.
- OQ-2 backdating window → **7 days, configurable setting**.
- INV-16 / B3 → suspend deferred; end_date mutable only via one named RPC.
- INV-23 → refund ≤ **net** charged on this subscription.
- INV-32 concurrency, INV-33 idempotency → added to matrix.

## Approach

One migration per phase + client refactor + CHANGELOG + ADR. Test in preview
between phases. No phase ships without DB-level enforcement for its invariants.
