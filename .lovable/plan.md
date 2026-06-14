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
5. **Phase 3.6 — Device assignment log + `replace_device` RPC ✅ DONE (2026-06-12).**
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
6. **Phase 3.7 — `adjustment` transaction type ✅ DONE (2026-06-12)** —
   first-class, separated from cash payments in reports; balance trigger
   treats adjustment as credit; void maps it to an offsetting charge;
   UI now exposes it in `AddTransactionDialog`.
7. **Phase 4a — Normalize `subscriptions` + `payment_allocations` ✅ DONE (2026-06-13)** —
   per BUSINESS_MODEL v3.2. `subscriptions` table with snapshot columns,
   device-level uniqueness (INV-39), inventory-agreement on serial swaps
   (INV-40), v1 end_date hard immutability (INV-41), refund cap from
   `payment_allocations` (INV-42), forward-only status transitions (INV-43).
   `payment_allocations` append-only ledger (INV-44) populated by a FIFO
   trigger on `transactions` (INV-45). `transactions.subscription_id` added
   as nullable display reference; set by the subscription RPCs only. All
   four RPCs (create/cancel/expire/replace_device) rewritten as dual-write
   so the UI keeps working. Demo data wiped. End-to-end verified.
8. **Phase 4b — Mechanical cutover + JSONB lock (NEXT, narrowed scope).**
   Per [docs/OPERATOR_WORKFLOW_UI_REVIEW.md](../docs/OPERATOR_WORKFLOW_UI_REVIEW.md)
   Part 7, Phase 4b is now **strictly mechanical**: swap UI reads from
   `subscribers.current_subscription` / `subscription_history` (and
   internet equivalents) to the `subscriptions` table. **Same UI, new data
   source.** No workflow redesign. Once stable, install a read-only
   trigger on the JSONB columns, then drop them in a follow-up migration.

   **Fold three small schema additions into the same Phase 4b migration**
   (per review doc Part 8) so Phase 5's Collect Payment workflow doesn't
   need a follow-up migration:
   - `transactions.source` CHECK: add `'subscription_payment'` enum value
   - `transactions.payment_method` text, CHECK IN `('cash','upi','other')`,
     nullable (legacy rows = NULL)
   - `settings.operator_upi_vpa` text (single per-user setting for
     client-side UPI QR generation in Workflow 4)

   ✅ Pre-4b correctness work landed (2026-06-14):
   - Analytics revenue/charge aggregations now exclude `status IN
     ('voided','reversal')`. Fixes the ₹2,200 phantom-revenue bug
     (voided payments + their reversal rows were both double-counted).
   - Imported review doc as `docs/OPERATOR_WORKFLOW_UI_REVIEW.md`.

9. **Phase 5 — Operator workflows + profile + ledger rendering.**
   The 9 workflows in review doc Part 2, the 2 new RPCs (`pair_device`,
   `unpair_device` — Part 4), profile redesign (Part 3), ledger rendering
   rules (Part 5: void-pair collapse, adjustment visual language,
   per-subscription context, expandable allocation breakdown), and
   Workflow 4 Collect Payment (Cash/UPI tabs, Option B allocation).
   Built on top of Phase 4b's data layer.




## Open items confirmed closed in v3.0

- OQ-1 outage compensation → **adjustment credit only**, never end_date extension.
- OQ-2 backdating window → **7 days, configurable setting**.
- INV-16 / B3 → suspend deferred; end_date mutable only via one named RPC.
- INV-23 → refund ≤ **net** charged on this subscription.
- INV-32 concurrency, INV-33 idempotency → added to matrix.

## Approach

One migration per phase + client refactor + CHANGELOG + ADR. Test in preview
between phases. No phase ships without DB-level enforcement for its invariants.
