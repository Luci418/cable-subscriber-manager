# Destructive Operations Audit

Audit date: 2026-07-05 (Consolidation Sprint)
Scope: every entity in the `public` schema that supports deletion or an
equivalent destructive operation.

## Summary table

| Entity | Current behaviour | Business rule | Appropriate? | Recommendation |
|---|---|---|---|---|
| **Subscribers** | Physical delete via `useSubscribers.deleteSubscriber` → `DELETE FROM subscribers WHERE id=…`. RLS scopes to `user_id`. `check_subscriber_deletable` RPC exists but is **not called from the UI**; delete is blocked instead by FK cascades / triggers on child rows. `archive_subscriber` RPC is the intended path and is used by `ArchiveCustomerDialog`. | Archive-on-history, delete only for empty data-entry mistakes | 🟡 Mostly. Gap: UI does not call `check_subscriber_deletable` first, so the user sees a raw FK error instead of a friendly "has transactions" message. | (a) Wire `check_subscriber_deletable` into `deleteSubscriber` before issuing the DELETE, surface `blockers[]` as a toast. (b) Long-term: add a `subscriber_delete_log` (id, deleted_by, deleted_at, reason) so even "empty" deletions leave a trail. |
| **Devices (stb_inventory)** | Physical delete via `useStbInventory` (`.delete().eq('id',…)`). No RPC gate. RLS scopes to `user_id`. `subscriber_id` FK is `ON DELETE SET NULL`-ish via trigger, but an `assigned` device deletion would orphan a subscriber's cache. | Delete only when device is `available` and has never been paired | 🔴 Missing. No status check, no history check. | Add a `check_device_deletable` RPC (blocks if `status != 'available'` OR any row in `device_assignment_log`). Retired devices should transition to `status='retired'`, not delete. |
| **Packs** | Physical delete via `usePacks.deletePack`; guarded by `is_pack_in_use()` SQL function (checks `subscribers.current_pack`/`current_internet_pack` for current user). UI blocks with friendly toast. | Delete only if never used; otherwise retire | 🟡 Partial. `is_pack_in_use` reads legacy `current_pack` columns only — it does NOT check `subscriptions.pack_id`. A pack referenced by a historical (non-current) subscription can be deleted, breaking historical FK. | Rewrite `is_pack_in_use` to also `EXISTS (SELECT 1 FROM subscriptions WHERE pack_id = X)`. Confirm `subscriptions.pack_id` FK behaviour (should be `ON DELETE RESTRICT`; verify). This is a **latent data-integrity bug** — fix within Phase 6.5. |
| **Providers** | Physical delete via `useProviders.deleteProvider`; guarded by `is_provider_in_use()` (checks packs, transactions, subscribers). Retire/reactivate path also exists. | Delete only if never used | 🟢 Correct. Function covers all four dependent tables. | None. |
| **Regions** | Physical delete via `useRegions.deleteRegion`; guarded by `is_region_in_use()` (checks `subscribers.region`). | Delete only if no subscribers use it | 🟢 Correct. | None. |
| **Complaints** | Physical delete via `useComplaints.deleteComplaint`. RLS scopes to `user_id`. No guard. | Delete allowed — complaints are operational tickets, not financial records | 🟡 Acceptable. But: deleting a resolved complaint erases audit context. | Long-term: add a `deleted_at` column and switch to soft-delete. Not urgent. |
| **Transactions** | Physical delete blocked by `transactions_enforce_immutability` trigger. UI has no delete affordance. Void via `void_transaction` RPC (role-gated). | Never delete; always void | 🟢 Correct — invariant is enforced at the DB layer. | None. |
| **Transaction notes** | INSERT/UPDATE/DELETE all blocked after insert by `transaction_notes_enforce_immutability`. | Append-only | 🟢 Correct. | None. |
| **Subscriber status log** | Same — trigger `subscriber_status_log_enforce_immutability` blocks UPDATE/DELETE. | Append-only | 🟢 Correct. | None. |
| **Device assignment log** | No immutability trigger. Rows are only ever written by `pair_device` / `unpair_device` / `replace_device` (SECURITY DEFINER RPCs). RLS forbids client-side writes. | Append-only | 🟡 Enforced only by absence of client-side write path. A future admin RPC could accidentally delete. | Add `device_assignment_log_enforce_immutability` trigger (mirror the pattern used for `subscriber_status_log`). Low-risk one-liner. |
| **Payment allocations** | No user-facing delete. Written only by `transactions_fifo_allocate_trg`. RLS restricts client writes. | Immutable by convention | 🟡 Enforced only by absence of a delete path. | Same recommendation — add an immutability trigger. Consider whether voiding a payment should reverse the allocation (currently it does not — needs a follow-up review). |
| **Subscriptions** | No user-facing delete. Status transitions via `cancel_subscription` / `expire_lapsed_subscriptions`. | Append-only + status transitions | 🟢 Correct behaviourally; no explicit immutability trigger, so a raw admin `DELETE` would succeed. | Add an immutability trigger for symmetry with `transactions`. |
| **Settings** | Row exists per user; UPDATE gated by RLS + `can_modify_settings()`. No delete surface. | Config, not history | 🟢 Correct. | None. |
| **User roles** | Delete allowed only when caller has `owner` role (RLS). UI in `RolesManagement.tsx` toggles roles by insert/delete. | Owner-only role management | 🟢 Correct. | None. |
| **Profiles** | No delete surface. Created by `handle_new_user` trigger on `auth.users` insert. | Auto-managed | 🟢 Correct. | None. |

## Findings — ranked by severity

1. **HIGH — `is_pack_in_use` misses historical subscriptions.** A pack
   referenced only by a cancelled or expired subscription can be
   physically deleted. If the FK on `subscriptions.pack_id` is `ON
   DELETE NO ACTION` the delete silently fails; if it is `ON DELETE SET
   NULL` we lose analytics attribution. Verify + rewrite the function.

2. **MEDIUM — Devices can be deleted while assigned.** No RPC gate on
   `stb_inventory` deletion means a mis-click can orphan a subscriber's
   `stb_number` and drop a row from device history. Add
   `check_device_deletable`.

3. **MEDIUM — `deleteSubscriber` bypasses its own gate.** The
   `check_subscriber_deletable` RPC exists but is not called from the
   UI. Wire it in; surface `blockers[]` to the operator.

4. **LOW — Append-only tables rely on absence rather than triggers.**
   `subscriptions`, `payment_allocations`, and `device_assignment_log`
   should each have an immutability trigger mirroring `transactions`.
   One-line additions.

5. **LOW — No audit log for "empty" subscriber deletions.** When a
   subscriber with no history is deleted, no trace remains. Consider a
   `subscriber_delete_log` for eventual GDPR/right-to-erasure hygiene.

6. **INFO — Complaints have no soft-delete.** Acceptable today. Revisit
   when a ticketing SLA feature lands.

## Not changed in this sprint

Per prompt scope, this sprint reports rather than remediates. All items
above are tracked in `PROJECT_STATUS.md#technical-debt-register` for
scheduling.
