# Permission Matrix

Canonical reference for who can do what. **The database is the security
boundary** — every row here is enforced server-side by SQL helper functions
(`can_*`) and triggers. The React UI (`usePermissions()` in
`src/lib/permissions.ts`) mirrors this table only to hide dead-end buttons.

Roles are stored in `public.user_roles`. See [ROLE_DESIGN.md](./ROLE_DESIGN.md)
for the rationale behind each role.

## Action matrix

| Action | Owner | Admin (Office) | Collection Agent | Technician | Backend gate | UI helper |
|---|:---:|:---:|:---:|:---:|---|---|
| Archive customer            | ✓ | ✓ |   |   | `archive_subscriber` RPC → `can_archive_customer()` | `canArchiveCustomer` |
| Reactivate customer         | ✓ | ✓ |   |   | `reactivate_subscriber` RPC → `can_archive_customer()` | `canArchiveCustomer` |
| Void transaction            | ✓ | ✓ |   |   | `trg_transactions_enforce_void_role` + `void_transaction` RPC → `can_void_transaction()` | `canVoidTransaction` |
| Cancel subscription (+ refund) | ✓ | ✓ |   |   | `cancel_subscription` RPC → `can_cancel_subscription()` | `canCancelSubscription` |
| Collect payment             | ✓ | ✓ | ✓ |   | (transactions insert; role-recorded via `created_by`) | `canCollectPayment` |
| Pair device                 | ✓ | ✓ |   | ✓ | `pair_device` RPC → `can_pair_device()` | `canPairDevice` |
| Unpair device               | ✓ | ✓ |   | ✓ | `unpair_device` RPC → `can_pair_device()` | `canPairDevice` |
| Replace device              | ✓ | ✓ |   | ✓ | `replace_device` RPC → `can_replace_device()` | `canReplaceDevice` |
| Mark device faulty / repair / decommission | ✓ | ✓ |   | ✓ | direct table update (inventory management) | `canReplaceDevice` |
| Add device to inventory     | ✓ | ✓ |   | ✓ | direct table insert | `canReplaceDevice` |
| Update business settings    | ✓ |   |   |   | RLS policy on `public.settings` → `can_modify_settings()` | `canModifySettings` |
| Manage user roles           | ✓ |   |   |   | RLS on `user_roles` requires `has_role(owner)`; `list_users_with_roles()` RPC gated | `isOwner` |

## `performed_by` attribution audit

Every gated write records who performed it. Verified on 2026-07-04.

| RPC / trigger | Attribution column | Source |
|---|---|---|
| `cancel_subscription`   | `subscriptions.cancelled_by` | `auth.uid()` inside RPC |
| `archive_subscriber`    | `subscribers.archived_by` + `subscriber_status_log.actor` | `auth.uid()` inside RPC |
| `reactivate_subscriber` | `subscriber_status_log.actor` | `auth.uid()` inside RPC |
| `pair_device`           | `device_assignment_log.opened_by` | `auth.uid()` inside RPC |
| `unpair_device`         | `device_assignment_log.closed_by` | `auth.uid()` inside RPC |
| `replace_device`        | `device_assignment_log.opened_by` (new row) + `closed_by` (old row) | `auth.uid()` inside RPC |
| `void_transaction`      | `transactions.voided_by` (original) + `transactions.created_by` (reversal, via `transactions_audit_stamp` trigger) | `auth.uid()` inside RPC + trigger |
| `create_subscription`   | `subscriptions.created_by` | `auth.uid()` inside RPC |
| All `INSERT`/`UPDATE` on `transactions` | `created_by` / `edited_by` | `transactions_audit_stamp()` trigger |

No gaps.

## UI-vs-backend alignment audit

| Action | Backend gate | UI gate | Helper used |
|---|:---:|:---:|---|
| Archive customer            | ✓ | ✓ | `canArchiveCustomer` |
| Reactivate customer         | ✓ | ✓ | `canArchiveCustomer` |
| Void transaction            | ✓ | ✓ | `canVoidTransaction` (folded into `canVoid` predicate) |
| Cancel subscription         | ✓ | ✓ | `canCancelSubscription` |
| Collect payment             | ✓ | ✓ | `canCollectPayment` |
| Pair device                 | ✓ | ✓ | `canPairDevice` |
| Unpair device               | ✓ | ✓ | `canPairDevice` |
| Replace device              | ✓ | ✓ | `canReplaceDevice` |
| Mark device faulty          | ✓ | ✓ | `canReplaceDevice` |
| Add device to inventory     | ✓ | ✓ | `canReplaceDevice` |
| Settings update             | ✓ (RLS) | ✓ (banner + Roles UI owner-only) | `canModifySettings` |
| Manage roles                | ✓ | ✓ | `isOwner` |

## Bootstrap and onboarding

- **First user only** is auto-granted `owner` by `grant_owner_on_signup`.
  Every subsequent signup receives **no role** — an existing Owner must
  assign a role from Settings → Roles & Access.
- The trigger is bootstrap-only and marked `TODO(pre-production)` — see
  [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

## When adding a new gated action

1. Add a `can_<action>()` SECURITY DEFINER helper in a migration.
2. Guard the RPC / trigger with `USING ERRCODE = '42501'`.
3. Record `performed_by = auth.uid()` on the mutated row.
4. Mirror the helper as a boolean in `src/lib/permissions.ts`.
5. Wire the boolean into the UI to hide/disable the button.
6. Add a row to both tables above.
