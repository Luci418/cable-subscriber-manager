# Analytics Strategy

> Guiding principle: **every metric must be tied to a decision**. If we cannot
> name the role that uses it and the action it informs, it is a vanity metric
> and does not belong on the dashboard.

This document inventories what is implemented today, what is planned, and the
reason each metric exists. When a metric is added or removed, update this
document.

---

## 1. Audiences and Their Decisions

| Audience | Recurring decisions |
|---|---|
| **Owner** | Where is growth coming from? Which provider is most profitable? Are we losing subscribers? Are collections healthy? |
| **Office staff** | Who is about to expire? Who owes money? Who should be called today? |
| **Collection agents** | Which subscribers in my route have dues? How much did I collect this week? *(planned)* |
| **Technicians** | Which complaints are open and where? *(today via Complaints page)* |

---

## 2. Current Analytics (implemented)

These live in `src/pages/Analytics.tsx`.

### 2.1 KPI summary
- **Total subscribers** — denominator for nearly every other metric.
- **Active subscriptions** — split by service type. Tells the owner the
  *currently paid-for* base, not just the registered base.
- **Outstanding balance** — total debt across all subscribers. Drives
  collection priority.
- **Revenue (period)** — sum of `payment` transactions. Cash actually
  collected, not invoiced.

### 2.2 Time-series
- **Subscribers over time** — net growth signal.
- **Revenue over time** — cash-in trend; surfaces seasonality (festivals,
  monsoon) and the impact of price changes.

### 2.3 Distribution
- **Plan mix** — which packs are popular. Informs catalog pruning.
- **Region distribution** — where the business is concentrated. Drives
  expansion / staffing decisions.

### 2.4 Provider performance (new in v0.9)
- **Active subscribers by provider** — share-of-wallet per upstream source.
- **Revenue by provider** — what each provider contributes; pair with
  upstream cost to compute margin (planned).
- **Outstanding by provider** — exposure per source; helps the owner negotiate
  with upstream when balances are stuck.

### 2.5 Operational lists (drill-down)
- **Expiring soon** (7 / 30 day windows) — work queue for renewals team.
- **Top defaulters** — work queue for collections.

### 2.6 Filters
All charts respect the global filters: **service type**, **provider**,
**region**, **plan**, **time window**. Filters update the URL so views are
shareable.

---

## 3. Planned Analytics (not yet built)

### 3.1 Collection analytics (depends on Phase 2 — `collected_by`, `payment_method`, `collection_route`)
- **Collected per agent per week** — pay/commission, performance reviews.
- **Collection efficiency** — `payments ÷ amount-due-at-start-of-period`.
- **Route heatmap** — geographic clustering of dues.

### 3.2 Lifecycle analytics (depends on Phase 6 — enriched subscription blob)
- **Renewal rate** — `% of expiring subscriptions that renewed within N days`.
- **Voluntary vs involuntary churn** — by `cancelReason`.
- **Average customer lifetime (months)** — for unit-economics decisions.
- **Cohort retention** — by month of acquisition, by acquisition provider.

### 3.3 Provider economics (depends on provider cost tracking)
- **Gross margin per provider** = revenue − upstream cost.
- **ARPU by provider** — pricing power signal.

### 3.4 Inventory analytics
- **STB utilization** — `assigned ÷ total`. Triggers procurement orders.
- **Fault rate** — `faulty ÷ assigned`. Vendor quality signal.

### 3.5 Subscriber health
- **Days-overdue distribution** — who is silently leaving?
- **Service mix per subscriber** — upsell candidates (cable-only with no
  internet).

---

## 4. Metrics Explicitly Rejected

| Metric | Why we don't show it |
|---|---|
| MAU / DAU of *staff* | Operator doesn't care; the system is a tool not a product. |
| Page-view analytics | No business decision attached. |
| NPS-style scores | We have no survey channel; would be noise. |
| Forecasted revenue | Sample size too small for honest forecasts; risks overconfidence. |

---

## 5. Implementation Strategy

### Today
- Analytics is computed **client-side** from the same data the operator screen
  loads. At a few thousand subscribers, this is sub-second.
- Filters and aggregations live in `src/pages/Analytics.tsx`.

### When client-side becomes too slow (>~10k subscribers, or charts taking >1s)
- Move heavy aggregations to **Postgres materialized views** refreshed every
  15 minutes (planned Phase 4 of the roadmap).
- View names should be `mv_<dimension>_<metric>` (e.g.
  `mv_provider_revenue_monthly`) so the source dimension is obvious.

### Avoiding heavy infra
We deliberately do **not** plan to add:
- A separate analytics warehouse (BigQuery, ClickHouse) — overkill at this
  scale and breaks the "free tier" budget.
- A dedicated ETL pipeline — Postgres views are sufficient.
- An event-streaming layer (Kafka, etc.) — the data is naturally batch.

If the operator base ever reaches multi-tenant SaaS scale, see
[FUTURE_EVOLUTION.md](./FUTURE_EVOLUTION.md) for the upgrade path.

---

## 6. Data Integrity for Analytics

Analytics is only as trustworthy as the ledger underneath. The key invariants:

1. **Every charge/payment/refund is recorded as a transaction.** No "ghost"
   balance edits.
2. **Every transaction has a `service_type` and `provider_id`.** Required for
   correct attribution.
3. **Stored balances reconcile with transaction sums** (planned: nightly
   reconciliation report; see BUSINESS_RULES §6.4).
4. **Time uses synchronized server time**, not browser clock, so "active"
   and "expired" are consistent across users.
