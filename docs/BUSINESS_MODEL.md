# Business Model & Invariant Handoff
## Subscriber Management System — Complete Implementation Brief for Lovable
### Version 3.2 — Phase 4 Schema Final (device-level uniqueness, transaction ownership model)

> **Authority:** This document is the single authoritative source for business
> rules, lifecycle decisions, and invariants for this system.
> It supersedes INVARIANT_WORKSHEET.md, all prior partial answers, informal
> chat decisions, and all earlier versions of this document.
> BUSINESS_RULES.md should reference this document rather than duplicate it.
>
> **Scope:** Covers all worksheet sections A through J in full.
> Every answer came directly from the operator. Nothing is assumed.
> No items remain marked [OPEN] — all questions are now resolved.
>
> **Instructions for Lovable:** Read this document before writing any Phase 3,
> 4, or 5 migration, RPC, or UI component. Every implementation decision
> must be traceable to a section here. If a scenario arises that is not
> covered, ask — do not infer.
>
> **Revision history:**
> - v1.0: Initial handoff, sections A–B from worksheet discussion
> - v2.0: All sections A–J completed from operator answers
> - v3.0: Seven Lovable refinements applied; all open questions closed;
>   suspend model added; refund calculation method confirmed; mobile/name/
>   region editability rules added; INV-02 scope restriction added;
>   INV-16 corrected; INV-23 corrected; INV-32/INV-33 added;
>   revised build order confirmed; OQ-1 and OQ-2 closed.
> - v3.1: Phase 4 schema finalised. `subscriptions` table confirmed with
>   four amendments to Lovable's proposal. `payment_allocations` table
>   added as the authoritative source for payment-to-subscription linkage.
>   `cash_paid` and `adjustment_credit_applied` removed from subscriptions.
>   Refund formula simplified to cash-only pro-rata. `device_serial_snapshot`
>   mutability corrected to inventory-agreement pattern. `end_date` session-flag
>   bypass rejected; trigger blocks all direct updates in v1. Suspend columns
>   added as nullable for v2 readiness. INV-39 through INV-44 added.
> - v3.2: Two final corrections before Phase 4 migration is written.
>   Uniqueness constraint corrected from (subscriber_id, service_type) to
>   (device_id) — multi-device model requires device-level uniqueness.
>   Transaction ownership model formalised: transactions are subscriber-owned
>   and service-scoped; device_id is NOT added to transactions; subscription_id
>   added as nullable FK for display context on charge/refund rows only.
>   Transaction ownership reference table added. INV-39 reworded. INV-45 added.
>   Phase 4 build sequence updated to 11 steps including subscription_id
>   column addition to transactions.

---

---

# PART ONE — THE BUSINESS MODEL

---

## 1.1 The Core Mental Model Correction

The most important thing to understand before implementing anything.

The system was previously being modelled as if subscriptions were persistent,
long-lived relationships — similar to Netflix or Microsoft 365, where a
subscription persists and gets renewed, upgraded, or mutated over time.

**That model is wrong for this operator.**

The correct mental model is **DTH / telecom prepaid recharge**:

- A customer recharges for X days.
- The recharge grants an entitlement for exactly those X days.
- When those days end, the entitlement ends. Nothing automatic happens.
- A renewal is a new, independent recharge — not a continuation of anything.
- Each entitlement period is a discrete, standalone record.

This is how Tata Play, Airtel Digital TV, Dish TV, Jio, regional cable
operators, and this operator all work.

**The consequence for implementation:**

A subscription record is a completed historical fact. Once created, its
commercial terms — pack, price, provider, start date, end date — are
immutable. It does not get extended, upgraded, or mutated. When something
changes, the old subscription ends and a new one begins.

The word "subscription" in this codebase means: *one prepaid entitlement
period for one device*.

---

## 1.2 The Five Separations — The Master Principle

These are not the same thing and must never be conflated in schema,
business logic, or UI:

```
Customer      ≠  Service
Service       ≠  Device
Device        ≠  Subscription
Subscription  ≠  Payment
Payment       ≠  Entitlement
```

Each object has its own lifecycle. Each has its own state transitions. Each
has its own invariants. The database and application exist to enforce these
boundaries so that impossible states cannot occur.

---

## 1.3 The Object Hierarchy

```
Customer
  └── Service Relationship  (Cable TV / Internet / IPTV / ...)
        └── Device           (STB / ONU / Router / any future type)
        │     └── Subscription  (one entitlement period per device)
        └── Ledger           (all financial transactions for this customer)
              └── Transaction  (charge / payment / refund / adjustment / ...)
```

**Reading the hierarchy:**

- A **Customer** is the business relationship. It exists independently of
  everything below it.
- A **Service Relationship** (`services[]` on the customer row) is the
  long-lived declaration that this customer is, for example, an Internet
  customer. It survives device replacements, subscription expiries, provider
  changes, and plan changes. It is removed only when the operator explicitly
  ends the customer's relationship with that service category.
- A **Device** is a physical inventory asset assigned to a customer under a
  service. A customer may have multiple devices under one service (multiple
  STBs, multiple ONUs). Each device is independently managed.
- A **Subscription** is one prepaid entitlement period, attached to one
  specific device. One device = at most one active subscription at any time.
- A **Transaction** is an immutable financial event in the customer's ledger.
  Every transaction is linked to the customer, and where relevant, to the
  service, device, subscription, and provider that generated it.

---

### Open Question (2026-06-20): is `services[]` declared intent, or a derived cache?

This question must be resolved before any further behavior change to the
`services[]` column or the `pair_device` / `unpair_device` auto-writes.

**The question:** Is there any real operator workflow in which `services[]`
contains a service that has no corresponding device in `stb_inventory`?

The candidate scenario is **prospect-before-installation**: an LCO records
a customer as a Cable prospect days or weeks before a technician shows up
with an STB. During that window:
- the subscriber row exists (`customer_status = 'prospect'`),
- `services[]` declares Cable as the intended service,
- there is no `stb_inventory` row paired to the subscriber yet.

A second candidate is **temporary device removal** — a paired STB sent
back to the warehouse for repair while the customer still considers
themselves a Cable subscriber. Under the current model the operator must
unpair (which removes the service from `services[]` when it's the last
device of that type), then re-pair on return. If the operator wants
`services[]` to persist through that window, it is declared intent.

**Decision rule:**
- **If YES** (real prospect/temporary-removal workflow exists): `services[]`
  is genuine declared intent. The auto-writes in `pair_device` (append on
  pair) and `unpair_device` (remove on last-device unpair) should be
  REMOVED — `services[]` should only change when an operator explicitly
  edits it. Pairing a device whose service isn't in `services[]` would
  then become an explicit operator-confirmed action, not an implicit
  mutation.
- **If NO** (every realistic state has at least one device per declared
  service): `services[]` is a derived cache. It should eventually be
  replaced by a query against `stb_inventory` (assigned devices' service
  types) ∪ `subscriptions` (active subs' service types), and the column
  dropped per Batch C/D of the legacy column audit.

**Status:** unresolved. No behavior change applied. Documented here to
prevent silent drift between the data model and the operator workflow.

**Answer when known:** _TBD — operator interviews / commercial-rollout
testing._ Once decided, update this section with the answer and the
corresponding cleanup (either remove the auto-writes, or schedule
`services[]` for derivation + drop).

---



# PART TWO — SECTION A: CUSTOMER LIFECYCLE

---

## A1. Minimum Valid State at Customer Creation

**A customer can be created with only:**

- Name (required)
- Mobile number (required, unique per operator)
- Region (required)
- Services list (required — at least one declared service category)

**Not required at creation:**

- Any device assigned
- Any active subscription
- Any payment
- Installation

**The workflow the system must support:**

```
Customer record created
  → [later] Installation performed
  → [later] Device assigned
  → [later] Subscription created
  → [later] Payment collected
  → [later] Receipt issued
```

Customer creation must never force the operator to complete downstream steps
immediately. Each step happens independently, in its own workflow, at the
right operational moment.

**Opening balances for migration:**

Opening balances are allowed when migrating customers from paper ledgers or
spreadsheets. They must be posted as a system-generated ledger transaction
with `source = 'opening_balance'`. They must never be a direct write to the
balance column. The balance trigger is the sole writer of stored balances.

**Invariant A1:**
> A customer record with name + mobile + region + services[] is valid,
> even with no device, no subscription, and zero balance.

---

## A2. Customer With Zero Active Subscriptions

**Yes — a customer can exist with zero active subscriptions.**

This is a valid and common operational state, not an error:

- Prospect: enquiry received, not yet installed
- Inactive seasonal: customer is away, will return
- Cancelled-but-returning: all subscriptions ended, history preserved
- Lapsed: subscription expired, operator has not yet collected renewal

A customer with no active subscriptions is in **Inactive** status
automatically. They remain on the books. Their history is intact. They
appear in balance/collections reports if they have an outstanding balance.
They can be subscribed again at any time without creating a new record.

**Invariant A2:**
> A customer with no active subscriptions must not be automatically
> archived or deleted. Zero active subscriptions is a valid state.
> The system must never force the operator to take action on a customer
> solely because their subscription expired.

---

## A3. Customer Status Model

**Four explicit statuses:**

| Status   | Meaning |
|----------|---------|
| Prospect | Enquiry received. No device assigned, no subscription, no payment. |
| Active   | Has at least one active subscription on at least one device. |
| Inactive | No active subscriptions. History intact. Can transact. Appears in collections if balance > 0. |
| Archived | Intentionally removed from all operational workflows. History fully preserved. Cannot transact until explicitly reopened by the operator. |

**Status transitions:**

```
Prospect  → Active    (first subscription created)
Active    → Inactive  (all subscriptions expire or are cancelled)
Inactive  → Active    (new subscription created)
Inactive  → Archived  (operator explicitly archives the customer)
Archived  → Inactive  (operator explicitly reopens the customer)
```

**Deletion rules:**

- Customer with any transaction, subscription history, or complaint:
  **archive only, never hard delete.** Hard-deleting a customer with
  transaction history rewrites revenue retroactively. The database must
  enforce this — not just the UI.
- Customer with zero transactions, zero subscription history, zero
  complaints: hard delete is permitted (this is a data entry mistake).

**Archive workflow — what must happen when archiving:**

1. All active subscriptions must be cancelled first (the archive RPC should
   enforce this or perform it as part of the action).
2. All assigned devices must be unassigned and returned to inventory.
3. If the customer has a non-zero balance (debt or credit), the system must
   warn the operator and require a conscious acknowledgement before archiving.
4. The customer row remains in the database with `status = 'archived'`.
5. Archived customers do not appear in: subscriber list, renewal reminders,
   collection routes, active subscriber counts.
6. Archived customers do appear in: all revenue history, transaction ledger,
   provider and service analytics, churn analysis.

**Reactivation (Archived → Inactive):**

When a former customer returns, the operator reopens the original record —
never creates a new one. This is enforced by mobile number uniqueness.
The historical balance at archive time is still present and must be surfaced
to the operator so they can decide to collect it, write it off via adjustment,
or carry it forward.

**INV-02 scope restriction (Lovable refinement):**

The trigger that flips status between Active and Inactive must be narrowly
scoped. It must only act when the current status is `active` or `inactive`.
If the current status is `prospect` or `archived`, the trigger must leave it
unchanged — those are operator-set states, not computed states. The trigger
must never overwrite `prospect` or `archived` with a computed value.

**Invariant A3:**
> A customer with any financial or subscription history cannot be
> hard-deleted. This must be enforced at the database level.

**Invariant A4:**
> Reopening an archived customer must reuse the original record.
> Creating a duplicate customer record for a known returning customer
> is a data quality violation. Mobile number uniqueness is the primary
> guard against this.

---

## A4. Customer Identity Field Editability

Customer identity fields are editable by the operator. The rules for each:

**Name:**
Editable at any time. Typos happen at onboarding and must be correctable.
No history required. The corrected name is the current name.

**Mobile number:**
Editable at any time. A returning customer who changed their phone number
needs their record updated rather than a duplicate record created.
The mobile uniqueness constraint (`unique per operator`) remains in force —
the operator cannot set a mobile to a number that already belongs to another
active or archived customer.
When a mobile number is changed, the old number is gone from the system.
The operator is responsible for ensuring the number is genuinely changing
(not a duplicate entry mistake). A search-before-edit prompt in the UI
is recommended to surface any existing customer with the new number before
committing the change.
Note: households share a single customer record with multiple devices —
they do not share a mobile number across two separate customer records.

**Region:**
Editable at any time. Customers move between regions. When a region is
changed, the new region takes effect immediately for all operational purposes
(collection routes, regional analytics, renewal reminders). No region change
history is maintained — current region is the only region stored.
Analytics for prior periods will reflect the customer's current region, not
their region at the time. This is a known and accepted limitation for v1.

**Invariant A5:**
> Mobile number must be unique per operator at all times. If an operator
> attempts to update a customer's mobile to a number already in use by
> another customer under the same operator, the system must reject the
> change with a clear error identifying the existing customer.

---

---

# PART THREE — SECTION B: SUBSCRIPTIONS

---

## B1. Multiple Active Subscriptions Per Customer

**Yes — a customer can have multiple active subscriptions simultaneously,
but only by having multiple devices.**

The rule is:

- **One device = at most one active subscription at any time.**
- A customer with two STBs can have two active cable subscriptions.
- A customer with both an STB and an ONU can have one active cable
  subscription and one active internet subscription simultaneously.
- A customer cannot have two active subscriptions on the same device.
- A customer cannot have two active subscriptions for the same service
  type on the same device.

This is not a SaaS "multiple seats" model. It is a physical reality:
each piece of hardware can only run one entitlement at a time.

**Invariant B1:**
> One device may have at most one active subscription at any time.
> This must be enforced at the database level (unique partial index on
> device_id where status = 'active'), not just in the UI.

---

## B2. Mid-Cycle Pack Change

**The operator decides — no automatic behaviour.**

When an operator wants to switch a customer from one pack to another
mid-cycle, the workflow is:

1. Cancel the current subscription. The system calculates and presents a
   suggested refund amount (pro-rata by days remaining — see D5). The
   operator decides the actual refund amount, which may be the suggested
   amount, a different amount, or zero.
2. Create a new subscription with the new pack.

There is no automatic "upgrade" or "downgrade" action. Pack changes always
go through explicit cancel + new subscription. This preserves historical
accuracy: the old pack is cleanly recorded as a completed (cancelled)
entitlement period; the new pack is a fresh entitlement period.

**Invariant B2:**
> A pack change is always: cancel current subscription (operator-determined
> refund) → create new subscription. There is no direct mutation of an
> active subscription's pack or price.

---

## B3. Pause / Suspend

**Not in v1. Cancel + recreate is sufficient for now.**

If a seasonal customer wants to pause their service, the operator cancels
the subscription (with whatever refund they decide) and recreates it when
the customer returns.

Suspension (billing paused, end date extended) is a planned future feature.
The architecture must not block it: the customer status model must include a
`suspended` state that can be added later, and the subscription model must
allow `end_date` to be extended through a controlled RPC without creating a
new subscription record.

**For v1:** No suspend workflow. Cancel + recreate is the operator workflow.

**For v2 (planned — full model defined here so architecture stays open):**

The suspend model works as follows:

When a subscription is suspended:
- `status` changes to `suspended`
- `days_remaining` is frozen and stored at the moment of suspension
- `end_date` is set to `null` (shown as blank in the UI — not expired,
  not active, in a known holding state)
- A suspension event is logged: `suspended_at`, `suspended_by`,
  `suspension_reason` (required), `max_resume_by` date (calculated from
  the max suspension duration setting)

During suspension:
- The customer's service is paused in the Conditional Access System (CAS)
  by the operator — this is an external operational step, not a system action
- No billing events occur
- The subscription is neither active nor expired — it is suspended

When the subscription is resumed:
- `end_date` is recalculated: `resume_date + days_remaining`
- `status` returns to `active`
- `days_remaining` is cleared (it is now derivable from `end_date`)
- A resume event is logged: `resumed_at`, `resumed_by`

If the maximum suspension duration is reached without manual resumption:
- The subscription auto-resumes on the `max_resume_by` date
- An auto-resume event is logged

**Concrete example:**
> Customer has Internet 100 Mbps running Jan 1 → Jan 31 (30 days).
> On Jan 15 the operator suspends it. 16 days remaining. The subscription
> shows: status = suspended, end_date = null, days_remaining = 16,
> suspended_at = Jan 15.
> On Feb 3 the operator resumes it.
> New end_date = Feb 3 + 16 days = Feb 19.
> Audit log shows: suspended Jan 15, resumed Feb 3, 19-day suspension.

**Suspension restrictions (to be configured as system settings):**
- Maximum suspension duration: TBD (e.g., 90 days)
- Maximum suspensions per subscription: TBD (e.g., once per subscription
  period)
- Reason required: yes
- Who can suspend: operator only (not collection agents)
- On reaching max duration: auto-resume

**Important: suspension affects INV-16.**
INV-16 states that commercial terms including `end_date` are immutable after
creation. Suspension requires `end_date` to be mutable through the
`suspend_subscription` and `resume_subscription` RPCs. INV-16 must be
scoped precisely: "commercial terms — pack, price, provider — are immutable
after subscription creation. `end_date` is mutable only through
`suspend_subscription`, `resume_subscription`, and (if implemented)
`extend_subscription` RPCs. Direct updates to `end_date` are blocked."

All suspension events are part of the subscription's audit trail and must
be visible in the customer passbook view.

---

## B4. Auto-Renewal on Expiry

**No auto-renewal. No auto-charge on expiry. Ever.**

When a subscription's end date passes, it expires. Nothing automatic happens.
The customer's entitlement ends. The operator initiates every renewal manually
when the customer pays.

Auto-charge would require stored payment credentials, dispute handling, and
a failure workflow. None of these are in scope.

**Invariant B4:**
> Subscription expiry triggers no automatic financial event.
> The `expire_lapsed_subscriptions` function only moves the subscription
> from active to history. It does not create any transaction.

---

## B5. Late Renewal — When Does the New Cycle Start?

**The new cycle starts from the day of recharge (today), not from the
original expiry date.**

The model is: recharge for X days → entitled for X days from today.

**Example:**
- Customer's subscription ran 1 Jan → 31 Jan.
- Customer pays and renews on 6 Feb (5 days late).
- New subscription runs 6 Feb → 7 Mar (30 days from today).
- The 5 gap days (1–5 Feb) are simply a lapsed period. No charge, no
  credit, no penalty.

This is the standard DTH/telecom model. The customer gets what they pay
for from the day they pay.

The operator may manually set a different start date if they need to
backdate a renewal (see Section F — backdating rules). But the default,
when the operator creates a new subscription today, is today as the
start date.

**Invariant B5:**
> The default start date for a new subscription is the date the operator
> creates it. The operator may override this within the backdating window
> (7 days). The system must not automatically use the prior subscription's
> end date as the new start date.

---

---

# PART FOUR — SECTION C: DEVICES AND INVENTORY

---

## Device Model — Abstract and Service-Agnostic

Devices are physical inventory assets. The system must model devices
abstractly — not as "STB" or "ONU" specifically, but as inventory items
with a `device_type` and `service_type`. Future device types (routers,
future hardware) are added by extending the enum, not by changing the model.

**Current device types:** STB (Cable TV), ONU (Internet), Router (Internet)

**The model must support any future device type without schema changes.**

---

## C1. Device Assignment History

**Yes — assignment history must be maintained.**

When a device is unassigned from a customer (for any reason), the system
must record:

- Which customer had it (`subscriber_id`)
- When they received it (`assigned_at`)
- When it was returned (`unassigned_at`)
- Why it was returned (`reason`: customer_closed / faulty / replaced /
  upgrade / inventory_correction / other)

This history is required for warranty tracking, dispute resolution ("the
customer claims they returned the router"), and fault diagnosis (a device
that has been marked faulty across three successive customers is a hardware
defect, not subscriber misuse).

A simple `device_assignment_log` table with these fields is sufficient.
When a device is unassigned, the current assignment is closed in the log.
When a device is assigned, a new log entry is opened.

**Invariant C1:**
> A device unassignment must create a closed entry in the assignment log.
> Nulling the `subscriber_id` FK without a log entry is not permitted.

---

## C2. Multiple STBs Per Customer

**Yes — a customer may have multiple STBs.**

Multiple STBs occur in multi-room setups, commercial premises, and hotels.
Each STB is independently managed:

- Each has its own assignment record.
- Each carries its own subscription.
- Each appears separately in the customer's financial summary with its
  own balance contribution.

**This is a v1 requirement, not a future feature.** The model must support
it from the start.

---

## C3. Multiple ONUs / Routers Per Customer

**Yes — same model as STBs.**

A customer may have multiple ONUs or routers. Each is independently managed,
independently subscribed, independently shown in the financial summary.

**This applies to any future device type as well.** The model is:
one customer → many devices of any type, each device → at most one active
subscription.

---

## C4. Faulty Device Workflow — Subscription Portability

**Keep the subscription. Swap the device. No financial event. This is the
only scenario where a device can be changed while a subscription is active.**

When a device fails and must be replaced:

1. The old device is marked `faulty` — this automatically unassigns it
   from the customer.
2. A replacement device is assigned to the customer.
3. The active subscription's device reference is updated to the new device.
4. The subscription end date, plan, provider, and billing state are
   unchanged.
5. A device swap event is logged: old device, new device, timestamp,
   reason (`faulty_replacement`), who performed it.
6. Zero financial transactions are created.

**This is called Subscription Portability.**

The entitlement belongs to the service relationship, not to the hardware.
When the hardware changes due to a fault, the entitlement moves with the
service.

**The current Phase 2 invariant "active subscription → STB cannot be
swapped" is wrong for fault replacement.** It must be corrected to:

> "A device cannot be changed as part of a plan change, provider change,
> or voluntary upgrade while a subscription is active. A device replacement
> due to confirmed fault is permitted through the `replace_device` RPC
> only, which creates no financial transactions."

**Permitted reasons for `replace_device` (the only scenarios where a
device can change while a subscription is active):**

- Faulty device (`faulty_replacement`)
- Device sent for repair (`repair_swap`)
- Hardware upgrade authorised by operator (`hardware_upgrade`)
- Inventory correction (`inventory_correction`)

Any other reason requires: cancel subscription → unassign device →
assign new device → create new subscription.

**Invariant C4 (Subscription Portability):**
> A device fault replacement must not create, cancel, or modify any
> subscription financial terms or any ledger transaction. It is a pure
> inventory event recorded in the device assignment log.

**Invariant C4b:**
> `replace_device` is the only RPC permitted to change the device on an
> active subscription. No other workflow may do this.

---

---

# PART FIVE — SECTION D: MONEY AND LEDGER

---

## D1. Sign Convention

**Positive balance = customer owes the operator (debt).**
**Negative balance = operator owes the customer (credit / advance).**

This convention must be consistent everywhere:
- All database columns and triggers
- All RPC return values and API responses
- All UI labels — never display a raw positive/negative number;
  always use explicit labels (see Section G for UI requirements)
- All reports and exports

**Invariant D1:**
> The stored `cable_balance` and `internet_balance` are always positive
> when the customer has a debt and negative when the customer has a credit.
> The balance trigger is the sole writer of these columns. No application
> code may write to them directly.

---

## D2. Partial Payments

**Partial payments are allowed. No minimum payment amount.**

A customer paying ₹400 of a ₹1,000 outstanding amount is a valid,
common real-world event. The system must not block any positive payment.
After a partial payment, the outstanding balance reflects what remains.
The UI must surface the remaining balance clearly.

---

## D3. Overpayment — What Happens to the Excess?

**The operator has three choices. The system presents all three explicitly.**

When a customer pays more than they owe, the excess becomes a credit
(negative balance). The operator can then:

**Option 1 — Leave as credit (advance payment):**
The credit sits on the service account. At the next recharge, the operator
collects the difference (pack price minus available credit). The credit is
consumed when the next subscription charge is posted.

**Option 2 — Transfer to another service:**
The operator can transfer the credit from one service account (e.g., cable)
to another (e.g., internet). This is a manual operation: the operator posts
a refund on the source service and a payment on the destination service for
the same amount. *Important: this transfer is only available for credits
arising from cash payments — not from compensation or goodwill adjustments
(see D4).*

**Option 3 — Refund in cash:**
The operator returns cash to the customer and records a manual refund
transaction. The credit is consumed.

**The system must present these three options clearly when a credit balance
exists, as part of the "next action" surface on the customer profile.**

**Invariant D3:**
> A credit balance does not auto-apply to future subscription charges.
> The operator explicitly chooses how to use it at the point of renewal.

---

## D4. Cross-Service Credit Transfers — With Restrictions

**Cross-service credit transfer is allowed, but only for credits arising
from cash payments (advance payments / overpayments).**

**Transfer is NOT allowed for:**
- Compensation credits (e.g., service outage credit)
- Goodwill adjustments
- Any `adjustment` transaction credit

The logic: a goodwill credit given for a cable outage is compensation
for a cable service failure. It is not transferable to internet. Cash
overpayments belong to the customer and can be directed wherever the
operator and customer agree.

**The system must track the origin of each credit** so it can enforce
this rule. `adjustment` transactions that create a credit must be clearly
distinguished from `payment` transactions that create a credit.

**Credit consumption ordering — when a subscription charge is posted
against a mixed credit balance:**

Adjustment-sourced credit is consumed before payment-sourced credit
(adjustment-first ordering). This means:
- Non-transferable credits (adjustment) are used up first
- The customer's own cash credit is preserved for as long as possible
- After consumption, any remaining credit inherits the type of whichever
  source was not fully consumed

**Invariant D4:**
> Cross-service credit transfer is permitted only for credits whose
> source is a cash payment (`type = 'payment'`). Credits from
> `type = 'adjustment'` transactions are siloed to the service
> they were posted against and may not be transferred.
> When consuming mixed credits against a charge, adjustment credit
> is consumed before payment credit.

---

## D5. Refund Formula on Subscription Cancellation

**The operator decides the refund amount. The system suggests; the
operator confirms or overrides.**

**The refund calculation method is adjustment-first (Method B):**

When a subscription was funded by a combination of adjustment credit
and cash payment, the adjustment portion is treated as covering the
first N days of service. Cash covers the remaining days. Only the
unused cash-funded days are refundable.

**Calculation:**

```
daily_rate         = pack_price / total_days
adjustment_days    = floor(adjustment_credit_applied / daily_rate)
cash_days          = total_days - adjustment_days
days_used          = total_days - days_remaining

if days_used <= adjustment_days:
    # still within the adjustment-funded window
    cash_days_used    = 0
    cash_days_remaining = cash_days
else:
    cash_days_used    = days_used - adjustment_days
    cash_days_remaining = cash_days - cash_days_used

suggested_refund = floor(daily_rate × cash_days_remaining)
```

Round down to the nearest rupee.

**Concrete example:**
> Subscription: ₹1,000 / 30 days.
> Funded by: ₹200 adjustment credit + ₹800 cash.
> Cancelled on day 15 (15 days remaining).
>
> daily_rate = ₹1,000 / 30 = ₹33.33
> adjustment_days = floor(₹200 / ₹33.33) = 6 days
> cash_days = 30 - 6 = 24 days
> days_used = 15
> cash_days_used = 15 - 6 = 9 days
> cash_days_remaining = 24 - 9 = 15 days
> suggested_refund = floor(₹33.33 × 15) = ₹499
>
> The ₹200 adjustment credit was fully consumed (first 6 days).
> The customer gets ₹499 back from their ₹800 cash.
> The unused adjustment portion (zero in this case) is forfeited.

**When the subscription was funded entirely by cash (no adjustment):**
The formula simplifies to the standard pro-rata:
`suggested_refund = floor(pack_price × days_remaining / total_days)`

The operator sees the full breakdown — total charged, adjustment portion,
cash portion, days used, days remaining, suggested refund — and can
confirm, override to a different amount, or set to ₹0.

**Cancellation reason is required:**

| Reason code | Typical operator action |
|-------------|------------------------|
| customer_request | Often ₹0 or suggested pro-rata |
| operator_error | Full refund of cash portion |
| provider_migration | No customer refund |
| non_payment | Often ₹0 |
| other | Operator judgment |

The `cancel_reason` is stored on the subscription history record and
visible in the passbook view.

**Invariant D5:**
> Refund amount is operator-determined within the bounds
> ₹0 ≤ refund ≤ cash_amount_paid_for_this_subscription.
> The refund can never exceed the cash the customer actually paid.
> Adjustment credit is never refunded in cash — it is either consumed
> or forfeited. The system suggests but does not mandate the amount.

---

## D6. Voiding Subscription-Generated Transaction Rows

**Correctly blocked. Do not change this.**

A subscription charge (`source = 'subscription_charge'`) and the
subscription it belongs to are two sides of the same business event.
Voiding the charge without cancelling the subscription would leave an
active entitlement with no corresponding financial record.

If a subscription was entered incorrectly, the workflow is:
1. Cancel the subscription (via `cancel_subscription` RPC).
2. This posts the appropriate refund (operator-determined amount).
3. Create the correct subscription.

The `void_transaction` RPC must reject any row with
`source IN ('subscription_charge', 'subscription_refund')` with a clear
error message directing the operator to the cancel workflow.

---

## D7. Adjustment Transaction Type

**Yes — `adjustment` is a required first-class transaction type.**

A goodwill credit, billing error correction, complaint resolution credit,
or outage compensation is fundamentally different from a cash payment or
a subscription refund. Conflating them corrupts cash reporting.

**Transaction type reference — complete set:**

| type | source (enum) | Meaning | Cash movement? |
|------|--------------|---------|----------------|
| charge | subscription_charge | Auto-created by create_subscription RPC | No (receivable) |
| charge | manual_charge | Operator-entered fee (late fee, reconnection, etc.) | No |
| payment | manual_payment | Cash or UPI received from customer | **Yes** |
| refund | subscription_refund | Auto-created by cancel_subscription RPC | **Yes** |
| refund | manual_refund | Operator cash return outside subscription | **Yes** |
| adjustment | adjustment | Non-cash credit or debit (goodwill, write-off, complaint resolution, outage compensation) | No |
| reversal | reversal | Auto-created by void_transaction RPC, offsets a voided row | No |
| opening_balance | opening_balance | One-time migration entry for paper ledger cutover | No |

**Critical distinction for reporting:**

Daily cash collected = SUM of `type = 'payment'` only.
Balance impact = ALL transaction types combined.
These must never be conflated.

**Invariant D7:**
> `type = 'payment'` rows represent cash moving in the physical world.
> `type = 'adjustment'` rows represent accounting corrections with no
> physical cash movement. Reports must separate these. The transaction
> entry UI must require the operator to choose the correct type —
> there must be no path where a non-cash event is recorded as a payment.

---

---

# PART SIX — SECTION E: PROVIDERS

---

## E1. Provider Change — Two Different Scenarios

**The worksheet question was about two different kinds of "provider change"
that must be handled differently:**

**Scenario A — Upstream infrastructure change (operator-side):**
The operator switches their internet lease line from BSNL to Airtel.
This does not affect any individual customer's subscription, plan, price,
or service. The customer doesn't know or care. This is an internal
operational change and does not touch the subscription or billing model.
If provider attribution in analytics matters, a bulk `migrate_provider`
operation is available (see below).

**Scenario B — Customer's service provider changes (customer-facing):**
A customer moves from a BSNL-sourced internet plan to a Fastnet-sourced
internet plan. This is a genuine commercial change for the customer — a
different plan, potentially different speed or price, from a different
provider. This always creates a new subscription:
cancel the BSNL subscription → create a new Fastnet subscription.
The service relationship (Internet) survives. The subscription does not.

**Bulk provider migration (for Scenario A):**

When the operator migrates all customers from Provider A to Provider B
with no commercial change to the customer (same plan, same price, only
the upstream source changes), a `migrate_provider` RPC should be available
that:
1. Updates `provider_id` on the customer's active subscription blob.
2. Updates the relevant provider field on the customer row.
3. Posts a ₹0 `adjustment` transaction with `source = 'provider_migration'`
   as an audit record.
4. Creates no cancellation, no refund, no new subscription.

This preserves subscription continuity and creates an auditable trail
without generating spurious financial events.

**Invariant E1:**
> A provider migration event (Scenario A) must be distinguishable from
> a customer-facing subscription change (Scenario B) in all analytics.
> A bulk migration must not appear as a wave of cancellations and
> new-subscriber events in churn analysis.

---

## E2. Historical Provider Attribution — Always Preserve

**Past transactions stay tagged with the provider that was correct at the
time they were created.**

Provider attribution on historical transactions is immutable (enforced by
ADR-011's immutability trigger).

The only reason to change a provider on a past transaction would be a typo
correction — and even then, the correct approach is to void the erroneous
transaction and re-post it correctly, so the audit trail shows the correction.
Direct re-tagging of historical transactions is not permitted.

**Analytics caveat (must be documented in ANALYTICS_STRATEGY):**
Revenue-by-provider analytics before the v0.9 provider migration date
contain a "Default Provider" placeholder for all pre-migration history.
This is a known data quality artifact. Any time series crossing the
migration date is not directly comparable on a per-provider basis.

---

---

# PART SEVEN — SECTION F: TIME AND EVENTS

---

## F1. Can Transactions Be Backdated?

**Yes. Backdating is a required feature, not an exception.**

Field agents collect cash and enter it into the system later — the same
evening, the next day, at the end of the week. This is the most common
real-world workflow. A system that does not support backdating forces
operators to misrepresent the date, which is worse than allowing it
explicitly.

The `date` field on a transaction is the real-world event date.
The `created_at` field is the system timestamp of when it was entered.
Both are stored. Both are displayed in the audit trail.

---

## F2. Maximum Backdating Window

**Default: 7 days without warning.**

- Transactions dated within 7 days of today: allowed without any warning.
- Transactions dated more than 7 days ago: the system displays a
  confirmation prompt ("This entry is dated more than 7 days ago — please
  confirm it is correct") but does not block it. The operator confirms.
- No hard maximum for the operator/owner role.

**Future role-based backdating limits (not for v1):**
- Collection agents: 24-hour maximum (they enter same-day collections).
- Office staff: 7 days.
- Owner: unlimited (with confirmation prompt beyond 7 days).

**Should the 7-day window be configurable?** Yes — add it as a system
setting that the operator can adjust. This costs almost nothing to
implement and avoids having to touch the code when the operator's workflow
changes.

---

## F3. Can Subscriptions Be Backdated?

**Yes — with the same 7-day window.**

A subscription entered 3 days after it actually started should have its
`start_date` set to the real start date. The subscription charge
transaction will carry the backdated date. This is normal operation.

The `create_subscription` RPC must accept a `start_date` parameter.
The default is today. The operator can set it to any date within the
backdating window.

---

## F4. Do Backdated Entries Affect Balance Immediately?

**Yes — immediately, identical to non-backdated entries.**

There is no "pending" state, no "flagged for review" queue, and no delayed
processing for backdated entries. The balance trigger fires on insert and
updates the stored balance immediately, regardless of the transaction date.

This is safe because backdating is restricted to the owner/admin role
(who is trusted) in v1, and will be restricted by role in v2.

---

---

# PART EIGHT — SECTION G: OPERATOR COMMUNICABILITY

---

## The Governing Principle

> The system may be mathematically correct, but if the operator cannot
> immediately understand what happened, who owes whom, and what action
> is required — the profile is failing its purpose.

**The operator must never have to:**

- Perform arithmetic mentally
- Infer meaning from colours alone
- Infer meaning from positive/negative signs alone
- Open multiple tabs to understand a customer's status
- Reconstruct business events from raw ledger entries

**The system must tell the story directly.**

A subscriber profile is successful if an operator can answer all of the
following within a few seconds, without calculations:

1. What services does this customer have?
2. Which devices are assigned?
3. What subscriptions are active and when do they expire?
4. What happened recently?
5. What is the customer's current financial position?
6. Which service / device / subscription contributed to that position?
7. What is the next required action?

---

## G1. Most Important Information at the Top of a Subscriber Profile

**The operator first needs the customer's overall financial position,
immediately followed by the breakdown of where it comes from.**

**Overall position — expressed in plain language, not numbers alone:**

| Position | Label shown |
|----------|-------------|
| Customer owes money | **Outstanding ₹[amount]** |
| Operator owes money (cash advance) | **Available Credit ₹[amount]** |
| Compensation/adjustment credit exists | **Service Credit ₹[amount]** |
| A cash refund should be returned | **Refund Due ₹[amount]** |
| All settled | **Settled** |

**Immediately below — the per-device breakdown:**

The operator must see how the overall position is composed without opening
any tab or scrolling.

Example — Outstanding:
```
Outstanding ₹1,800

  Internet
    ONU-001 (BSNL 100 Mbps) ............ ₹700 due
    ONU-002 (Fastnet Home 50) ........... ₹500 due

  Cable TV
    STB-001 (Gold HD) .................. ₹300 due
    STB-002 (Basic) .................... ₹300 due
```

Example — Available Credit:
```
Available Credit ₹500

  Internet
    ONU-001 ............................. Settled
  Cable TV
    STB-001 ............................. ₹500 credit available
```

**Financial position terminology — strictly defined:**

**Outstanding** — money owed by the customer to the operator. They must
pay this.

**Available Credit** — money already paid by the customer in excess of
what was charged. It can be applied to future recharges, transferred to
another service (if from a cash payment — see D4), or refunded in cash.
This is not the same as Refund Due.

**Service Credit** — a non-cash credit from an adjustment (goodwill,
outage compensation, complaint resolution). It can only be applied to
future charges on the same service. It cannot be transferred or refunded.

**Refund Due** — money that should be returned to the customer in cash.
This arises after a subscription cancellation where a refund was issued
to the balance and the customer has not yet been paid. The operator must
either return the cash or convert it to Available Credit.

**Settled** — balance is exactly zero. No action required.

**Invariant G1:**
> The UI must never display a raw positive or negative number as a balance.
> Every financial figure must be accompanied by its meaning label.
> The per-device breakdown must be visible on the profile without any
> additional clicks.

---

## G2. Per-Transaction Display Requirements

**Each transaction row in the ledger must make three things unambiguous
at a glance:**

**1. What happened — in plain language**

Not generic labels. Specific, human-readable descriptions that require
no interpretation:

| Instead of | Show |
|------------|------|
| charge | Internet Subscription Charge |
| payment | Cash Payment Received |
| refund | Subscription Cancellation Refund |
| adjustment | Goodwill Credit — Service Outage |
| reversal | Void: Duplicate Entry |
| opening_balance | Opening Balance (Migration) |

**2. Amount and direction — explicitly labelled**

Not a sign. A direction word:

| Instead of | Show |
|------------|------|
| ₹1,000 | Charged ₹1,000 |
| -₹500 | Refunded ₹500 |
| -₹100 | Credited ₹100 |
| ₹400 | Received ₹400 |

**3. Context — which asset generated this transaction**

Every transaction row must show (where applicable):
- Service type (Cable TV / Internet)
- Device serial number (STB-001, ONU-002)
- Provider (BSNL, Fastnet)
- Subscription period (100 Mbps, 1 Jun → 30 Jun)

**Example of a correct transaction row:**

```
15 Jun 2026
Internet Subscription Charge
Service: Internet | Device: ONU-002 | Provider: BSNL
Plan: 100 Mbps | Period: 1 Jun → 30 Jun
Charged ₹700                          Running balance: ₹700 due
```

**4. Running balance after this transaction**

Every row must show the balance state after that event. The operator must
be able to read the ledger from top to bottom and understand the account
history without any arithmetic.

---

## G3. Post-Cancellation Display

After a cancellation + refund, the customer profile must explicitly show
a human-readable summary. No arithmetic. No inference.

**Example:**
```
Subscription cancelled on 15 Jun 2026
  Service: Internet | Device: ONU-002
  Plan: 100 Mbps | Original period: 1 Jun → 30 Jun

  Original charge:    ₹1,000
  Days used:          15 of 30
  Days remaining:     15
  Refund issued:      ₹966
  Amount retained:    ₹34 (15 days consumed)

  Current financial position: Settled
```

If the outcome is not "Settled", the position must state exactly what it
is — Outstanding, Available Credit, Service Credit, or Refund Due — with
the amount.

---

## G4. Subscriber Statement (Passbook View)

**Yes — required.**

A chronological running balance view, like a bank passbook, must be
available on every subscriber profile.

**Format:**

```
Date     | Description                    | Charged | Received/Credited | Balance
---------|--------------------------------|---------|-------------------|--------
01 Jun   | Opening Balance (Migration)    |  ₹500   |                   | ₹500 due
01 Jun   | Internet Subscription Charge   |  ₹700   |                   | ₹1,200 due
05 Jun   | Cash Payment Received          |         |        ₹1,200     | Settled
15 Jun   | Subscription Cancelled         |         |                   |
15 Jun   | Cancellation Refund            |         |          ₹966     | ₹966 credit
18 Jun   | Refund Returned (Cash)         |  ₹966   |                   | Settled
```

- Voided rows appear with strikethrough and a "Voided" label.
- Reversal rows reference the voided transaction.
- The statement is printable as PDF (uses the same infrastructure as receipts).
- The current position is shown clearly at the bottom.

---

## G5. Next-Action Chip

**Yes — required on both the subscriber list card and the subscriber
profile.**

The next-action chip is a single, computed label that tells the operator
exactly what to do about this customer right now. It requires no new data —
it is computed from existing fields.

**Complete chip decision table:**

| Customer state | Chip displayed |
|----------------|----------------|
| All active, all settled, >7 days remaining | ✅ No Action Required |
| Any active subscription expiring within 7 days, settled | ⏰ [Service] renewal due in [N] days |
| Any subscription expired, zero balance | 🔄 Renew [Service] |
| Any subscription expired, positive balance | 💰 Collect ₹[amount] and renew [Service] |
| Active subscription, positive balance | 💰 Collect ₹[amount] |
| Available credit balance (cash advance) | 💳 ₹[amount] credit — apply at next recharge |
| Service credit balance (non-cash) | 🎁 ₹[amount] service credit available |
| Refund due (post-cancellation credit) | ↩️ Return ₹[amount] to customer |
| Device assigned, no active subscription | 📋 Create subscription for [Device] |
| Service declared, no device assigned | 🔧 Assign device before subscription |
| Device return outstanding | 📦 Device return pending |
| Archived customer | 🗄️ Archived [date] |

Multiple chips may be shown if multiple actions are required (e.g., one
service renewing + another service has outstanding balance). Prioritise
the most urgent.

---

---

# PART NINE — SECTION H: WORKFLOW BOUNDARIES

---

## H1. Every Place a Customer Can Be Created

**Known and confirmed:**
1. Add Subscriber form (primary manual entry)
2. CSV import (planned — not yet built)

**Requires audit before production:**
- Any onboarding or import wizard
- Demo / seed data scripts
- Direct database inserts (must be eliminated)
- Future API endpoints
- Any RPC that creates subscribers as a side effect

**Requirement:**
Every customer creation path must go through the same validation and
business rules. There must be no "special" creation path that bypasses
lifecycle constraints. CSV import is not a database bypass — it must invoke
the same validations as the manual form.

---

## H2. Every Place a Transaction Can Be Created

**Known and confirmed:**
1. `AddTransactionDialog` — manual charge, payment, or adjustment
2. `create_subscription` RPC — subscription charge (automatic)
3. `cancel_subscription` RPC — subscription refund (automatic, operator-confirmed amount)
4. `void_transaction` RPC — reversal row (automatic)
5. `migrate_provider` RPC — ₹0 adjustment audit record (automatic)
6. Opening balance migration flow — opening_balance (one-time, special)
7. Record Payment flow from Billing screen (recently added — must go through
   the same ledger RPC as AddTransactionDialog, not a separate code path)

**Requires audit before production:**
- Bulk import paths
- Any remaining direct `INSERT INTO transactions` in application code
- Future payment integrations
- Future compensation/credit workflows

**Requirement:**
Every financial transaction must originate from a controlled, named workflow.
No direct transaction creation should bypass ledger invariants (immutability,
`source` required, `performed_by` stamped, balance trigger fires).

---

## H3. Every Place a Customer Can Be Edited

**Known and confirmed:**
1. `EditSubscriberDialog` — identity fields: name, mobile, address, region,
   coordinates, photo
2. `create_subscription` RPC — modifies subscription state as a side effect
3. `cancel_subscription` RPC — modifies subscription state as a side effect
4. `expire_lapsed_subscriptions` — modifies subscription state as a side effect
5. `migrate_provider` RPC — modifies provider fields as a side effect
6. Device assignment RPC — modifies device assignment and `stb_number`
7. `replace_device` RPC — modifies device reference in active subscription

**Requires audit before production:**
- Bulk edit operations
- CSV re-import/update flows
- Any remaining direct `UPDATE subscribers` in application code (must be
  eliminated or replaced by RPCs)
- Future API endpoints

**Requirement:**
All subscriber modifications must respect lifecycle constraints regardless
of entry point. UI restrictions are not sufficient — the database invariants
must be the final authority.

---

---

# PART TEN — SECTION I: ROLES AND ACCESS

---

## I1. Multi-User Support

**Yes — will exist in the future. Not required for v1.**

v1 is single-operator, single account. All authenticated users have full
access to their own data (scoped by `user_id` via RLS).

**Architecture requirement before v2:**

Every RPC must accept and stamp a `performed_by` parameter (defaulting to
`auth.uid()`). This is already done for transactions. All new RPCs must
follow the same pattern. When roles are added, the audit trail already has
the correct shape — no schema migration will be needed for attribution.

**Planned role set (v2):**

| Role | What they can do |
|------|-----------------|
| Owner / Administrator | Full access to everything |
| Office Staff | Create subscriptions, record payments, view all history, no voiding |
| Collection Agent | Record payments only, view assigned collection route, 24-hour backdating, cannot approve refunds or determine refund amounts, cannot void |
| Viewer / Read-Only | View all data, no writes |

**Key permission boundaries for future enforcement:**
- Collection agents must not approve refunds.
- Collection agents must not determine refund amounts.
- Collection agents must not void any financial records.
- Certain inventory actions (decommission, bulk migration) require Owner
  level.

Role gates must be enforced at the RPC level. UI-only gates are insufficient.

---

---

# PART ELEVEN — SECTION J: KNOWN LOOSE ENDS

---

## J1. Categories of Issues Personally Encountered

These are the failure modes the operator has directly observed. They
define the production risk surface.

**State synchronisation failures:**
- Assigned devices showing as Available in inventory.
- Customer and inventory state drifting apart after subscriber operations.
- Service state and subscription state becoming inconsistent.

**Lifecycle enforcement gaps:**
- Active services being removable from a customer while subscriptions are
  still running.
- Device changes being permitted while subscriptions are active (outside
  the permitted fault-replacement workflow).
- Provider changes bypassing subscription lifecycle expectations.

**Financial communicability failures:**
- Refunds and reversals being mathematically correct but impossible for
  the operator to interpret.
- Ambiguous balance displays (the ₹34 scenario — operator cannot tell
  what the ₹34 represents or why).
- Operators manually reconstructing events from raw transaction rows.

**Transaction context failures:**
- Transactions not identifying the affected service, device, provider,
  or subscription.
- Difficulty determining which device or subscription generated a charge
  or refund.

**Referential integrity failures:**
- Text-based references between packs, providers, regions, and customers.
- Silent drift when names are changed (a pack renamed from "Gold HD" to
  "Gold HD Plus" changes what shows on reprinted historical receipts).

**Workflow consistency failures:**
- Business rules enforced in the UI but not guaranteed at the database level.
- Different workflows producing different outcomes for the same business event
  (e.g., "Record Payment" vs "Create Transaction" taking different code paths).

**Asset lifecycle failures:**
- Inventory actions not matching real-world field workflows.
- Device replacement and repair workflows not clearly modelled.

**Source-of-truth conflicts:**
- Multiple places representing the same business state.
- Derived values and stored values drifting apart.

---

## J2. Reports and Exports That Must Not Break

Any ledger or schema change must preserve the ability to reproduce all of
the following reports accurately, including for historical periods:

**Financial reports:**
- Outstanding dues (per customer, per service, per region)
- Daily collection summary (cash received on a given day)
- Payment history export (per customer, per date range)
- Refund and adjustment report (separated by type — cash vs non-cash)
- Credit balance report (customers with advance payments or service credits)
- Aging / overdue report (outstanding balances by days overdue)
- Revenue report (total and per service, per provider, per region)
- Provider-wise revenue report
- Service-wise revenue report

**Customer reports:**
- Customer statement / passbook (chronological running balance per customer)
- Active subscriber count (by service, by region, by provider)
- Subscription renewal due report (expiring in next N days)

**Requirement:**
Historical reports must remain stable and reproducible after schema
evolution. Running the same revenue query for Q1 2026 today and in one
year must produce the same number. This is a hard constraint on any future
migration.

---

---

# PART TWELVE — COMPLETE INVARIANT MATRIX

---

Every row is one thing that must be impossible to violate.
Ordered by object, then severity.
Rows marked *(v2)* are defined now but not enforced until that feature is built.

| ID | Object | Invariant | Enforcement |
|----|--------|-----------|-------------|
| INV-01 | Customer | Cannot be hard-deleted if any transaction, subscription history, or complaint exists | DB: pre-delete RPC check; trigger blocks direct DELETE |
| INV-02 | Customer | `status` flips between `active` and `inactive` automatically based on active subscriptions. The trigger must NOT overwrite `prospect` or `archived` — those are operator-set states | Trigger: scoped to act only when current status is `active` or `inactive` |
| INV-03 | Customer | Mobile number is unique per operator at all times, including after edits | DB: unique constraint on `(user_id, mobile)` |
| INV-04 | Customer | Reopening an archived customer must use the original record | Business rule: mobile uniqueness blocks duplicate creation for the same number |
| INV-05 | Customer | `status = 'archived'` requires zero active subscriptions and zero assigned devices | RPC: archive workflow cancels active subscriptions and unassigns devices first |
| INV-06 | Customer | Mobile number update must be rejected if the new number already belongs to another customer under the same operator | RPC/DB: check before update, surface the conflicting customer by name |
| INV-07 | Service | `services[]` is not cleared or modified when subscriptions expire | Trigger: `expire_lapsed_subscriptions` must not touch `services[]` |
| INV-08 | Device | `status = 'assigned'` iff `subscriber_id IS NOT NULL` | DB: trigger fires on any change to status or subscriber_id |
| INV-09 | Device | `status IN ('faulty', 'decommissioned')` implies `subscriber_id IS NULL` | DB: trigger |
| INV-10 | Device | One device assigned to at most one customer at any time | DB: unique partial index on subscriber_id where status = 'assigned' |
| INV-11 | Device | Every device unassignment must write a closed entry to `device_assignment_log` | RPC: `unassign_device` writes to the log before nulling subscriber_id |
| INV-12 | Device | `replace_device` is the only permitted operation that changes the device reference on an active subscription | RPC: all other device-change attempts while subscription is active are rejected |
| INV-13 | Device | `replace_device` creates zero financial transactions | RPC: the replace_device code path has no transaction creation |
| INV-14 | Subscription | One device = at most one active subscription at any time | DB: unique partial index on device_id where status = 'active' |
| INV-15 | Subscription | Cannot be created without a device of matching service type assigned to the customer | RPC: `create_subscription` validates device assignment and service_type match |
| INV-16 | Subscription | Cannot be created while another active subscription exists for that device | RPC: eager expiry called first, then active check |
| INV-17 | Subscription | Commercial terms — pack, price, provider — are immutable after creation. `end_date` is mutable only through `suspend_subscription`, `resume_subscription` RPCs (v2). Direct column updates are blocked | DB: immutability trigger scoped to commercial fields; end_date exempted for the named RPCs only |
| INV-18 | Subscription | Start date default is today; may be backdated up to the configured system window (default 7 days) | RPC: `create_subscription` validates start_date ≥ today − backdating_window_days |
| INV-19 | Subscription | `subscription_charge` and `subscription_refund` rows cannot be voided directly | DB/RPC: `void_transaction` rejects rows with these source values with a clear error |
| INV-20 | Subscription *(v2)* | A suspended subscription's `days_remaining` is frozen at suspension time. `end_date` is null during suspension. On resume, `end_date = resume_date + days_remaining` | RPC: `suspend_subscription` and `resume_subscription` enforce this; direct updates blocked |
| INV-21 | Subscription *(v2)* | Suspension requires a reason. Auto-resumes at `max_resume_by` if not manually resumed. Suspension and resume events are logged in audit trail | RPC: enforce reason not null; scheduled job handles auto-resume |
| INV-22 | Transaction | Financial fields are immutable after posting | DB: `transactions_enforce_immutability` trigger (ADR-011) |
| INV-23 | Transaction | Ledger is the sole source of balance truth. No application code writes balance columns directly | DB: balance trigger is the only writer; application code is read-only on balance columns |
| INV-24 | Transaction | `source` must be set at creation; never null | DB: `source NOT NULL` constraint |
| INV-25 | Transaction | `type = 'payment'` amount must be > 0 | DB: check constraint |
| INV-26 | Transaction | Refund on cancellation cannot exceed the cash amount paid for that subscription. Adjustment credit applied to the subscription is never refundable in cash | RPC: `cancel_subscription` calculates cash_amount_paid and enforces ₹0 ≤ refund ≤ cash_amount_paid |
| INV-27 | Transaction | When consuming mixed credits (adjustment + payment) against a charge, adjustment-sourced credit is consumed first | Application logic in charge-posting code path |
| INV-28 | Transaction | `adjustment` credits cannot be transferred cross-service. Only payment-sourced credits may be transferred | RPC: cross-service transfer validates credit source type before permitting |
| INV-29 | Transaction | Transaction `date` may precede `created_at` (backdating allowed) but may not be in the future | DB: check constraint `date <= now() + interval '1 hour'` |
| INV-30 | Financial | Balance sign convention: positive = customer owes operator; negative = operator owes customer (credit). This is consistent in all DB columns, RPC values, and UI labels | Convention: enforced by trigger logic; UI must never display raw sign — always explicit label |
| INV-31 | Financial | Entitlement (active subscription) and payment status (balance) are fully independent. An active subscription does not imply zero balance | Design: `create_subscription` does not check or require zero balance |
| INV-32 | Provider | `service_type` on a provider record is immutable after it is first referenced by any pack, subscriber, or transaction | RPC/trigger: block edit if referenced |
| INV-33 | Provider | Retiring a provider does not modify historical transaction attribution | Soft-delete via `is_active = false` only; no cascade updates |
| INV-34 | Pack | Cannot be hard-deleted if referenced in any active or historical subscription | RPC: existence check before delete |
| INV-35 | Audit | Every state-changing RPC records `performed_by` | All RPCs: `performed_by` parameter, defaults to `auth.uid()` |
| INV-36 | Concurrency | All RPCs that modify customer financial or subscription state must acquire a row-level lock on the customer row before proceeding. Concurrent modification must serialize, not race | DB: `SELECT ... FOR UPDATE` on customer row at start of each RPC |
| INV-37 *(v1.x)* | Idempotency | `create_subscription`, `cancel_subscription`, and payment-recording RPCs should be idempotent: a duplicate call with the same inputs produces the same result without creating duplicate records | RPC: idempotency key parameter; deduplication check on recent calls |
| INV-38 | Import | CSV import and any bulk-import path must invoke the same RPCs as manual entry. Direct INSERT into any table from an import path is forbidden | Code review gate: no direct INSERT statements in import code |

---

---

# PART THIRTEEN — ALL QUESTIONS CLOSED

---

All worksheet questions (sections A through J) are answered in this document.
All Lovable refinements from the v2 review have been applied.
No open questions remain.

**Decisions closed in v3.0:**

| Topic | Decision |
|-------|----------|
| OQ-1: Outage compensation | Adjustment credit only — `type = 'adjustment'`, `source = 'adjustment'`. No end_date extension. Keeps subscriptions immutable and reuses the Service Credit UI label. |
| OQ-2: Backdating window | Configurable system setting. Default 7 days. Applies to both transaction dates and subscription start dates equally. |
| Suspend model | Full model defined (INV-20/21). Deferred to v2. Architecture kept open. `end_date` mutability scoped to named RPCs only. |
| Refund calculation method | Method B (adjustment-entire-first). Adjustment credit covers the first N days; cash covers the rest. Only unused cash days are refundable. |
| Mobile editability | Allowed. Unique constraint enforced at all times including after edits. Duplicate check surfaces conflicting customer before committing change. |
| Name editability | Allowed at any time. No history required. |
| Region editability | Allowed at any time. No region change history for v1. Current region is the only stored region. |
| INV-02 scope | Active↔Inactive trigger must not touch Prospect or Archived status. |
| INV-16 scope | Commercial terms immutable; end_date mutable only through named suspension RPCs. |
| INV-26 refund cap | Cap is cash_amount_paid, not gross_charge. Adjustment credit is never refundable. |
| Concurrency | INV-36: row-level lock on customer row at start of every financial/subscription RPC. |
| Idempotency | INV-37: deferred to v1.x. Documented as known gap. |
| CSV import | INV-38: must use RPCs. Direct INSERT forbidden. |

---

---

# PART FOURTEEN — BUILD PRIORITY ORDER

---

Revised order incorporating Lovable's Phase 3 FK recommendation.
Each item lists what it unblocks.

**Phase 3 — FK migration (start here, already approved):**

1. **Region, pack, provider FK columns** — replaces text references with
   proper foreign keys. Unblocks INV-32, INV-34. Mechanical migration, low
   risk. Run data quality checks first (see note below).

**Phase 4 — Customer and device foundations:**

2. **Customer status field + archive workflow** — without this, INV-01
   through INV-06 cannot be enforced. Required before production.
3. **Device assignment log (`device_assignment_log` table)** — required
   by INV-11. Build alongside the device workflow.
4. **`replace_device` RPC** — live operational gap. Corrects the
   over-restrictive Phase 2 trigger. INV-12/INV-13.
5. **INV-08/INV-09 DB enforcement** — device status ↔ subscriber_id
   coherence at the database level. Currently violable.

**Phase 5 — Financial and transaction:**

6. **`adjustment` transaction type** — schema migration. All goodwill,
   complaint, and outage workflows depend on it. INV-28.
7. **Credit origin tracking** — tag each credit as payment-sourced or
   adjustment-sourced. Required for INV-27/INV-28 enforcement.
8. **`cancel_subscription` refund calculation update** — implement
   Method B (adjustment-first) and the corrected refund cap (INV-26).
9. **Opening balance migration path** — `source = 'opening_balance'`
   transaction type. Required for paper-ledger migration.

**Phase 6 — Communicability (within 30 days of production):**

10. **Subscriber passbook / statement view** — resolves MAHARAJ-003.
    Chronological running balance. PDF-printable.
11. **Next-action chip** — computed from existing state. Highest
    operational value per implementation hour.
12. **Per-transaction context fields** — service, device, subscription,
    provider linked on every transaction row. Required for G2.
13. **Backdating window as configurable system setting** — default 7 days.

**Pre-migration data quality check (before Phase 3):**

Before adding FK constraints, run and resolve:
- Any subscriber rows where mobile is duplicated under the same user_id
- Any transaction rows where provider_id is null or references a missing provider
- Any active subscription blobs where the pack name does not exist in the current packs table
- Any device rows with `status = 'assigned'` and `subscriber_id IS NULL`

These will surface as FK constraint violations during migration if not
resolved first.

**Defer — do not build until explicitly prioritised:**

- Subscription suspension (v2): model is defined, architecture is open,
  build only when operationally needed
- Staff roles and permissions: architecture is ready (performed_by on all
  RPCs); defer until multi-user is operationally needed
- Cohort and churn analytics: requires renewal lineage data first
- Real-time push / websockets: polling model adequate for current user count
- Invoice entity / invoice table: dynamic PDF from immutable ledger is
  correct for current legal requirements

---

---

# PART FIFTEEN — PHASE 4 SCHEMA SPECIFICATION

---

This part is the authoritative schema spec for Phase 4. It supersedes
Lovable's proposed schema from the Phase 4 pre-migration review.
Write the migration from this spec exactly. Do not carry forward any
column or constraint from the earlier proposal that conflicts with
what is written here.

---

## The Two New Tables

Phase 4 introduces two tables. They must be created together in a single
migration. Neither is useful without the other.

---

## Table 1 — `public.subscriptions`

Replaces `current_subscription`, `subscription_history`,
`internet_subscription`, `internet_subscription_history`,
`current_pack`, and `current_internet_pack` JSONB blobs and columns
on the `subscribers` row.

### Column Specification

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | NO | — | FK → `auth.users`. RLS scope. |
| `subscriber_id` | `uuid` | NO | — | FK → `subscribers(id)` ON DELETE RESTRICT. INV-01. |
| `service_type` | `text` | NO | — | CHECK IN ('cable','internet'). |
| `device_id` | `uuid` | YES | — | FK → `stb_inventory(id)` ON DELETE RESTRICT. Nullable for historical rows where device was decommissioned. |
| `device_serial_snapshot` | `text` | YES | — | Serial at time of subscription creation. Mutable only via `replace_device` RPC using inventory-agreement check (see constraint below). Cable subs primarily; nullable for internet where ONU serial is less operationally significant. |
| `pack_id` | `uuid` | YES | — | FK → `packs(id)` ON DELETE RESTRICT. Nullable so pack retirement doesn't break history. Snapshot columns are the truth. |
| `provider_id` | `uuid` | YES | — | FK → `providers(id)` ON DELETE RESTRICT. |
| `pack_name_snapshot` | `text` | NO | — | Pack name at creation time. Never updated. |
| `pack_price_snapshot` | `numeric(12,2)` | NO | — | Pack price at creation time. Never updated. Base for refund calculation. |
| `billing_type_snapshot` | `text` | NO | — | CHECK IN ('prepaid','postpaid'). Never updated. |
| `validity_days_snapshot` | `int` | NO | — | Days validity at creation time. Never updated. |
| `total_days` | `int` | NO | — | Computed and stored at creation: `validity_days_snapshot × duration`. Never updated. |
| `total_charged` | `numeric(12,2)` | NO | — | `pack_price_snapshot × duration`. Stored for passbook reads. Never updated. |
| `duration` | `int` | NO | — | Multiplier (number of validity blocks purchased). |
| `start_date` | `date` | NO | `CURRENT_DATE` | Explicit because late-renewal start differs from created_at. Never updated after creation. |
| `end_date` | `date` | NO | — | Computed at creation: `start_date + total_days`. Mutable in v1 only via `replace_device` (device swap does not change end_date — this column is effectively immutable in v1 outside of that). In v2, mutable only via `suspend_subscription` / `resume_subscription` RPCs. |
| `status` | `text` | NO | `'active'` | CHECK IN ('active','expired','cancelled','superseded'). |
| `cancel_reason_code` | `text` | YES | — | Required when status = 'cancelled'. CHECK IN ('customer_request','operator_error','provider_migration','non_payment','other'). |
| `cancel_reason_note` | `text` | YES | — | Free-text supplement to cancel_reason_code. |
| `cancelled_at` | `timestamptz` | YES | — | Timestamp of cancellation action. |
| `refund_amount` | `numeric(12,2)` | YES | — | Operator-confirmed refund amount. 0 ≤ refund_amount ≤ cash_paid_at_cancel (enforced by trigger at cancel time). Stored for passbook rendering without re-querying payment_allocations. |
| `previous_subscription_id` | `uuid` | YES | — | FK → `subscriptions(id)` ON DELETE SET NULL. Renewal lineage. Set when this subscription is a renewal of a prior one. |
| `suspended_at` | `timestamptz` | YES | — | v2 suspend model. Null in v1. |
| `days_remaining_at_suspend` | `int` | YES | — | v2 suspend model. Frozen at suspension time. Null in v1. |
| `resumed_at` | `timestamptz` | YES | — | v2 suspend model. Null in v1. |
| `auto_resume_by` | `timestamptz` | YES | — | v2 suspend model. Deadline for auto-resume. Null in v1. |
| `created_at` | `timestamptz` | NO | `now()` | |
| `updated_at` | `timestamptz` | NO | `now()` | Maintained by trigger. |
| `created_by` | `uuid` | YES | `auth.uid()` | Audit trail. |

### Columns Explicitly Excluded

`cash_paid` — removed. Derived from `payment_allocations` at query time.
`adjustment_credit_applied` — removed. Derived from `payment_allocations`
at query time. Neither column is stored on the subscription row.

### Indexes

```sql
-- next-action chip: expiring soon, expired + balance, active + balance
CREATE INDEX idx_subscriptions_subscriber_status_end
  ON subscriptions (subscriber_id, status, end_date);

-- operator-wide renewal dashboard
CREATE INDEX idx_subscriptions_user_status_end
  ON subscriptions (user_id, status, end_date);

-- per-service subscription history and analytics
CREATE INDEX idx_subscriptions_subscriber_service_status
  ON subscriptions (subscriber_id, service_type, status);

-- walking renewal lineage backward
CREATE INDEX idx_subscriptions_previous
  ON subscriptions (previous_subscription_id);

-- FK lookups + provider/pack revenue reports
CREATE INDEX idx_subscriptions_pack ON subscriptions (pack_id);
CREATE INDEX idx_subscriptions_provider ON subscriptions (provider_id);
```

### DB-Level Constraints and Triggers

**One active subscription per device:**
```sql
CREATE UNIQUE INDEX idx_subscriptions_one_active_per_device
  ON subscriptions (device_id)
  WHERE status = 'active';
```

The uniqueness rule is at the device level, not the service level. A
subscriber with two STBs has two device_ids and may hold two simultaneous
active cable subscriptions — one per device. Any constraint scoped to
`(subscriber_id, service_type)` would incorrectly block this and must
not be used.

The `create_subscription` RPC active-check must validate:
```sql
-- Correct: check this specific device
SELECT 1 FROM subscriptions
WHERE device_id = :device_id AND status = 'active';

-- Wrong — do not use:
-- SELECT 1 FROM subscriptions
-- WHERE subscriber_id = :subscriber_id
--   AND service_type = :service_type
--   AND status = 'active';
```

**Snapshot immutability trigger** — blocks UPDATE of:
`pack_name_snapshot`, `pack_price_snapshot`, `billing_type_snapshot`,
`validity_days_snapshot`, `total_days`, `total_charged`, `start_date`,
`duration`, `previous_subscription_id`, `created_by`.
These columns are write-once. Any UPDATE attempt raises an exception.

**`device_serial_snapshot` mutability** — not in the snapshot immutability
trigger. Governed by a separate constraint: if `device_serial_snapshot` is
being updated, the new serial must exist in `stb_inventory` with
`status = 'assigned'` AND `subscriber_id = this subscription's subscriber_id`.
This is the same inventory-agreement pattern from Phase 3.6. No session flag.
The `replace_device` RPC satisfies this automatically because it updates
inventory before the subscription row, within the same transaction.

**`end_date` mutability — v1:** Trigger blocks all direct UPDATE of
`end_date`. Nothing in v1 legitimately changes `end_date` after creation.

**`end_date` mutability — v2 suspend (when built):** The trigger is relaxed
to permit `end_date` updates only when the same UPDATE statement also sets
`resumed_at IS NOT NULL` (resume operation) or `suspended_at IS NOT NULL`
(if suspension affects end_date). No session flag. The data state is the
guard.

**Status transition trigger** — permits only:
- `active` → `expired`
- `active` → `cancelled`
- `active` → `superseded`
- `active` → `suspended` (v2)
- `suspended` → `active` (v2, resume)
- `suspended` → `cancelled` (v2, cancel while suspended)

No reverse transitions. No deletes. Immutable history per §1.1.

**Refund cap trigger** — on update where `refund_amount IS NOT NULL`:
```sql
ASSERT refund_amount BETWEEN 0 AND (
  SELECT COALESCE(SUM(pa.amount), 0)
  FROM payment_allocations pa
  JOIN transactions t ON t.id = pa.transaction_id
  WHERE pa.subscription_id = NEW.id
    AND t.type = 'payment'
);
```
This reads from `payment_allocations` directly. No stored cash_paid needed.

---

## Table 2 — `public.payment_allocations`

This table is the authoritative source for how each payment or adjustment
transaction is distributed across subscriptions.

It is the answer to: "which subscription did this payment fund?" and
"how much cash has been received toward this subscription?"

### Why This Table Exists

Once subscriptions are first-class entities, the naive approach of computing
"cash paid toward a subscription" by querying transactions filtered by
subscriber + service + date range becomes ambiguous across renewals, partial
payments, historical subscriptions, and future multi-device scenarios.

A payment posted on Jan 28 (before expiry) might fund the February renewal,
not the expiring January subscription. A ₹700 payment might clear ₹400 of
February debt and ₹300 toward March. A date-range query cannot resolve these
cases correctly.

`payment_allocations` makes the linkage explicit at the time the payment is
posted, rather than reconstructing it by inference at cancellation time.
It is the join table between `transactions` and `subscriptions`.

### Column Specification

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | NO | — | FK → `auth.users`. RLS scope. |
| `transaction_id` | `uuid` | NO | — | FK → `transactions(id)` ON DELETE RESTRICT. The payment or adjustment row. |
| `subscription_id` | `uuid` | NO | — | FK → `subscriptions(id)` ON DELETE RESTRICT. Which subscription this allocation funds. |
| `amount` | `numeric(12,2)` | NO | — | How much of this transaction is allocated to this subscription. CHECK > 0. |
| `allocated_at` | `timestamptz` | NO | `now()` | |
| `allocated_by` | `text` | NO | — | CHECK IN ('fifo_trigger','manual','opening_balance'). Who/what wrote this row. |
| `created_by` | `uuid` | YES | `auth.uid()` | Audit. |

### Allocation Rules

**One payment may produce multiple allocation rows** if it spans
subscriptions (partial payment clearing old debt, remainder toward new).

**One subscription accumulates multiple allocation rows** as payments
arrive incrementally over its lifetime.

**The sum of all allocation rows for a subscription where the linked
transaction type is 'payment' = cash received toward that subscription.**
This is the refund cap source of truth.

**The sum of all allocation rows for a subscription where the linked
transaction type is 'adjustment' = adjustment credit applied to that
subscription.** This is consumed first under the simplified refund formula
but is never itself refundable in cash.

### The FIFO Allocation Trigger

Fires on INSERT into `transactions` where `type IN ('payment', 'adjustment')`.

**Algorithm:**

```
1. Find all subscriptions for this subscriber and service_type where
   the total allocated (from payment_allocations) is less than
   total_charged, ordered by start_date ASC (oldest first = FIFO).

2. Allocate the incoming transaction amount across those subscriptions
   in order until the amount is exhausted.

3. Insert one payment_allocations row per subscription touched.

4. If the amount exceeds all outstanding subscription charges
   (overpayment / pure advance credit), no allocation rows are
   written for the excess. The excess sits as a credit on the balance.
   When the next subscription is created, the allocation trigger will
   consume the unallocated credit balance against it at that time
   (or the operator applies it manually at renewal).
```

**Service scoping:** A cable payment allocates only to cable subscriptions.
An internet payment allocates only to internet subscriptions. No automatic
cross-service allocation. Cross-service transfer is manual and
operator-initiated (INV-28).

**The FIFO trigger is the only writer of `payment_allocations`** with
`allocated_by = 'fifo_trigger'`. No application code writes directly to
this table except via the trigger. Manual reallocation (v1.x feature) writes
with `allocated_by = 'manual'` and requires operator confirmation.

### Indexes

```sql
-- refund cap query: all allocations for a subscription
CREATE INDEX idx_payment_alloc_subscription
  ON payment_allocations (subscription_id);

-- passbook: all subscriptions funded by a transaction
CREATE INDEX idx_payment_alloc_transaction
  ON payment_allocations (transaction_id);

-- subscriber-level allocation history
CREATE INDEX idx_payment_alloc_user
  ON payment_allocations (user_id);
```

### Immutability

`payment_allocations` rows are immutable once written by the FIFO trigger.
Corrections are made by inserting reversal rows (negative amount,
`allocated_by = 'manual'`) and replacement rows, not by updating existing
rows. This preserves a full audit trail of all allocation decisions.

---

## The Refund Formula — Final Version

This replaces Method B from §D5. Method B is retired.

**The simplified formula:**

```
daily_rate       = pack_price_snapshot / total_days
days_used        = total_days - days_remaining
cash_paid        = SUM(pa.amount) WHERE transaction.type = 'payment'
                   (queried from payment_allocations at cancel time)

suggested_refund = floor(cash_paid × days_remaining / total_days)
```

**What this means:**

- The refund is pro-rated against cash paid only, not against total charged.
- Adjustment credit applied to this subscription is always forfeited on
  cancellation. It funded service that was consumed or is being consumed.
  It is never refunded in cash.
- The operator sees: cash paid, days used, days remaining, suggested refund.
- The operator confirms or overrides to any amount between ₹0 and cash_paid.
- The refund cap trigger enforces ₹0 ≤ refund_amount ≤ cash_paid.

**Why Method B was simplified:**

Method B's `adjustment_days` calculation was an optimisation for a rare edge
case — a cancellation where adjustment credits were significant relative to
the subscription price. In practice, adjustment credits are exceptional
workflow events. The simplified formula produces results that are correct,
easier to explain to an operator, and implementable without storing
adjustment credit amounts on the subscription row.

---

## Transaction Ownership Model

Transactions belong to the **customer ledger**, not to devices or
subscriptions. This is the authoritative ownership model.

A transaction answers: "what financial event happened in this customer's
account?" It is scoped to a subscriber and a service type. Nothing more
is required for correctness.

**`device_id` is NOT added to transactions.** A single payment can fund
multiple subscriptions on multiple devices — making device_id on the
transaction row either ambiguous (which device?) or redundant (the
allocation already knows). Device context is derivable through
`subscription_id → subscriptions.device_id` when needed for display.

**`subscription_id` is added to transactions as a nullable FK.** Set only
for `subscription_charge` and `subscription_refund` rows by the relevant
RPCs. Null for all other transaction types (payments, adjustments,
opening balances, goodwill credits, reversals). This is a display
convenience for the passbook — it allows a charge row to show which
subscription it belongs to without traversing the allocation table.
It is not used for financial calculations.

**Transaction ownership by type — complete reference:**

| type | source | subscriber_id | service_type | subscription_id |
|------|--------|--------------|--------------|-----------------|
| charge | subscription_charge | ✓ | ✓ | ✓ set by RPC |
| charge | manual_charge | ✓ | ✓ | null |
| payment | manual_payment | ✓ | ✓ | null |
| refund | subscription_refund | ✓ | ✓ | ✓ set by RPC |
| refund | manual_refund | ✓ | ✓ | null |
| adjustment | adjustment | ✓ | ✓ | null |
| reversal | reversal | ✓ | ✓ | null |
| opening_balance | opening_balance | ✓ | ✓ | null |

The `payment_allocations` table provides all payment-to-subscription-to-device
traceability. The transaction row itself remains subscriber-owned and
service-scoped.

**Schema change to `transactions` table required in Phase 4:**

```sql
ALTER TABLE transactions
  ADD COLUMN subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL;
```

Nullable. No backfill required for existing rows. Set going forward by
`create_subscription` and `cancel_subscription` RPCs only.

---

## JSONB Column Retirement Plan

The following columns on `subscribers` are retired by Phase 4:

```
current_subscription          → rows in subscriptions WHERE service_type='cable'
subscription_history          → rows in subscriptions WHERE service_type='cable'
internet_subscription         → rows in subscriptions WHERE service_type='internet'
internet_subscription_history → rows in subscriptions WHERE service_type='internet'
current_pack                  → pack_name_snapshot on active cable subscription
current_internet_pack         → pack_name_snapshot on active internet subscription
```

**Two-phase retirement:**

Phase 4a (this migration):
- Create `subscriptions` and `payment_allocations` tables
- Add `subscription_id` column to `transactions`
- Backfill all existing JSONB data into subscription rows
- Keep JSONB columns in place as read-only (trigger blocks writes)
- All RPCs rewritten to read from `subscriptions` table
- UI updated to read from `subscriptions` table
- Demo data is wiped so backfill is a clean slate operation

Phase 4b (follow-up migration, after Phase 4a is stable in production):
- Drop the retired JSONB columns
- Remove the read-only trigger

---

## Additional Invariants — INV-39 through INV-45

Added to the invariant matrix in Part 12.

| ID | Object | Invariant | Enforcement |
|----|--------|-----------|-------------|
| INV-39 | Subscription | One active subscription per device. Multiple active subscriptions per subscriber per service type are permitted when the subscriber has multiple devices | DB: `UNIQUE(device_id) WHERE status='active'`. The `create_subscription` RPC checks device_id only, never subscriber_id + service_type |
| INV-40 | Subscription | `device_serial_snapshot` may only be updated when the new serial exists in inventory with status='assigned' and subscriber_id matching this subscription's subscriber | Trigger: inventory-agreement check, same pattern as Phase 3.6 |
| INV-41 | Subscription | `end_date` cannot be updated directly in v1. In v2, only permitted when the same transaction also sets `resumed_at` or `suspended_at` | Trigger: blocks direct end_date UPDATE; relaxed for suspend RPCs in v2 |
| INV-42 | Subscription | `refund_amount` cannot exceed the sum of payment-type allocations for this subscription in `payment_allocations` | Trigger: reads payment_allocations at cancel time to enforce cap |
| INV-43 | Subscription | No hard deletes. Status transitions are one-directional. Immutable history | Trigger: blocks DELETE; blocks invalid status transitions |
| INV-44 | Payment allocations | `payment_allocations` rows are immutable after insert. Corrections use reversal rows with negative amounts | Trigger: blocks UPDATE and DELETE on payment_allocations |
| INV-45 | Payment allocations | The FIFO trigger is the only writer of allocation rows with allocated_by='fifo_trigger'. No direct INSERT from application code | Code constraint: enforced by code review; no direct INSERT in application layer |

---

## What to Build in Phase 4 — Confirmed Scope

In sequence within Phase 4:

1. Create `payment_allocations` table with indexes and immutability trigger
2. Create `subscriptions` table with all columns, indexes, and triggers
   listed above — uniqueness at device level, not service level
3. Add `subscription_id` nullable FK column to `transactions` table
4. Backfill demo data (clean slate — no legacy data to migrate)
5. Rewrite `create_subscription` RPC:
   - Insert into `subscriptions`
   - Active-check validates `device_id` only
   - Sets `subscription_id` on the generated charge transaction
6. Rewrite `cancel_subscription` RPC:
   - Updates `subscriptions` status, cancel fields, refund_amount
   - Queries `payment_allocations` for refund cap
   - Sets `subscription_id` on the generated refund transaction
7. Rewrite `expire_lapsed_subscriptions`:
   - Updates `subscriptions.status` to 'expired'
   - Works at device level — all devices, regardless of service count
8. Update `replace_device` RPC:
   - Updates `subscriptions.device_serial_snapshot` using inventory-agreement check
9. Add FIFO allocation trigger on `transactions`:
   - Fires on INSERT where type IN ('payment', 'adjustment')
   - Allocates within service_type, FIFO by subscription start_date
   - Writes to `payment_allocations`
10. Update all UI reads from JSONB blobs to query `subscriptions` table
11. Set JSONB columns to read-only (Phase 4a column retirement trigger)

Phase 4b (separate deployment after Phase 4a is confirmed stable):
- Drop retired JSONB columns and the read-only trigger

---

*End of document.*

*Compiled from: Architecture Review (May 2026), Lifecycle Audit (June 2026),*
*Financial Lifecycle Review (June 2026), Business Invariant Worksheet*
*Sections A–J — operator-confirmed answers (June 2026), Lovable refinement*
*review and operator sign-off (June 2026), Phase 4 schema review (June 2026).*

*Version 3.2 — authoritative. All prior versions superseded.*
*Changes from v3.1: uniqueness constraint corrected to device level;*
*transaction ownership model formalised; device_id excluded from transactions;*
*subscription_id added to transactions as nullable display reference;*
*INV-39 reworded to reflect multi-device model; INV-45 added.*
*Any change to a business rule, invariant, or workflow decision must be*
*reflected here before implementation begins.*

---

## Appendix: Credential Ownership

Every credential surfaced on the Credentials tab is owned by exactly one
table. This mapping is authoritative — both the RPCs and the UI enforce it,
and the ownership comment in `src/components/subscriber-detail/CredentialsTab.tsx`
mirrors this table verbatim.

| Field                | Owner table              | Reason                                                      |
| -------------------- | ------------------------ | ----------------------------------------------------------- |
| Assigned Telephone   | `subscribers`            | ISP identity, persists regardless of device                 |
| PPPoE Username       | `subscribers`            | Account credential, not device-specific                     |
| PPPoE Password       | `subscribers`            | Account credential, not device-specific                     |
| WiFi SSID            | `device_assignment_log`  | Installation-specific, reconfigured on device replacement   |
| WiFi Password        | `device_assignment_log`  | Installation-specific, reconfigured on device replacement   |
| ONU Username         | `device_assignment_log`  | Deployment-specific                                         |
| ONU Password         | `device_assignment_log`  | Deployment-specific                                         |
| VLAN ID              | `device_assignment_log`  | Network config per installation                             |
| MAC Address          | `stb_inventory`          | Hardware identity, fixed to the physical device             |

**Consequences of this ownership model:**

- WiFi and ONU credentials both live on the **internet** device's open
  assignment log row. There is no cable-side WiFi credential — a cable STB
  does not provide WiFi in this model.
- Replacing an internet device (via `replace_device`) opens a fresh
  assignment log row with null credentials. Installation-specific values
  (SSID, WiFi password, ONU login, VLAN) must be re-entered by the
  technician. This is intentional — those values are typically
  reconfigured during a physical install.
- Account-level values (assigned telephone, PPPoE) survive device swaps
  because they live on `subscribers`.
- MAC address is written once per device on `stb_inventory` and is locked
  in the UI thereafter. To change it, the device itself must be replaced.



