# Operator Workflow & UI Alignment Review
## Companion to BUSINESS_MODEL.md v3.2

> **Purpose:** BUSINESS_MODEL.md defines the data model, invariants, and
> schema. This document defines how operators should *interact* with that
> model — the workflows, the UI surfaces, and the principle that separates
> a CRUD admin panel from a Subscriber Management System.
>
> **Read this after BUSINESS_MODEL.md.** Every workflow below maps to RPCs
> and invariants already defined there. Where a new RPC is needed, it is
> named and specified here, to be added to BUSINESS_MODEL.md's invariant
> matrix once confirmed.
>
> **Scope:** This is a design review, not a migration spec. Nothing here
> requires a schema change beyond the two new RPCs noted in Part 4. The
> primary cost is UI/UX rebuild, not database work.

---

# Part 0 — Design Principle (Strict)

**Every workflow, screen, and feature in this system must be modelled on
how existing ISP / DTH / Cable operator software actually works —
not on what is technically possible, not on generic admin-panel patterns,
and not on what's fastest to build with the current component library.**

This is not a preference. It is the primary design constraint for all UI
and workflow work from this point forward, including Phase 4b and Phase 5.

**What this means concretely:**

The mental model is the recharge/plan card, not the database record.
A subscription renders as: plan name, validity dates, price, status
(active/expiring/expired), and a primary action button — "Renew,"
"Pay Now," "Replace Device" — exactly as a Tata Play, Airtel, or Jio
account screen presents a plan. The operator should never see a form
with database column names as labels.

Bills are paid, not "transactions are recorded." The verb the operator
uses is "collect" or "mark as paid" — see Workflow 4 (rewritten below).
The ledger entry is a *consequence* of that action, never the action
itself from the operator's perspective.

History is a passbook/timeline, not a table. Per BUSINESS_MODEL §G4,
chronological, human-readable, running balance — the same shape as a
bank passbook or a recharge history screen in a telecom app.

Lists are action-oriented. A subscriber list, a collection route, an
expiring-subscriptions list — each row shows status + next action
("₹700 due — Collect"), not a row of editable fields.

**When in doubt, ask: "what would this screen look like in a Tata Play
account, an Airtel Thanks app, or a local cable operator's existing
billing software — and does our screen look like that, or does it look
like a database admin tool?"** If it looks like the latter, redesign it
before building it, regardless of how much faster the admin-tool version
would be to implement.

This principle applies retroactively to anything reviewed in this
document — every workflow below should be read with this lens, and any
implementation detail that conflicts with it should be flagged back to
the operator before being built.

---

# Part 1 — The Core Problem

The system currently presents itself as a set of records to edit:
a subscriber record with fields, a device record with fields, a
subscription blob with fields. The operator's job, in this presentation,
is to keep those fields correct.

That is not how an operator thinks about their day. An operator thinks in
**events**: a customer walks in to pay, a technician reports a broken box,
a customer wants to cancel, a subscription is about to expire. Each event
has a known shape — a beginning, a set of steps, an end state, and a
financial or inventory consequence (or explicitly, no consequence).

The fix is not more fields or better validation on the existing forms.
The fix is to replace "edit this record" with "run this workflow." The
record becomes something the operator *reads* (per BUSINESS_MODEL §G1–G5);
the workflows are what the operator *does*.

This single shift resolves all five issues raised:

- Device pairing becomes a workflow (Part 4), not a field edit
- Replace-device becomes one atomic workflow (Part 4), not two disconnected actions
- Ledger communicability is a rendering problem solved once the ledger is
  read-only and workflows are the only write path (Part 5)
- Analytics correctness follows from workflows producing well-defined
  transaction shapes (Part 6)
- The subscriber profile becomes a summary view because nothing on it is
  editable except identity fields (Part 3)

---

# Part 2 — The Nine Operator Workflows

Each workflow below is specified as: trigger, preconditions, steps shown
to the operator, system actions, and the confirmation shown at the end.
The confirmation step is not optional — every workflow ends by telling the
operator what just happened in plain language, per BUSINESS_MODEL §G3.

---

## Workflow 1 — New Customer (Onboarding)

**Trigger:** A prospect requests service, or a salesperson captures a lead.

**Preconditions:** None. This is the entry point.

**Steps:**
1. Operator enters name, mobile, region, and selects declared services
   (cable / internet / both)
2. System checks mobile uniqueness — if a match exists, shows the existing
   customer and asks "is this the same person?" before allowing creation
3. Confirm

**System actions:** Creates customer row, `status = 'prospect'`. No device,
no subscription, no transaction.

**Confirmation shown:** "Customer [name] created. Status: Prospect. Next
step: pair a device when ready for installation."

**What this replaces:** The current "Add Subscriber" form, which likely
asks for more than this (device fields, pack fields) up front. Those fields
move to Workflows 2 and 3.

---

## Workflow 2 — Pair Device (Installation)

**Trigger:** A technician installs an STB or ONU at the customer's premises.

**Preconditions:**
- Customer exists and has the relevant service declared in `services[]`
- A device of the matching `service_type` exists in inventory with
  `status = 'available'`
- The customer does not already have a device of this type that is
  unassigned-but-intended-for-this-slot (avoids accidental double-pairing)

**Steps:**
1. Operator opens the customer profile, sees "Internet: no device paired"
   (or similar) as a next-action item
2. Clicks "Pair Device"
3. System shows available devices of the matching service_type, filterable
   by region/warehouse if relevant
4. Operator selects a device, confirms

**System actions (new RPC: `pair_device`):**
- `stb_inventory.status = 'assigned'`, `subscriber_id = customer`
- `device_assignment_log`: new entry, `assigned_date = now()`,
  `reason = 'installation'`
- Does **not** create a subscription. Pairing and activation are separate
  events (Customer ≠ Service ≠ Device ≠ Subscription)

**Confirmation shown:** "STB-0042 paired to [customer name]. No active
subscription yet — create one when ready to activate service."

**What this replaces:** Direct editing of `stb_number` on the subscriber
record. This field becomes entirely non-editable in the UI; it is set only
by `pair_device`, `replace_device`, and `unpair_device`.

---

## Workflow 3 — New Subscription (Activation / Recharge)

**Trigger:** Customer pays for their first pack on a paired device, or this
is a renewal (Workflow 8 reuses this with one extra field).

**Preconditions:**
- A device of the matching service_type is paired to this customer
  (`status = 'assigned'`, `subscriber_id = customer`)
- That device has no `active` subscription (one active subscription per
  device — BUSINESS_MODEL INV-39)

**Steps:**
1. Operator clicks "New Subscription" (or "Recharge" — see terminology
   note below) on the relevant device
2. Selects pack, provider, duration
3. Start date defaults to today; operator may backdate within the
   configured window
4. System shows: pack price, total charge, computed end date
5. Confirm

**System actions (`create_subscription` RPC, already exists, Phase 4a):**
- Inserts `subscriptions` row, `status = 'active'`
- Inserts `subscription_charge` transaction, `subscription_id` set
- Customer `status` flips to `'active'` if it was `'inactive'` (INV-02,
  scoped correctly)

**Confirmation shown:** "Subscription created: [Pack name], [start] →
[end]. Charge of ₹[amount] recorded. Current balance: ₹[X] [due/credit]."

**Terminology note:** Internally this is `create_subscription`. In the UI,
label it "Recharge" for cable/DTH-style packs and "New Subscription" or
"Activate Plan" for internet — match the language operators already use
for each service type if they differ. This is a labelling decision, not
a workflow difference.

---

## Workflow 4 — Collect Payment ("Mark as Paid")

**Trigger:** A bill is due — either the operator is collecting from a
walk-in customer, or (future) a collection agent is working through a
route.

**This replaces "Record Payment" as the primary flow.** It is per-bill,
not per-service. The generic standalone payment form (no specific bill)
becomes a secondary, rarely-used action — see the note at the end of this
workflow.

**Preconditions:** None.

**Steps:**

1. Operator sees an active or recently-expired subscription card showing
   its own outstanding amount: "Internet 100Mbps (1 Jun–30 Jun) — ₹700 due"
   with a **"Collect Payment"** button.

2. Clicking it opens a small dialog:
   - Amount: pre-filled with ₹700, editable (for partial payment)
   - Method: **Cash** | **UPI** tabs
     - **Cash:** nothing further — just the amount
     - **UPI:** renders a QR code (generated client-side from the
       operator's configured UPI VPA, the entered amount, and a note
       — see "UPI QR — Implementation Note" below)
   - **"Mark as Paid"** button — this is the single action that commits
     the payment, regardless of which method tab is active

3. Operator taps "Mark as Paid" once cash is in hand or the UPI payment
   notification has been seen on their own phone (this system does not
   detect the UPI payment — see note below).

**System actions:**
- Inserts `payment` transaction:
  - `subscription_id` set to **this specific subscription** (extends the
    transaction ownership table in BUSINESS_MODEL — `subscription_payment`
    is a new `source` value alongside `subscription_charge` /
    `subscription_refund`, all three carrying `subscription_id`)
  - `payment_method` set from the tab selected (`cash` / `upi`)
- Writes **one** `payment_allocations` row: this subscription, the entered
  amount, `allocated_by = 'manual'`
- **If the entered amount exceeds this subscription's outstanding
  (overpayment on this specific bill):** the excess is **not** allocated
  to any other subscription. It remains unallocated and shows as advance
  credit on the relevant `cable_balance` / `internet_balance`. This is
  Option B — confirmed. See "Future FIFO" note below for how this can be
  extended later without a schema change.
- Balance trigger updates as normal

**Confirmation shown:**

If exact: "₹700 marked as paid for Internet 100Mbps (1 Jun–30 Jun).
Status: Settled."

If overpaid (e.g., ₹1,000 entered against a ₹700 bill): "₹700 applied to
Internet 100Mbps (1 Jun–30 Jun) — Settled. ₹300 added as advance credit on
Internet."

If partial (e.g., ₹400 entered against a ₹700 bill): "₹400 applied to
Internet 100Mbps (1 Jun–30 Jun). ₹300 still due."

**Existing advance credit — surfaced, not auto-applied:**

If this subscriber already has unallocated advance credit on this service
when "Collect Payment" is opened, the dialog shows it and offers to apply
it: "This customer has ₹300 advance credit on Internet. Apply it to this
bill? New amount due: ₹400." The operator can accept (writes an additional
`payment_allocations` row against the existing credit transaction,
`allocated_by = 'manual'`) or decline and proceed with the full amount.
This keeps every allocation decision visible and operator-confirmed,
consistent with Option B.

---

### UPI QR — Implementation Note

No payment gateway, merchant account, or API integration is required for
v1. A UPI QR code is a static image generated from a `upi://pay?...` URI
containing the operator's own UPI VPA, the amount, and a note — the
customer scans it with their own banking app and pays directly to the
operator's account, exactly as if the operator had shown them a QR code
on a piece of paper.

**Requires:** one new setting — `operator_upi_vpa` (the operator's UPI ID,
e.g. `operatorname@upi`), entered once in settings. QR generation is then
purely client-side per transaction: `upi://pay?pa={vpa}&pn={operator_name}
&am={amount}&tn={subscriber_name}+-+{pack_name}&cu=INR`.

**This system does not detect or confirm the UPI payment.** The operator
sees the payment land on their own phone (bank/UPI app notification, same
as today, outside this system) and then taps "Mark as Paid." This is
identical to how a paper QR code at a shop works today — the QR is a
convenience for the customer to pay correctly, not a payment processor.

**Full gateway integration** (auto-confirming payments via API/webhook —
Razorpay, Cashfree, etc.) is explicitly **out of scope** for this phase.
It is a different category of feature — merchant account setup, webhook
handling, settlement timing, reconciliation against the ledger — and
should only be considered if/when transaction volume and operator
sophistication justify that complexity. The QR-display approach above
delivers nearly all of the practical value (correct amount, correct
recipient, no manual UPI ID typing) at effectively zero implementation
or ongoing cost.

**Collection agent app (future):** the same QR mechanism applies — the
agent's screen shows the same "Collect Payment" dialog with the QR
generated against the operator's (or agent's, depending on cash-flow
policy — a business decision, not a technical one) UPI VPA. No additional
mechanism is needed; this workflow is already agent-ready.

---

### Future FIFO — How to Add It Without a Migration

If, in the future, overpayment spillover should automatically apply to
the subscriber's *other* outstanding subscriptions (oldest first) rather
than sitting as advance credit, this is a **trigger logic change only**:

- The schema is unchanged — `payment_allocations` already supports
  multiple rows per transaction
- The trigger, on detecting spillover, would write *additional* allocation
  rows against other outstanding subscriptions for this service,
  `allocated_by = 'fifo_trigger'`
- This could be a per-operator setting
  (`settings.auto_allocate_advance_credit: boolean`), toggled without
  any migration — Option B (manual/surfaced) remains the default and
  this becomes opt-in

No data already written under Option B needs to change if this is added
later — `allocated_by = 'manual'` rows and future `allocated_by =
'fifo_trigger'` rows coexist in the same table with no conflict.

---

### Generic "Add Payment" — Secondary, Rare

A standalone payment-entry action (no specific bill selected) remains
available for genuine edge cases: a customer pays in advance for a
subscription that doesn't exist yet, or pays toward an old debt with no
current active subscription to attach to. This requires the service-type
selector (as it exists today) and creates a `payment` transaction with
`subscription_id = null` — pure advance credit, no allocation. This should
be visually de-emphasised relative to "Collect Payment" on subscription
cards — a secondary action in an overflow menu, not a primary button.

---

## Workflow 5 — Add Credit / Adjustment

**Trigger:** Service outage compensation, goodwill gesture, billing
correction, provider migration audit entry (₹0).

**Preconditions:** None.

**Steps:**
1. Operator clicks "Add Credit" — a **separate button from "Collect
   Payment,"** visually distinct (different icon/colour)
2. Selects service type
3. Enters amount
4. Selects reason: `outage_compensation` / `goodwill` / `billing_correction`
   / `provider_migration` / `other`
5. Optional note
6. Confirm

**System actions:**
- Inserts `adjustment` transaction, `source = 'adjustment'`,
  `subscription_id = null`
- FIFO allocation trigger fires for adjustment credits the same way as
  payments, but per BUSINESS_MODEL D4: adjustment-sourced credit is
  consumed first when a charge is later posted, and is never
  cross-service-transferable

**Confirmation shown:** "Service Credit of ₹200 added to Cable account.
Reason: Outage compensation (3-day outage, 12–14 Jun). This credit will
be applied to Cable charges first and is not refundable in cash."

**Why this must be a separate button from Collect Payment:** if "Add
Credit" and "Collect Payment" are the same form with a type dropdown, every
operator will eventually use the wrong one under time pressure, and the
distinction this entire system was redesigned around (cash vs non-cash,
transferable vs siloed, INV-28) collapses back into "it's all just money
in the ledger." The button-level separation is the enforcement mechanism
for a distinction that cannot be enforced at the database level alone.

---

## Workflow 6 — Replace Device (Faulty / Repair / Upgrade)

**Trigger:** A device fails, needs repair, or the customer is upgrading
hardware.

**This is the workflow Lovable flagged as incomplete. The fix is to make
it a single guided flow, not two separate actions ("mark faulty" +
"assign new device").**

**Preconditions:**
- A device is currently assigned to this customer
  (`status = 'assigned'`, `subscriber_id = customer`)
- A replacement device of the same `service_type` exists in inventory
  with `status = 'available'`

**Steps — single flow, four screens:**

1. **Identify:** Operator clicks "Replace Device" on the device card.
   If the customer has multiple devices of this service type (multi-STB),
   they select which one is being replaced.

2. **Reason:** Select reason — `faulty` / `repair` / `hardware_upgrade` /
   `inventory_correction` (the four permitted reasons from BUSINESS_MODEL
   §C4).

3. **Replacement:** System shows available devices of the matching
   service_type. Operator selects the replacement.

4. **Confirm:** System shows a preview before committing:
   > "Replacing STB-0042 with STB-0099 for [customer].
   > Active subscription (Cable Gold HD, expires 30 Jun) will continue
   > unchanged. No charge, refund, or new subscription will be created."

**System actions (`replace_device` RPC — already specified in
BUSINESS_MODEL Part 15, Phase 3.6 shipped):**
- Old device → `status = 'faulty'`, `subscriber_id = NULL`
- New device → `status = 'assigned'`, `subscriber_id = customer`
- `device_assignment_log`: closes old entry, opens new entry,
  `reason` from step 2
- `subscriptions.device_serial_snapshot` updated via inventory-agreement
  check (INV-40)
- Zero transactions created

**Confirmation shown:** "Device replaced: STB-0042 → STB-0099. Subscription
continues uninterrupted, expires 30 Jun. STB-0042 marked faulty and removed
from your inventory pool — send for repair or decommission separately."

**The "send for repair" follow-up:** the faulty device is now sitting in
inventory with `status = 'faulty'` and no customer attached. This is a
*separate, lower-priority* inventory-management workflow (not
customer-facing): an inventory screen showing all `faulty` devices with
actions "Mark Repaired → available" or "Decommission." This should exist
but is not part of the customer-facing replace-device flow — it's where
"Mark Faulty" as a standalone action belongs, scoped to inventory
management, never to a customer profile.

---

## Workflow 7 — Unpair Device

**Trigger:** Customer cancels their last subscription for a service and the
device should be returned to inventory; or a downgrade removes a device
in a multi-device household.

**Preconditions:**
- Device is assigned to this customer
- No `active` subscription references this device (must cancel first, or
  this is invoked as part of Workflow 9's cancellation flow)

**Steps:** Usually not a standalone action — surfaced as a checkbox inside
Workflow 9 (Cancel Subscription): "Also return device to inventory?"
defaulting to checked. Can also exist as a standalone action for the rare
case of unpairing without cancellation (e.g., correcting a pairing mistake
on a customer who never had a subscription on that device).

**System actions (new RPC: `unpair_device`):**
- Device → `status = 'available'` (or `'faulty'` if the operator indicates
  the returned device is damaged), `subscriber_id = NULL`
- `device_assignment_log`: closes entry, `reason = 'customer_closed'` /
  `'downgrade'` / `'correction'`

**Confirmation shown:** "STB-0042 returned to inventory (available)."

---

## Workflow 8 — Renewal

**Trigger:** A subscription has expired (or is expiring soon) and the
customer pays to continue.

**This is Workflow 3 (New Subscription) with one difference:** the system
pre-fills `previous_subscription_id` from the expired/expiring subscription
on the same device, establishing renewal lineage (BUSINESS_MODEL
`previous_subscription_id`).

**Steps:**
1. Operator sees "Renew" as the next-action chip on an expiring/expired
   device (per BUSINESS_MODEL §G5)
2. Clicks "Renew" — pack, provider, and duration pre-filled from the
   previous subscription but editable (a plan or provider change during
   renewal is still recorded as a renewal with lineage — BUSINESS_MODEL
   treats plan/provider changes as new subscriptions regardless, so this
   is the same action either way)
3. Start date: per BUSINESS_MODEL §B5, defaults to today (the recharge
   model — billing cycle begins on the day of recharge)
4. Confirm

**System actions:** Same as Workflow 3, plus `previous_subscription_id`
set to the prior subscription's `id`.

**Confirmation shown:** "Subscription renewed: [Pack], [start] → [end].
This is a renewal of the subscription that ended [prior end date]. Charge
of ₹[amount] recorded."

---

## Workflow 9 — Cancel Subscription

**Trigger:** Customer wants to end a subscription before expiry.

**Preconditions:** Subscription `status = 'active'`.

**Steps:**
1. Operator clicks "Cancel" on the active subscription card
2. Selects cancellation reason: `customer_request` / `operator_error` /
   `provider_migration` / `non_payment` / `other`
3. System computes and displays:
   - Total charged
   - Cash paid (from `payment_allocations`, sum of `payment`-type
     allocations)
   - Days used / days remaining
   - Suggested refund: `floor(cash_paid × days_remaining / total_days)`
     (simplified formula, BUSINESS_MODEL v3.1)
4. Operator confirms the suggested refund, or overrides to any amount
   `0 ≤ x ≤ cash_paid`
5. Checkbox: "Return device to inventory?" (defaults checked — invokes
   Workflow 7 if checked)
6. Confirm

**System actions (`cancel_subscription` RPC):**
- `subscriptions.status = 'cancelled'`, `cancelled_at`, `cancel_reason_code`,
  `cancel_reason_note`, `refund_amount` set
- `subscription_refund` transaction inserted if `refund_amount > 0`,
  `subscription_id` set
- Refund cap enforced by trigger (INV-42): `0 ≤ refund_amount ≤ cash_paid`
- If device return checked: Workflow 7 actions

**Confirmation shown (per BUSINESS_MODEL §G3, verbatim format):**

> "Subscription cancelled on [date].
> Internet 100Mbps — 15 of 30 days used.
> Cash paid: ₹800. Refund issued: ₹400.
> Current Internet balance: Settled."

---

## (Workflow 10 — Suspend / Resume — v2, UI groundwork now)

Not built in v1, but per BUSINESS_MODEL §B3/INV-41, the subscription card
should reserve a slot for a "Suspend" action now, even if disabled or
hidden behind a feature flag, so that Phase 4b's card layout doesn't need
retrofitting when v2 ships. The action would open: reason (required) →
confirm → `suspend_subscription` RPC. A separate "Resume" action appears
on suspended subscriptions.

---

# Part 3 — Subscriber Profile Redesign

The profile becomes a read surface structured exactly as BUSINESS_MODEL
§G1 specifies, with workflow buttons attached to each section. This is
not a new design — it's the implementation of decisions already made in
the business model that haven't yet reached the UI.

```
┌─────────────────────────────────────────────────┐
│ [Customer Name]                    [Edit Identity]│
│ Status: Active                                    │
│                                                    │
│ Overall position: Outstanding ₹1,800              │
│                                                    │
│ ── Internet ──────────────────────────────────────│
│  ONU-001 → Active, 12 days left → ₹700 due        │
│    [Record Payment] [Add Credit] [Replace Device] │
│    [Cancel]                                       │
│                                                    │
│  ONU-002 → Active, 2 days left → ₹500 due         │
│    Next action: Renew Internet (ONU-002)          │
│    [Renew] [Replace Device] [Cancel]              │
│                                                    │
│ ── Cable ──────────────────────────────────────── │
│  STB-001 → EXPIRED → ₹300 due                     │
│    Next action: Collect ₹300 and renew            │
│    [Renew] [Replace Device] [Cancel]              │
│                                                    │
│  STB-002 → Active, 12 days left → Available       │
│    Credit ₹500                                    │
│                                                    │
│ ── Recent Activity ──────────────  [View Passbook]│
│  (last 3 ledger lines, per Part 5 rendering)      │
└─────────────────────────────────────────────────┘
```

Identity fields (name, mobile, region) are edited through a single small
"Edit Identity" action — the only remaining direct-edit surface on the
entire profile, and it touches only the three fields BUSINESS_MODEL §A4
designates as freely editable.

Everything else on the profile is either a read-only derived value (per
the per-device breakdown discussed earlier — derived from `subscriptions`,
`payment_allocations`, and `transactions` at read time, not stored
per-device) or a button that launches one of the nine workflows above.

---

# Part 4 — New RPCs Required

Two new RPCs are needed to complete the workflow set. Both follow the
existing pattern: transactional, accept `performed_by`, enforce
preconditions, write to `device_assignment_log`.

### `pair_device(subscriber_id, device_id, reason DEFAULT 'installation')`

Preconditions: device `status = 'available'`; subscriber has the matching
`service_type` in `services[]`.

Actions: device → `assigned` + `subscriber_id`; `device_assignment_log`
entry opened.

### `unpair_device(subscriber_id, device_id, reason, return_status DEFAULT 'available')`

Preconditions: device currently assigned to this subscriber; no `active`
subscription references this device.

Actions: device → `return_status` (`available` or `faulty`) +
`subscriber_id = NULL`; `device_assignment_log` entry closed.

These two, plus the already-shipped `replace_device`, give the device
lifecycle a complete and atomic set of operations. No direct field edits
on `stb_inventory.subscriber_id` or `subscribers.stb_number` should remain
reachable from the UI after these land.

---

# Part 5 — Ledger Rendering

This section addresses "voided transactions, reversals, adjustments, and
credits are mathematically correct but visually difficult to interpret."

The ledger is, and remains, a flat immutable list of transaction rows.
What changes is purely the *rendering* — grouping and labelling rules
applied at display time, with zero schema impact.

**Rule 1 — Voided pairs render as one collapsed entry.**

A transaction with a corresponding `reversal` row (matched via the void
RPC's linkage — whatever field currently associates a reversal with its
original, e.g. a `reversed_transaction_id` or similar) renders as a single
list item:

> ~~Payment received ₹1,000~~ **Voided** — _Reason: duplicate entry, 14 Jun_
> [expand to show reversal detail]

Both the original and the reversal exist in the data and in an expanded
view, but the default rendering is one line, not two, and it is visually
marked as void rather than appearing as live activity.

**Rule 2 — Adjustments get a distinct visual language.**

`adjustment` type rows never render in the same visual style as `charge`
or `payment` rows. Proposed: a "Service Credit" badge (per BUSINESS_MODEL
§G1 terminology), a different icon (e.g., a shield or gift icon vs a
cash/receipt icon), and they are excluded from any "bill" or "charges"
summary grouping — they appear only in the chronological passbook and in
a dedicated "Credits" rollup.

**Rule 3 — Every charge/refund row shows its subscription context.**

Per the transaction ownership model (BUSINESS_MODEL v3.2), `charge` and
`refund` rows where `source` is `subscription_charge` / `subscription_refund`
carry `subscription_id`. The rendered row shows: "Internet Subscription
Charge ₹700 — 100Mbps, 1 Jun–30 Jun, ONU-002, BSNL" — pulling
`pack_name_snapshot`, dates, `device_serial_snapshot`, and provider name
from the linked subscription row. This is the G2 requirement
("the operator should never need to guess which device or subscription
generated a transaction") and it is now fully derivable from data that
exists after Phase 4a.

**Rule 4 — Payments show their allocation.**

A `payment` row, when expanded, shows the `payment_allocations` rows it
produced: "Allocated: ₹500 → Internet 100Mbps (1 Jun–30 Jun), ₹200 → advance
credit." This is the same content as the Workflow 4 confirmation screen,
persisted into the passbook so the story remains visible later, not just
at the moment of entry.

---

# Part 6 — Analytics Correctness (Framework)

To be applied once the ₹2,200 case is diagnosed against real data (see
the inline note above this document). The general rules, restated for
implementation:

**Gross Revenue** (a period, e.g. a month):
```sql
SELECT COALESCE(SUM(amount), 0)
FROM transactions
WHERE type = 'payment'
  AND id NOT IN (
    SELECT original_transaction_id FROM <reversal-linkage>
    WHERE reversal exists
  )
  AND date BETWEEN :start AND :end
```

**Refunds Issued** (a period):
```sql
SELECT COALESCE(SUM(amount), 0)
FROM transactions
WHERE type = 'refund'
  AND id NOT IN (<voided refunds, same exclusion>)
  AND date BETWEEN :start AND :end
```

**Net Revenue** = Gross Revenue − Refunds Issued.

**Service Credits Issued** (tracked separately, never added to revenue):
```sql
SELECT COALESCE(SUM(amount), 0)
FROM transactions
WHERE type = 'adjustment'
  AND date BETWEEN :start AND :end
```

**Outstanding Balance** (point in time, unchanged — already correct via
the balance trigger): `SUM(cable_balance) + SUM(internet_balance)` across
active customers, or per-service as needed.

The key structural point: **voided transactions and their reversals are
excluded from revenue entirely**, not included-then-netted. This matches
the "this transaction never should have counted" semantics of a void,
as distinct from a `refund`, which represents real money that genuinely
went back out and should reduce net revenue but not erase the original sale.

---

# Part 7 — Sequencing Recommendation

Phase 4b as originally scoped ("UI cutover to read from `subscriptions`,
then lock + drop JSONB columns") is a mechanical data-source swap — low
design risk, but it's being asked to also absorb this entire workflow
redesign, which is a UX project of comparable size to Phase 4a itself.

Recommend splitting:

**Phase 4b (mechanical):** UI reads switch from JSONB blobs to the
`subscriptions` / `payment_allocations` tables, producing *the same UI
as today, with the same fields and forms*. Verify nothing breaks. Lock
and drop JSONB columns. This is testable in isolation — same UI, new data
source.

**Phase 5 (workflow redesign):** Implement the nine workflows, the two new
RPCs, the profile redesign, and the ledger rendering rules from this
document. This is new UI surface on top of the Phase 4b data layer.

Doing 4b first and in isolation means that if something is subtly wrong
in the data layer (the revenue query), it surfaces against a *known,
unchanged UI* — much easier to diagnose than discovering it for the first
time inside a brand-new workflow screen.

Before Phase 4b starts: resolve the ₹2,200 revenue diagnosis (the
overpayment/allocation question is now resolved — see Workflow 4, Option
B). The revenue query is the remaining data-layer correctness question
that Phase 4b's "same UI, new data source" verification depends on.

---

# Part 8 — Schema Addition Required for Workflow 4

One addition to BUSINESS_MODEL.md's transaction ownership table (v3.2,
"Transaction Ownership by Type — complete reference"):

| type | source | subscriber_id | service_type | subscription_id |
|------|--------|--------------|--------------|-----------------|
| payment | **subscription_payment** *(new)* | ✓ | ✓ | ✓ set by Collect Payment action |

This is a new `source` enum value, alongside the existing
`subscription_charge` / `subscription_refund` / `manual_payment` /
`manual_refund` / `adjustment` / `reversal` / `opening_balance`. It
identifies a payment that was collected against a specific bill via
Workflow 4 ("Collect Payment"), as distinct from `manual_payment` (the
de-emphasised generic "Add Payment" with no subscription context).

Also required: `payment_method` column on `transactions` if not already
present from Phase 2 planning — `CHECK IN ('cash', 'upi', 'other')`. Set
by the method tab selected in Workflow 4.

Also required: `operator_upi_vpa` setting — a single text field in the
operator's settings, used for client-side QR generation in Workflow 4.
No other payment-gateway-related schema is needed.

---

*End of document. Companion to BUSINESS_MODEL.md v3.2.*
*New RPCs (`pair_device`, `unpair_device`), the new `subscription_payment`
source value, `payment_method` and `operator_upi_vpa` columns, and the
Phase 4b/5 split should be reflected in BUSINESS_MODEL.md's invariant
matrix and build order once confirmed.*
*v1.1 — Part 0 (design principle) added; Workflow 4 rewritten as "Collect
Payment" with Cash/UPI method and Option B allocation behaviour confirmed;
Part 8 added.*
