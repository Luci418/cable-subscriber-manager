# Provider Integration Architecture

> **Status:** Architectural proposal only. No adapters, parsers, migrations,
> or UI changes were shipped in this batch. Companion document:
> `docs/PROVIDER_REPORT_ANALYSIS.md`.

## 1. Goals & non-goals

**Goals**

- Support **Hathway** now, and additional MSOs later,
  without duplicating business logic per provider.
- Keep the SMS's local ledger and inventory authoritative for money,
  operator actions, and audit; let provider data mirror upstream state.
- Give operators a **preview-before-commit** experience on every import.
- Provide a complete audit trail: every provider-driven change to a local
  record is traceable to the import run + row it came from.

**Non-goals (this batch)**

- No parsing code, no upsert code, no adapters, no schema changes.
- No scheduled jobs, no queues.
- The existing Settings → Integrations → Hathway stub is unchanged.

## 2. Guiding principles

1. **Provider is a mirror, not the ledger.** SMS transactions, payments and
   allocations remain the source of truth for money owed and collected.
   Provider financial reports are used for **reconciliation** and drift
   alerts, not to rewrite the ledger.
2. **Provider is authoritative for upstream identity and expiry.** Account
   numbers, VC/STB serials, service status, and current-pack expiry come
   from the provider.
3. **Never auto-overwrite operator-entered fields.** Local subscriber name,
   address, phone, notes, credentials — those are operator-owned. Provider
   data may *suggest* an update via drift report; a human confirms.
4. **Every import is previewable and reversible.** No provider file
   silently mutates production data.
5. **Provider-neutral core, provider-specific edges.** The pipeline speaks
   a canonical model; adapters translate.

## 3. Provider abstraction

Each provider is a **ProviderAdapter** with a narrow, stable contract. No
code in this batch — this is the responsibility contract:

- `identify()` — human-readable provider id and version.
- `listReports()` — the reports this adapter can handle, tagged with
  cadence hint (daily/on-demand/event) and canonical type
  (`subscriber_master` / `device_status` / `transaction_ledger` /
  `asset_return` / `cancellation_delta` / …).
- `parseReport(reportType, payload)` — takes a raw file (or API response)
  and yields **canonical rows** of a single canonical type.
- `matchKeys(canonicalRow)` — returns the ordered list of keys the row can
  be matched by locally (e.g. `hathway_customer_nbr`, `vc_id`, `stb_no`,
  `phone`).
- `capabilities()` — declares what this provider *can* deliver (e.g.
  Hathway: yes to master + device status; unknown for wallet).

Adapters do **not** talk to the database, do **not** know about SMS tables,
and do **not** decide policy. They translate.

## 4. Canonical intermediate model

Provider-neutral shapes the pipeline speaks in:

- **CanonicalSubscriber** — upstream account id, display name, phone,
  address, provider tag.
- **CanonicalDevice** — device type (STB / ONU), VC id, serial, current
  service status, linked upstream account id.
- **CanonicalSubscriptionSnapshot** — device ref, pack identifier (as the
  provider names it), start date, expiry, price components.
- **CanonicalLedgerEntry** — upstream account ref, timestamp, amount,
  direction, provider transaction id, transaction type.
- **CanonicalAssetReturn** — device ref, returned-at, reason.

Each canonical shape carries `provider_id`, `report_type`, `source_row_id`
(row hash) so any downstream write can be traced back.

## 5. Pipeline stages

```text
        ┌──────────┐   ┌────────┐   ┌────────────┐   ┌───────────┐
raw ──▶ │ Ingestion│──▶│ Parsing│──▶│Normalization│──▶│Validation │
        └──────────┘   └────────┘   └────────────┘   └─────┬─────┘
                                                            │ canonical rows + issues
                                                            ▼
                                                    ┌───────────────┐
                                                    │Reconciliation │
                                                    └──────┬────────┘
                                                            │ diff plan
                                                            ▼
                                                    ┌───────────────┐   operator
                                                    │   Preview     │◀──────────
                                                    └──────┬────────┘
                                                            │ approved plan
                                                            ▼
                                                    ┌───────────────┐
                                                    │   Import      │
                                                    └──────┬────────┘
                                                            ▼
                                                    ┌───────────────┐
                                                    │    Audit      │
                                                    └───────────────┘
```

| Stage | Responsibility | Input | Output | Failure mode |
|---|---|---|---|---|
| Ingestion | Accept the raw report (manual upload today, scheduled pull later). Persist the raw file for audit. | file bytes + provider hint | `import_run` row + stored raw blob | Reject if provider/report can't be identified. |
| Parsing | Adapter converts raw → canonical rows. | raw blob | canonical rows | Per-row parse errors are collected, not fatal. |
| Normalization | Trim leading `'`, unify dates, phone formats, uppercase serials, resolve pack name → local pack id (via mapping table, future). | canonical rows | canonical rows (clean) | Unknown pack name → row flagged, not dropped. |
| Validation | Enforce required fields, referential sanity (VC without account? status not in vocabulary?). | canonical rows | canonical rows + per-row issues | Row-level severities: `error` (excluded from plan) / `warning` (included). |
| Reconciliation | Diff canonical rows against current SMS state via match keys. Produce a **plan**: `{creates, updates, no-ops, drift-alerts, unmatched}`. | canonical rows + local state | diff plan | Ambiguous match (two locals hit) → unmatched with reason. |
| Preview | Render the plan for operator review. Show counts per bucket, per-row detail, and drift table. | diff plan | operator decision | Operator may reject entirely, or apply subset. |
| Import | Execute approved creates/updates transactionally, per canonical type. | approved plan | write results | Any write failure rolls back its row; the run continues. |
| Audit | Persist run summary, per-row results, and diff artefacts. | write results | `import_run` closed + `import_row_result` rows | Always runs, even on partial failure. |

## 6. Reconciliation semantics

**Match key order** (first hit wins, later keys used as tiebreakers):

1. Provider customer number on the subscriber↔provider link
2. VC Id on device inventory
3. STB / device serial on device inventory
4. RMN (phone) — advisory only, never a sole match

**Conflict rules**

- If provider says a device is `SUSPENDED` and local status is `active` →
  **drift-alert**, do not auto-update; operator confirms.
- If provider `End Date` differs from local `expires_at` on the currently
  active subscription → **drift-alert**; operator can accept to update.
- Provider price differing from local `packs.provider_cost` → **drift-alert**
  on the catalog, not the subscription.
- Provider subscriber name/address/phone differing from local → **never
  auto-update**. Surface as a suggestion in the drift report.

**Never-auto-overwrite categories**

- Financial ledger entries (`transactions`, `payment_allocations`).
- Subscriber personal fields (name, phone, address, notes).
- Credentials (ISP/WiFi/hardware).

## 7. Sync cadence model

- **Scheduled daily pull** for authoritative reports (Customer Master
  Summary, Dashboard Data) once we have a provider API or automated
  download. Until then, treat manual uploads as the same code path.
- **On-demand pull** for investigation reports triggered by an operator
  action ("check upstream state for this subscriber").
- **Manual upload fallback** — the current Hathway stub — is preserved
  permanently as a break-glass path.

The **current stub** in `src/pages/Settings.tsx` maps cleanly onto this: the
"Import Report" file picker becomes the manual-upload ingestion entry
point; the sync log becomes a truncated view of `import_run`.

## 8. Audit & observability (proposed tables)

Not created in this batch. Sketched here so the pipeline has a clear target:

- `import_run` — one row per ingestion attempt: provider, report type,
  source (manual/scheduled), started/ended, operator, raw-file ref,
  status, counts summary.
- `import_row_result` — per canonical row: run ref, canonical type,
  match keys resolved, action taken (create/update/noop/drift/skip),
  local id touched, error text.
- `drift_report` — persisted drift alerts not auto-applied; operator
  disposition (accept/dismiss) and outcome.

All three would follow the existing SMS conventions (RLS + grants +
service_role) when the time comes.

## 9. UI surface evolution

Today the Hathway integration lives at **Settings → Integrations →
Hathway** with: enable toggle, last-synced timestamp, Import Report
picker, rolling log. The proposed growth path (no work in this batch):

1. **Connection config** — provider credentials / API key section (masked).
2. **Scheduled sync status** — next run, last run, health.
3. **Run history** — links to `import_run` rows with drill-down.
4. **Preview / commit screen** — after upload or pull, before write.
5. **Drift review inbox** — outstanding drift alerts across all runs.
6. **Per-subscriber "provider snapshot" panel** — show what upstream
   currently believes about this subscriber.

The stub does not need to be redesigned yet; it just needs to be aware it
will grow.

## 10. Future-provider extensibility

Provider-specific:

- Raw report shapes (CSV/TSV/XLS/API).
- Report names and cadence quirks.
- Match-key vocabulary (which provider ids/serials exist).
- Capability declaration (does this provider expose a wallet? asset
  return? plan cancellation delta?).

Shared:

- Canonical model.
- Reconciliation rules.
- Preview / audit / drift tables.
- UI screens.

A second provider should be addable by implementing the
`ProviderAdapter` contract and registering it — no changes to pipeline
stages, tables, or UI screens.

## 11. Gap analysis vs current SMS model

| Concern | Current SMS captures? | Provider adds? | Gap |
|---|---|---|---|
| Upstream subscriber id | Yes (`hathway_customer_nbr`, superseded by the provider link table) | — | None |
| Device inventory | Yes (`stb_inventory`) | Confirms status | None |
| Service status per device | Yes (`stb_inventory.status`) | Yes (Dashboard) | Need drift check |
| Current pack + expiry | Yes (`subscriptions`) | Yes (Customer Master) | Need pack-name → local pack mapping table |
| Provider cost of pack | Yes (`packs.provider_cost`) | Yes (Total Base Price) | Fine; need catalog-drift check |
| Pack sub-components (ALC/BB/NCF) | No | Yes (Customer Master) | **Missing** — accept later if needed |
| LCO wallet balance | No | Yes (Available Balance) | **Missing** — no local model yet |
| Provider-side transactions | No | Likely (Transaction Report) | **Deferred** until sample; then reconciliation-only |
| Asset returns | Partial (`decommissioned` status) | Yes (Asset Return Report) | Wire event → status transition |
| KYC / e-CAF | No | Yes (Bulk Ecaf) | **Deferred** |

No schema changes in this batch. Fields to consider later, but only after
seeing populated samples:

- `subscriptions.provider_cost_snapshot` (from Total Base Price at import
  time, for margin history).
- `provider_transactions` table if the Transaction Report proves
  reconciliation-worthy.
- `provider_pack_map (provider_id, provider_pack_name, local_pack_id)` —
  the pack-name mapping table.

## 12. Implementation roadmap

Each phase is gated on resolving specific **Unknowns** from the Report
Analysis. Do not start a later phase until its predecessor is verified in
production use.

1. **Phase 0 — Provider adapter contract.** Land the `ProviderAdapter`
   interface + canonical types with a Hathway adapter that supports two
   reports: Customer Master Summary and Dashboard Data. Manual upload
   only. Preview + import + audit. Ships the `import_run` /
   `import_row_result` tables.
   *Gate:* none — everything needed is in hand.

2. **Phase 1 — Pack-name mapping.** Introduce `provider_pack_map` and a
   Catalog UI to bind Hathway `Base Plan` strings to local packs.
   *Gate:* Phase 0 in operator use.

3. **Phase 2 — Drift review inbox.** Persist drift alerts and add the
   inbox UI + per-subscriber snapshot panel.
   *Gate:* enough drift observations to design the disposition workflow.

4. **Phase 3 — Financial reconciliation.** Add adapter support for
   Transaction Report and LCO Party Ledger — read-only reconciliation
   against the local ledger.
   *Gate:* **populated Transaction Report sample** (see Analysis §10).

5. **Phase 4 — Scheduled pull.** Move from manual upload to scheduled
   fetch (requires credentials / API access from Hathway).
   *Gate:* provider access story confirmed.

6. **Phase 5 — Asset return events.** Wire Asset Return Report to a
   controlled `decommissioned` transition.
   *Gate:* populated sample.

7. **Phase 6 — Second provider adapter.** Register another adapter using
   the same pipeline.
   *Gate:* sample exports from that provider in hand.

## 13. Open questions to answer before implementation

- Does Hathway offer an API (or SFTP feed) for LCOs, or is the portal
  export the only channel?
- Are Customer Master Summary and Customer Master Report the same data
  with different verbosity, or two different feeds?
- What are the exact values of `Service Status` in Dashboard Data across
  a live account (ACTIVE/SUSPENDED/TERMINATED/…)?
- What does the Transaction Report look like once transactions exist?
- Does `Wallet Balance` in Customer Master ever populate for a real LCO,
  and is it per-LCO or per-subscriber?
- What is the meaning of `JV`, `Scheme Name`, and the value found under
  `Connection Type`?
- How does Hathway represent an STB *carrying multiple parallel packs* —
  one row per pack per STB, or a rolled-up row?

Answering these unblocks Phases 3–5 above.
