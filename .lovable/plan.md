# Batch — Provider Integration Analysis (Hathway)

Analysis-only. No code, migrations, parsers, or UI changes. Deliverables are two markdown documents. Every conclusion is tagged **Confirmed**, **High-confidence inference**, or **Unknown — needs sample**.

## Inputs

- `user-uploads://hathway_reports1.png`, `hathway_reports2.png` — portal report menu
- `user-uploads://plan_expiry_report.png`, `transaction_report_window.png` — report filter UIs
- `user-uploads://CustomerMasterSummaryReport_2672026192522.xls` — Customer Master export (401 rows)
- `user-uploads://TotalDashboardData_2572026185731.xls` — Dashboard export (401 rows)
- Existing Hathway stub in `src/pages/Settings.tsx` (IntegrationsSection) and `subscribers.hathway_customer_nbr` column

## Deliverable 1 — `docs/PROVIDER_REPORT_ANALYSIS.md`

Sections:

1. **Purpose & scope** — analysis-only batch, evidence vs inference discipline.
2. **Evidence legend** — Confirmed / High-confidence inference / Unknown.
3. **Report catalogue** — every report visible in the two portal screenshots, one row each. Columns:
   - Report name
   - Apparent business purpose
   - Classification (Master / Operational-Delta / Financial / Inventory / Investigation / Unknown)
   - Likely intended use (auto-sync / operator investigation / audit / reconciliation)
   - Filter surface (from screenshots where visible: e.g. Plan Expiry and Transaction Report require date + optional VC Id; noted as blocker for per-VC operator-driven flows)
   - Candidate for SMS import? (Yes / No / Deferred / Unknown)
   - Evidence tag
4. **Export analysis — Customer Master Summary** — every column with inferred meaning, quality notes, candidate SMS destination (Subscriber / Subscription / Device / Catalog / Provider / Credentials / Financial / none), authoritative vs informational, evidence tag. Explicitly covers: Account Number, VC Id, New STB No, Mobile, Base Plan, Start/End Date, LCO Code/Name, City/State/Address/Pin, JV, Company, Company Type, Plan Type, DPO/ALC/BB/NCF prices and counts, Total Base Price, Wallet Balance, Remark, Scheme Name, Connection Type.
5. **Export analysis — Total Dashboard Data** — same treatment: Sr.No, Service Status, STB ID, VC ID, RMN, Customer Name. Note near-total overlap with Customer Master on identity fields; classify as lightweight status delta.
6. **Overlap matrix** — which fields appear in multiple reports and which report should be authoritative for each concept (subscriber identity, device mapping, package mapping, expiry, activation, provider reference, wallet).
7. **Fields with no natural SMS home** — e.g. JV, Scheme Name, NCF pricing components, Wallet Balance at provider level, DPO/ALC/BB breakdown.
8. **New-account caveat** — first-month-free, no transactional history yet, so Transaction Report / LCO Collection Details / Plan Expiry are currently empty; conclusions about those reports are marked Unknown.
9. **Operator-workflow blockers** — reports requiring per-VC-Id input are unsuitable for daily bulk SMS refresh; called out explicitly.
10. **Unknown reports requiring sample export** — enumerated list with what sample would resolve each.
11. **Synchronization recommendations** — daily / on-demand / never / deferred, per report, with rationale.
12. **Authoritative source recommendations** — one source of truth per concept.

## Deliverable 2 — `docs/PROVIDER_INTEGRATION_ARCHITECTURE.md`

Sections:

1. **Goals & non-goals** — multi-provider (Hathway now, GTPL next, others later) without duplicating business logic; analysis-only for this batch.
2. **Guiding principles** — provider data is a mirror, not the ledger; SMS ledger stays authoritative for money; provider is authoritative for upstream identity/expiry; preview-before-commit; full audit.
3. **Provider abstraction** — conceptual `ProviderAdapter` contract (identify, list reports, fetch report, parse to canonical rows). No code — described as responsibilities and boundaries.
4. **Canonical intermediate model** — provider-neutral shapes for SubscriberIdentity, DeviceAssignment, SubscriptionSnapshot, LedgerEntry.
5. **Pipeline stages** — ingestion → parsing → normalization → validation → reconciliation → preview → import → audit. Responsibility, inputs/outputs, and failure mode of each stage.
6. **Reconciliation semantics** — match keys (VC Id, STB No, hathway_customer_nbr, phone), conflict rules, drift reporting, never-auto-overwrite categories.
7. **Sync cadence model** — daily authoritative pull, on-demand investigation pull, manual upload fallback (current stub upgrade path).
8. **Audit & observability** — import_run, import_row_result, drift_report tables (proposed only, no migration this batch).
9. **UI surface evolution** — how the current Settings → Integrations → Hathway stub grows into: connection config, scheduled sync status, last-run summary, preview/commit screen, drift review.
10. **GTPL & future-provider extensibility** — what must be provider-specific vs shared; expected shape of the second adapter.
11. **Gap analysis vs current SMS model** — captured / duplicated / missing / likely-future-fields (references Report Analysis doc; no schema changes).
12. **Implementation roadmap** — sequenced phases (adapter contract → manual upload parser for Customer Master → scheduled pull → reconciliation UI → GTPL adapter). Each phase gated on resolving specific Unknowns from the Report Analysis.
13. **Open questions** — consolidated list to answer before implementation begins.

## Out of scope (explicit)

No parsing, no imports, no upserts, no migrations, no UI changes, no adapter code. Hathway stub remains as-is.
