
# Fix 5 & Fix 6 — Delivery Plan

Scope is large enough that I'll ship in **four batches**, each independently reviewable. Every batch keeps the app fully functional; no half-migrated states.

---

## Batch A — Server-side pagination foundation (data layer)

Today `AppDataContext` loads **every** subscriber into memory on app load. At scale that's the biggest risk. This batch fixes the plumbing before the UI changes so the redesigned list can plug straight into it.

- Add a new hook `useSubscribersPaged({ search, filters, sort, page, pageSize })` that queries Supabase with `.range()` + `.ilike()` + filter clauses server-side. Returns `{ rows, total, loading }`. Uses the existing `v_subscriber_active_subscription` view join for service badges.
- Keep the existing `useSubscribers` (unpaged) for surfaces that legitimately need the full set: Dashboard KPIs, Analytics aggregates, CSV export, Complaints. Those already aggregate — leaving them unchanged avoids a giant blast radius this batch.
- Add a lightweight `useSubscriberLookup(search)` hook: debounced server-side search returning up to 20 matches, for use inside comboboxes (Complaints "Link Customer", AddTransaction, CollectPayment, etc.).
- Add a `count: 'exact'` query for total row count so the paginator can render "Showing 1–50 of 1,247".

Deliverable: hooks land, no UI wired yet. Zero user-visible change.

---

## Batch B — Customer list redesign (Fix 5 main)

Rebuild `SubscriberList` on the new hook + design system primitives.

Layout:
```text
┌─ Toolbar ──────────────────────────────────────────────────┐
│  [🔍 Search name / mobile / ID ..............]  [+ Add]    │
│  [Service ▾] [Region ▾] [Status ▾] [Balance ▾]  Export ⋯   │
└────────────────────────────────────────────────────────────┘
┌─ DataTable ────────────────────────────────────────────────┐
│ Name • ID       Services   Next action        Balance  ⋯   │
│ Ravi Kumar      Cable      Renew (2d)         ₹350 due     │
│ MAHARAJ-003     Internet                       [Collect]   │
│ ...                                                        │
└────────────────────────────────────────────────────────────┘
     ‹ Prev   Page 3 of 25 (1,247 subscribers)   Next ›
```

- Search input dominant, full-width on mobile, ~60% width desktop. Debounced 250 ms, hits server.
- Filters: **Service** (Cable / Internet / Both), **Region** (populated from `regions`), **Status** (active / prospect / suspended / archived), **Balance** (has dues / has credit / settled). All URL-bound via `useSearchParams` so views are shareable.
- Row uses the existing `financialPosition.ts` chip helper for the next-action label ("Renew in 2 days", "Overdue ₹350", "Settled", etc.).
- Inline row actions:
  - **Collect Payment** button when balance owed > 0
  - **Renew** button when any active subscription expires in ≤ 7 days
  - Three-dot overflow keeps: Edit Identity, Archive, Open Profile, View Ledger
- Row body remains clickable → subscriber profile.
- Pagination controls: 50 per page, prev/next, jump-to-page, total count.
- Empty/loading/error states via the shared `EmptyState` primitive.

Note: card view on mobile keeps the same primary actions inline (no menu-only actions on mobile).

---

## Batch C — Searchable subscriber pickers (dropdowns)

Every place we render a `<Select>` of all customers becomes an async combobox using `useSubscriberLookup`. Targets:

- `Complaints` — the "Link customer" picker
- `AddTransactionDialog` — customer selector when opened generically
- `CollectPaymentDialog` — global open (not per-profile)
- Any Billing worklist "Select customer" surfaces
- Global command palette entry point (if present)

Pattern: shadcn `Command` + `Popover` combobox showing name • ID • mobile, typing hits the server, 20 results max, keyboard-navigable.

---

## Batch D — Analytics + Billing restructure (Fix 6)

**Analytics** (`src/pages/Analytics.tsx`, currently 1,000 lines):

- Top strip: 6 operational KPI cards, all clickable to filtered destinations:
  1. Active Subscribers → `/customers?status=active`
  2. Monthly Collection vs Dues (ratio + rupee)
  3. Collection Rate this month (%)
  4. Expiring in 7 days → `/customers?expiring=7d`
  5. Outstanding Balance total → `/customers?balance=dues`
  6. Average Revenue per Subscriber
- Sticky sub-nav: **Revenue · Subscribers · Collections · Devices**. Anchored scroll + active-section highlight (IntersectionObserver).
- Each section holds its detailed charts; the current arbitrary metric cards (subscriber-age histogram, pack popularity walls, etc.) get folded into their section or dropped if operators don't act on them.
- Split the file: `Analytics.tsx` orchestrator + `analytics/RevenueSection.tsx`, `SubscribersSection.tsx`, `CollectionsSection.tsx`, `DevicesSection.tsx`.

**Billing** (`src/pages/Billing.tsx`):

- "Needs attention today" gets a Service filter chip group: **All / Cable / Internet**.
- Worklist table gets pagination (same paginator component as customer list; reuse `useSubscribersPaged` filtered to `balance=dues`).
- `TodaysCollectionsCard` stays; add the same service filter there for consistency.

---

## Non-goals (explicit)

- No changes to subscription/device business rules.
- No credentials-tab work (queued next).
- Not migrating Dashboard / Complaints list views to paged loads — they aggregate over the full set and current volumes are fine. Revisit when a customer crosses ~5k subscribers.
- No design token changes; reusing the existing primitives (`Toolbar`, `DataTable`, `SectionCard`, `StatCard`, `EmptyState`).

---

## Technical notes

- Pagination uses PostgREST `.range(from, to)` with `{ count: 'exact', head: false }`. Indexes already exist on `user_id`; may add a trigram index on `(name, mobile, subscriber_id)` in Batch A if `ilike` latency shows up in testing.
- Filters compose as chained `.eq()` / `.gt()` / `.or()` — no RPC needed.
- URL state is the source of truth for filters; the hook derives its query key from search params so back/forward navigation restores exact views.
- `financialPosition.ts` next-action derivation runs client-side per row on the current page only (50 rows), so no perf concern.
- Sticky section nav in Analytics uses a small `useActiveSection(ids[])` hook with `IntersectionObserver`, no library.

---

## Review checkpoints

I'll pause for your ack between batches so you can smoke-test on real data before I move on. Batch A → B is the sequence that matters most; C and D are independent and could reorder.
