# Changelog

All notable changes to the Subscriber Management System are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/) (Major.Minor.Patch).

See [`docs/releases/`](./docs/releases/) for detailed per-version notes.

---

## [Unreleased]

### Changed — Invariants sprint Phase 1: atomic lifecycle RPCs (2026-06-09)
- **Subscription create is now atomic.** `AddPackageSubscriptionDialog` no longer writes the subscriber row and the ledger in two separate calls. Both run inside the new `create_subscription(subscriber_id, service_type, pack_id, duration)` SECURITY DEFINER RPC. If anything fails, nothing is persisted — eliminating the race where a network blip between the two writes left `cable_balance` permanently inflated with no matching ledger row.
- **Subscription cancel is now atomic.** `SubscriberDetail.handleCancelSubscription` now calls the new `cancel_subscription(subscriber_id, service_type, refund_amount, reason)` RPC. The server clears the active subscription, marks history cancelled, and posts the refund payment in one transaction.
- **Balance trigger is now the sole writer of `cable_balance` / `internet_balance`.** Three client paths used to mutate balance directly: `Index.tsx` (manual transactions), `AddPackageSubscriptionDialog` (subscription creation), and `SubscriberDetail` (cancellation). All three have been removed. The pre-existing `transactions_recalc_balance` trigger recomputes balances from the immutable ledger after every insert/update/delete.
- **Refunds capped at the original charge in the server.** `cancel_subscription` rejects refund amounts greater than `packPrice × duration` — the UI's `max` attribute was the only check before.
- See `docs/ARCHITECTURE_DECISIONS.md` ADR-012 for full context. Phases 2–4 (constraints/triggers on subscriber writes, referential integrity, transaction provider/service validation) are next.


### Fixed — Lifecycle integrity round 2 (2026-06-09)
- **Inventory trigger attached.** The `sync_stb_inventory_on_subscriber_change`
  function existed but was never wired up as a trigger, so cable STB
  assignments could drift out of sync with `subscribers.stb_number` (STBs
  showing as Available while clearly assigned). The trigger is now attached
  to `subscribers`, and a one-time reconciliation migration heals existing
  drift. A `reconcile_stb_inventory()` RPC is available for future use.
- **Service uncheck blocked while a subscription is active.** Removing Cable or
  Internet from a subscriber's services in Edit Subscriber is now disabled
  when the corresponding subscription is still active. Operators must Cancel
  the subscription first, eliminating the orphaned-subscription state where
  re-enabling the service would resurrect the old pack.
- **Mark Faulty / Decommission no longer apply on Cancel.** Cancelling the
  reason prompt now aborts the operation instead of silently committing the
  state change.
- **Delete eligibility surfaces real errors.** When the
  `check_subscriber_deletable` RPC fails, the dialog now shows the underlying
  Postgres message instead of a generic "Please try again" string.
- **Overview surfaces provider + pack per service.** The per-service balance
  cards on the subscriber Overview now display the linked provider and the
  active pack/plan name, making the full service relationship visible without
  switching tabs.
- **Billing → "Record Payment".** Lines with an outstanding balance now have a
  Record Payment / Mark as Paid action that posts a `manual_payment` ledger
  row in one step, removing the need to navigate into each subscriber. The
  immutable-ledger guarantees still apply (use Void to undo).



### Changed — Subscriber profile clarity & actionable validation
- **Subscriber profile surfaces the full service relationship.** Each service
  card (Cable / Internet) now shows the linked provider name alongside the
  pack, device and per-service balance. The profile header carries an account
  status badge (Active / Lapsed / No services) derived from current
  subscriptions, so operators see the state of the account at a glance.
- **Provider attribution stops being an operator choice.** The Add Transaction
  dialog no longer asks operators to pick a provider when more than one is
  configured — every manual transaction now inherits the provider already
  linked to the subscriber's service (`cable_provider_id` /
  `internet_provider_id`). The chosen provider is surfaced read-only in the
  dialog. This eliminates accidental mis-attribution and matches how packs and
  subscription charges already work.
- **Delete validation is now explanatory.** Attempting to delete a subscriber
  used to surface "Validation check failed" — actually the immutable-ledger
  trigger fighting the cascading delete of transactions. Added the
  `check_subscriber_deletable(uuid)` RPC, which returns a typed list of
  blockers (active subscriptions, non-zero balance, transactions on file,
  assigned devices). The Delete dialog now shows that list and disables the
  destructive action until every blocker is resolved.
- **`friendlyDbError` recognises ledger-trigger violations.** Errors raised by
  `transactions_enforce_immutability`, `transaction_notes_enforce_immutability`
  and the subscription-source guard are now translated into operator-facing
  guidance instead of generic "Value failed a validation check".



### Changed — ADR-011 hardened: explicit source, frozen rows, accountable voids
- **Transaction `source` is now explicit, never inferred.** New `transaction_source`
  enum on `public.transactions`: `manual_charge`, `manual_payment`,
  `subscription_charge`, `subscription_refund`, `reversal`, `adjustment`.
  Existing rows backfilled by inspecting description patterns; new code paths
  set the source at insert time. Behaviour no longer depends on parsing
  description text.
- **`description` and `source` are now immutable** along with all financial
  fields. The "edit description" workflow is gone — the `EditTransactionDialog`
  component has been removed.
- **Append-only `transaction_notes`** table replaces description edits: every
  row carries a transaction FK, author, and timestamp; UPDATE/DELETE are
  blocked at the DB level. Operators add as many notes as they need without
  ever rewriting the ledger row. Surfaced via the new `TransactionNotesDialog`.
- **Subscription-sourced rows cannot be voided directly.** `void_transaction`
  rejects `source IN ('subscription_charge','subscription_refund','reversal')`
  — those corrections must flow through the subscription lifecycle (cancel /
  refund) so the subscription and its ledger row stay in sync. The Void
  button is hidden in the UI for these rows.
- **Void accountability**: new `voided_by` (uuid), `voided_at` (timestamptz),
  and `void_reason_code` (`data_entry_error`, `duplicate`, `wrong_subscriber`,
  `wrong_amount`, `customer_dispute`, `other`) enum columns. The new
  `VoidTransactionDialog` requires a reason code and accepts an optional
  free-text note; the RPC stamps both rows.
- **Cleaner reversal descriptions** — operator-facing UUIDs are gone. The
  reversal row reads `Reversal — wrong subscriber (note)`; the audit link is
  the existing `reverses_transaction_id` FK, not text the cashier has to read.
- **Recent Voids widget** added to the Billing page: lists every void from
  the last 7 days with reason code, amount, subscriber, and note. Voids
  become visible operational events rather than silent ledger actions.
- See ADR-011 (hardened) and `docs/FINANCIAL_LIFECYCLE_REVIEW_2026-06.md`.



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
