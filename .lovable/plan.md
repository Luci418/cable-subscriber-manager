# Phase 6.5 — Product Experience Foundation

The current app is a single-page state machine (`Index.tsx` switches views via `useState`) with a modal-heavy interaction model, a legacy blue/slate shadcn theme, and pages that grew independently (`SubscriberDetail.tsx` alone is 1,412 LOC). To carry the domain into technician credentials, provider connectors, field ops, warehouse and asset lifecycle without another rewrite, this sprint rebuilds the foundation in four staged batches. Each batch is shippable and independently reviewable.

## Guiding architectural decisions

**Real routes, not view state.** Replace `useState<View>` in `Index.tsx` with React Router routes under an `AppShell` layout. Enables deep links, browser back/forward, per-entity URLs (`/customers/:id`, `/equipment/:serial`), and lets future modules mount without touching a central switch statement. Fixes discoverability today and is the single biggest unlock for future modules.

**Persistent left rail (desktop) + bottom nav (mobile).** The current top-tab strip runs out of room fast (5 sections already); the reference screenshots use a left rail for the same reason. Left rail scales to 10+ modules, groups related items (Operations / Inventory / Admin), and mirrors Stripe/Linear/Supabase patterns the user cited.

**Pages for viewing, dialogs for acting.** Convert to full pages: Subscriber Detail (already big, gains sub-tabs), Device Detail (new), Provider Detail (new). Keep as dialogs: Add/Edit Subscriber, Collect Payment, Add/Cancel Subscription, Pair/Replace/Unpair Device, Void Transaction, Archive/Reactivate. Rule: anything the operator returns to or shares a link to is a page; anything that mutates and closes is a dialog.

**Customer list overflow menu → inline primary action + overflow for the rest.** The most common action per row (View, or Collect Payment when balance is owed) surfaces as a button; edit/archive/delete stay in overflow. Applies the same rule to every table in the app.

**Subscriber profile becomes a tabbed workspace.** Overview / Subscriptions / Devices / Ledger / Timeline / Credentials (Phase 6 Owner-only). Today's 1,412-line scroll becomes navigable and leaves each tab room to grow (PPPoE, ONU, complaints, field visits land in the right tab without a rewrite).

**Design tokens first, then components.** New neutral palette (warm off-white bg, near-black text, single primary accent, semantic success/warn/destructive tuned for badges), refined type scale, tighter radius, softer shadows. Introduced via `index.css` tokens + a small primitives layer (`PageHeader`, `StatCard`, `DataTable`, `EmptyState`, `SectionCard`, `Toolbar`, `Badge` variants) so future pages inherit look-and-feel free.

## Batch plan

### Batch 1 — Design system + shell (foundation)

- Rewrite `src/index.css` tokens (light + dark) toward a Linear/Stripe register: warmer neutrals, single accent, tuned semantic colors, refined radii/shadows. Keep all existing semantic token names so no component breaks.
- Add typography scale via Tailwind (display, h1–h3, body, mono for IDs). Load one distinctive display + one neutral body (e.g. Instrument Sans + Inter, or similar) via `<link>` in `index.html`.
- New primitives in `src/components/ui-ext/`:
  - `PageHeader` (title, description, breadcrumbs slot, actions slot)
  - `SectionCard` (title + description + optional actions)
  - `StatCard` (label, value, delta, icon)
  - `DataTable` (sticky header, zebra-off, row hover, primary action slot, overflow slot, empty state, loading skeleton)
  - `Toolbar` (search + filters + right actions, responsive collapse)
  - `EmptyState`, `LoadingState`, `ErrorState`
  - `Metric`, `KeyValue`, `Money`, `RelativeDate` display helpers
- New `AppShell` component: left rail (collapsible) + top bar (breadcrumbs, search, user menu) + mobile bottom nav. Nav config is data-driven so new modules register by adding one entry.

### Batch 2 — Routing migration

- Introduce nested routes: `/`, `/customers`, `/customers/:id`, `/customers/:id/:tab`, `/billing`, `/equipment`, `/equipment/:serial`, `/analytics`, `/complaints`, `/settings`, `/settings/:section`.
- Replace `Index.tsx` view-state machine with `<Outlet />` inside `AppShell`.
- Rewrite each page to read/write URL params instead of parent-passed callbacks. Filter state (pack/region/balance) moves to search params so links are shareable.
- Preserve current dialog components; they mount from the pages that own them.

### Batch 3 — Page redesigns

Rebuilt on the primitives from Batch 1:
- **Dashboard** (new home at `/`): 4 KPI cards (customers, MRR, collection rate, overdue), revenue trend, subscription status donut, today's actions (overdue collections, expiring subs, unassigned devices) — designed as slots so provider/network cards drop in later.
- **Customers**: rebuilt `DataTable`, inline "View" primary + overflow menu, sticky toolbar with search + status/region/balance filters bound to URL.
- **Subscriber profile**: tabbed layout (Overview | Subscriptions | Devices | Ledger | Timeline | Credentials). Extract sections from the 1,412-line file into focused sub-components under `src/components/subscriber/`.
- **Billing**: two-column layout — collections queue (overdue/pending/paid) on the left, selected invoice detail on the right at ≥lg; stacked on mobile.
- **Equipment → Assets**: list + detail route. List gets filters (status, type, assigned/unassigned). Detail page has assignment history, current holder, actions.
- **Settings**: sectioned via sub-routes (`/settings/profile`, `/settings/business`, `/settings/services`, `/settings/roles`, `/settings/notifications`, `/settings/security`) with a secondary nav.

### Batch 4 — Polish + documentation

- Consistency pass: badge variants, empty states, loading skeletons on every list.
- Keyboard: `/` focuses global search, `g c` goes to customers, `g b` billing, etc. (Linear-style; low cost once shell exists).
- Update `docs/OPERATOR_WORKFLOW_UI_REVIEW.md` and create `docs/DESIGN_SYSTEM.md` documenting tokens, primitives, and page-vs-dialog rules.
- Update `docs/PROJECT_STATUS.md` marking Phase 6.5 foundation complete.

## Explicitly out of scope (per prompt)

Technician credentials encryption (Batch C from prior sprint), GTPL/provider connectors, warehouse, complaints redesign, field ops, GIS, network mgmt, new business features. The layouts leave slots for these but no functionality is implemented.

## Risk & sequencing

- Batches 1 and 2 change infrastructure but preserve every existing feature; they can ship together safely.
- Batch 3 is where the visible product changes; risk is per-page and reviewable independently.
- I'll run a build after each batch and eyeball the preview via Playwright before moving on.

## Approval question

This is a large sprint (~2–3 batches worth of edits per turn). Two options:

1. **Ship in sequence, one batch per turn**, so you can review after each. Recommended.
2. **Ship all four batches back-to-back** in this thread; faster, less reviewable.

Confirm which, and I'll start with Batch 1 (design system + shell).
