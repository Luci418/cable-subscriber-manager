# Project Status

**Single source of truth for where the project stands.**
Update at the end of every major milestone. If it disagrees with any other
doc, this file wins for status; the domain docs win for rules.

Last updated: 2026-07-08 (Phase 6.5 Batch C)

---

## Current milestone

**Phase 6.5 — Consolidation Sprint & UX Foundation: IN PROGRESS.**
Batches A (correctness), B (legacy pack columns) and C (JSONB blob
retirement) have shipped. Remaining: encrypted technician credentials
and navigation IA + Device Detail worked example.

## Completed milestones

| Phase | Scope | Shipped |
|---|---|---|
| 1 | Core CRUD: subscribers, packs, regions, providers, transactions | ✅ |
| 2 | Payments, receipts (58mm + A4), balance model v2 | ✅ |
| 3 | STB inventory + pairing lifecycle | ✅ |
| 4 | Normalised `subscriptions` table + timeline/active views | ✅ |
| 4b | View-based reads for active/timeline; legacy JSONB writes retained | ✅ |
| 5 | Multi-device pairing, device replacement, unpair with reason | ✅ |
| 5.1 | Services[] decoupled from device pairing; declared-intent model | ✅ |
| 5.2 | Add-Service flow on subscriber profile (Cable⇄Internet symmetry fix) | ✅ |
| 5.3 | Error-propagation audit + `updateSubscriber` maybeSingle() fix + QA gate | ✅ |
| 6 | `app_role` enum, `user_roles`, `has_role()`, `can_*` gates on all RPCs, RolesManagement UI, PERMISSION_MATRIX + ROLE_DESIGN docs | ✅ |
| 6.5-A | `is_pack_in_use` canonical rewrite, `check_device_deletable` RPC + UI gate, `deleteSubscriber` routed through `check_subscriber_deletable`, immutability triggers on `subscriptions` / `payment_allocations` / `device_assignment_log` | ✅ |
| 6.5-B | Dropped `current_pack` / `current_internet_pack`; pruned all pack-label compat writes; frontend migrated to view-derived active/timeline pack names | ✅ |
| 6.5-C | Dropped JSONB blob columns (`current_subscription`, `subscription_history`, `internet_subscription`, `internet_subscription_history`); rewrote `subscribers_enforce_invariants`, `check_subscriber_deletable`, `create_subscription`, `cancel_subscription`, `expire_lapsed_subscriptions` against the normalised `subscriptions` table | ✅ |


## Active work

Consolidation Sprint (this document, `SYSTEM_INVARIANTS.md`,
`TESTING_ARCHITECTURE.md`, `DESTRUCTIVE_OPERATIONS_AUDIT.md`,
`LEGACY_DEPENDENCY_AUDIT.md`, docs reorganisation).

## Next milestone — Phase 6.5

UX & navigation refinement. Not scoped here. See future planning doc when
opened; current backlog lives in `FUTURE_EVOLUTION.md`.

## Deferred work

See **Deferred Work Register** below.

## Technical debt

See **Technical Debt Register** below and the Technical Debt section
inside `PRODUCTION_READINESS.md`.

## Known regressions

None open. Last regression closed: Add-Service Cable/Internet asymmetry
(Phase 5.2) + silent-success on `updateSubscriber` (Phase 5.3).

## Current blockers

None. Project is unblocked for Phase 6.5.

---

## Deferred Work Register

| Deferred Item | Reason | Dependencies | Suggested milestone |
|---|---|---|---|
| Warranty tracking on `stb_inventory` | Not needed for current single-operator scale; would bloat inventory UI | STB inventory (done) | Phase 8 (Warehouse) |
| Full asset lifecycle (procurement → disposal) | Requires purchase orders + vendors, out of current scope | Warranty tracking, vendor model | Phase 8 (Warehouse) |
| Warehouse module (bulk receive, transfer, RMA) | Only meaningful once operator holds inventory across sites | Vendor model | Phase 8 |
| Fiber / cable GIS (splitter, span, closure) | Field mapping needs dedicated GIS work; not required for billing | None | Phase 9 |
| Network monitoring (SNMP, ping sweep) | Requires backend worker; Supabase alone cannot poll | Worker infra | Phase 10 |
| FreeRADIUS integration | Only relevant for ISP customers using PPPoE/hotspot auth | Provisioning API | Phase 10 |
| GenieACS (TR-069 CPE mgmt) | Same as above, ONU/CPE remote config | Provisioning API | Phase 10 |
| Field Operations PWAs (installer app, collection app) | Requires offline-first architecture; premature before UX baseline | Phase 6.5 UX | Phase 7 |
| Multi-tenant SaaS mode | Business decision, not engineering | Billing infra, org model | Post-1.0 |
| Automated testing (see TESTING_ARCHITECTURE.md) | Deliberately incremental; introduce layer by layer | pgTAP setup | Phase 7 tail |
| Retiring `services[]` column | Open question — keep as declared-intent cache or derive? See BUSINESS_MODEL.md | Trigger rewrite | No milestone |
| Retiring `stb_number` column | High blast radius; invariant trigger + UI + CSV all read it | Batch D rewrite | Phase 8 |
| Retiring `current_subscription` / `internet_subscription` JSONB | Three server consumers still read them | Batch C rewrite | Phase 7 |
| Retiring `current_pack` / `current_internet_pack` text | 5 UI readers + `is_pack_in_use` SQL | Batch B rewrite | Phase 6.5 tail |

## Technical Debt Register

| Item | Impact | Severity | Notes |
|---|---|---|---|
| Legacy JSONB blob columns on `subscribers` | Duplicated state — cache vs. normalised `subscriptions` | Medium | See `LEGACY_DEPENDENCY_AUDIT.md` and `PRODUCTION_READINESS.md#technical-debt`. Retirement order documented. |
| `src/lib/storage.ts` (585 lines, still imported by 7 files) | Legacy localStorage-era helpers not fully migrated to Supabase hooks | Low | Callers work correctly; refactor when touching each caller for another reason. |
| Balance reconciliation | Shipped 2026-07-17 — `reconcile_subscriber_balance` + `reconcile_all_balances` RPCs + `balance_audit` table + UI. ADR-003 closed. | ✅ Done | — |
| `grant_owner_on_signup()` trigger | Dropped 2026-07-17. First-Owner provisioning is now a documented manual SQL step in PRODUCTION_READINESS.md. | ✅ Done | — |
| Renewal lineage in analytics | Renewals look like new sales; churn is approximate | Low | Enrich subscription blob when Batch C ships. |
| No client-side error capture (Sentry) | Silent frontend errors invisible to operator | Low | Nice-to-have. |
| No automated tests | Every release relies on manual QA | Medium | See `TESTING_ARCHITECTURE.md` for the phased plan. |

---

## Architecture Evolution

Short notes so future contributors understand *how* the system got here.
Not a substitute for `ARCHITECTURE_DECISIONS.md`; call out only assumptions
that have changed.

- **JSONB blobs were once authoritative.** Pre-Phase-4, `current_subscription`
  and `internet_subscription` on `public.subscribers` were the source of
  truth. Phase 4 introduced the normalised `subscriptions` table + the
  `v_subscriber_active_subscription` and `v_subscriber_subscription_timeline`
  views. The blobs are now caches maintained by RPCs; retirement plan lives
  in `LEGACY_DEPENDENCY_AUDIT.md`. Any new code MUST read the views, not the
  blobs.
- **`services[]` was once tied to devices.** Pre-Phase-5.1, `'cable' ∈
  services[]` implied a paired STB. Phase 5.1 decoupled the two: `services[]`
  is now a *declared intent* and `stb_inventory` is the *realised state*.
  The `subscribers_enforce_invariants` trigger still guards the transition
  but no longer requires a device on the same row.
- **Single-user was once the model.** Pre-Phase-6 the whole app assumed one
  operator per tenant (ADR-009). Phase 6 introduced `user_roles`; the
  bootstrap trigger backfills the *first* signup as `owner` and everyone
  after that starts with no role. RLS now assumes multiple authenticated
  users may share a tenant.
- **Deletion was once physical.** Early phases allowed hard-delete on
  subscribers. Phase 5+ moved that behaviour to `archive_subscriber` + gate;
  physical delete is now blocked by `check_subscriber_deletable`. See
  `DESTRUCTIVE_OPERATIONS_AUDIT.md`.
- **Time source is server-derived.** `src/lib/timeSync.ts` (IST from
  WorldTimeAPI) exists because active/expired calculations must not depend
  on device clocks. Any new time-sensitive UI MUST use it.

---

## How to update this file

At the end of each milestone:

1. Move the completed milestone into the "Completed milestones" table.
2. Refresh "Current milestone" and "Next milestone".
3. Age off any items in "Active work" that shipped.
4. Move any items reclassified as debt into the register (with severity).
5. Update `Last updated:` at the top.
