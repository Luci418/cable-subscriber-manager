# Database tests — pgTAP (Testing Sprint 1)

These SQL suites follow `docs/TESTING_ARCHITECTURE.md` §1. They validate the
immutability triggers and role-gated helpers that the app relies on to
guarantee an accurate audit trail.

## Requirements

- Postgres 15 (matches Supabase) with the `pgtap` extension installed:
  `CREATE EXTENSION IF NOT EXISTS pgtap;`
- The `pg_prove` runner from the `TAP::Parser::SourceHandler::pgTAP` CPAN
  distribution.

## Run locally

Point the standard `PG*` env vars at a **throwaway** database that has the
project migrations applied (never run against production):

```sh
pg_prove -v test/db/*.sql
```

## What is covered

| File | Invariants |
| ---- | ---------- |
| `01_transactions_immutable.sql` | DELETE fails, protected columns fail on UPDATE, only `posted → voided` (with `void_reason`) status transition is allowed. |
| `02_subscriptions_immutable.sql` | DELETE fails, `pack_id`/`start_date`/etc. cannot be updated, whitelisted lifecycle columns (`status`, `cancelled_at`, `refund_amount`, …) can. |
| `03_payment_allocations_immutable.sql` | DELETE and UPDATE both fail. |
| `04_device_assignment_log_immutable.sql` | DELETE fails, non-lifecycle columns cannot be updated, credential columns are mutable only while `closed_at IS NULL`. |
| `05_role_gates.sql` | `can_void_transaction`, `can_archive_customer`, `can_view_credentials` return the correct boolean for owner / admin_office / collection_agent / technician / no-role. |
| `06_create_subscription.sql` | Active-subscription constraint is device-scoped (not subscriber-scoped); provider mismatch on an already-active device is rejected. |
| `07_cancel_subscription.sql` | Refund cap is enforced; the RPC requires the `cancel_subscription` role. |
| `08_pair_device.sql` | Role gate rejects unpermitted callers; device/service-type mismatch is blocked. |
| `09_mark_device.sql` | `mark_device_faulty` closes the assignment log without touching subscription status; `mark_device_repaired` accepts empty notes. |
| `10_rls_isolation.sql` | User A cannot read or write user B's subscribers / transactions under RLS. |
| `11_fifo_allocation.sql` | A default payment allocates to the older subscription first when multiple active subs exist. |

Sprint 2 added 16 assertions across `06_*` – `11_*.sql`, bringing the total to 31.

