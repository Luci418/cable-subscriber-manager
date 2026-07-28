# Fresh-Thread Handoff

**Purpose:** everything a new Claude / Gemini / ChatGPT thread needs to
become productive on this project without re-deriving the last six months
of decisions. Read this first, then open the files listed at the bottom.

Last updated: 2026-07-28.

---

## 1. What this project is (30 seconds)

A single-operator **Subscriber Management System (SMS)** for a regional
Cable TV + Broadband business in India. Replaces paper ledgers.
Marketed to the operator as "Khatabook for cable operators" — the design
bar is *simpler than a notebook*, not richer than enterprise OSS.

- **Stack:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui.
  Supabase Postgres (via Lovable Cloud) for auth, RLS, RPCs, storage.
- **Scale target:** hundreds to a few thousand subscribers, 1–10 staff.
- **Not a SaaS.** Single-tenant, single deployment per operator today.

Read `docs/PROJECT_VISION.md` for the fuller "why".

## 2. Where the project stands today

**Phases 1 through 6.5 are complete and in production-ready shape.**
That covers: core CRUD, payments, receipts, balance model v2, STB
inventory, normalized `subscriptions` + `payment_allocations`, multi-device
pairing, device replacement, roles + RLS + permission gates, encrypted
credentials, legacy column retirement (JSONB blobs, `current_pack*`,
`stb_number`), reconciliation RPCs, audit trails, standardized confirm
dialogs, catalog page, pack margin analytics, Testing Sprint 1 & 2
(pgTAP + Vitest, 31 assertions).

**Currently in planning, not built:** provider integration (Hathway
snapshot import + write-through to provider portal). See `.lovable/plan.md`
for the current direction — it changed on 2026-07-28 from a
diff-and-apply engine to a write-through-first model where our app leads
and the provider portal follows.

**Blockers:** none. **Known regressions:** none.

## 3. The most important rules a new thread must respect

1. **Read `docs/SYSTEM_INVARIANTS.md` before proposing schema or RPC
   changes.** INV-01…INV-44 are enforced by triggers; breaking one will
   fail at insert time, not review time.
2. **Never touch legacy paths in code without checking
   `docs/LEGACY_DEPENDENCY_AUDIT.md` first.** Several columns look alive
   but are retired mirrors.
3. **`useTransactions.deleteTransaction` does not exist and must not be
   added.** Reversal is via `void_transaction` RPC only. The DB blocks
   physical deletes with an immutability trigger.
4. **Money math is server-side.** Balance is recomputed by a Postgres
   trigger, not by the client. Never sum transactions in the UI to derive
   "amount owed" — read `subscribers.balance`.
5. **Roles are stored in `user_roles`, never on `subscribers` or
   `profiles`.** Client-side role checks are advisory only; every gated
   RPC re-checks server-side.
6. **No auto-signup granting of `owner`.** The former
   `grant_owner_on_signup()` trigger was dropped; first owner is a
   documented manual SQL step in `docs/PRODUCTION_READINESS.md`.
7. **Provider = business concept, not vendor name.** Schema uses
   `providers` / `service_type`; don't hardcode "Hathway" or "BSNL" in
   business logic.
8. **The word "Supabase" is not shown to the operator.** In UI copy it's
   "Cloud" or "backend". In internal docs, Supabase is fine.

## 4. Directory map

```
src/
  pages/           — route entry points (Home, Customers, CustomerDetail,
                     Equipment, EquipmentDetail, Billing, Catalog,
                     Analytics, Complaints, Settings, Auth)
  components/      — feature components; subscriber-detail/ holds tab bodies
  components/ui/   — shadcn primitives (do not modify)
  components/ui-ext/ — house primitives (DataTable, StatCard, PageHeader…)
  hooks/           — data hooks (useSubscribers, useTransactions, usePacks…)
  contexts/        — AppDataContext, SettingsContext, PermissionsProvider
  lib/             — pure logic (financialPosition, ledgerRendering,
                     activeSubs, subscriberIdGenerator, timeSync, confirm)
  integrations/supabase/ — auto-generated client + types (do not edit)
supabase/migrations/  — SQL migrations (append-only, timestamped)
test/db/         — pgTAP tests (16 files, 31 assertions)
docs/            — all long-form documentation (see docs/README.md)
.lovable/plan.md — current active build plan
```

## 5. Provider integration — the current live discussion

Two design iterations happened. A new thread should understand both:

- **v1 (rejected):** classic importer — parse Hathway TSV, upsert into local
  tables. Rejected because reports are event-evidence, not the truth.
- **v2 (partially rejected):** diff-and-apply sync engine — snapshot,
  diff, review dashboard, auto-create charges from detected renewals.
  Documented in the older `.lovable/plan.md` (git history) and
  `docs/PROVIDER_INTEGRATION_ARCHITECTURE.md`.
- **v3 (current, 2026-07-28):** write-through-first — operator acts in
  our app, we generate a `provider_action_intent` row, then assist the
  operator to reproduce the action on the Hathway portal (checklist →
  deep-link → optional browser automation). Reactive snapshot diffing
  survives, but only as a reconciliation safety net. See
  `.lovable/plan.md` for the full plan.

## 6. Testing

- `bun run test` — Vitest unit tests (46 tests). Covers financialPosition,
  ledgerRendering, activeSubs, subscriberIdGenerator.
- `bun run test:db` — pgTAP against a throwaway Postgres (31 assertions).
  Covers immutability triggers, role gates, RPC behaviour, RLS isolation,
  FIFO allocation.
- No E2E/browser tests yet. Regression is manual per `docs/QA_TEST_PLAN.md`.

## 7. What a new thread should NOT do without asking

- Introduce a new framework, UI library, state manager, or ORM.
- Add a background worker, cron, or scheduled job (no runtime for it).
- Store portal credentials server-side (see plan §1).
- Re-add any retired column, table, RPC, or trigger listed in the legacy
  audit.
- Rewrite BUSINESS_MODEL.md; propose ADRs instead.
- Change financial invariants without a migration + pgTAP coverage.

---

## 8. Files to attach to a fresh AI thread

**Minimum viable context (~15 files) — attach these first:**

Governance & status:
- `docs/HANDOFF.md`   *(this file — read first)*
- `docs/PROJECT_STATUS.md`
- `docs/PROJECT_VISION.md`
- `docs/SYSTEM_INVARIANTS.md`
- `docs/ARCHITECTURE_DECISIONS.md`
- `docs/PRODUCTION_READINESS.md`
- `CHANGELOG.md`

Domain:
- `docs/BUSINESS_MODEL.md`  *(large — the authoritative spec)*
- `docs/BUSINESS_RULES.md`

Roles & security:
- `docs/PERMISSION_MATRIX.md`
- `docs/ROLE_DESIGN.md`

Engineering:
- `docs/DEVELOPER_GUIDE.md`
- `docs/LEGACY_DEPENDENCY_AUDIT.md`
- `docs/TESTING_ARCHITECTURE.md`

Current active work:
- `.lovable/plan.md`

**Add these if the thread will work on provider integration:**
- `docs/PROVIDER_REPORT_ANALYSIS.md`
- `docs/PROVIDER_INTEGRATION_ARCHITECTURE.md`  *(v2 design, superseded but still useful context)*

**Add these if the thread will work on analytics:**
- `docs/ANALYTICS_STRATEGY.md`

**Add these if the thread will work on UI:**
- `docs/OPERATOR_WORKFLOW_UI_REVIEW.md`
- `docs/QA_TEST_PLAN.md`

**Add these if the thread will work on deployment / going live:**
- `docs/DEPLOYMENT.md`
- `docs/DESTRUCTIVE_OPERATIONS_AUDIT.md`
- `docs/PRODUCTION_AUDIT_2026-07.md`

**Skip / reference-only** (mostly historical, only load if the thread
asks about a specific past decision): `docs/AUDIT_REPORT.md`,
`docs/LIFECYCLE_AUDIT_2026-06.md`,
`docs/FINANCIAL_LIFECYCLE_REVIEW_2026-06.md`,
`docs/REVIEW_RESPONSE_2026-06.md`,
`docs/INVARIANT_WORKSHEET.md`,
`docs/INDUSTRY_BENCHMARKING_ADDENDUM.md`,
`docs/NEXT_PROJECT_CHECKLIST.md`,
`docs/FUTURE_EVOLUTION.md`,
`docs/archive/**`.

**Never attach** (auto-generated, will confuse the thread):
- `src/integrations/supabase/types.ts`
- `src/integrations/supabase/client.ts`
- `supabase/config.toml`
- `.env`
- `bun.lockb` / `package-lock.json`
