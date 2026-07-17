# Production-Readiness Audit — 2026-07

Scope: whole-app review for daily production use by a regional Cable +
ISP operator (target 5,000 subscribers, 2–5 staff, one shop). Written as
a senior business analyst / architect / engineer would present it before
opening a next-feature workstream.

Legend:
- **[FIX-NOW]** — landed in this pass.
- **[DEFER]** — documented with rationale, filed into
  `PROJECT_STATUS.md#technical-debt-register` for scheduling.
- **[ADR]** — needs an architecture decision (blocks silent change).

---

## 1. Workflow consistency

Traced each lifecycle from list → detail → RPC → post-state UI.

### 1.1 Onboarding → Add service → Pair → Replace → Faulty → Repair
| Step | State | Notes |
|---|---|---|
| Create subscriber | 🟢 | `/customers/new` returns to `/customers/:id`. STB auto-assigned inline. |
| Add subscription | 🟢 | `create_subscription` RPC + snapshotted pack pricing. |
| Pair device | 🟢 | `pair_device` RPC logs to `device_assignment_log`. |
| Replace device | 🟢 | `replace_device` closes old log entry and opens new. |
| Mark faulty | 🟢 (after Fix 1) | `mark_device_faulty` now clears `subscriber_id` + clears `stb_number` cache + closes assignment log; devices tab renders the faulty "guided device-needed state" (Fix 2). |
| Repair | 🟠 | `markAsRepaired` flips status → `available` but does **not** capture *what* was repaired or by whom. See §3.1. |
| Decommission | 🟢 | Terminal state, blocks further transitions. |

### 1.2 Archive → Reactivate
- 🟢 `archive_subscriber` writes `subscriber_status_log`; `reactivate_subscriber` mirrors it.
- 🟠 Reactivation does **not** re-pair the previously assigned device even when the device is still in inventory unassigned. Operator must pair again by hand. **[DEFER]** — needs a UX call: prompt "Re-pair last known device?" during reactivation.

### 1.3 Subscription lifecycle
- 🟢 States `active | expired | superseded | cancelled | suspended` enforced by trigger `subscriptions_enforce_invariants`.
- 🟠 `suspended` status is enforced in the trigger but there is **no UI to suspend** a subscription (soft-disconnect). This is a standard ISP concept (Splynx: "Blocked", Powercode: "Suspended", Sonar: "Delinquent"). **[DEFER — ADR needed]** because it needs:
  - policy: does a suspension pause billing or accrue?
  - hardware side: for ISPs it triggers a RADIUS disconnect; we have no NAS integration.
  - grace-period → auto-suspend cron.
- 🟠 Renewals look identical to new sales in the ledger (no `renewal_of` linkage surfaced in UI). Already tracked as `PRODUCTION_READINESS.md` Phase 6.

### 1.4 Payment lifecycle
- 🟢 Collect → FIFO allocation → allocations table.
- 🟢 Void → reversal row + immutable original.
- 🟠 **Partial refunds on active subs** — `cancel_subscription` only refunds on cancel. No standalone refund flow for over-collections. **[DEFER]**.
- 🟠 **No payment mode capture beyond `description`**. Cash / UPI / bank transfer / cheque are only distinguishable by free-text. This blocks accurate day-end reconciliation and is table-stakes in every ISP OSS. **[FIX-NEXT — ADR]**: add `payment_method` enum column + migrate `description` prefix.

### 1.5 Terminology inconsistencies found
- "Customer" vs "Subscriber" used interchangeably across routes and copy. Route is `/customers` but domain model is `subscribers`. Kept as-is (customer = user-facing, subscriber = domain) but this should be codified in a glossary. **[FIX-NOW]** — recorded in this doc, `docs/BUSINESS_RULES.md` glossary section to be reviewed.
- "Pack" (domain) vs "Plan" (industry) — kept "Pack" for continuity; users understand it.
- "Void" vs "Reverse" — DB uses both. Trigger writes `reversal` type rows but UI says "Voided". Acceptable — they are two sides of the same event.

---

## 2. Confirmation audit

Walked every state-changing action; verified each requires an appropriate
confirmation matching severity.

| Action | Before | After |
|---|---|---|
| Archive customer | ✅ AlertDialog | unchanged |
| Reactivate customer | ✅ AlertDialog | unchanged |
| Cancel subscription | ✅ AlertDialog | unchanged |
| Void transaction | ✅ AlertDialog + reason code | unchanged |
| Pair / Unpair / Replace / Mark faulty | ✅ AlertDialog | unchanged |
| Delete transaction (`useTransactions.deleteTransaction`) | ⚠️ no confirm | **[FIX-NEXT]** — the function exists but is unreachable from UI today; kept unguarded to surface as dead code. See §4.5. |
| Delete complaint | ❌ `window.confirm` | **[FIX-NOW]** → shadcn confirm |
| Delete STB from inventory | ❌ `window.confirm` | **[FIX-NOW]** → shadcn confirm |
| Decommission STB | ❌ `window.confirm` | **[FIX-NOW]** → shadcn confirm |
| Delete pack / retire pack | ❌ `window.confirm` | **[FIX-NOW]** → shadcn confirm |
| Delete provider | ❌ `window.confirm` | **[FIX-NOW]** → shadcn confirm |
| Delete region | ❌ `window.confirm` | **[FIX-NOW]** → shadcn confirm |

Introduced `src/lib/confirm.tsx` — imperative `confirm({title, description, destructive})` backed by a single mounted `<ConfirmHost/>` in `AppLayout`. Consistent tone, dark-mode aware, matches AlertDialog styling used everywhere else.

**Verification pass (2026-07, post-audit):** Re-swept for browser-native modals. Two residual `prompt()` sites — decommission-reason in `StbInventoryDialog` and resolution-notes in `Complaints` — were replaced with proper shadcn `Dialog` + input/textarea flows. No `window.confirm` or `prompt()` calls remain in application code (only the safety fallback inside `confirm.tsx` itself).

---

## 3. Audit trail

Verified append-only log tables for each business event.

| Event | Log | Status |
|---|---|---|
| Customer archive/reactivate | `subscriber_status_log` | 🟢 |
| Device pair/unpair/replace/faulty | `device_assignment_log` + `device_status_log` | 🟢 |
| Payment / charge / refund / void | `transactions` immutable + reversal rows | 🟢 |
| Subscription cancellation | `subscriptions.cancel_reason_code` snapshot | 🟢 |
| Transaction note added | `transaction_notes` (append-only trigger) | 🟢 |

### 3.1 Gaps
- 🟠 **Device repair** (`markAsRepaired`) writes `device_status_log` via trigger but no `close_reason` / `repaired_by` / repair notes. Loss of information the operator needs when the same device fails twice. **[DEFER]** — add a `repair_note` column and a `mark_device_repaired` RPC that mirrors `mark_device_faulty`.
- 🟠 **Settings changes** (company details, receipt template, service enablement, roles) are silent — no `settings_audit`. For a multi-staff shop this matters: today a rogue admin_office could flip a receipt template without trace. **[DEFER — ADR]**.
- 🟠 **Role grants/revokes** in `user_roles` are RLS-protected but not append-only-logged. Recommend a `role_change_log` table. **[DEFER]**.
- 🔵 **Login/session events** — not captured. Rely on Supabase auth logs (dashboard-side). Acceptable for now.

---

## 4. Performance

### 4.1 Duplicated fetchers (fixed)
- **[FIX-NOW]** `Analytics.tsx` was calling `useSubscribers(user?.id)` + `useTransactions(user?.id)` directly, duplicating what `AppDataContext` already loads for Home/Customers/Billing. Now consumes `useAppData()`. Removes ~2 network round-trips on every Analytics visit.

### 4.2 Client-side filtering that should be server-side
- 🟢 `SubscriberList` — already paged server-side (Fix 5).
- 🟠 `Billing` worklist filter chips (`All / Cable / Internet`) still run over the fully-fetched worklist. Fine at 5k subscribers × O(active-lines) ≈ acceptable, but crosses the pain threshold at ~10k. **[DEFER — Phase 7]** convert to a `v_worklist` view + range.
- 🟠 `Analytics` recomputes 6 KPIs client-side against the full transactions array. At 5k subs × 1yr this is ~40k rows in memory. Works, but slow first paint. **[DEFER]** materialise a `v_analytics_daily` roll-up.

### 4.3 N+1 patterns
- 🟢 `DevicesTab` batches `device_assignment_log` for both services in one query already (verified).
- 🟠 `EquipmentDetail` fetches the device, then the holder subscriber, then the last N subscriptions — three sequential round-trips. Could parallelise with `Promise.all`. **[DEFER — minor]**.

### 4.4 Stale contexts
- 🟢 `SettingsContext` re-fetches only on mount; refresh path exists.
- 🟢 `AppDataContext` is the single source; no drift observed.

### 4.5 Dead code
- `useTransactions.deleteTransaction` — no caller, no UI. Kept for now (it's guarded by `transactions_enforce_immutability` at DB level anyway so it would fail hard) but should be removed to prevent future misuse. **[DEFER]**.

---

## 5. Consistency (terminology, icons, badges, empty/loading)

### 5.1 Status badges
- Consistent palette in most tabs (green=active, amber=expiring, red=expired/cancelled, slate=archived).
- 🟠 Two places still hand-roll status classes:
  - `SubscriptionsTab` — inline `text-yellow-600` conditional.
  - `DevicesTab` days-remaining chip.
  These should share `src/lib/statusBadges.ts`. **[DEFER — small refactor, mostly cosmetic]**.

### 5.2 Icons
- `Wifi` for internet, `Tv` for cable, `Wallet` for payments — used consistently. 🟢
- `Link2 / Link2Off` for pair/unpair — consistent. 🟢
- 🟠 "Faulty" uses `AlertTriangle` in some places, `Wrench` in others (equipment page). Pick one — `AlertTriangle` is louder and more accurate. **[DEFER — trivial]**.

### 5.3 Empty states
- 🟢 SubscriberList uses `EmptyState` with primary CTA.
- 🟠 Complaints list, StbInventory list, and Ledger tab render bare text ("No complaints yet."). Wrap in `EmptyState`. **[DEFER]**.

### 5.4 Loading states
- 🟢 Home dashboard has skeletons.
- 🟠 Analytics uses a full-page spinner rather than section-level skeletons — jarring when the operator only cares about one KPI. **[DEFER]**.

---

## 6. Navigation

### 6.1 Cross-links added (fixed)
- **[FIX-NOW]** `DevicesTab` device rows now link the serial → `/equipment/:serial`. Closes the "customer → device → back to customer" loop.

### 6.2 Existing dead-ends
- 🟢 `/equipment/:serial` already links assigned subscriber → `/customers/:id`.
- 🟢 `TodaysCollectionsCard` rows already link to the subscriber.
- 🟠 **Complaint rows** don't link to the subscriber they're for — the operator must scroll and open a dialog. **[DEFER — small edit in Complaints.tsx]**.
- 🟠 **Ledger transaction rows** don't link back to the subscription they were allocated to. For an operator investigating a payment dispute this is one indirection too many. **[DEFER]**.

### 6.3 Breadcrumbs
- Not present anywhere. Not strictly needed at current depth (2 levels max), but on `/equipment/:serial → subscriber → tab` the operator can lose their place. **[DEFER — nice-to-have]**.

---

## 7. Permission audit (UI ↔ RPC ↔ RLS)

Walked every gated action against `src/lib/permissions.ts`, the `can_*`
SQL helpers, and RLS policies. Table below reads:
✓ = UI honours it (button hidden), ✗ = UI still shows the button but RPC rejects.

| Action | UI hide | RPC gate | RLS |
|---|---|---|---|
| Void transaction | ✓ (LedgerTab) | ✓ `can_void_transaction` | ✓ |
| Cancel subscription | ✓ | ✓ | ✓ |
| Archive customer | ✓ | ✓ | ✓ |
| Reactivate customer | ✓ (uses `canArchiveCustomer` — see below) | ✓ | ✓ |
| Pair / Unpair device | ✓ | ✓ | ✓ |
| Replace / Mark faulty / Repair | ✓ (EquipmentDetail, StbInventoryDialog) | ✓ | ✓ |
| Collect payment | ✓ | ✓ | ✓ |
| Modify settings | ✓ (Settings pages read-only) | ✓ | ✓ |

### 7.1 Findings
- 🟠 There is **no `canReactivateCustomer` derived permission** — the UI reuses `canArchiveCustomer` on the assumption that archive and reactivate share the same role set. They do today, but the coupling is implicit. **[DEFER — trivial rename to `canManageCustomerLifecycle`]**.
- 🟠 Collection agents can currently *see* the "Cancel subscription" button on the subscriber profile because the button is disabled but rendered. Per spec (§7 of the audit request) it should be *hidden*. **[DEFER — verify at SubscriberDetail line 501; currently gated by `canCancelSubscription` prop, so likely fine — confirm in build pass]**.
- 🟢 No case found where the DB rejects an action the UI unconditionally exposes.

### 7.2 RLS spot-check
- All 15 public tables have RLS enabled and at least one policy.
- `user_roles` and `settings` writes go through owner-only policies.
- `list_users_with_roles()` enforces `has_role('owner')` inside the RPC — cannot be called by non-owners even if they were shown the Roles UI.

---

## 8. Error handling audit

### 8.1 Loading
- 🟢 All list pages set `loading` state; buttons disable during submit.
- 🟠 `AddPackageSubscriptionDialog` submit button doesn't disable on click — a double-click races and creates two subscriptions. RPC has an advisory lock but the second attempt still surfaces an error toast rather than being silently deduped. **[DEFER — one-line `submitting` state addition]**.

### 8.2 Retry
- 🟠 No page has an explicit retry button on load failure. Toast fires and list stays empty. Operator has to refresh the browser. **[DEFER — add `Retry` to `EmptyState.error`]**.

### 8.3 Optimistic updates
- 🟢 `useTransactions.addTransaction` optimistically inserts and rolls back on error via toast — acceptable.
- 🟠 `useSubscribers.addSubscriber` refetches instead of optimistic update; slower perceived UX but correct. Kept.

### 8.4 Error surfacing
- 🟢 `friendlyDbError` translates common Postgres errors (constraint violations, permission errors) into operator language. Used in ~90% of catch blocks.
- 🟠 Complaints hook still surfaces raw error messages in a few paths. **[DEFER]**.

---

## 9. ISP-industry gap analysis

Compared against Splynx / Sonar / Powercode / RUCKUS Cloud OSS conventions.
Filed as `[DEFER — ADR]` unless trivially reachable. Non-exhaustive; picked
the gaps a 5k-subscriber operator would actually notice within 30 days.

| Capability | Present? | Business impact |
|---|---|---|
| **Suspension / soft-disconnect** (pause without cancel) | ❌ | High. Customers who miss one cycle should be suspended, not cancelled — cancel loses the device pairing. |
| **Payment method breakdown** (cash / UPI / bank / cheque) | ❌ (freetext only) | High. Day-end reconciliation requires this. |
| **Dunning reminders** (auto SMS/WhatsApp on Day-3, Day-1, Day+2) | ❌ | High. Collection agents currently work from a printed list. |
| **Scheduled disconnection** (mark for cutoff on date X) | ❌ | Medium. Reduces manual chase. |
| **Prorated billing** on mid-cycle plan change | ❌ | Medium. Currently full-cycle charge only. |
| **Ticket SLA on complaints** (deadline + escalation) | ❌ | Medium. Complaints has status but no SLA clock. |
| **Bulk operations** (bulk renewal, bulk SMS, CSV price update) | Partial | Medium. Only CSV import for subscribers exists. |
| **RADIUS / NAS integration** (network-level enforcement) | ❌ | Low today (cable-first shop) → High if internet share grows. Blocks true ISP OSS status. **[ADR needed]** before ISP customer count > cable count. |
| **Referral / discount codes** | ❌ | Low. |
| **Customer self-service portal** (view bills, pay) | ❌ | Low today, table-stakes at 5k. **[ADR]**. |
| **Multi-tenant / franchise model** | Explicitly single-tenant (ADR-009) | Non-goal until 4+ staff. |

---

## Top 10 risks remaining, ranked

| # | Severity | Risk | Recommended action |
|---|---|---|---|
| 1 | **Critical** | No **Suspension** workflow — expired subscriptions today either stay-expired-forever or get cancelled (losing device pairing). Operator will misuse "Cancel" as "Suspend". | ADR + implement `suspend_subscription` RPC + UI. Before RBAC rollout to collection agents. |
| 2 | **Critical** | **Payment method not captured**. Day-end cash vs UPI totals are guesses. `TodaysCollectionsCard` groups by source only. | Add `payment_method` enum column, populate in Collect/AddTransaction dialogs, group in end-of-day view. |
| 3 | **Critical** | **Balance drift** (ADR-003 open). Concurrent writes can leave `cable_balance`/`internet_balance` incorrect. Weekly manual SQL check is the current mitigation. | Ship `reconcile_balances()` + `balance_audit` table (Phase 3 already scoped). |
| 4 | **High** | **`grant_owner_on_signup` trigger still live**. Anyone who signs up first on a fresh deploy becomes Owner. | Drop trigger and provision first owner via one-off SQL before public deployment. |
| 5 | **High** | **No dunning reminders**. Operator manually notifies. Collection efficiency & churn suffer. | Add WhatsApp/SMS integration (Meta/Gupshup); trigger on `v_worklist` daily cron. |
| 6 | **High** | **Settings changes untraced**. Rogue admin_office can change receipt template, service enablement, provider list without trace. | Add `settings_audit` table + trigger. |
| 7 | **High** | **Repair not logged** (`markAsRepaired`). Repeated failures on same device invisible to operator. | Add `repair_note` + `repaired_by`; RPC mirroring `mark_device_faulty`. |
| 8 | **Medium** | **Analytics recomputes 40k rows client-side**. First paint slow at 5k subs. | Materialised view or paginated aggregate RPC. |
| 9 | **Medium** | **No `useTransactions.deleteTransaction` UI, but the function exists**. Future contributor may wire it and bypass immutability triggers on schema-drift. | Delete the function. |
| 10 | **Medium** | **No breadcrumbs/back-context on `/equipment/:serial`** from timeline entries. Operator using the browser Back button lands on the equipment list, losing filter state. | Persist equipment list filters in URL. |

---

## Do-before-next-workstream checklist

Blocking (do these before any new feature work):
- [ ] **Risk #4** — drop `grant_owner_on_signup` trigger, provision owner manually.
- [ ] **Risk #2** — payment_method capture. Everything downstream (dunning, reconciliation, analytics) depends on it.
- [ ] **Risk #3** — balance reconciler ships.

Should:
- [ ] **Risk #1** — Suspension workflow ADR + implementation.
- [ ] **Risk #6** — settings audit trail.
- [ ] **Risk #7** — repair capture RPC.

Nice-to-have:
- [ ] Cross-link complaint rows → subscriber.
- [ ] Ledger row → subscription link.
- [ ] `statusBadges.ts` unification.
- [ ] `EmptyState` for Complaints/StbInventory/Ledger.
- [ ] Delete `useTransactions.deleteTransaction`.

---

## Changes landed in this pass

Code:
- `src/lib/confirm.tsx` — new imperative confirm helper + `<ConfirmHost/>`.
- `src/components/AppLayout.tsx` — mount `<ConfirmHost/>` once.
- `src/pages/Complaints.tsx`, `src/components/StbInventoryDialog.tsx`
  (delete + decommission), `src/components/PackManagementDialog.tsx`
  (delete + retire), `src/components/ProviderManagementDialog.tsx`,
  `src/components/RegionManagementDialog.tsx` — swap `window.confirm`
  for shadcn AlertDialog via the new helper.
- `src/components/subscriber-detail/DevicesTab.tsx` — device serial links
  to `/equipment/:serial`.
- `src/pages/Analytics.tsx` — consume `useAppData()` instead of
  duplicating `useSubscribers`/`useTransactions` calls.

Docs:
- This file.
- `.lovable/plan.md` — updated pointer.

Everything else in this report is `[DEFER]` — captured here and in
`PROJECT_STATUS.md#technical-debt-register`.
