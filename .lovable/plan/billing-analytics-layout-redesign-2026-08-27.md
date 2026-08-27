# Billing & Analytics — layout redesign

Both pages are single long scrolls today. Billing stacks 4 stat cards, Today's Collections, "Needs attention", the full service-line table and Recent Voids one after another (534 lines). Analytics stacks a filter bar, 6 KPI cards, a 5-tab chart block, and then six more full-width tables plus a Margin section that are always rendered (1274 lines). The fix is the same in both: split content into tabs so only one working surface is on screen, and move the big blocks into their own component files.

## Billing

Turn the page into three tabs under a compact header.

```text
Billing                                   [service filter] [search]
┌ Due today  ₹x ┐┌ Collected ₹x ┐┌ Expiring 7d ┐┌ Active lines ┐   (compact strip, 4 across)
[ Worklist ] [ Collections ] [ Activity ]
```

- **Worklist** (default) — "Needs attention today" and the full service-line table, with the table's status filter chips inline in a single toolbar row instead of separate controls.
- **Collections** — Today's Collections card, given full width now that it isn't squeezed between other sections.
- **Activity** — Recent Voids plus the day's recorded payments.

Stat cards shrink to a compact one-line strip (label + value) so they cost ~90px instead of a full card grid. The active tab is remembered in the URL (`?tab=`) alongside the existing service/status/search params, so links and refreshes land in the same place.

## Analytics

Group the twelve blocks into four tabs, all sharing the existing period/service/compare filter bar and KPI strip.

```text
Analytics             [service] [period presets] [custom] [compare] [export]
┌ KPI strip: 6 metrics, compact ┐
[ Overview ] [ Revenue ] [ Customers ] [ Catalog ]
```

- **Overview** — revenue-over-time chart + outstanding aging, side by side on desktop.
- **Revenue** — cable vs internet split, distribution pies, and the Margin section.
- **Customers** — subscriber growth (acquisition vs churn), Top Subscribers, Top Defaulters.
- **Catalog** — Pack, Region and Provider performance tables.

Tables inside tabs get a "show top 10 / show all" toggle so a 60-row pack table doesn't force scrolling; CSV export still exports everything. Tab choice persists in the URL.

## Technical notes

- New folder `src/components/billing/` with `BillingStatsStrip.tsx`, `NeedsAttentionSection.tsx`, `ServiceLinesTable.tsx`, `RecordPaymentDialog.tsx`. `src/pages/Billing.tsx` keeps data derivation + handlers and renders the tabs.
- New folder `src/components/analytics/` with `AnalyticsFilterBar.tsx`, `KpiStrip.tsx`, `OverviewTab.tsx`, `RevenueTab.tsx`, `CustomersTab.tsx`, `CatalogTab.tsx`, and the existing `KpiCard` / `DistroPie` moved into `AnalyticsPrimitives.tsx`. All `useMemo` computations stay in `Analytics.tsx` and are passed down as props — no data-fetching or calculation changes.
- Tab content mounts on demand (Radix `Tabs` default), so inactive Recharts containers are no longer in the DOM; this also removes the current cost of rendering every chart on load.
- Reuse existing `ui-ext` primitives (`SectionCard`, `DataTable`, `Toolbar`, `StatCard`) and the calm dot-status language already applied in these pages. No color or business-logic changes.
- Verify with a Playwright pass over `/billing` and `/analytics` at mobile and desktop widths, plus the existing Vitest suite.
