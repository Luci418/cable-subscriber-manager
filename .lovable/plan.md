## Scope confirmation

Phase 5.6 (Archive) + Asset Timeline + Phase 6 role foundation. Field-ops interfaces and refund/cancel permissions are gated on your confirmations and will not be built in this batch.

## Discrepancies / gates to resolve before I code

1. **Audit mechanism for archive/reactivate — RESOLVED (user-approved).** Three existing patterns were evaluated first and each ruled out:
   - `device_assignment_log` — append-only and immutable, but scoped to a single device↔subscriber pairing. Records why a device left, not why a customer left. An archive with no devices produces zero rows.
   - `transactions` ledger — append-only, immutable, actor-stamped, but every row must have a signed financial amount. Overloading it with non-financial "archived" events would break every reconciliation query (`reconciliation.ts`, `ledgerRendering.ts`) that assumes rows represent money.
   - `transaction_notes` — immutable but bound to a transaction row. Same failure mode: no transaction, nowhere to hang the note.
   None answer "who archived this customer, when, and why" for a customer with no devices and no outstanding balance. `subscriber_status_log` is the smallest extension that fills the gap and reuses the immutability-trigger pattern from `transaction_notes`.

2. **Cancel-subscription permission** — per your instruction I will STOP here and ask:
   - Option A: Admin-only (Owner + Admin Office can cancel directly).
   - Option B: Approval workflow (Collection Agent can request; Owner/Admin approves).
   - I will not gate `cancel_subscription` until you choose.

3. **`performed_by` attribution audit.** Verified before role work:
   - `pair_device`, `unpair_device`, `replace_device` → write `opened_by` / `closed_by = auth.uid()` on `device_assignment_log`. ✓
   - `create_subscription` → `created_by = auth.uid()` on `subscriptions`. ✓
   - `transactions` → `created_by`, `voided_by`, `edited_by` stamped by trigger. ✓
   - `cancel_subscription` → does NOT stamp a `cancelled_by`. **Gap.** I will add `cancelled_by uuid` to `subscriptions` and set it in the RPC as part of the role foundation migration.
   - `settings`, `ensure_settings_row` → scoped by `auth.uid()` but no actor column needed (single-row per user).

4. **Equipment sales / `device_id` on transactions.** Existing `AddTransactionDialog` already supports `manual_charge` with `subscription_id = NULL` and a free-text description — confirmed sufficient. Adding `device_id` to `transactions` is NOT trivial (schema + RLS + immutability trigger + types regen + UI picker). Recommend skipping per your "do not expand scope" rule. Confirm.

## Implementation order (after gates resolved)

### Batch 1 — Archive Customer (Phase 5.6)

**Migration**
- Add `archived_at`, `archived_by`, `archive_reason`, `archive_reason_code` to `subscribers`.
- Add `subscriber_status_log` table (append-only, RLS scoped to `auth.uid()`, GRANTs to authenticated + service_role, immutability trigger).
- New RPC `archive_subscriber(p_id, p_reason_code, p_reason_note)`:
  - Loops active subscriptions → calls existing cancel logic (no refund unless caller passed one; archive UI will compute refund per-sub via existing dialog before invoking).
  - Loops assigned devices → calls `unpair_device(..., reason='customer_closed', return_status='available')`.
  - Sets `customer_status='archived'` + archive columns.
  - Inserts `subscriber_status_log` row.
- New RPC `reactivate_subscriber(p_id, p_reason_note)` → restores to `active` or `inactive` based on whether any non-archived subscriptions remain (none → `inactive`), logs event.

**UI**
- `ArchiveCustomerDialog.tsx`: two-step (warnings → reason picker + free-text → confirm). Reason codes: `moved_away`, `switched_provider`, `duplicate`, `non_payment`, `other`.
- `ReactivateCustomerDialog.tsx`.
- `SubscriberDetail.tsx`: replace Delete with Archive when `customer_status != 'archived'`; show Reactivate otherwise. Banner on archived profiles.
- `SubscriberList.tsx`: filter out `customer_status='archived'` by default; add "Show archived" toggle.
- `Billing.tsx` collection/renewal lists: exclude archived.
- Analytics, mobile search, revenue history: leave archived visible (already query all rows).

### Batch 2 — Asset Timeline (read-only, no schema change)

- New `src/lib/assetTimeline.ts` — pure query helpers over `device_assignment_log`.
- `AssetTimelineCustomer.tsx` — collapsible "Previous Devices" section on `SubscriberDetail` (excludes rows where `closed_at IS NULL` — those are the current device cards). Newest first by `opened_at`.
- `AssetTimelineDevice.tsx` — "Asset Timeline" section on `StbInventoryDialog` device detail. Top row tagged **Current Customer** when `closed_at IS NULL`; all others historical with duration.
- Heading copy uses "Asset Timeline" per your naming guidance.

### Batch 3 — Phase 6 role foundation

**Migration**
- Enum `app_role` = `owner`, `admin_office`, `collection_agent`, `technician`.
- `user_roles` table per the canonical pattern (GRANTs, RLS, `has_role()` SECURITY DEFINER).
- Seed: every existing `auth.users` row → `owner` (one-operator-business assumption).
- Permission helpers (SQL, all `STABLE SECURITY DEFINER`):
  - `can_void_transaction()`, `can_archive_customer()`, `can_modify_settings()`, `can_pair_device()`, `can_replace_device()`, `can_collect_payment()`.
  - Each wraps `has_role()` with role sets per your spec.
- Gate RPCs:
  - `void_transaction` → `can_void_transaction()`.
  - `archive_subscriber` / `reactivate_subscriber` → `can_archive_customer()`.
  - `pair_device` / `unpair_device` / `replace_device` → `can_pair_device()`.
  - Settings writes → `can_modify_settings()` (enforced via RLS policy on `settings`).
  - **`cancel_subscription` NOT gated yet** (awaits gate #2).
  - Add `cancelled_by` column + stamp in `cancel_subscription` (closes attribution gap #3).
- TS helper `src/lib/permissions.ts` mirroring server-side helpers for UI button-hiding (defence in depth, not the security boundary).

### Batch 4 — DEFERRED until you confirm

- Cancel-subscription gating (gate #2).
- Refund permissions.
- Collection Agent map interface.
- Technician job interface.
- Equipment sales `device_id` column (recommend permanent skip).

## Out of scope (acknowledged, not touched)

Warranty, deployment events, repair lifecycle, warehouse, FreeRADIUS/GenieACS/LibreNMS, suspension automation, multi-tenant SaaS, separate PWAs.

## Files touched (estimated)

Migrations: 2 (archive + roles).
New files: `ArchiveCustomerDialog.tsx`, `ReactivateCustomerDialog.tsx`, `AssetTimelineCustomer.tsx`, `AssetTimelineDevice.tsx`, `assetTimeline.ts`, `permissions.ts`.
Modified: `SubscriberDetail.tsx`, `SubscriberList.tsx`, `Billing.tsx`, `StbInventoryDialog.tsx`, `useSubscribers.tsx` (archived filter).

---

**Please confirm:**
- (a) Audit approach in gate #1 (status_log table OK, or columns-only).
- (b) Cancel-subscription model in gate #2 (admin-only vs approval workflow).
- (c) Skipping `device_id` on `transactions` per gate #4.

Once confirmed I'll ship Batch 1 → 2 → 3 in that order, with the migration tool surfacing each schema change for your approval.