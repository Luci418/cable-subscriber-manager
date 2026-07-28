
# Provider Synchronization Engine — Final Implementation Plan

Supersedes the "importer" framing in `docs/PROVIDER_INTEGRATION_ARCHITECTURE.md`. Reports are treated as **evidence of business events**, not as rows to mirror. Every sync produces a reviewable diff between yesterday's provider snapshot and today's, plus a plan the operator approves before anything writes.

## 1. Critical assessment of the discussion

Points to keep:
- **Event detection over row import** (ChatGPT). Correct — this matches how you actually operate through the Hathway operator portal.
- **Snapshot-vs-snapshot diff, not snapshot-vs-SMS** (ChatGPT). Prevents misclassifying "already synced" as "new event".
- **Configurable Synchronization Policy per provider** with three field classes: provider-owned / operator-owned / shared-ask.
- **Clickable review dashboard** with drill-down to per-subscriber diffs before commit.
- **Auto-create charges for detected provider events** using your local catalog price (not Hathway's DPO Total Price).
- **Provider Pack Mapping table** — never match packs by free-text name.
- **Per-row success/failure**, atomic per subscriber, not atomic per run.
- **`charge_source` enum** to distinguish `MANUAL` vs `SYNC_HATHWAY` vs `SYNC_BSNL`.
- **Rollback per import run** using recorded diffs (Git-inspired diffs, not actual Git).

Points to reject or soften:
- Do **not** infer terminations from absence — require positive evidence (Dashboard `INACTIVE`/`SUSPENDED`, Daily Plan Cancellation Report, or explicit Customer Master flag).
- Do **not** auto-create subscribers into `active` from Hathway. New provider rows go into a **Needs Review** queue; operator decides link/create/ignore.
- Do **not** ship the full "ProviderAdapter interface + canonical model" abstraction yet. One concrete Hathway path first; extract the interface only when the BSNL path is being built.
- No Git integration — implement diff/rollback in-app.

## 2. What we build for Hathway (Cable)

### 2.1 Sync workflow (operator-facing)

```text
Settings → Integrations → Hathway
  ├─ Upload "Customer Master Summary" (.xls TSV)
  ├─ Upload "Dashboard / Service Status" (.xls TSV)
  │
  ▼
Parse (tab-split, strip leading ')
  ▼
Build Provider Snapshot #N
  ▼
Diff vs Provider Snapshot #N-1
  ▼
Detect Business Events
  ▼
Apply Synchronization Policy + Pack Mapping
  ▼
────── Review Dashboard ──────
  🟢 5 New subscribers        (click → per-row diff + link/create/ignore)
  🟡 18 Renewals              (click → old→new expiry, charge preview)
  🟣 2 Package changes        (click → old→new pack, adjustment preview)
  🔴 1 Cancellation           (positive evidence only)
  🔵 7 Provider status changes
  🟠 3 New devices in inventory
  ⚠  4 Conflicts (name/mobile drift on operator-owned fields)
  ❓ 2 Unmapped packs         (blocks apply until mapped)
  ⚪ 412 No change
  ▼
Operator approves (all / subset)
  ▼
Apply — per-subscriber transactional
  ▼
Persist ImportRun + per-event ImportEvent rows (for rollback + audit)
```

### 2.2 Event types detected
- `subscriber_new`, `subscriber_terminated` (positive evidence only)
- `subscription_new`, `subscription_renewed` (expiry moved forward, same pack)
- `subscription_pack_changed`
- `provider_status_changed` (ACTIVE / INACTIVE / SUSPENDED)
- `device_new`, `device_returned`
- `field_drift` (shared fields diverging — surfaced, never auto-applied)

### 2.3 Synchronization Policy (per provider, persisted)

Three columns per field: **Provider-owned** (always overwrite), **Operator-owned** (never overwrite, drift shown as info), **Shared** (operator toggles per-provider default; individual conflicts surface in Review).

Default policy for Hathway:
- Provider-owned: `hathway_customer_nbr`, VC/STB serial, provider status, plan name (mapped), plan start/end.
- Operator-owned: notes, credentials, region, collection agent, internal tags, complaint history.
- Shared (default off): subscriber name, mobile, address.

### 2.4 Auto-charge rules

On approved `subscription_renewed` or `subscription_new`:
- Look up mapped local pack → use `packs.price` (your selling price) as the charge amount.
- Create a `transactions` row with `source = 'subscription_charge'`, new `charge_source = 'SYNC_HATHWAY'`, linked to the created/extended subscription and the ImportRun.
- The existing balance recompute trigger takes it from there.

On `subscription_pack_changed`: compute pro-rated delta if remaining days exist; create an adjustment charge with the same `charge_source`.

Never auto-mark as paid. Payments remain operator-collected.

## 3. What we build for BSNL Internet

BSNL FMS/Teevra has no public API and the business model is different (always-on postpaid; you pay BSNL via CSC and forward the invoice). So the sync engine's Hathway shape does **not** translate directly. What we ship for BSNL now:

- **Manual monthly cycle** stays as-is for payments — no auto-import.
- **Reuse from Cable side**:
  - Same **Synchronization Policy** UI, same **ImportRun / ImportEvent** tables, same **Review Dashboard** shell, same **charge_source** enum (add `SYNC_BSNL` value now).
  - Same **Provider Pack Mapping** table (BSNL plans → local packs).
- **BSNL-specific manual entry surface** (Settings → Integrations → BSNL):
  - "Record monthly cycle" form per subscriber (or bulk): plan, billing month, BSNL bill amount (your cost), due date, paid-to-BSNL date, CSC reference.
  - Creates one `provider_cycle` row (new small table) and a local charge using the mapped local pack price. Cost stored for margin analytics (already have `packs.provider_cost`).
- **Optional light importer**: if you later export a CSV from Teevra/FMS by hand, the same pipeline accepts it — the parser is per-provider, the pipeline is shared. Not built this batch beyond a stubbed file picker.

Explicitly **not** shipping for BSNL now: auto-status polling, auto-disconnection tracking, portal scraping.

## 4. Schema additions (new migration)

- `provider_sync_policy(provider_id, field_name, mode)` — modes: `provider_owned | operator_owned | shared_on | shared_off`. Seeded with the Hathway/BSNL defaults above.
- `provider_pack_map(provider_id, provider_pack_key, provider_pack_name, local_pack_id)` — unique on `(provider_id, provider_pack_key)`.
- `provider_snapshot(provider_id, taken_at, source_file_hash, canonical_jsonb)` — one row per successful parse; used as the "yesterday" side of the next diff.
- `import_run(id, provider_id, uploaded_by, uploaded_at, source_file_name, source_file_hash, status, summary_jsonb, approved_at, approved_by)`.
- `import_event(id, run_id, event_type, subscriber_id nullable, provider_row_key, before_jsonb, after_jsonb, plan_action jsonb, apply_status, apply_error, applied_txn_id nullable)`.
- `provider_cycle(id, subscriber_id, provider_id, billing_month, provider_cost, csc_reference, paid_to_provider_at, local_charge_txn_id)` — BSNL manual cycle.
- Enum `charge_source` add `SYNC_HATHWAY`, `SYNC_BSNL` (existing `MANUAL` unchanged); add nullable `charge_source` and `import_run_id` columns to `transactions`.
- New columns on `subscribers` (Hathway snapshot mirror, display-only): `hathway_plan_name`, `hathway_plan_start`, `hathway_plan_end`, `hathway_status`, `hathway_synced_at`. (`hathway_customer_nbr` already exists.)

All tables get RLS + GRANTs per project conventions. `import_event` immutable via trigger except `apply_status`/`apply_error`/`applied_txn_id`.

## 5. Rollback

Each `import_event` stores `before_jsonb` and `applied_txn_id`. "Rollback Import #N" opens a review of the same events in reverse:
- Charges → `void_transaction` with reason `sync_rollback`.
- Subscription creates → cancel with zero refund.
- Subscription renewals → shrink expiry back to `before.end_date`.
- Field updates → restore `before_jsonb` values.
Rollback is itself an approvable plan, not a one-click destructive action.

## 6. UI surface

- **Settings → Integrations → Hathway** (upgrade existing stub):
  - Sync Policy editor (field grid with provider/operator/shared toggles).
  - Pack Mapping table (provider plan name ↔ local pack).
  - "New Sync" wizard: upload Customer Master → upload Dashboard (optional) → Review Dashboard → Approve.
  - Run History (list of ImportRuns with counts, status, "View" and "Rollback").
- **Settings → Integrations → BSNL**:
  - Same Sync Policy + Pack Mapping surfaces.
  - "Record monthly cycle" form (single + bulk).
  - Run History showing manual cycles per month.
- **Subscriber profile → Overview**: read-only "Provider Snapshot" card (per provider) showing plan, expiry, provider status, last synced. Drift on shared fields shows a small "Sync suggestion" chip.
- **Catalog → Packs**: new "Mapped provider packs" column so operators see mapping status alongside price.

## 7. Phasing

- **Phase A (this batch)**: schema migration, Hathway parser (Customer Master + Dashboard), Snapshot store, Diff engine, Review Dashboard, Policy editor, Pack Mapping, Apply with auto-charge, ImportRun/Event, Provider Snapshot card. No rollback UI yet.
- **Phase B**: Rollback UI, drift inbox, BSNL manual cycle form + `provider_cycle` writes, BSNL Pack Mapping.
- **Phase C (deferred)**: BSNL CSV importer if a stable export becomes available; GTPL adapter when needed (reuse pipeline, add parser).

## 8. Explicit non-goals
- No GTPL work (deferred indefinitely per user).
- No scheduled/automatic polling — all syncs operator-initiated via upload.
- No provider-side payment reconciliation (LCO Party Ledger etc.) — deferred until a populated sample exists.
- No mutation of operator-entered fields without explicit shared-field policy opt-in.
- No inferring terminations from absence.

## 9. Open items to confirm before Phase A starts
1. For Hathway Customer Master, is `Account Number` stable across renewals for the same subscriber? (Assumed yes; needed for snapshot keying.)
2. Should the auto-created charge date = provider event date (`Start Date` on the new row) or the sync-apply date? Recommend **provider event date**, source stamped as sync.
3. For BSNL, do you want one `provider_cycle` per subscriber-month, or aggregated by pack? Recommend per-subscriber-month.
