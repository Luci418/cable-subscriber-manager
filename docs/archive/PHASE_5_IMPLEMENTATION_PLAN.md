# Phase 5 — Sequenced Implementation Plan

**Companion to:** [OPERATOR_WORKFLOW_UI_REVIEW.md](./OPERATOR_WORKFLOW_UI_REVIEW.md) v1.1, [INDUSTRY_BENCHMARKING_ADDENDUM.md](./INDUSTRY_BENCHMARKING_ADDENDUM.md)
**Prerequisite:** Phase 4b regression (QA_TEST_PLAN.md) must pass before any item below starts.
**Date:** 2026-06-14

## Sequencing principle

Order = (a) DB primitives first, then (b) the workflows that depend on them, then (c) pure UI refactors that touch many components. This minimizes rework when an RPC contract shifts.

## The ordered list

### 5.0 — Pre-flight: confirm Phase 4b regression green
- **Dependency:** none
- **Effort:** 0.5 day (operator QA only, no dev work)
- **Exit:** zero diff rows in Part B parity sweep across all subscribers.

### 5.1 — Service card refactor (UI primitive)
- **Why first:** every workflow below mounts an action onto a service card. If the card shape is wrong, every workflow rebuilds against the wrong host.
- **What:** `<SubscriptionCard subscription={…} device={…}>` rendered once per row in `_activeCable[]` / `_activeInternet[]`. Card shows: pack, dates, days remaining, paired device serial + type, and an action menu (Renew / Replace Device / Unpair Device / Cancel).
- **Dependency:** 5.0
- **Effort:** 1 day
- **Touches:** `SubscriberDetail.tsx`, new `SubscriptionCard.tsx`, new `EmptyServiceLine.tsx` (for services enabled with no active sub).

### 5.2 — `pair_device` RPC
- **Why:** closes the bug "can't add a new ONU to a subscriber whose old ONU was marked faulty". No existing RPC handles "subscriber has a service, no device assigned, assign a new one".
- **Signature:** `pair_device(p_subscriber_id uuid, p_serial text, p_reason text)` → returns `{device_id, service_type}`.
- **Logic:** verify subscriber exists; verify device exists, `status='available'`, `service_type` matches a service in `subscribers.services`; verify no active subscription on this device; set device → `assigned` + `subscriber_id`; insert `device_assignment_log` (open row, `open_reason = 'new_pair'`); update `subscribers.stb_number` only if `service_type='cable'` AND `stb_number IS NULL`.
- **Dependency:** 5.0
- **Effort:** 0.5 day (mirror of `replace_device`)

### 5.3 — `unpair_device` RPC
- **Why:** closes the "device returned for repair, but service should stay" gap. Today we force cancellation.
- **Signature:** `unpair_device(p_subscriber_id uuid, p_serial text, p_reason text)` → returns `{device_id, had_active_subscription bool}`.
- **Logic:** verify device assigned to this subscriber; if an active subscription is bound to this device → reject with a clear error ("Cancel the active subscription first, or use Replace Device to swap onto a new device without losing the subscription."); release device (`status='available'`, `subscriber_id=NULL`); close `device_assignment_log` row with `close_reason`.
- **Dependency:** 5.0
- **Effort:** 0.5 day
- **Note:** intentionally does NOT touch any active subscription. Operator must cancel separately. Keeps the RPC single-purpose.

### 5.4 — Pair/Unpair/Replace device UI
- **What:** three dialogs wired to 5.2 / 5.3 / existing `replace_device`. Pair lives on the "no device" state of `EmptyServiceLine`; Unpair + Replace live on the `SubscriptionCard` action menu and on a standalone "Devices" panel for devices without an active subscription.
- **Dependency:** 5.1, 5.2, 5.3
- **Effort:** 1 day
- **Touches:** `SubscriberDetail.tsx`, new `PairDeviceDialog.tsx`, new `UnpairDeviceDialog.tsx`, finish `ReplaceDeviceDialog.tsx` (Workflow 6 completion).

### 5.5 — Collect Payment workflow (Workflow 4)
- **What:** new `CollectPaymentDialog` (per review doc Part 8 + benchmarking addendum). Bill-first selection (one checkbox per outstanding service line), Cash | UPI tabs, inline UPI QR (`upi://pay?...` rendered by `qrcode` lib client-side using `settings.operator_upi_vpa`), optional UTR field.
- **Dependency:** 5.1 (uses service-line list), Phase 4b schema additions (already shipped: `transactions.payment_method`, `source='subscription_payment'`, `settings.operator_upi_vpa`).
- **Effort:** 1.5 days
- **Touches:** new `CollectPaymentDialog.tsx`, replace the existing "Add Payment" path in `SubscriberDetail.tsx`. Charging logic does not change — FIFO trigger still allocates.
- **Open question to resolve before build:** Part D6 of the QA plan — confirm what the existing FIFO trigger does with manual amount-first payments today, so we know whether Collect Payment can route through the same trigger unchanged.

### 5.6 — Ledger rendering rules (Part 5)
- **What:** in `TransactionLedger` (rename of the current list), apply: (a) collapse void + its reversal into a single struck-through row with an "expand" affordance, (b) distinct visual language for adjustments (badge, muted color), (c) group by service line within a date, (d) expandable allocation breakdown reading from `payment_allocations`.
- **Dependency:** 5.0 (no RPC dependency; pure presentation)
- **Effort:** 1 day
- **Touches:** transaction list component in `SubscriberDetail.tsx`.

### 5.7 — Subscriber profile redesign (Part 3)
- **What:** restructure `SubscriberDetail` top region. Header (name, ID, status, total outstanding across services). Below: tabs or sections for **Services**, **Devices**, **Ledger**, **Complaints**, **Profile**. Services tab renders the cards from 5.1. Devices tab lists assigned devices independent of subscriptions. Profile tab holds editable fields.
- **Dependency:** 5.1, 5.4, 5.6 (everything else lives inside this redesigned shell)
- **Effort:** 1.5 days
- **Touches:** `SubscriberDetail.tsx` mainly; small extractions to keep files <300 lines.

### 5.8 — Edit subscriber form fix
- **What:** the bug you reported: adding the Cable service to an Internet-only subscriber leaves the ONU dropdown disabled even though an ONU is already assigned. Root cause is almost certainly that `EditSubscriberDialog` resets the internet device dropdown whenever any service checkbox flips. Audit and fix to preserve already-assigned devices when the service set is *extended*, and only clear when a service is *removed*.
- **Dependency:** 5.0 (independent of 5.1–5.7, can ship anytime in this phase)
- **Effort:** 0.5 day
- **Touches:** `EditSubscriberDialog.tsx`.

## Effort summary

| Item | Effort | Cumulative |
|---|---|---|
| 5.0 regression | 0.5d | 0.5d |
| 5.1 card refactor | 1d | 1.5d |
| 5.2 pair_device RPC | 0.5d | 2d |
| 5.3 unpair_device RPC | 0.5d | 2.5d |
| 5.4 device UIs | 1d | 3.5d |
| 5.5 Collect Payment | 1.5d | 5d |
| 5.6 ledger rules | 1d | 6d |
| 5.7 profile redesign | 1.5d | 7.5d |
| 5.8 edit form fix | 0.5d | 8d |

≈ **8 working days** of focused build, assuming Phase 4b regression is clean. Realistic with revision cycles: **~2 calendar weeks**.

## Dependency graph

```text
5.0 ──┬─▶ 5.1 ──┬─▶ 5.4 ──┐
      │         │         │
      ├─▶ 5.2 ──┘         │
      ├─▶ 5.3 ────────────┤
      │                   ▼
      ├─▶ 5.5 ◀── (Phase 4b schema) ──┐
      ├─▶ 5.6                          │
      │                                ▼
      └─▶ 5.8                  5.7 ◀── 5.1, 5.4, 5.6
```

5.0 is the gate. 5.1, 5.2, 5.3, 5.6, 5.8 can be worked in parallel after the gate. 5.4 needs 5.1+5.2+5.3. 5.5 needs 5.1. 5.7 is last and integrates everything.

## Out of scope for Phase 5 (parked for Phase 6)

- KYC + Address structured fields (TRAI)
- Subscriber profile audit log (TRAI)
- Itemised monthly statement export (TRAI NTO-2)
- Complaint SLA timers
- GST line items
- **Role-based access (collection agent / admin / owner) + collection-agent map app** — see Phase 6 sketch in `.lovable/plan.md`.
- Proration on plan change
- Discounts / promo packs as first-class entities

---

## 5.5 ledger rendering — known requirement (flagged 2026-06-22)

The targeted-allocation verification in Phase 5.3 (Test 3) produced a state
that is mathematically correct but visually misleading if rendered as a net:

> Subscriber has ₹102 advance credit AND ₹200 outstanding on a separate
> subscription simultaneously. Net `cable_balance = ₹98 due`.

Showing only "₹98 due" will confuse operators who don't understand why the
collection target is lower than the outstanding bill. The passbook in 5.5
MUST surface the gross components:

> "₹200 outstanding on STB-001, ₹102 advance credit"

…not just the net figure. This is the same principle as BUSINESS_MODEL §G1
("never display a raw balance number without its meaning label") applied
to per-subscription positions, and the same intent as the bill-first
Collect Payment dialog: the operator sees what they're collecting against,
not an opaque aggregate.

Implementation hint: the passbook can compute per-subscription outstanding
from `subscriptions.total_charged` minus `payment_allocations` per
`subscription_id` (the same query already used in `SubscriberDetail` for
the per-device breakdown). Advance credit is the residual portion of any
payment with no remaining allocation target on the same service line.
