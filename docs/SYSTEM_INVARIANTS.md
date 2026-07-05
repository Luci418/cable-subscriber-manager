# System Invariants

**Rules that must never be broken, regardless of implementation changes.**

If you are about to change code that touches one of these rows, the change
requires either (a) preserving the invariant or (b) an ADR + migration that
consciously retires it. Silent violations are the most expensive class of
bug in this system.

Source of truth for the *why* is `BUSINESS_MODEL.md` (INV-01…INV-33). This
document is the *engineering* view: what code enforces each rule today.

Legend for **Tested?** — 🟢 covered, 🟡 partial (manual only), 🔴 no coverage.

## Ledger & Financial

| Invariant | Why it exists | Enforced where | Tested? | Docs |
|---|---|---|---|---|
| Transactions are append-only. No physical `DELETE`. | Legal + audit — an operator cannot rewrite history | `transactions_enforce_immutability` trigger (BEFORE DELETE/UPDATE); RLS forbids client deletes | 🟡 | FINANCIAL_LIFECYCLE_REVIEW_2026-06.md, ADR-011 |
| Financial columns on a posted transaction are immutable | Same as above — amount/type/service/date cannot change | `transactions_enforce_immutability` trigger blocks UPDATE of those columns | 🟡 | ADR-011 |
| Voiding a transaction is the only reversal path | Preserves the immutable trail while allowing correction | `void_transaction` RPC + role gate (`can_void_transaction`); `voided` is the ONLY allowed status transition from `posted` | 🟡 | PERMISSION_MATRIX.md |
| Transaction notes are append-only | Notes are audit context, not editable narrative | `transaction_notes_enforce_immutability` trigger | 🔴 | — |
| Payment allocations are FIFO by default | Deterministic aging of subscriber balance | `transactions_fifo_allocate_trg` — oldest unpaid subscription first | 🟡 | BUSINESS_RULES §5 |
| Targeted payments honour operator intent | `subscription_payment` / `manual_payment` with `subscription_id` must not spill via FIFO | Same trigger, targeted branch | 🟡 | BUSINESS_RULES §5 |
| Refund ≤ cash paid toward the subscription | Prevents negative-cash refunds | `cancel_subscription` RPC — `IF p_refund_amount > v_cash_paid THEN RAISE` | 🔴 | — |
| Stored subscriber balances are derived, never authoritative | Prevents drift-in-drift-out bugs | `recalc_subscriber_balance()` recomputes from `transactions` | 🟡 (drift possible under concurrent writes) | ADR-003, PRODUCTION_READINESS.md#tech-debt |

## Subscription Lifecycle

| Invariant | Why it exists | Enforced where | Tested? | Docs |
|---|---|---|---|---|
| One active subscription per `(subscriber, service_type, device)` | Prevents double-billing | `create_subscription` — `IF EXISTS active` RAISE | 🟡 | BUSINESS_RULES §4 |
| A subscription cannot be created for a service the subscriber does not have | `services[]` is declared intent; catches typos | `create_subscription` — `p_service_type = ANY(v_sub.services)` | 🔴 | — |
| Lapsed subscriptions auto-expire | UI must reflect authoritative state | `expire_lapsed_subscriptions` RPC — called hourly (cron) and on every list-load in `useSubscribers` | 🟡 | features/subscription-lifecycle-management memory |
| Cancellation preserves history | Analytics + audit | `cancel_subscription` writes `cancelled_at`, `cancelled_by`, `cancel_reason_code`, `cancel_reason_note`; the row is never deleted | 🟡 | ADR-011 |
| Cannot cancel a subscription without permission | Role gate | `can_cancel_subscription` (owner + admin_office) — SQLSTATE 42501 | 🔴 | PERMISSION_MATRIX.md |

## Device Pairing & Inventory

| Invariant | Why it exists | Enforced where | Tested? | Docs |
|---|---|---|---|---|
| Only one subscriber may hold an `assigned` inventory row | Physical reality — one STB, one house | `stb_inventory` update in `pair_device` (device must be `available` first); `sync_stb_inventory_on_subscriber_change` trigger | 🟡 | STB inventory memory |
| Unpair blocked while an active subscription is tied to the device | Cannot orphan billing | `unpair_device` RPC — `IF v_active_count > 0 THEN RAISE` | 🔴 | BUSINESS_MODEL.md |
| Inventory is the authority for pairing; `subscribers.stb_number` is a cache | Prevents divergence | `subscribers_enforce_invariants` — writing `stb_number` requires an agreeing `stb_inventory` row | 🟡 | LEGACY_DEPENDENCY_AUDIT.md |
| Device service type must match subscription service type | Cannot pair an ONU to a cable subscription | `create_subscription` + `replace_device` service-type checks | 🔴 | — |
| Replacement device must be `available` and same service type as old | Prevents swap-into-conflict | `replace_device` RPC | 🔴 | — |
| `services[]` cannot be removed while an active subscription exists for that service | Data integrity — cancel first | `subscribers_enforce_invariants` trigger | 🔴 | — |
| Provider cannot change while an active subscription exists for that service | Revenue attribution stays correct | `subscribers_enforce_invariants` trigger | 🔴 | — |

## Deletion, Archive & Data Preservation

See `DESTRUCTIVE_OPERATIONS_AUDIT.md` for the full matrix. Core rule:

| Invariant | Why it exists | Enforced where | Tested? | Docs |
|---|---|---|---|---|
| Subscribers with history are archived, never deleted | Ledger, subscriptions, device history must remain queryable | `check_subscriber_deletable` RPC — blocks delete on any of: active sub, non-zero balance, any transaction row, any assigned device; `archive_subscriber` is the intended path | 🟡 | DESTRUCTIVE_OPERATIONS_AUDIT.md |
| Regions / Packs / Providers cannot be deleted while in use | Preserves historical references on subscribers/txns/subs | `is_region_in_use`, `is_pack_in_use`, `is_provider_in_use` SQL functions gate deletes | 🟡 | data-integrity constraint memory |
| `subscriber_status_log` is append-only | Audit trail for archive/reactivate | `subscriber_status_log_enforce_immutability` trigger | 🔴 | — |
| `device_assignment_log` records every pair/unpair/replace | Device provenance | Written by `pair_device`, `unpair_device`, `replace_device` RPCs | 🔴 | — |

## Tenancy, Roles & RLS

| Invariant | Why it exists | Enforced where | Tested? | Docs |
|---|---|---|---|---|
| Every operational table has RLS enabled with a `user_id = auth.uid()` policy | Tenant isolation | RLS on all `public` tables; verified via `security--get_table_schema` | 🟡 | PRODUCTION_READINESS.md |
| Every public table has explicit `GRANT` in the SAME migration as its `CREATE TABLE` | PostgREST otherwise returns permission errors | Convention enforced by reviewer + prompt directives | 🔴 | DEVELOPER_GUIDE.md |
| Role checks live in SECURITY DEFINER helpers, never in RLS directly | Prevents recursive RLS | `has_role()`, `can_*()` all SECURITY DEFINER | 🔴 | ROLE_DESIGN.md |
| Only owners can grant/revoke roles | Prevents privilege escalation | RLS on `user_roles` — writes require `has_role('owner')` | 🔴 | PERMISSION_MATRIX.md |
| Owner cannot revoke their own owner role | Prevents zero-owner lockout | UI guard in `RolesManagement.tsx` (belt-and-braces: manual SQL check documented) | 🔴 | PRODUCTION_READINESS.md |
| Roles are stored in `public.user_roles`, never on `profiles` | Prevents privilege escalation via profile writes | Schema — no `role` column on `profiles` | 🔴 | ROLE_DESIGN.md |
| Actions that mutate protected state record `auth.uid()` in an attribution column | Audit | `cancelled_by`, `archived_by`, `opened_by`, `closed_by`, `created_by`, `edited_by`, `voided_by` — populated by RPC or `transactions_audit_stamp` trigger | 🔴 | PERMISSION_MATRIX.md |

## UI / Data-fetch Contracts

| Invariant | Why it exists | Enforced where | Tested? | Docs |
|---|---|---|---|---|
| Every write RPC/call site verifies its return value before showing `toast.success` | Prevents silent-success bugs (see Phase 5.3 `maybeSingle()` fix) | Code review gate in QA_TEST_PLAN.md Part H | 🟡 | QA_TEST_PLAN.md#part-h |
| Active/timeline reads use `v_subscriber_active_subscription` / `v_subscriber_subscription_timeline`, never the JSONB blobs | Blobs are caches, may drift | `useSubscribers.tsx` reads views; grep-audited each phase | 🟡 | LEGACY_DEPENDENCY_AUDIT.md |
| Time comparisons use `src/lib/timeSync.ts`, not `new Date()` | Device clocks are not trustworthy | Convention; grep-audited | 🔴 | time-synchronization memory |

---

## Testing status legend

- 🟢 covered by automated test
- 🟡 covered by manual regression checklist (QA_TEST_PLAN.md) or by
     a database constraint whose violation surfaces immediately
- 🔴 no explicit coverage; relies on developer diligence + code review

The heavy 🔴/🟡 lean is the biggest gap in the project. See
`TESTING_ARCHITECTURE.md` for the roadmap.
