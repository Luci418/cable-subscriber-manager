# Provider Synchronization Engine — Design Verification & Implementation Plan

> **Status:** Plan only (2026-07-30). No schema or code shipped yet.
> Scope: reactive snapshot sync **from** the provider's exported reports
> into the SMS. Hathway is the only provider in scope; the parser is
> provider-specific, everything else is keyed by `provider_id`.
> Supersedes the "write-through / Mode A first" framing in
> `.lovable/plan.md` §4 — the operator provisions on the provider portal,
> the SMS reconciles afterwards.

---

## Part 1 — Design verification against the existing schema

Verified against the live database on 2026-07-30. The proposed spec is
sound in shape, but **four items duplicate concepts that already exist**
and must be reused instead of re-created.

### 1.1 Corrections to the proposed design

| Proposed | Reality in the schema | Decision |
|---|---|---|
| `ALTER TABLE transactions ADD COLUMN charge_source text` + `ALTER TYPE charge_source ADD VALUE 'SYNC_HATHWAY'` | Neither the column nor the type exists. `transactions.source` already exists, typed `transaction_source` (`manual_charge`, `manual_payment`, `subscription_charge`, `subscription_refund`, `reversal`, `adjustment`, `subscription_payment`, `opening_balance`). This *is* the charge-source concept. | **Reuse `transactions.source`.** Add one enum value: `provider_sync` — provider-generic, not vendor-named. `transactions.provider_id` already carries which provider it came from. No new column, no `charge_source` type. |
| `provider_snapshots` + `provider_sync_log` as two tables | Strictly 1:1 — every run writes exactly one snapshot and exactly one log row, including the dashboard-status import. Two tables means two inserts, two RLS policy sets, and a foreign key for no gain. | **One table: `provider_import_runs`** holding `snapshot_data`, `events_detected`, `results`, `row_count`, `status`. "Latest baseline for a provider + report type" is `ORDER BY imported_at DESC LIMIT 1 WHERE status='committed'`. |
| `provider_sync_policies` table | The row is 1:1 with `providers` and holds nothing but booleans. A table whose primary key is effectively `provider_id` is a column set in disguise. | **Add `providers.sync_policy jsonb NOT NULL DEFAULT` …** with the same eight flags. Extends an existing table; a new provider gets working defaults with zero rows to seed. |
| New vendor columns for VC id | `stb_inventory` already has `serial_number` (unique per `user_id`), `mac_address`, `device_type`, `service_type`. In both Hathway samples **VC Id == New STB No**, but that is not guaranteed for every box type. | **Extend `stb_inventory` with a nullable `vc_id text`** + unique index on `(user_id, vc_id)`. Match order: `vc_id` → `serial_number`. No new device table. |

### 1.2 Proposed items that are genuinely new — keep

- **`provider_pack_mappings`** — nothing today maps a provider plan
  string to a local pack. `packs.provider_id` and `packs.provider_cost`
  exist but carry no upstream plan name. New table, provider-scoped.
- **`subscriber_provider_state`** — `subscribers.cable_provider_id` /
  `internet_provider_id` record *which* provider serves a subscriber, but
  there is nowhere to hold upstream plan name / window / status. New
  table, one row per `(subscriber, provider)`.
- **`provider_import_runs`** — no equivalent exists.

### 1.3 Reused as-is (do not duplicate)

| Existing | Used for |
|---|---|
| `providers` | Provider identity + (new) `sync_policy`. |
| `packs.provider_cost` | Wholesale cost. **Operator-maintained**: entered from the known wholesale rate and updated when the provider's rate changes. DPO Total Price is informational only — pre-filled as an *unverified suggestion*, never auto-assigned. |
| `transactions` (`source`, `provider_id`, `subscription_id`, immutability + FIFO triggers) | Every sync-created charge. No parallel ledger. |
| `stb_inventory` | Device ↔ subscriber resolution. |
| `subscribers.hathway_customer_nbr` | **Legacy read path.** Kept, not removed, not double-written this batch. New writes go to `subscriber_provider_state.provider_customer_number`. A backfill + drop is a later batch. |
| `subscribers.customer_status = 'prospect'` | "Create new" from `needs_review`. |
| `has_role` + `can_*` security-definer pattern | New `can_sync_provider(_uid)` → owner, admin_office only. |

### 1.4 Business rules confirmed and carried into the plan

1. **Absence is never termination.** Only an explicit non-`ACTIVE`
   `service_status` counts as evidence. Missing rows only age
   `last_seen_in_snapshot_at`; 14+ days stale surfaces as an
   informational "not seen recently" list.
2. **Mobile is never an auto-match** (BUSINESS_RULES §1.1 — households
   share numbers). A mobile hit is a *suggested candidate* inside
   `needs_review` requiring explicit operator confirmation.
3. **Charge amount is always the local catalog price** (operator-editable
   on the review screen), never `dpo_total_price`.
4. **Per-row partial success.** One bad row never blocks the run.
5. **The sample export is genuine data, not a demo.** Hathway
   bulk-allocated 400 STBs under a promotional arrangement (month 1 free,
   operator pays month 2, month 3 free), uploaded under the operator's own
   name as a placeholder; real names/addresses/mobiles fill in as boxes get
   assigned. Do **not** discard it as synthetic — but its current
   one-or-two-distinct-names shape is *not* steady state. Phase 2/3
   fixtures must not overfit to "every row has the same customer name".

### 1.5 Design decisions locked in (2026-07-31)

**A. `subscriber_provider_state` is the long-term model, deliberately.**
It generalises past the `subscribers.cable_provider_id` /
`internet_provider_id` column pair, which only works because there happen to
be exactly two service types today. One row per subscriber × provider scales
to any provider count with no further schema change.

**B. `providers.sync_policy jsonb` — eight fixed booleans, one hard rule.**
No independent lifecycle, so no table. But `sync_policy` may only be read
through a `getSyncPolicy(provider)` helper that merges the stored JSON over
the **current defaults**. Direct `sync_policy.<key>` access is forbidden
anywhere in the codebase. A missing key takes its documented default, never
`false`/`undefined` — otherwise a future ninth flag silently disables itself
for every existing provider row. (INV-50)

**C. Idempotency is an explicit guarantee, not an emergent property.**
- A charge is only ever created as part of **committing** a
  `provider_import_run`.
- A run is only ever diffed against the most recent **committed** run for
  that `(provider_id, report_type)`.
- Therefore re-uploading an already-committed file always diffs to 100%
  `no_change` and creates zero transactions.
- Corollary: a cancelled review (never approved) leaves **no baseline**.
  Cancelling and re-uploading the same or a newer file must not cause any
  event to be silently treated as already-synced. (INV-48)

**D. Synchronization is an operator-approved reconciliation process**
(upload → review → approve), **not** continuous or automatic replication.
Nothing is written before Approve; no scheduled or background imports exist.

**E. Ledger authority.** Provider reports are evidence that a business event
occurred upstream, never the ledger itself. Sync never edits, deletes or
rewrites an existing transaction; it creates new business events or flags
discrepancies. Corrections are explicit operator actions (adjustment,
reversal, reconciliation). (INV-46, INV-47)

**F. Identity ownership.** Sync never changes subscriber identity fields
(name, address, mobile, GST, notes, billing preferences) unless the operator
has explicitly enabled that field in `sync_policy`. Defaults deny. (INV-49)

**G. `provider_status` stores the raw provider string, always.** Business
logic derives `is_active = (raw === 'ACTIVE')` separately. Unrecognised
values are never discarded, normalised, or bucketed — they are shown to the
operator verbatim. Only `ACTIVE` is verified from the sample (400/400 rows);
Hathway's full status vocabulary is unknown, so **no list of inactive states
is hardcoded**.

**H. Canonical subscriber match order.**
1. `vc_id` (exact)
2. `serial_number` (exact)
3. `subscribers.hathway_customer_nbr` vs. the report's `account_number`
   (exact) — the column exists for exactly this purpose, from 6.5-M
4. mobile → *suggested candidate only*, surfaced in review, never auto-applied
5. otherwise → `needs_review`

Defensive rule: if the `vc_id` match and the `serial_number` match resolve to
**two different existing subscribers**, do not silently pick one — surface it
as a **conflict** inside `needs_review`.


---

## Part 2 — Phased implementation

Each phase is independently shippable and verifiable. Do not start a
phase before its predecessor is green.

### Phase 1 — Schema foundation
- Migration: `provider_import_runs`, `provider_pack_mappings`,
  `subscriber_provider_state`; `providers.sync_policy jsonb`;
  `stb_inventory.vc_id`; enum value `provider_sync` on
  `transaction_source`.
- GRANTs + RLS (`user_id = auth.uid()`) on every new table, `service_role`
  included; immutability trigger on `provider_import_runs` results.
- `can_sync_provider(_uid)` security-definer (owner, admin_office).
- **Done when:** migration applied, pgTAP asserts RLS isolation + role gate.

### Phase 2 — Parser + canonical model (pure, no DB)
- `src/lib/providers/hathway/parseCustomerMaster.ts`,
  `parseDashboardStatus.ts`: TSV split on `\t`, strip leading `'`,
  `DD-MON-YYYY` → ISO, numeric coercion.
- Canonical row type shared by both reports.
- **Done when:** Vitest suites cover both sample files, malformed rows,
  and quoting/whitespace edge cases.

### Phase 3 — Diff engine (pure)
- `detectEvents(previousSnapshot, currentRows)` →
  `new_activation | renewal | plan_change | status_change | no_change`,
  keyed on `vc_id`; no-previous-snapshot ⇒ all `new_activation`.
- Stale-row detection (`last_seen_in_snapshot_at` ≥ 14 days).
- **Done when:** Vitest covers every transition plus the
  "absence ≠ termination" rule.

### Phase 4 — Resolution layer
- Pack resolution via `provider_pack_mappings` → `unmapped_pack`.
- Subscriber resolution `vc_id`/serial → `stb_inventory` → subscriber;
  otherwise `needs_review` with an optional suggested mobile candidate.
- Sync-policy filter applied before anything is proposed as a write.
- **Done when:** Vitest covers matched / unmapped / needs_review /
  policy-suppressed paths.

### Phase 5 — Review screen
- Upload → parse → diff → bucketed review UI with counts, drill-downs,
  editable charge amounts, "Total charges to post", Approve / Cancel.
- Drill-downs: renewal, `needs_review` (link / create prospect / ignore),
  `unmapped_pack` (selling price + pre-filled unverified provider cost).
- Nothing is written before Approve.
- **Done when:** an operator can dry-run the sample file end-to-end and
  cancel with zero DB writes.

### Phase 6 — Commit
- `commit_provider_import(...)` RPC, per-row transactional:
  upsert `subscriber_provider_state`; insert charge
  (`source='provider_sync'`, `provider_id`, `service_type='cable'`);
  create pack rows for newly mapped plans; status-only rows write no
  transaction; `needs_review → create new` creates a `prospect`
  (no auto-pairing).
- Writes `provider_import_runs` with per-row results and becomes the new
  baseline.
- **Done when:** pgTAP proves role gating, per-row partial success, and
  that a re-run of the same file produces `no_change`.

### Phase 7 — Dashboard Status import
- Separate picker, no review screen. Match by `vc_id`, update
  `provider_status` + `last_seen_in_snapshot_at`, plain
  updated/not-found/skipped summary, logged as its own run.

### Phase 8 — Settings → Integrations
- Per-provider: Pack Mappings CRUD (auto-populated from review screen),
  Sync Policy checkboxes, run history. Gated on `can_sync_provider`.

### Phase 9 — Docs & tests
- Update `PROVIDER_INTEGRATION_ARCHITECTURE.md`, `SYSTEM_INVARIANTS.md`
  (new invariants for absence≠termination and catalog-price charging),
  `BUSINESS_RULES.md`, `CHANGELOG.md`, and correct the Mode-A framing in
  `.lovable/plan.md`.

---

## Part 3 — Explicitly out of scope

Write-through / portal automation / deep-links; provider billing and
settlement tracking (`provider_bill`); scheduled or automated imports;
customer notifications on import events; multi-file batch upload;
any second provider adapter.

## Part 4 — Open questions for the operator

1. Is the sample export demo data or a genuine bulk/reseller account?
2. A recent settlement statement / invoice — needed to set real
   `provider_cost` and to define what financial reconciliation compares.
3. Does VC Id ever differ from STB No on this account's box types?
4. Exact vocabulary of `Service Status` values in Dashboard Data.
