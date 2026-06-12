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
3. **Phase 3 — Referential integrity (FK migration)** — region_id, pack_id,
   internet_pack_id, providers.service_type, stb FK. Unblocks INV-28/30.
4. **Phase 3.5 — Customer status & archive** — `customer_status` enum
   (active/prospect/archived); operator-set, never trigger-overwritten
   (INV-02 scope).
5. **Phase 3.6 — Device assignment log + `replace_device` RPC** — relaxes
   Phase 2 stb-change block; logs swaps with reason; enforces INV at DB.
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
