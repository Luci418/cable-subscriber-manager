# Business Rules

This document describes *what the system does* in plain language. It should be
readable by the owner or office staff without opening any code. When behavior
changes, update this file *and* the CHANGELOG.

> Terminology note: this document uses the generic business concepts —
> **Subscriber**, **Service Type**, **Provider**, **Pack**, **Subscription**,
> **Transaction**. Today's services (Cable TV, Internet) and providers (BSNL,
> Fastnet, Internal Network, Own ISP) are examples — the rules apply to any
> future Service Type or Provider added later.

---

## 1. Subscribers

### 1.1 Identity
- Every subscriber has a human-readable **Subscriber ID** auto-generated from
  their region: e.g. `NORTH-001`, `DOWNTOWN-014`. The sequence is per region
  and per operator.
- Mobile number is required; uniqueness is *not* enforced (households share
  numbers).

### 1.2 Services held
- A subscriber holds **zero or more Service Types** (today: Cable TV,
  Internet). The set is stored on the subscriber row.
- Each held service has its own independent ledger: balance, current
  subscription, history, provider, and (optionally) device assignment.
- Deactivating one service does not affect the other.

### 1.3 Deletion
- A subscriber can be deleted only if their downstream records are in a safe
  state (no orphaned device assignments). Deletion is rare — prefer
  deactivating services.

---

## 2. Packs (Plans)

- A pack belongs to **exactly one Service Type** and **exactly one Provider**.
- A pack has a name, price, channel/feature description, validity in days, and
  a billing type (`prepaid` / `postpaid`).
- Packs are **soft-deleted** (`is_active = false`). A pack in use by any
  current subscription or referenced in transaction history cannot be hard
  deleted.
- Renaming a pack changes the display name in *future* receipts. Historical
  transactions retain the name captured at the time of sale (snapshot in the
  subscription blob).

---

## 3. Providers

- A Provider represents **any organization, network, upstream carrier,
  franchisee, reseller, or service source** through which a service is
  delivered. Examples: BSNL, Fastnet, Internal Cable Network, Own ISP.
- Every pack, transaction, and active service-subscription is tagged with a
  provider. This drives revenue attribution and reconciliation with upstream.
- Providers are scoped per operator (per `user_id`).
- A provider cannot be deleted if it is referenced by any pack, transaction,
  or active subscription (enforced by `is_provider_in_use` RPC).

---

## 4. Subscription Lifecycle

For each Service Type a subscriber holds, the lifecycle is:

```
   NONE ──assign pack──▶ ACTIVE ──end date passes──▶ EXPIRED (in history)
                            │
                            ├──cancel with refund──▶ CANCELLED (in history)
                            └──renew / change pack──▶ ACTIVE (new entry)
```

### 4.1 Active status
A subscription is **active** if its `endDate` is strictly in the future
(IST). The application uses synchronized server time
([timeSync](../src/lib/timeSync.ts)), not the browser clock.

### 4.2 Auto-expiry
- A server-side function (`expire_lapsed_subscriptions`) runs hourly and on
  every list-load to move lapsed `current_subscription` blobs into
  `subscription_history` with `status = 'expired'`.
- This is idempotent — re-running it on a clean dataset is a no-op.

### 4.3 Assigning a new pack
- Cannot assign a new subscription for a service if one is already active for
  that service. Cancel or wait for expiry first.
- Total charge = `packPrice × duration` (in pack-defined billing units).
- The full charge is added to the subscriber's balance as **debt** at the
  moment of assignment (see §6).
- A `charge` transaction is recorded automatically, tagged with the service
  type and provider.

### 4.4 Cancellation with refund
- Refund defaults to a prorated amount: `daysRemaining × (totalCharged ÷ totalDays)`.
- Staff may override the refund between `0` and `totalCharged`.
- A `refund` transaction is recorded and reduces the balance.
- The subscription moves to history with `status = 'cancelled'` and the
  cancellation timestamp.

### 4.5 Renewals (current behavior)
- Today, "renew" is implemented as "assign a new pack" after expiry. The
  system does not yet distinguish *renewal* from *new sale* — both look the
  same in history. Distinguishing them is a planned enhancement; until then,
  renewal/churn analytics is an approximation.

---

## 5. Transactions

- Three types: **charge**, **payment**, **refund**.
- Every transaction is tagged with `subscriber_id`, `service_type`, and
  `provider_id`.
- **Charge** ⇒ increases balance (debt). Created automatically on subscription
  assignment, or manually for ad-hoc fees.
- **Payment** ⇒ decreases balance. Created when staff/agents record money
  collected.
- **Refund** ⇒ decreases balance. Created on cancellation.
- Transactions can be edited (amount, description) but the `type` and
  `service_type` should not change after creation — doing so will desync the
  stored balance (see §6.4).

---

## 6. Balance Model

### 6.1 Sign convention
- `balance > 0` ⇒ subscriber **owes** money (debt).
- `balance < 0` ⇒ subscriber has **credit** (overpaid / advance).
- `balance = 0` ⇒ settled.

### 6.2 Per-service ledgers
Cable and Internet balances are **independent**. A payment recorded against
the cable service does not reduce the internet balance, and vice versa. The
UI requires staff to choose the service when recording a payment for a
multi-service subscriber.

### 6.3 Stored, not computed
Balances are stored on the subscriber row and updated transactionally with
every charge/payment/refund. This makes reads O(1) for cashiers.

### 6.4 Drift and reconciliation
- The true balance is always `Σ charges − Σ payments − Σ refunds` per service.
- If a transaction is added without updating the stored balance (e.g. via a
  bulk import bug), the stored value drifts.
- A reconciliation tool is planned (`reconcile_balances` /
  `repair_balances`) to detect and repair drift. Until then, the recommended
  practice is to use the UI for all balance-affecting changes.

---

## 7. Inventory (Set-Top Boxes / Devices)

- Devices have statuses: `available`, `assigned`, `faulty`, `returned`.
- `assigned` requires a `subscriber_id`. Other statuses must have no
  subscriber.
- A device assignment is part of subscriber creation/edit; deactivating a
  service should mark the device for return.

---

## 8. Complaints

- Linked to a subscriber. Fields: category, priority, description, status,
  resolution notes.
- Status transitions are unrestricted (free workflow) — the operator decides
  the meaning of `pending → in_progress → resolved`.

---

## 9. Collections (planned, not yet enforced)

When the Phase 2 transaction-enhancement work lands, every payment will
carry: `collected_by` (which staff member/agent), `collection_route`
(optional), and `payment_method` (cash / UPI / bank transfer / cheque). This
will enable collection-agent dashboards and route-level analytics.

---

## 10. Data Integrity Guarantees

- Regions, packs, and providers cannot be deleted while referenced by any
  subscriber, subscription, or transaction.
- Subscriber ID format and sequence is enforced server-side.
- Row-Level Security: every row is scoped to the owning operator
  (`auth.uid() = user_id`). Staff sharing one account today; per-staff roles
  are an explicit non-goal (see ADR-009).
