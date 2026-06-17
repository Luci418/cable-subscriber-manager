# Phase 5.1 Plan — Pair / Unpair Device

## Audit results: where `subscriber.services[]` is used today

Full inventory done. 23 read sites, classified:

| Category | Count | Action in 5.1 |
|---|---|---|
| Workflow gates (4 SQL, 4 TS) | 8 | **Keep SQL gates as safety nets.** Remove the 4 TS mirrors only on the surfaces 5.1 touches (`EditSubscriberDialog`). |
| UI display / filter / form-state / derivation | 15 | Leave alone — degrade gracefully, no behavior change needed. |

### Why we are NOT ripping out `services[]` in 5.1

The DB has a hard CHECK constraint (`array_length >= 1`) and a trigger that raises on service-removal-while-active. Rewriting those in 5.1 would balloon scope across analytics, billing, and 6 migrations. Instead:

- `pair_device` **auto-adds** the matching service to `services[]` if missing — this becomes the "service declaration" the prompt describes, just expressed inside the RPC.
- `unpair_device` leaves `services[]` alone (capability is sticky; operator never loses the tab).
- `AddSubscriberForm` keeps its services checkbox for now (initial-record creation still needs at least one entry to satisfy the CHECK constraint). Removing that form path is a Phase 5.4 concern.
- `EditSubscriberDialog` is stripped completely — that is the only place the device-assignment-on-edit pattern lives, and stripping it fixes the ONU dropdown bug and removes 4 of the 4 TS-side workflow-gate mirrors in one move.

This keeps 5.1 narrowly focused on what the prompt actually asks: operator can pair/unpair devices, see workflow buttons on the profile, and the ONU dropdown bug is gone.

## Migrations

### 1. `pair_device(p_subscriber_id, p_device_id, p_reason)` RPC

- Preconditions:
  - Auth uid set; subscriber exists and `customer_status != 'archived'`
  - Device exists, belongs to caller, `status = 'available'`
- Transaction body:
  - `UPDATE stb_inventory SET status='assigned', subscriber_id=p_subscriber_id`
  - If device.`service_type` not already in `subscribers.services`, append it (auto-declaration)
  - If service is `cable` and `subscribers.stb_number` is null, set it to the new device's serial (keeps the cable-STB invariant trigger happy)
  - Insert open row into `device_assignment_log` with `open_reason = p_reason` (default `'installation'`)
  - No subscription created, no transaction created
- Returns: `jsonb { device_id, serial, service_type }`

### 2. `unpair_device(p_subscriber_id, p_device_id, p_reason, p_return_status)` RPC

- `p_reason` in `('customer_closed','downgrade','correction','repair')`
- `p_return_status` in `('available','faulty')` (default `'available'`)
- Preconditions:
  - Device assigned to this subscriber
  - **No active subscription references this `device_id`** — block with clear error pointing operator to cancel first
- Transaction body:
  - Close open `device_assignment_log` row (`closed_at = now()`, `close_reason = p_reason`)
  - `UPDATE stb_inventory SET status = p_return_status, subscriber_id = NULL`
  - If the device was the cable STB on the subscribers row (`stb_number = device.serial` and `service_type='cable'`), clear `stb_number` (avoids the inventory-agreement trigger flagging it as orphaned)
  - Leave `services[]` untouched
- Returns: `jsonb { device_id, return_status }`

Both RPCs `SECURITY DEFINER`, `search_path=public`, granted to `authenticated`.

## Code changes

### 3. `EditSubscriberDialog.tsx` — strip to identity only (fixes ONU dropdown bug)

Keep: `name`, `mobile`, `region` (and any address fields currently shown).
Remove: services checkboxes, STB selector, ONU/router selector, all `wantsCable`/`wantsInternet` derivations, all related toast guards.

This single change removes TS-1, TS-2, TS-5 from the audit AND fixes the ONU-dropdown-greyed-out bug at the source.

### 4. `PairDeviceDialog.tsx` — new component

Modal opened from the device card area of each service section on the subscriber profile.
- Pre-scoped to a service type (`cable` or `internet`)
- Query: `stb_inventory WHERE status='available' AND service_type = :scope` (excludes faulty/assigned/decommissioned at the query level — not just UI hiding)
- Shows: serial, device type, date added
- "Pair" button → calls `pair_device` RPC → toast → refresh subscriber

### 5. `UnpairDeviceDialog.tsx` — new component

Confirm dialog with:
- Reason selector (Customer closed / Downgrade / Correction / Repair)
- Return-as toggle: Available (default) / Faulty
- "Unpair" button → calls `unpair_device` RPC

### 6. `SubscriberDetail.tsx` — device card layout per service

For each enabled service section (Cable / Internet), replace today's flat field list with:

- One **device card** per device currently assigned to the subscriber for that service (driven by `stb_inventory` query, not by the legacy `stb_number` column)
- Each card shows: serial, active subscription status if any (from `_activeCable[]` / `_activeInternet[]` matched by `deviceId`), days remaining, balance due
- Action buttons on every card: `Collect Payment` (disabled, "coming soon" tooltip), `Renew` (opens existing `AddPackageSubscriptionDialog`), `Replace Device` (disabled until 5.2), `Unpair` (opens dialog from #5)
- `+ Pair Device` action when service section has zero devices; `+ Pair Another Device` when ≥1 device (gated by the multi-device test in step 8)

Scope: only the device-card region is restructured in 5.1. The wider financial summary / next-action-chips redesign is 5.4 and explicitly out of scope here.

### 7. `StbInventoryDialog.tsx` — confirm four-state separation

Inspect current implementation: it already buckets by status into Available / Assigned / Faulty / Retired tabs. Verify nothing leaks faulty/decommissioned into the available list. Add a small "last subscriber" line to faulty cards (from the most recent closed `device_assignment_log` entry). No structural rebuild.

## Verification

### 8. Multi-device render test (before shipping "+ Pair Another Device")

Per the prompt's requirement:
1. Pick a test subscriber. Open a transaction in `psql`.
2. Insert a second `stb_inventory` row and a second active `subscriptions` row tied to it.
3. Open the subscriber profile. Confirm **two independent device cards** render with their own subscription status and action buttons.
4. Roll back the transaction.
5. Report pass/fail. Only enable "+ Pair Another Device" if pass.

### 9. Final report — confirm before moving to 5.2/5.3

- [ ] Operator can pair a replacement ONU after marking the old one faulty (faulty → repair → available → pair)
- [ ] Inventory screen cleanly separates Available / Assigned / Faulty / Decommissioned, with Pair Device modal only showing Available
- [ ] Subscriber profile shows per-device cards with workflow buttons (Collect Payment disabled, Renew wired, Replace Device disabled, Unpair wired, Pair Device wired)
- [ ] `EditSubscriberDialog` has zero device fields and zero services-related guards
- [ ] Multi-device render test passed

## Out of scope (explicitly deferred)

- Replace Device UI → 5.2 (the `replace_device` RPC already exists; button will be visible-but-disabled)
- Collect Payment workflow → 5.3
- Full subscriber-profile redesign (financial summary header, next-action chips, cross-device totals) → 5.4
- Archive customer workflow → later in Phase 5
- Removing the `services[]` workflow gates in SQL and `AddSubscriberForm` → deferred until the create-subscriber flow itself is redesigned, likely 5.4
