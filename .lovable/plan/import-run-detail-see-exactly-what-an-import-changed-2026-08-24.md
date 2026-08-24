# Import run detail — see exactly what an import changed

Today a committed import only leaves a one-line summary in Settings → Integrations
("3 charges · 1 new customer"). Everything needed for a per-customer breakdown is
already stored on the run: `results.rows` records one entry per decision with its
outcome, bucket, subscriber, subscription, transaction and the frozen pack snapshot
(name, price, validity) used at commit time. This adds the screen that reads it.

## What gets built

### 1. Recent imports become clickable
In Settings → Integrations, each row in "Recent imports" becomes a link to a new
page. A "View all imports" link is added beneath the list.

### 2. Import history page — `/integrations/hathway/runs`
Full list of runs (not just the latest 10), newest first: file name, date, provider,
row count, status badge (committed / draft / cancelled), and the summary counters.
Draft and cancelled runs are shown too, greyed, so an abandoned review is visible.

### 3. Import run detail page — `/integrations/hathway/runs/:runId`
Header: file name, provider, who committed it and when, parser version, row count.

Summary strip (StatCards, existing component): total charged, charges posted,
customers created, upstream records updated, rows skipped, rows failed.

**Customers affected** — the core of the request. One card per row of
`results.rows`, grouped by outcome so problems surface first:

```text
Failed            rows that errored — reason shown verbatim, needs re-import
Skipped           policy blocked it (e.g. provider forbids creating customers)
New customers     prospects created by this run
Renewals          subscription extended
Plan changes      old subscription cancelled, new one created
New activations   first subscription for an existing customer
Provider data only  no money moved — plan/status mirrored upstream
```

Each customer card shows:
- Customer name + human-readable ID, linking to the profile
  (`/customers/<subscriber_id>`) — same link style Billing uses
- Plain-language description of what happened, e.g.
  "Renewed *HD Value Pack* — 1 month, extended to 30 Sep 2026"
  "Plan changed from *Basic* to *HD Value Pack*"
  "Customer created from report and activated on *HD Value Pack*"
  "Marked active upstream — no charge posted"
- Amount charged, when a charge was posted, with a link to the transaction on the
  customer's ledger tab
- The provider identifiers from the report row (VC id / STB no / account number)
- For failures: the error text and the report row it came from

A search box filters by customer name or identifier; groups collapse (same
pattern as the review screen's `no_change` bucket).

## Data — no schema change needed

Everything comes from two reads:
1. `provider_import_runs` by id — `results`, `snapshot_data`, `file_name`,
   `provider_id`, `committed_at/by`, `parser_version`, `status`.
2. One `subscribers` read for the ids in `results.rows` (name, `subscriber_id`)
   and one `transactions` read for the recorded `transaction_id`s (amount, date).

Rows without a subscriber (skipped/failed) fall back to the report row in
`snapshot_data`, matched on the same key the results use (VC id, else STB no), so
the operator still sees a name and identifiers.

`results.rows[].frozen` already carries pack name, price, validity and provider
cost as of commit time, so the descriptions reflect what was actually charged even
if the pack is later edited — consistent with INV-51.

## Technical notes

- New files: `src/pages/ImportRuns.tsx` (history list),
  `src/pages/ImportRunDetail.tsx`, `src/components/providers/ImportRunRowCard.tsx`,
  and `src/lib/providers/runReport.ts` (pure function turning a run's `results` +
  joined subscribers/transactions into grouped, labelled view rows — unit tested
  the same way `reviewModel.ts` is).
- Routes registered in `src/App.tsx` alongside the existing lazy `ProviderImport`
  route, with the same idle prefetch treatment.
- Permission-gated on `canSyncProvider`, matching the import screen.
- Read-only page: no writes, no RPCs, nothing re-postable from here.
- Reuses `PageHeader`, `SectionCard`, `StatCard`, `EmptyState`, `Money`,
  `Collapsible` — no new UI primitives.
- After a successful commit, the import screen navigates to the new run detail page
  instead of just clearing, so the operator lands on "here's what just happened".

## Out of scope

No re-run/undo of a committed import, no export of the report, no changes to the
commit RPC, parsers, diff engine or resolution layer.
