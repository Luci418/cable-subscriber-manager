# Analytics — YouTube Studio style rebuild

First, the metrics question: nothing was dropped in the tab refactor. Margin (totals, per provider, per pack) is intact on the Revenue tab, along with the service split, distribution pies, aging, growth, top subscribers, top defaulters, and pack/region/provider performance. The problem is density and hierarchy, not missing data.

## The idea

YouTube Studio works because it commits to one hero chart at full width, keeps a small strip of secondary numbers beside it, and pushes everything else into calm, scannable lists below. Nothing competes for attention. We apply the same discipline.

## New Overview (the page you land on)

```text
Analytics                        [service] [period] [compare] [export]

┌────────────────────────────────────────────────────────────┐
│  Revenue collected                              ₹1,24,500   │
│  ▲ 12.4% vs previous 30 days                                │
│                                                             │
│        (full-width area chart, ~360px tall)                 │
│                                                             │
│  [ Revenue ] [ Payments ] [ Charges ] [ New subs ]  <- metric switcher
└────────────────────────────────────────────────────────────┘

┌ Outstanding ₹  ┐┌ Active subs  ┐┌ ARPU ₹      ┐┌ Net margin ₹ ┐
│ ▲2.1%          ││ ▼0.4%        ││ ▲1.8%       ││ ▲3.0%        │
└────────────────┘└──────────────┘└─────────────┘└──────────────┘

Top by revenue        Needs attention        Where money sits
(compact list)        (top defaulters)       (aging bars)
```

- **Hero chart, full width.** One line at a time, chosen by a pill switcher above the chart (Revenue / Payments / Charges / New subscribers). Comparison period renders as a soft dashed line when compare is on. Hover shows a single crosshair tooltip with the value and the compare delta.
- **Secondary KPI row** sits under the chart, not above it — four cards, each with value + delta + sparkline. Clicking a card swaps it into the hero chart.
- **Three ranked lists** below in a 3-up grid: top subscribers by revenue, top defaulters, outstanding-by-age. Each capped at 5 rows with "See more" that jumps to the relevant tab.

## The other tabs

Same shape, so the page always feels like one product:

- **Revenue** — full-width cable vs internet stacked chart as its hero, then Margin (totals band, per-provider table, per-pack table) below, then the distribution pies side by side.
- **Customers** — full-width acquisition vs churn chart, then top subscribers and top defaulters as full tables.
- **Catalog** — no hero chart; pack / region / provider performance tables, each with a horizontal bar rendered inside the row (share-of-total) instead of a separate pie.

Every chart that stays becomes full-bleed inside its card — no more 2-up chart grids, which is what made it feel cramped.

## Design language

- Charts lose the boxed card chrome: no border, just a title row, the number, and the plot on the page background. Grid lines are horizontal only and very low contrast; axis labels drop to muted 11px.
- One accent colour for the active metric (primary), one muted grey for the comparison line, and the semantic success/danger tokens only for deltas. The 8-colour rainbow palette shrinks to a 4-step monochrome ramp of the primary plus the semantic colours where category separation is genuinely needed.
- Numbers use tabular figures everywhere so columns line up.
- Motion: charts animate in once (400ms ease-out draw), metric switching cross-fades the series, tab switches fade content 150ms. Hover states on rows and KPI cards are a background tint only. No bouncing, no staggered card entrances.
- Loading uses skeleton blocks matching the final layout rather than a spinner.
- Mobile: hero chart stays full width at 240px tall, KPI cards go 2-up, the three ranked lists stack.

## Technical notes

- No changes to data fetching or any `useMemo` aggregation in `src/pages/Analytics.tsx` — the same values feed the new layout, so Margin and every existing metric stay wired.
- New `src/components/analytics/HeroChart.tsx` owns the metric switcher, the big number, delta line, and the Recharts area/line surface; it takes `series`, `metrics[]`, and `compare` as props.
- `KpiStrip.tsx` becomes `KpiRow.tsx`: four cards with sparkline (Recharts `<Line>` in a 60x24 container) and an `onSelect` that drives the hero chart.
- `AnalyticsPrimitives.tsx` gains a `ChartFrame` (borderless title + value + children) alongside the existing `AnalyticsCard`, plus a shared `chartTheme` object for axis/grid/tooltip props so every chart looks identical.
- New `RankedList.tsx` for the 3-up overview lists (label, value, optional bar, "see more" footer).
- Colour ramp added as CSS variables in `index.css` (`--chart-1` … `--chart-4`) and consumed via tokens, replacing the hardcoded `COLORS` array.
- `OverviewTab`, `RevenueTab`, `CustomersTab`, `CatalogTab` are rewritten to the new composition; URL tab persistence and CSV export are unchanged.
- Verify with Playwright at 390px and 1440px on all four tabs, plus the existing Vitest suite.
