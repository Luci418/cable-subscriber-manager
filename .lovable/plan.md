# Why loose ends keep surfacing

The audit found three compounding architectural causes — not isolated bugs:

1. **No RPC firewall.** The `subscribers` row is a mixed-concern "god object" (identity, device, subscription JSONB, balances, providers, services flags). RLS lets clients freely UPDATE any column. Every business rule lives in a dialog. Any new code path, import, or direct API call bypasses them.
2. **JSONB-as-source-of-truth for subscriptions.** `current_subscription` / `internet_subscription` are unvalidated blobs. There's no `subscriptions` table, no status enum, no FK, no shape check.
3. **Two writers to balance.** A trigger correctly recomputes `cable_balance`/`internet_balance` from the ledger — but three client paths *also* mutate the balance directly. One of them (subscription creation) writes the balance **before** inserting the transaction; if the insert fails, the balance is permanently inflated with no compensating row.

Until these are fixed at the schema/RPC layer, you will keep finding "the UI lets me…" issues forever.

# Concrete invariants currently unenforced

| # | Invariant | Today |
|---|---|---|
| 1 | No STB swap while cable subscription is active | UI only blocks *removal*, allows swap |
| 2 | Internet device assignment is atomic | Two separate API calls, errors swallowed |
| 3 | Cannot assign a faulty/decommissioned device | UI filter only |
| 4 | `stb_number` must exist in inventory | No FK — free text |
| 5 | Cannot drop a service with an active subscription | UI only |
| 6 | `services` must be non-empty, only `cable`/`internet` | No CHECK |
| 7 | Provider must match service type, locked mid-sub | No constraint |
| 8 | Subscription JSONB shape, status enum, valid dates | No validation |
| 9 | `region`, `current_pack` must reference real rows | Free text — rename silently splits data |
| 10 | Transaction `service_type` matches subscriber's enabled services | None |
| 11 | Transaction `provider_id` matches subscriber's per-service provider | UI convention only |
| 12 | Balance = recomputed from ledger only | Trigger correct, but 3 client paths also write directly |
| 13 | Mobile format / STB required for cable / refund ≤ charged | UI only |

# Proposed sprint — 4 phases

Phases are ordered by leverage. Each phase is independently shippable; we stop and test between them.

## Phase 1 — Atomic write paths (highest leverage, fixes the race bug)

Move multi-step mutations into security-definer RPCs so the client can no longer split a logical operation across two calls:

- `create_subscription(subscriber_id, service_type, pack_id, duration, …)` — inserts the charge transaction and updates `current_subscription` in one transaction. Lets the existing balance trigger be the sole balance writer.
- `cancel_subscription(subscription_id, refund_amount, reason)` — inserts refund row, clears `current_subscription`, all atomic.
- `assign_device(subscriber_id, device_id)` / `unassign_device(...)` — single RPC covering both cable and internet devices; validates device status and service-type match.
- **Remove all direct client writes** to `cable_balance` / `internet_balance` (Index.tsx, AddPackageSubscriptionDialog, SubscriberDetail cancellation path). The trigger is authoritative.

## Phase 2 — Hard constraints & triggers on `subscribers`

Add at the DB layer:

- CHECK on `services`: non-empty, subset of `{cable, internet}`.
- CHECK on `mobile`: `^\d{7,15}$` (verify the existing constraint is actually present and VALIDATED).
- BEFORE UPDATE trigger blocking:
  - dropping `cable` from services while `current_subscription` is active (same for internet)
  - changing `stb_number` / internet device while the matching subscription is active
  - changing `cable_provider_id` / `internet_provider_id` while subscription is active
- BEFORE INSERT trigger: if `cable` ∈ services then `stb_number` required.

## Phase 3 — Referential integrity & inventory

- Add CHECK / trigger on `stb_inventory`: cannot move to `status='assigned'` from `faulty`/`decommissioned`; service-type ↔ device-type must match.
- Add per-tenant FK (or trigger equivalent): `subscribers.stb_number` must exist in `stb_inventory.serial_number` for that user.
- Migrate `region` → `region_id UUID FK` and `current_pack` / `current_internet_pack` → `pack_id UUID FK`. Keep denormalized name for display via join. (This is the biggest data migration in the sprint — back-fill carefully.)
- Add `providers.service_type` and constrain `cable_provider_id` / `internet_provider_id` accordingly.

## Phase 4 — Transaction & subscription validation

- Trigger on `transactions` INSERT: `service_type` must be in subscriber's `services`; `provider_id` must equal the subscriber's per-service provider.
- Trigger on `transactions` INSERT (refund): cumulative refunds for a subscription ≤ cumulative charges for that subscription.
- Validate `current_subscription` / `internet_subscription` JSONB shape at write time (required keys, valid `status`, `endDate > startDate`, `duration > 0`). Longer-term: normalize into a proper `subscriptions` table — out of scope for this sprint but flagged in ADR.

# Out of scope (intentionally)

- Full normalization of `subscriptions` into its own table — large refactor; flagged in ADR for a later sprint. Phase 4's JSONB shape trigger is the bridge.
- New analytics, dashboards, workflow features (per your direction).

# Deliverables per phase

- Migration files with the constraints/triggers/RPCs.
- Client refactors to call the new RPCs and stop writing the protected columns directly.
- ADR-012 documenting the "DB-enforced invariants & RPC-mediated writes" decision.
- CHANGELOG entries per phase.
- Updated `dbErrors.ts` mapping for each new trigger message.

# Approval needed

Confirm:
1. The phasing above (1 → 4) is acceptable, **or** you'd prefer all-in-one.
2. You're OK with the Phase 3 data migration that converts `region` / `current_pack` text columns to UUID FKs. This rewrites every subscriber row and changes types — biggest risk in the sprint. Alternative: keep them as text but add a trigger that validates existence (lighter, leaves rename-splits-data unsolved).
3. Whether to keep subscription state as validated JSONB (this sprint) or also normalize to a `subscriptions` table now (adds ~1 more phase).
