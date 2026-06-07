# Changelog

All notable changes to the Subscriber Management System are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/) (Major.Minor.Patch).

See [`docs/releases/`](./docs/releases/) for detailed per-version notes.

---

## [Unreleased]

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
