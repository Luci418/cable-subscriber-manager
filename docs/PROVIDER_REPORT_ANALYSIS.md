# Provider Report Analysis — Hathway (Phase 1 baseline)

> **Status:** Analysis-only. No code, schema, or importer changes were made in
> this batch. Every conclusion below is tagged with an evidence level so that
> future implementation work can distinguish what we *know* from what we
> *suspect*.

## 1. Purpose & scope

The SMS is preparing to integrate with upstream MSO/DPO systems, starting with
**Hathway** and later **GTPL**. Before writing any importer we must first
understand which provider reports carry authoritative business data, which are
operational deltas, and which are only human-facing artefacts. This document
catalogues the reports visible in the Hathway LCO portal, analyses the two
exports we have samples of, and recommends how each should (or should not) be
consumed by the SMS.

The account under study is **brand-new** (LCO code `1434012565`, "SHRI BALAJI
DIGITAL CABLE COMMUNICATION"). Hathway granted a first-month free window, so
most transactional/financial reports are currently empty. Conclusions about
those reports are therefore marked **Unknown**.

## 2. Evidence legend

Each row/field carries one of:

- **Confirmed** — directly supported by an export column, portal screenshot,
  or existing SMS code path.
- **High-confidence inference** — strongly implied by naming, adjacent
  columns, or Hathway's known product structure, but not directly verified.
- **Unknown — needs sample** — cannot be responsibly classified without a
  populated export or Hathway documentation.

## 3. Report catalogue

Derived from `hathway_reports1.png` and `hathway_reports2.png`. Filter surface
notes come from `plan_expiry_report.png` and `transaction_report_window.png`
where available.

| Report | Apparent business purpose | Classification | Likely intended use | Filter surface | SMS import? | Evidence |
|---|---|---|---|---|---|---|
| Customer Last Five Transactions | Per-customer recent activity view | Investigation | Operator investigation | Unknown (likely per-VC) | No | High-confidence inference |
| Receipt Entry Report | LCO-entered receipts audit | Financial | Audit | Unknown | Deferred | High-confidence inference |
| Transaction Report | Provider-side ledger of plan changes / renewals / cancellations | Financial + Operational | Reconciliation | Date range (same-month), Plan Type, Transaction Type, Pay Term, optional VC Id | **Yes (daily, deferred until sample)** | Confirmed (filter UI); Unknown (rows) |
| LCO Party Ledger Report | LCO-level running balance with Hathway | Financial | Audit / reconciliation | Unknown | Deferred | High-confidence inference |
| Global Search | Ad-hoc lookup UI | Investigation | Operator investigation | n/a | No | High-confidence inference |
| Available Balance Report (LCO wise) | Wallet balance snapshot per LCO | Financial | Audit | Unknown | No (single-LCO context) | High-confidence inference |
| User Details Report (LCO wise) | LCO staff/user directory | Master (LCO scope) | Operator investigation | Unknown | No | High-confidence inference |
| Lco Payment Revoke Report | Reversed LCO payments | Financial | Audit | Unknown | Deferred | High-confidence inference |
| User Details Report | LCO staff directory (variant) | Master | Operator investigation | Unknown | No | High-confidence inference |
| Service Status Report | Per-STB active/suspended status | Operational-Delta | Automated sync | Unknown | **Yes (daily)** — likely equivalent to Dashboard export | High-confidence inference |
| New Selfcare Transaction Report | Customer-initiated (self-care) txns | Financial | Audit | Unknown | Deferred | High-confidence inference |
| **CUSTOMER MASTER SUMMARY REPORT** | Authoritative subscriber+active-plan snapshot | Master + Subscription snapshot | Automated sync | Unknown (export delivered as .xls) | **Yes (daily — authoritative)** | Confirmed (export in hand) |
| Top Up Required Report | Wallet-topup dunning list | Financial | Investigation | Unknown | No | High-confidence inference |
| Bulk Ecaf Report | Bulk e-CAF (KYC form) submissions | Master (KYC) | Audit | Unknown | Deferred | High-confidence inference |
| Customer renewal request report | Pending renewal requests | Operational-Delta | Investigation | Unknown | Deferred | High-confidence inference |
| Reprint POD | Proof-of-delivery reprint tool | Investigation | Operator investigation | n/a | No | High-confidence inference |
| Plan Expiry Report | Plans expiring in a window | Operational-Delta | Investigation / dunning | From/To date, Package, optional VC Id | Deferred — expiry is already in Customer Master `End Date` | Confirmed (filter UI) |
| Bulk Discount Report | Bulk discount grants | Financial | Audit | Unknown | No | High-confidence inference |
| Bulk Upload Process | LCO → Hathway bulk operations log | Operational-Delta | Operator investigation | n/a | No | High-confidence inference |
| Bulk File Process Status | Status of bulk file jobs | Operational-Delta | Operator investigation | n/a | No | High-confidence inference |
| Customer Master Report | Verbose master (superset of Summary?) | Master | Investigation / audit | Unknown | **Unknown — needs sample** to compare against Customer Master Summary | Unknown |
| Notification Report | Sent notifications catalogue | Investigation | Audit | Unknown | No | High-confidence inference |
| SMS Delivery Report | Text-message delivery status | Investigation | Audit | Unknown | No | High-confidence inference |
| Transaction Summary | Aggregated transaction totals | Financial | Audit | Unknown | No (summary; use Transaction Report) | High-confidence inference |
| Expired Report | Already-expired plans | Operational-Delta | Dunning | Unknown | Deferred — same reason as Plan Expiry | High-confidence inference |
| Notification Sent Report | Notification dispatch log | Investigation | Audit | Unknown | No | High-confidence inference |
| LCO Collection Details | Per-collection detail rows | Financial | Reconciliation | Requires From Date + To Date + VC Id (per user report) | **No** — per-VC filter makes bulk daily sync infeasible | Confirmed (per user testing) |
| Customer Modification Report | Log of subscriber field changes | Operational-Delta | Audit | Unknown | Deferred | High-confidence inference |
| Daily Plan Cancellation Report | Cancellations of the day | Operational-Delta | Audit | Unknown | **Yes (daily)** — useful for keeping local subs in sync | High-confidence inference |
| Ecaf Report SP | Service-provider view of e-CAF | Master (KYC) | Audit | Unknown | Deferred | High-confidence inference |
| Bulk ACT/DEACT Status | Bulk activate/deactivate job status | Operational-Delta | Operator investigation | n/a | No | High-confidence inference |
| Bulk ACT/DEACT Scheduler Status | Scheduled activate/deactivate status | Operational-Delta | Operator investigation | n/a | No | High-confidence inference |
| Bulk Scheduler Process Status | Generic bulk scheduler status | Operational-Delta | Operator investigation | n/a | No | High-confidence inference |
| STB Wallet Party Ledger Report | STB-wallet-level ledger | Financial | Audit | Unknown | **Unknown — needs sample** | Unknown |
| Bulk Transaction Report | Bulk txn upload results | Financial | Audit | Unknown | Deferred | High-confidence inference |
| Balance Allocation Report | Allocations of LCO balance to STBs | Financial | Audit | Unknown | Deferred | High-confidence inference |
| Customer Auto Renewal | Customers on auto-renew | Master flag | Investigation | Unknown | Deferred | High-confidence inference |
| Asset Return Report | STBs returned to Hathway | Inventory | Audit | Unknown | **Yes (event-driven)** — should retire devices in local inventory | High-confidence inference |

## 4. Export analysis — Customer Master Summary

File: `CustomerMasterSummaryReport_2672026192522.xls`. Tab-separated, ~400
rows, all rows in the sample belong to a single subscriber (`VENKATESH
NYAMGOUD`, mobile `9448521221`) with many STBs bulk-provisioned during account
setup.

| Column | Inferred meaning | Data quality | Candidate SMS destination | Authority | Evidence |
|---|---|---|---|---|---|
| Sr. No. | Row counter | Junk | none | — | Confirmed |
| Account Number | Hathway subscriber account id | Clean, leading-quote artefact | `subscribers.hathway_customer_nbr` | **Authoritative** for upstream identity | Confirmed |
| Customer Name | Subscriber display name | Duplicated across all STBs (bulk-provision artefact) | `subscribers.name` (informational only) | Informational — SMS name may differ | Confirmed |
| VC Id | Viewing-card / smartcard id | Clean | Device-level identifier (STB) | **Authoritative** for VC | Confirmed |
| New STB No | STB serial | Identical to VC Id in this sample | Device-level identifier (STB) | High-confidence inference — needs sample where VC ≠ STB | High-confidence inference |
| Mobile Number | Subscriber RMN | Clean | `subscribers.phone` (informational) | Informational | Confirmed |
| Base Plan | Pack name as marketed | Human-readable, non-canonical | Catalog matching key (fuzzy) | Informational — must map to local pack | Confirmed |
| Start Date | Current pack start | Clean | `subscriptions.start_date` (mirror) | **Authoritative** for provider-side term | Confirmed |
| End Date | Current pack end / expiry | Clean | `subscriptions.expires_at` (mirror) | **Authoritative** for expiry | Confirmed |
| LCO Code | LCO id (constant within one export) | Constant | Connection-scope filter only | Informational | Confirmed |
| LCO Name | LCO display name | Constant | none | Informational | Confirmed |
| City / State / Address / Pin Code | Service address | Address partly redundant with Pin | `subscribers.address` (informational) | Informational | Confirmed |
| JV | Joint-venture flag/id | Unclear (`1` in all rows) | none | Unknown | Unknown — needs sample |
| Company | MSO entity | Constant | none | Informational | Confirmed |
| Company Type | SP/MSO/etc | Constant | none | Informational | Confirmed |
| Plan Type | e.g. `DPO PLAN` | Categorical | Catalog metadata | High-confidence inference | High-confidence inference |
| DPO Total Price | Pure-DPO price component | Numeric | Catalog `provider_cost` candidate | High-confidence inference | High-confidence inference |
| ALC Total Count / Price | À-la-carte add-ons | Zero in sample | Catalog add-on (future) | Unknown | Unknown — needs sample |
| BB Total Count / Price | Broadcaster-bouquet add-ons | Zero in sample | Catalog add-on (future) | Unknown | Unknown — needs sample |
| NCF Count / Price | Network Capacity Fee components | Zero in sample | Tax/fee line (future) | Unknown | Unknown — needs sample |
| Total Base Price | Sum of all price components | Clean | Catalog `provider_cost` reference | **Authoritative** for provider cost per pack instance | Confirmed |
| Wallet Balance | LCO wallet balance? Blank here | Empty in sample | none (LCO-scope, not per-subscriber) | Unknown | Unknown — needs sample |
| Remark | Free-text remark | `'` in sample | none | Informational | Confirmed |
| SCHEME NAME | Marketing scheme | Categorical (`PURE DPO`) | none | Informational | Confirmed |
| Connection Type | STB / broadband / etc | Categorical (`HW_FY27_KN_1_FPF` in sample — actually a scheme code, ambiguous) | Unclear | Unknown | Unknown — column header vs value mismatch |

### Notes on quality

- Every value is prefixed with `'` (Excel text-lock). Any parser must strip
  it.
- Because this LCO bulk-provisioned STBs to one holding account, the
  Customer Name / Mobile fields are not per-end-user identity — they are
  LCO-controlled placeholders. **VC Id / STB No are the only per-endpoint
  identifiers we can trust.** *Confirmed* by the near-total duplication in
  the sample.
- One row per **active plan on an STB**. If an STB carries multiple plans in
  parallel, expect multiple rows for that STB.

## 5. Export analysis — Total Dashboard Data

File: `TotalDashboardData_2572026185731.xls`. Tab-separated, ~400 rows.

| Column | Inferred meaning | Candidate SMS destination | Authority | Evidence |
|---|---|---|---|---|
| Sr.No. | Row counter | none | — | Confirmed |
| Service Status | ACTIVE / SUSPENDED / TERMINATED | `stb_inventory.status` mirror | **Authoritative** for provider-side service state | Confirmed |
| STB ID | STB serial | device match key | Authoritative | Confirmed |
| VC ID | VC id | device match key | Authoritative | Confirmed |
| RMN | Registered mobile | `subscribers.phone` (informational) | Informational | Confirmed |
| Customer Name | Display name | none (already in Customer Master) | Informational | Confirmed |

This is a **lightweight status delta** feed. It contains no plan/expiry/price
data — it is the cheapest signal for "is this STB currently live upstream".

## 6. Overlap matrix — who owns what

| Concept | Best source | Alternate sources | Rationale |
|---|---|---|---|
| Upstream subscriber identity (Account Number, RMN) | Customer Master Summary | Dashboard (partial), Customer Master Report (unknown) | Only Customer Master has address + account fields |
| Device inventory (VC / STB) | Dashboard Data | Customer Master Summary | Dashboard is smaller and status-focused; ideal for daily inventory sync |
| Current service status (ACTIVE / SUSPENDED / …) | Dashboard Data | Service Status Report (unknown) | Dashboard is confirmed present and small |
| Current active plan + expiry | Customer Master Summary | Plan Expiry Report (partial, date-window only) | Customer Master gives full active state; Plan Expiry is a filter over it |
| Provider cost of pack instance | Customer Master Summary (`Total Base Price`) | — | Only place we see the number |
| Financial transactions (renewals, refunds) | Transaction Report (deferred) | LCO Party Ledger, LCO Collection Details | Needs sample before choosing |
| Asset returns | Asset Return Report | — | Unique event stream |
| KYC / e-CAF | Bulk Ecaf Report / Ecaf Report SP | — | Deferred |

## 7. Fields with no natural SMS home (yet)

- `JV`, `Scheme Name`, `Connection Type` (column header/value mismatch) —
  meaning unclear.
- `ALC / BB / NCF` count+price columns — SMS catalog currently models a pack
  as a single `provider_cost`; à-la-carte and NCF break-down not modelled.
- `Wallet Balance` (as shipped in Customer Master) — appears LCO-scoped, not
  per-subscriber; we have no LCO wallet concept locally.
- `Remark`, `Company`, `Company Type`, `LCO Name` — informational; not worth
  a column until a use case appears.

## 8. New-account caveat

The sampled LCO is brand-new; Hathway waived the first month, so:

- Transaction Report / LCO Collection Details / Receipt Entry Report / LCO
  Party Ledger Report are **empty** in this account today.
- Plan Expiry Report returns `No data found` for a same-day range (see
  screenshot).
- **All financial/collection reports are therefore classified Unknown until
  we can inspect a populated month.** Do not design importers against them
  yet.

## 9. Operator-workflow blockers

Confirmed via user testing:

- **LCO Collection Details** requires From/To Date **and** a VC Id. This
  makes it unusable for a nightly bulk sync — an operator cannot iterate the
  form once per subscriber to refresh SMS records. Do not build against this
  report; wait for a bulk export or API.
- **Transaction Report** enforces "From Date To Date should be same Month"
  (screenshot). Any importer must chunk requests per calendar month.
- **Plan Expiry Report** takes an optional VC Id but works without it —
  usable for bulk *if* we decide we need it (we don't; Customer Master
  already carries `End Date`).

## 10. Unknown reports requiring sample export

Before designing an importer, we need a populated sample of:

1. **Transaction Report** — to see the row shape, transaction-type
   vocabulary, and whether it carries VC Id + amount + payment mode.
2. **LCO Party Ledger Report** — to know whether it doubles as a running
   balance or itemised ledger.
3. **Customer Master Report** (the non-Summary variant) — to decide if it
   supersedes Customer Master Summary.
4. **STB Wallet Party Ledger Report** — to know if per-STB wallet is a
   concept we need to mirror.
5. **Asset Return Report** — to know how a return maps back to `stb_inventory`.
6. **Ecaf / Bulk Ecaf** — to know whether KYC docs are attachments or
   structured rows.

## 11. Synchronization recommendations

| Cadence | Reports | Why |
|---|---|---|
| **Daily (authoritative)** | Customer Master Summary; Dashboard Data | Together they cover identity, device inventory, service status, active plan, expiry. |
| **Daily (delta)** | Daily Plan Cancellation Report; Service Status Report (if it turns out to differ from Dashboard) | Catch cancellations promptly. |
| **Event-driven** | Asset Return Report | Retire devices in local inventory. |
| **On-demand (deferred)** | Transaction Report; LCO Party Ledger; Receipt Entry; Bulk Transaction Report; Balance Allocation | Financial reports — defer until populated sample available. |
| **Never (operator-only)** | Global Search; Reprint POD; Notification / SMS reports; Bulk file/scheduler status; User Details; Top Up Required; Customer Last Five Transactions | These are human-facing tools, not data feeds. |
| **Never (per-VC filter)** | LCO Collection Details | Confirmed unusable for bulk. |

## 12. Authoritative source recommendations

| SMS concept | Authoritative provider source | Notes |
|---|---|---|
| Upstream subscriber identity | Customer Master Summary → `Account Number` | Store on `subscribers.hathway_customer_nbr` (already present). |
| Device (VC + STB) | Dashboard Data | Customer Master Summary is a secondary confirmation. |
| Service status | Dashboard Data → `Service Status` | Overrides local `stb_inventory.status` on drift. |
| Current pack + expiry | Customer Master Summary → `Base Plan` + `Start/End Date` | Requires local pack-mapping table (future). |
| Provider cost per pack instance | Customer Master Summary → `Total Base Price` | Cross-check against `packs.provider_cost`. |
| Money in/out with provider | **Unknown** — pending Transaction Report / LCO Party Ledger sample | SMS ledger remains authoritative in the interim. |
| Asset returns | Asset Return Report | Event-driven only. |

---
Cross-reference: implementation strategy in
`docs/PROVIDER_INTEGRATION_ARCHITECTURE.md`.
