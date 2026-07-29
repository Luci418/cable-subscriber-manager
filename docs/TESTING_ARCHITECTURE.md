# Testing Architecture

**Status (2026-07-29): Sprints 1 and 2 are SHIPPED.** Layers 1 (pgTAP)
and 2 (Vitest over pure functions) exist today: `test/db/` holds 11 pgTAP
files with 44 assertions, and `src/lib/*.test.ts` holds 46 Vitest tests
(`financialPosition`, `ledgerRendering`, `activeSubs`, `subscriberIdGenerator`).
Run them with `bun run test` and `bun run test:db`.

Everything below layer 2 — migration hygiene, component tests, routing
guards, Playwright E2E, CI — is still **target architecture, not built**.
Testing is introduced incrementally, one layer at a time; this file states
the plan and the order.

## Guiding principles

1. **Every test protects an invariant.** If you can't point at a row in
   `SYSTEM_INVARIANTS.md`, don't write the test.
2. **Test at the lowest layer that gives high confidence.** A trigger
   test in pgTAP beats an end-to-end Playwright run for enforcing an
   immutability rule.
3. **Prefer database-first.** The DB is authoritative; regressions here
   are silent and expensive. UI regressions are visible.
4. **Green tests must be trustworthy.** No skips, no `if (process.env)`
   escape hatches, no snapshot-only tests that pass on any change.

## Layers

### 1. Database (pgTAP)

**Purpose:** Verify triggers, RPC behaviour, and RLS policies at the SQL
layer where they actually run.

**Recommended tools:** `pgTAP` (SQL-native), executed via `pg_prove` in
CI against a throwaway Postgres 15 container. Local dev: docker compose
with the same image used by Supabase.

**Priority coverage (in order):**

1. **Immutability triggers** — `transactions`, `transaction_notes`,
   `subscriber_status_log`. Each should have a "DELETE fails" and
   "UPDATE of protected column fails" test.
2. **Role gates on RPCs** — `cancel_subscription`, `archive_subscriber`,
   `pair_device`, `unpair_device`, `replace_device`, `void_transaction`.
   Test as each role (owner, admin_office, collection_agent,
   technician), assert SQLSTATE 42501 for the negative cases.
3. **FIFO allocation** — `transactions_fifo_allocate_trg` with mixed
   default and targeted payments; assert allocations land on the
   intended subscription.
4. **`create_subscription` guards** — active-subscription conflict,
   pack/service mismatch, device/service mismatch.
5. **RLS isolation** — sign in as user A, attempt to read/write user
   B's rows; assert empty result / permission error.

**Status: SHIPPED (Sprint 1 + 2).** 11 files, 44 assertions covering
immutability triggers (transactions, subscriptions, payment*allocations,
device_assignment_log), role gates, `create_subscription` /
`cancel_subscription` / `pair_device` / `mark_device*\*` behaviour, RLS
isolation and FIFO allocation.

### 2. Backend business rules (unit tests over pure functions)

**Purpose:** Test the pure logic that lives in `src/lib/` (e.g.
`activeSubs.ts`, `financialPosition.ts`, `ledgerRendering.ts`,
`subscriberIdGenerator.ts`, `subscriptionUtils.ts`) without hitting the
DB.

**Recommended tools:** Vitest (already available via bun).

**Priority coverage:**

1. `financialPosition.ts` — balance derivation from a transaction
   fixture.
2. `subscriberIdGenerator.ts` — prefix formation, sequence progression,
   collision behaviour.
3. `activeSubs.ts` — enrichment shape, edge cases (no active,
   multi-device).
4. `assetTimeline.ts` — timeline merge from device history.

**Status: SHIPPED (Sprint 1).** 46 Vitest tests across `financialPosition`,
`ledgerRendering`, `activeSubs`, `subscriberIdGenerator`. `assetTimeline` is
still uncovered.

### 3. Migration hygiene

**Purpose:** Every migration must be forward-compatible; every new
public-schema table must GRANT explicitly.

**Recommended tools:** Custom shell/CI script that:

- Applies all migrations against a fresh DB.
- Greps every `CREATE TABLE public.` for a matching `GRANT` in the same
  file.
- Runs a `SELECT` from PostgREST as `anon`/`authenticated` against a
  seed row per table.

**When to introduce:** Sprint 2.

### 4. Frontend components (React Testing Library)

**Purpose:** Test presentation contracts and permission gating in
components that render conditionally on roles or on the enriched
subscriber shape.

**Recommended tools:** Vitest + React Testing Library + a mocked
`supabase` client.

**Priority coverage:**

1. `usePermissions` — every branch (owner, admin_office,
   collection_agent, technician, no-role user).
2. `SubscriberDetail` — Add-Service flow (the Phase 5.2 regression must
   have a test); action buttons hidden/shown per role.
3. `TransactionLedger` — void button hidden when
   `!canVoidTransaction`.
4. `RolesManagement` — owner cannot revoke own owner role.

**When to introduce:** Sprint 2.

### 5. Routing / auth guards

**Purpose:** Unauthenticated users cannot reach `/`; deep links preserve
`redirect` after auth.

**Recommended tools:** Same stack as (4).

**When to introduce:** Sprint 2, alongside component tests.

### 6. End-to-end (Playwright)

**Purpose:** Prove the critical operator workflows work against a real
DB + real UI.

**Recommended tools:** Playwright (already available in the sandbox).
Run against a seeded test tenant.

**Priority coverage (the "seven paths"):**

1. Add subscriber → pair STB → assign pack → collect payment → print
   receipt.
2. Cancel subscription with refund → verify ledger + balance.
3. Void a payment → verify balance restored, void_reason recorded.
4. Replace a faulty STB → verify device history + active subscription
   retained.
5. Archive a subscriber → verify inaccessible from list, still queryable
   in ledger.
6. Owner grants a role → new user sees new capabilities on next login.
7. Non-owner attempts a role-gated action → sees permission error, no
   silent success.

**When to introduce:** Sprint 3.

### 7. Regression / release checklist

**Purpose:** The floor. Even without automation, manual regression must
run before every release.

**Location:** `QA_TEST_PLAN.md` (exists). Add a release checklist:

- Run `npm audit`, resolve criticals.
- Restore a backup into a scratch project; run smoke test.
- Run the seven E2E paths (manual until Sprint 3).
- Verify no `TODO(pre-production)` markers remain unresolved.
- Bump CHANGELOG.

### 8. CI

**Purpose:** Every push runs (1) + (2); every PR runs (1) + (2) + (4)

- (5); tagged release runs everything including (6).

**Recommended tools:** GitHub Actions matrix with a Postgres service
container. Cache node_modules + Playwright browsers.

**When to introduce:** Sprint 4 (only meaningful once the tests exist).

## Testing Sprint 1 — DONE (2026-07-20), extended by Sprint 2 (2026-07-27)

**Testing Sprint 1** — pgTAP + Vitest for pure functions. Delivered as
described below; Sprint 2 added 6 more pgTAP files (RPC integration + RLS).
Tests live in `test/db/` and alongside the sources in `src/lib/*.test.ts`
(no `test/unit/` directory — Vitest suites sit next to the code they cover).

Delivered:

- `test/db/` with pgTAP suites covering immutability triggers and role
  gates on every write RPC.
- `src/lib/*.test.ts` with Vitest suites for `financialPosition`,
  `subscriberIdGenerator`, `activeSubs`.
- A local `bunx vitest run` command and a `pg_prove test/db/*.sql`
  command, both documented in DEVELOPER_GUIDE.md.
- No CI yet — prove the workflow locally first.

**Next milestone: Sprint 3** — migration-hygiene script (layer 3) and
component/permission tests (layer 4). Not started.

## Anti-goals

- **No snapshot tests.** They pass on any change and hide regressions.
- **No component tests for pure presentation.** Screenshot the design
  system in Storybook if we ever add one; don't unit-test JSX.
- **No end-to-end tests that mock the DB.** That's a component test in
  disguise.
