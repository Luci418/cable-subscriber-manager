# Industry Benchmarking Addendum

**Companion to:** [OPERATOR_WORKFLOW_UI_REVIEW.md](./OPERATOR_WORKFLOW_UI_REVIEW.md) v1.1
**Status:** Planning — does not change the spec, augments it.
**Date:** 2026-06-14

## Scope

Cross-check the 9 operator workflows in the review doc against patterns from real operator-facing ISP/Cable subscriber management platforms and against TRAI's MSO/LCO obligations. Identify: **confirmed**, **refine**, or **gap**.

## Platforms surveyed

| Platform | Segment | Why it matters here |
|---|---|---|
| **Splynx** | ISP billing/CRM (global, popular with WISPs) | Strongest reference for inventory pairing, payment collection, and a dedicated installer/collector app. |
| **Sonar Software** | Tier-2/3 US ISPs | Reference for ledger/passbook UX, dunning, and accounting integration. |
| **UISP (Ubiquiti)** | ISP CRM + NMS (free) | Reference for device-centric subscriber model and map view. |
| **Powercode** | Mid-market ISPs | Reference for collection workflows and tax handling. |
| **India LCO/MSO billing** (Hathway/GTPL local LCO panels, CAS/SMS vendors like Cisco VideoGuard, Conax, Verimatrix India deployments, Catvision, SkyPro, plus open LCO billing apps) | India cable | Reference for STB pairing terminology, prepaid recharge model, and TRAI NTO-2 statement formats. |
| **TRAI references** | Regulator | Manual of Practice for SMS (Subscriber Management System) under NTO-2.0 + Telecommunication (Broadcasting & Cable) Services Interconnection Regulations 2017/2020. |

> No deep-research links pasted — this is a synthesis from public docs, vendor product tours, and India operator community knowledge. Treat as starting brief; flag anything you want me to confirm with a targeted web fetch.

## Domain conventions worth adopting

1. **"Service instance"** is the universal noun. Splynx/Sonar/Powercode all model `Customer → Service (n) → Device(s)`. A subscriber can hold multiple Internet services and multiple Cable services concurrently. Our `subscriptions` table already supports this; the UI must stop saying "the cable subscription".
2. **Device pairing is a first-class verb.** All four platforms have explicit `Pair`, `Unpair`, `Swap/Replace` actions on the service, not on the customer. The action lives on the service card.
3. **"Collect Payment" is bill-centric, not amount-centric.** Sonar and Splynx open the collection screen pre-populated with the outstanding invoices/services; operator chooses which to settle, system handles allocation. We currently take an amount + free-text → this is the biggest UX gap.
4. **Ledger = chronological passbook, never a balance recalculation.** Industry shows running balance per service line with reversal pairs **collapsed by default** (expand on click). Sonar calls this "Account Activity"; Splynx calls it "Transactions". TRAI's SMS guidelines require a per-subscriber statement showing every charge and payment with date, source, and amount — append-only.
5. **Map + route view is standard for field-collector apps.** UISP CRM has a customer map; Splynx has the "Splynx Administration" mobile app with route planning. India LCO apps (e.g. ChannelPlay, Catvision LCO Connect) ship route-by-area collection lists.

## TRAI-specific obligations we should design toward

These are operator-facing requirements, not optional UX:

- **Per-subscriber SMS record** with: subscriber ID, address, KYC docs, active subscriptions (a-la-carte channels / bouquets / packs), CAS ID and STB number(s), activation date, payment history. We have most of this; we are missing **explicit KYC field group** (ID proof type + number + photo).
- **Itemised monthly statement** per NTO-2.0: NCF, bouquet charges, a-la-carte charges, taxes, paid/unpaid status. For ISP side, DOT's CAF/KYC + monthly bill format applies.
- **Complaint ticket lifecycle** with timestamps for raised → acknowledged → resolved, and SLA breach flag. Our `complaints` table has the fields; the UI doesn't surface SLA timers.
- **Audit log for any change to subscription/billing data.** We are append-only on transactions and subscriptions — good. We are NOT logging edits to subscriber profile fields (mobile, address). **Gap.**

## Cross-check against the 9 workflows

Numbering follows OPERATOR_WORKFLOW_UI_REVIEW.md Part 2.

| # | Workflow | Verdict | Notes |
|---|---|---|---|
| 1 | Add subscriber | **Refine** | Industry collects KYC (ID type/number/photo) and full address (line1/line2/city/pincode) at this step. We collect name/mobile/region/coords/STB only. For TRAI compliance and field-agent navigation, add an Address block and a KYC block (can be optional fields gated by setting). |
| 2 | Add subscription (Pair pack to service) | **Confirmed** | Matches Splynx "Add Service" pattern. Our RPC is already snapshot-based, which is industry standard. |
| 3 | Renew subscription | **Refine** | Industry distinguishes **Renew (extend same pack)** from **Change Plan (new pack, prorate old)**. We collapse both into "create new subscription". For Phase 5, keep one path but label the two operator intents clearly in the UI. Proration is a future item, not Phase 5. |
| 4 | Collect Payment | **Refine (big)** | This is the workflow that needs the most redesign. See "Refinement detail" below. |
| 5 | Cancel subscription + refund | **Confirmed** | Splynx/Sonar do exactly this: terminate service, optionally issue refund capped at cash paid. Our INV-42 already enforces the cap. |
| 6 | Replace device | **Confirmed (incomplete UI)** | RPC is correct. UI is the gap — needs a real screen, not a hidden action. |
| 7 | Pair device (new) | **Gap** | No dedicated RPC yet. Today the only way to "pair" is through `replace_device` or via Add Subscriber. Industry has explicit `Assign Device` action on an existing customer's service. **Needs `pair_device` RPC.** |
| 8 | Unpair device (new) | **Gap** | Same — no RPC. Splynx allows unpair without cancellation (e.g. device returned for repair, service paused). We currently force a cancellation. **Needs `unpair_device` RPC.** |
| 9 | Adjustment / outage credit | **Confirmed** | Our `adjustment` type matches Splynx "Credit Note" and Sonar "Account Credit". Keep. |

### Refinement detail — Workflow 4 (Collect Payment)

Current: operator types amount + free text → row goes into ledger → FIFO trigger allocates.

Industry pattern (Splynx "Add Payment", Sonar "Apply Payment"):

```
┌─ Collect Payment ──────────────────────────────────────┐
│ Subscriber: NORTH-001 — Ramesh                         │
│                                                         │
│ Outstanding by service line:                            │
│  ☑ Cable    ₹450  (Pack A, expires Jun 30)             │
│  ☑ Internet ₹600  (Pack B, expires Jul 05)             │
│  ─────────                                              │
│  Selected:  ₹1,050                                      │
│                                                         │
│ Or pay a custom amount: [______]                        │
│ (excess will sit as advance credit on selected service) │
│                                                         │
│ Method: ( ) Cash  (•) UPI                              │
│   [ UPI QR rendered client-side from operator VPA ]     │
│   Reference / UTR (optional): [__________]              │
│                                                         │
│ [Cancel]                              [Record Payment]  │
└─────────────────────────────────────────────────────────┘
```

Three additions vs today:
1. **Bill-first selection** (checkboxes per service line) replaces amount-first.
2. **Method tabs** (Cash | UPI) — already in Phase 4b schema (`payment_method` + `operator_upi_vpa`).
3. **Inline UPI QR** generated client-side from `upi://pay?pa=<vpa>&am=<amount>&tn=<subscriber_id>`. No backend dependency.

## New gap items the review doc doesn't yet name

| Gap | Source | Priority |
|---|---|---|
| **KYC fields on subscriber** (ID type, ID number, ID photo URL) | TRAI / DOT CAF | High before commercial rollout. |
| **Address block** (line1/line2/city/state/pincode) separate from `region` | TRAI + field-agent app navigation | High. |
| **Subscriber profile edit audit log** | TRAI audit obligation | Medium. |
| **Complaint SLA timers** in UI | TRAI redressal norms | Medium. |
| **Itemised monthly statement** export per subscriber | TRAI NTO-2 / DOT bill format | Medium — needed before "go live commercially". |
| **Role-based access** (collection agent / admin / owner) with map-based collection app | User requirement | High — covered in Phase 6 below. |
| **Tax / GST line items** on charges | GST compliance | Medium. |
| **Discounts / promo packs** as a separate concept | Industry standard | Low (post-Phase 5). |

## What we are doing better than baseline

- Append-only `transactions` + `payment_allocations` with reversal rows is cleaner than Splynx (which lets you delete payments with an admin role) and matches Sonar's ledger model.
- Device-level subscription uniqueness (INV-39) is more precise than UISP (subscriber-level).
- Inventory-as-source-of-truth with the agreement trigger (Phase 3.6) — most India LCO apps treat STB as a free-text field on the subscriber. We are stricter.

## Recommendation for Phase 5 scope

Adopt these from this addendum into Phase 5 without expanding scope unmanageably:

1. **Workflow 4 redesign as drawn above** — bill-first + method tabs + UPI QR.
2. **`pair_device` and `unpair_device` RPCs** (closes Gap rows 7, 8 above and unblocks the bug "can't add ONU to a customer whose old ONU was marked faulty").
3. **Service card refactor** — show one card per active subscription, with Pair/Unpair/Replace actions on the card itself (fixes the multi-device UX gap).
4. **Ledger collapse rule for void+reversal pairs** (already in review doc Part 5).

Defer to **Phase 6** (post-Phase 5):
- KYC + Address blocks + subscriber profile audit log.
- Role-based access + collection-agent map view.
- Itemised monthly statement export.
- GST line items.

This keeps Phase 5 finite while making the gaps explicit and tracked.
