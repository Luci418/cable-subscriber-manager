# Changelog

All notable changes to the Subscriber Management System are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/) (Major.Minor.Patch).

See [`docs/releases/`](./docs/releases/) for detailed per-version notes.

---

## [Unreleased]

### Changed — ADR-011 simplified: full immutability, grace window removed
- **Transactions are now immutable the moment they are saved.** The earlier
  5-minute grace window for in-place edit/delete is gone. The void workflow
  alone covers fat-finger fixes, with a permanent audit trail.
- **DB enforcement**: new `transactions_enforce_immutability` BEFORE
  UPDATE/DELETE trigger on `public.transactions`:
  - `DELETE` is rejected unconditionally.
  - Edits to `amount`, `type`, `service_type`, `subscriber_id`, `provider_id`,
    `date`, and `reverses_transaction_id` are rejected.
  - `status` may only move `posted → voided`, and only when `void_reason` is
    set (the path used by `void_transaction`).
  - `description` (and bookkeeping fields like `edited_at`/`edited_by`) remain
    editable.
- **UI**: `EditTransactionDialog` reduced to a description-only editor; the
  password gate is gone. The row "Delete" button is replaced by **Void**,
  which calls `void_transaction` after collecting a reason. Voided rows are
  rendered struck-through with a "Voided" badge; the offsetting row carries
  a "Reversal" badge.
- **Receipts** are never blocked by timing logic anymore — every persisted
  transaction is already final.
- See ADR-011 (revised) and `docs/FINANCIAL_LIFECYCLE_REVIEW_2026-06.md`.

### Added — Financial-record lifecycle (ADR-011, initial)
- **Append-only ledger model** adopted for `transactions`. New columns:
  `status` (`posted` / `voided` / `reversal`), `reverses_transaction_id`
  (self-FK), `void_reason` (text). Existing rows backfilled to
  `status = 'posted'`.
- **`void_transaction(p_transaction_id, p_reason)` RPC** —
  SECURITY DEFINER, single-transaction. Inserts an offsetting reversal
  row, marks the original `voided`, returns the reversal id. Refuses to
  re-void or to void rows the caller does not own.
- **Balance trigger updated** to exclude `status = 'voided'` rows from
  the running balance sum.

### Documentation — Financial lifecycle
- `docs/FINANCIAL_LIFECYCLE_REVIEW_2026-06.md` — new.
- `ARCHITECTURE_DECISIONS.md` — ADR-011 added, then revised 2026-06-08 to
  drop the grace window.
- `docs/README.md` — index updated.



### Added — Tier 0 hardening (per `docs/REVIEW_RESPONSE_2026-06.md`)
- **A1 — Automatic balance recalculation**: `recalc_subscriber_balance()` plus
  AFTER INSERT/UPDATE/DELETE trigger on `transactions` keeps
  `cable_balance` / `internet_balance` in lockstep with the ledger. One-time
  backfill recomputed all existing balances at migration time.
- **A2-min — Transaction audit fields**: `created_by`, `edited_at`, `edited_by`
  on `public.transactions`, auto-stamped by a BEFORE trigger using
  `auth.uid()`.
- **A4 — Concurrent-safe subscriber IDs**: new RPC
  `generate_subscriber_id(region_name)` (SECURITY DEFINER, per-prefix
  `pg_advisory_xact_lock`). Client `generateSubscriberId()` now calls the
  RPC.
- **I3 — Concurrent-safe expiry job**: `expire_lapsed_subscriptions()` takes
  an advisory transaction lock so cron + UI-triggered runs cannot overlap.

### Removed — Tier 0 cleanup
- **C2 — `billing_history` table dropped**. Confirmed unused (no writers,
  0 rows, only read once into unused state in `Billing.tsx`). Code
  references and related validation messages removed.

### Documentation
- Documentation system: `docs/README.md` index, `PROJECT_VISION`,
  `ARCHITECTURE_DECISIONS` (ADR log), `BUSINESS_RULES`,
  `ANALYTICS_STRATEGY`, `FUTURE_EVOLUTION`, `PRODUCTION_READINESS`,
  `DEPLOYMENT`, `AUDIT_REPORT`, `REVIEW_RESPONSE_2026-06`.
- **`docs/LIFECYCLE_AUDIT_2026-06.md`** — operational lifecycle integrity
  audit covering every business object (states, transitions, creation /
  edit / delete / archive rules, invalid states, analytics impact). Surfaces
  several Critical findings (A0): client-side balance mutation now
  double-counts against the Tier-0 balance trigger; subscribers can be
  hard-deleted with active subscriptions / non-zero balance / assigned
  devices, silently rewriting analytics; STB orphan state after subscriber
  delete; stray `packs_name_key` unique constraint. No code changes yet —
  fixes are queued as a follow-up.

### Notes
- **E3 (storage bucket privacy)**: no storage buckets exist in the project
  yet — this becomes relevant the day the first bucket is created.
- **I2 (restore drill) and I1 (off-platform `pg_dump`)** are operational
  tasks; runbook to be added to `docs/DEPLOYMENT.md` in the Tier-1 sprint.


### Notes
- `docs/DEVELOPER_GUIDE.md` is retained as the code-level reference. Its
  schema/ER sections are stale (predate the cable/internet split and the
  Provider entity) and are scheduled for a focused refresh in a follow-up
  pass — see `docs/AUDIT_REPORT.md` §6.

## [0.9.0] — 2026-06-05

### Added
- **Providers & Service Catalog** (Phase 1 of the architecture roadmap):
  new `providers` table; `provider_id` on `packs`, `transactions`, and
  per-service columns on `subscribers` (`cable_provider_id`,
  `internet_provider_id`).
- Provider Management dialog (`Manage → Providers`).
- `useProviders` hook.
- `is_provider_in_use` RPC to prevent destructive deletes.
- Provider Performance card on the Analytics page (active subscribers,
  revenue, outstanding by provider).
- Provider selector in transaction add/edit flows (only shown when more than
  one active provider exists for the chosen service type).

### Changed
- Pack creation/editing now requires a provider selection; pack cards show
  a provider badge.
- Subscription assignment now stores `providerId` / `providerName` inside
  the subscription blob and updates the subscriber's per-service provider
  column on activation/renewal.

### Migrated
- Backfilled "Default Cable Network" and "Default Internet" providers per
  operator. All existing packs, transactions, and active subscriptions were
  linked to the appropriate default.

See [`docs/releases/v0.9.0.md`](./docs/releases/v0.9.0.md) for upgrade
notes and risks.

## [0.8.x and earlier]

Pre-changelog history. Significant prior milestones (reconstructed from
project memory):

- Internet service added alongside Cable TV; per-service balances
  (`cable_balance`, `internet_balance`) and per-service subscription blobs.
- Region-based subscriber ID generator.
- STB inventory with statuses (`available` / `assigned` / `faulty` /
  `returned`) and `service_type` extension to cover internet devices.
- IST time synchronization via WorldTimeAPI for active/expired calculations.
- Hourly `expire_lapsed_subscriptions` server-side cleanup.
- Thermal (58mm) and A4 PDF generation.
- Data-integrity guards: `is_pack_in_use` and region/provider deletion
  protection.
