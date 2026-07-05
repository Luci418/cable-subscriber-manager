# Testing Architecture

**Not an implementation.** This document describes the target testing
architecture for the project. Testing is introduced incrementally, one
layer at a time; this file states the plan and the order.

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

**When to introduce:** Sprint 1 of testing rollout. Highest ROI, lowest
setup cost.

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

**When to introduce:** Sprint 1, in parallel with pgTAP.

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
+ (5); tagged release runs everything including (6).

**Recommended tools:** GitHub Actions matrix with a Postgres service
container. Cache node_modules + Playwright browsers.

**When to introduce:** Sprint 4 (only meaningful once the tests exist).

## Recommended first implementation milestone

**Testing Sprint 1** — pgTAP + Vitest for pure functions.

Deliverables:
- `test/db/` with pgTAP suites covering immutability triggers and role
  gates on every write RPC.
- `test/unit/` with Vitest suites for `financialPosition`,
  `subscriberIdGenerator`, `activeSubs`.
- A local `bunx vitest run` command and a `pg_prove test/db/*.sql`
  command, both documented in DEVELOPER_GUIDE.md.
- No CI yet — prove the workflow locally first.

That milestone alone would move ~15 rows in `SYSTEM_INVARIANTS.md` from
🔴/🟡 to 🟢.

## Anti-goals

- **No snapshot tests.** They pass on any change and hide regressions.
- **No component tests for pure presentation.** Screenshot the design
  system in Storybook if we ever add one; don't unit-test JSX.
- **No end-to-end tests that mock the DB.** That's a component test in
  disguise.
