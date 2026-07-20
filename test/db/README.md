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

## Not covered by Sprint 1 (deferred to Sprint 2)

- FIFO allocation behaviour (`transactions_fifo_allocate_trg`) — requires
  realistic seed data across multiple subscribers; scheduled with the RPC
  suite.
- `create_subscription` / `cancel_subscription` / `pair_device` RPC role
  gates — deferred alongside the RPC-behaviour tests in Sprint 2 per the
  architecture doc.
- RLS isolation between users — deferred to Sprint 2.
