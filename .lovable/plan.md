# Fix 7 — Production-Readiness Audit

Goal: review the app end-to-end as a senior analyst/engineer would before daily production use by a 5,000-subscriber ISP+cable operator. Produce a written audit *and* implement the quick wins in the same pass. Larger items get documented, not silently reshaped.

## Deliverables

1. **`docs/PRODUCTION_AUDIT_2026-07.md`** — the audit report. Sections mirror the 9 categories you listed, plus a final "Top 10 risks, ranked" and a "Do-before-next-workstream" checklist.
2. **In-pass code fixes** — every finding tagged `[FIX-NOW]` in the report is implemented in this same turn. Findings tagged `[DEFER]` are documented with rationale and a suggested milestone (no code change).
3. **`.lovable/plan.md`** update — record what was done vs deferred so the next session has continuity.

## How I'll conduct the review

For each of the 9 categories I will:

- Walk the relevant screens/hooks/RPCs (not just grep).
- Compare UI affordances against `has_role` / RPC guards / RLS policies (category 7).
- Cross-check terminology, icons, badges, empty/loading states between pages (categories 1 & 5).
- Trace one representative workflow end-to-end per lifecycle (category 1):
  onboarding → add service → pair → replace → faulty → repair → archive → reactivate;
  and payment: collect → allocate → void → refund.
- For performance (category 4), look for: client-side filtering over full tables, duplicated fetchers across contexts vs `AppDataContext`, missing pagination, N+1 in Devices/Ledger tabs, over-eager reloads.
- For audit trail (category 3), verify each state change writes to one of: `device_status_log`, `device_assignment_log`, `subscriber_status_log`, `transactions` (with `void_reason_code`, `cancel_reason_code`), or `transaction_notes`.
- ISP-industry comparison (SplyntOSS, Sonar, Powercode, Splynx patterns): flag missing workflows such as service suspension (soft-disconnect), scheduled disconnection, dunning reminders, prorated billing, ticket SLA, prepaid top-up flow — noted as `[DEFER]` unless already trivially reachable.

## Quick-win fixes I expect to apply in this pass (subject to what the walkthrough surfaces)

Representative — final list is written in the report:

- **Confirmation gaps**: any destructive action still using `window.confirm` or no confirm at all (e.g., `deleteTransaction` in `useTransactions`, provider/region/pack deletes) → replace with `AlertDialog` matching the Archive/Cancel pattern.
- **Terminology drift**: normalize "Subscriber" vs "Customer", "Pack" vs "Plan", "STB" vs "Device", "Voided" vs "Reversed" to the glossary in `BUSINESS_RULES.md`.
- **Status colour drift**: unify `active / suspended / expired / cancelled / archived` badge palette in one helper (`src/lib/statusBadges.ts`) and replace scattered inline classes.
- **Empty & loading states**: any list still rendering a bare "No data" string gets an `EmptyState` with a primary action; any async panel without a skeleton gets one.
- **Permission-UI mismatches**: hide (not just disable) buttons whose RPC will reject the caller — currently visible for non-Owner roles on Cancel Subscription, Void Transaction, Replace/Mark-Faulty, Settings tabs.
- **Dead-ends**: `/equipment/:serial` → clickable subscriber name; `/customers/:id` device rows → link to `/equipment/:serial`; complaint rows → link to subscriber profile.
- **AppDataContext reuse**: pages that still call `useSubscribers()` directly (bypassing the provider) get switched to `useAppData()` to remove duplicate fetches.
- **N+1**: Devices tab currently fetches `device_assignment_log` per service on mount — fold into a single query.

## Items I expect to `[DEFER]` (documented, not built)

- Balance reconciliation job (`reconcile_balances`) — ADR-003, already tracked.
- Service **Suspension** workflow (soft-disconnect without cancel) — ISP-standard, currently missing; needs schema (`status='suspended'`) UX + RPC design.
- Scheduled disconnection & dunning reminders — cron + notification channel decision needed.
- Prorated billing on mid-cycle plan change — pricing-policy call.
- Per-user activity log (who did what, when) beyond the append-only tables — needs a general `audit_events` table.
- Legacy retirement batches B/C/D from `PRODUCTION_READINESS.md`.

## Report structure (preview)

```text
docs/PRODUCTION_AUDIT_2026-07.md
├── 1. Workflow consistency          (findings + FIX-NOW / DEFER)
├── 2. Confirmation audit
├── 3. Audit trail
├── 4. Performance
├── 5. Consistency (terminology/icons/badges/states)
├── 6. Navigation
├── 7. Permissions (UI ↔ RPC ↔ RLS matrix)
├── 8. Error handling
├── 9. ISP-industry gap analysis      (added per your ask)
├── Top 10 risks, ranked Critical→Low
└── Do-before-next-workstream checklist
```

## Out of scope (this pass)

- No new feature workstreams (credentials tab, dunning, suspension) — they belong to their own plan.
- No schema migrations beyond what a fix-now finding forces (and if one does, I'll surface it before writing SQL).
- No visual redesign beyond consistency normalization.

## Approval

Approve this and I'll produce the report and land the fix-now changes in one build pass. If you want me to *only* produce the report first (no code changes) so you can triage which fixes to accept, say so and I'll split it.
