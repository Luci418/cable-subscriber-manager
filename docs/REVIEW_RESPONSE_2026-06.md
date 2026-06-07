# Response to External Architecture Review — June 2026

This document is our internal response to the principal architect's review.
It is deliberately opinionated: the review is treated as input, not as
instructions. Every recommendation is rated Agree / Partially Agree /
Disagree, with impact, effort, risk, and a concrete decision.

Scoring scale:
- **Impact**: Low / Med / High — operational value if implemented
- **Effort**: S (≤½ day) / M (1–3 days) / L (>3 days)
- **Risk**: Low / Med / High — risk of *not* doing it at current scale
  (hundreds to low-thousand subscribers, 1–3 trusted staff, single operator)

---

## 1. Verdict by Recommendation

### A. Data-integrity & ledger correctness

#### A1. Trigger to recalc `cable_balance`/`internet_balance` on transaction insert/update/delete
- **Verdict**: **Agree** — strongest finding in the review.
- **Why**: Today the balance is only updated by the app's write path. Edit a
  transaction amount in the UI and the stored balance silently goes stale.
  This is the most plausible silent-revenue-leakage vector and we cannot
  catch it by reading the UI.
- **Impact**: High. **Effort**: S–M (single SQL trigger + tests).
  **Risk of not doing**: High.
- **Decision**: Ship before go-live. Reconciliation tool then becomes an
  anomaly detector, not a repair tool — exactly as the reviewer argues.
  Supersedes part of the Phase 3 plan in the roadmap.

#### A2. Add `created_by`, `edited_at`, `edited_by` and soft-delete to `transactions`
- **Verdict**: **Partially Agree**.
- **Why**: `created_by` is cheap and immediately useful even with one
  account (it becomes meaningful the day a second staff member is added).
  `edited_at` / `edited_by` and soft delete are pure audit features — we
  agree on `created_by + edited_at` now; defer soft delete until staff > 1.
- **Impact**: Med now, High later. **Effort**: S for `created_by`+`edited_at`,
  M for soft delete + UI. **Risk of not doing**: Med.
- **Decision**: `created_by` + `edited_at` + `edited_by` before go-live.
  Soft delete added with user-roles work (see D1), not before.

#### A3. `current_pack` denormalization can drift from JSONB snapshot
- **Verdict**: **Agree** on the diagnosis, **Partially Agree** on the fix.
- **Why**: The reviewer is right that the text column reflects the *current*
  pack name while the JSONB blob holds the *snapshot*. We don't want to drop
  `current_pack` — it is used in list filters and indexes for "active on
  Pack X" queries. The pragmatic fix is to keep `current_pack` as the
  pointer to the catalog and ensure all PDF / receipt / history reads use
  the JSONB `packName` snapshot.
- **Impact**: Med. **Effort**: S (audit `pdf.ts` + history views).
  **Risk of not doing**: Med (one renamed pack = ambiguous invoice).
- **Decision**: Audit invoice/history code paths within 30 days; document
  the invariant in `BUSINESS_RULES.md`. Do not remove the column.

#### A4. Subscriber-ID race condition (client-side max query)
- **Verdict**: **Agree**.
- **Why**: `src/lib/subscriberIdGenerator.ts` reads max-then-write with no
  lock. With 1–2 concurrent staff this almost never collides; the day it
  does, you get a unique-constraint error and a confused operator. Cheap to
  fix, embarrassing to leave.
- **Impact**: Low today, High at >2 staff. **Effort**: S (RPC with
  advisory lock or a per-prefix sequence table).
  **Risk of not doing**: Low → Med.
- **Decision**: Replace with a SECURITY DEFINER RPC using an advisory lock
  before go-live. A real Postgres sequence per prefix is over-engineered
  because prefixes are user-defined region names.

### B. Subscription model

#### B1. Add `previousSubscriptionId`, `origin`, `cancelReason`, blob `version` to JSONB
- **Verdict**: **Agree** — and the reviewer's argument that "every day of
  delay is permanently un-backfillable history" is the right framing.
- **Impact**: High (unlocks renewal/churn analytics). **Effort**: M (write
  path changes in `AddPackageSubscriptionDialog` + cancel flow).
  **Risk of not doing**: Med-High over 6 months.
- **Decision**: Ship within 30 days. Goes ahead of the original Phase 4 in
  the roadmap. Adds a `subscriptionBlobVersion: 2` discriminator so a
  future normalized table can ingest cleanly.

#### B2. Normalize to a `service_subscriptions` table now
- **Verdict**: **Disagree** at current scale.
- **Why**: ADR-008 is still correct. The reviewer's own concrete trigger —
  "client-side cost of unnesting JSONB across all subscribers crosses 1s" —
  hasn't been hit. B1 closes the lineage gap without normalization.
- **Decision**: Defer. Update ADR-008 with the concrete trigger conditions
  the reviewer suggested (1s analytics latency; or first time we need a
  scheduled renewal-reminder job; or third long-lived service with its own
  balance).

### C. Analytics

#### C1. Move heavy aggregations to Postgres materialized views earlier (not at 10k)
- **Verdict**: **Partially Agree**.
- **Why**: Agreed on direction, disagree on urgency. Today's analytics page
  is fast on the seed data. We will *measure* before we move; the rule is
  median client-side load > 1s in production, not subscriber count.
- **Impact**: Med. **Effort**: M when needed. **Risk of not doing**: Low
  now.
- **Decision**: Add a perf check (timing log) to the Analytics page now so
  we have data when the threshold is crossed. Don't pre-build views.

#### C2. `billing_history` table — second source of truth?
- **Verdict**: **Agree** — needs clarification.
- **Decision**: Audit usage within 7 days. If unused, drop in next migration
  with an ADR. If used, document who writes to it.

#### C3. Missing operator metrics (daily cash vs expected, collection efficiency
by region, cash-in-hand vs deposited, days-to-renewal, credit-balance aging,
complaint rate per region/provider)
- **Verdict**: **Agree** these are the right metrics. **Partially Agree** on
  timing.
- **Decision**:
  - Daily cash vs expected and credit-balance aging — add to the morning
    dashboard (E1). Cheap, no schema changes.
  - Cash-in-hand vs deposited — requires a "deposit" transaction type or a
    flag. Worth doing **only** with field agents; defer until D1.
  - Days-to-renewal — depends on B1; lights up automatically once B1 ships.
  - Complaint rate per region/provider — add as a card on Complaints page;
    low effort.

### D. Roles & access

#### D1. User roles (owner / office / agent / technician)
- **Verdict**: **Partially Agree**.
- **Why**: Reviewer reframes the trigger from "4+ staff" to "any staff
  member operating outside the owner's direct supervision". That's correct
  and we adopt it. But this operator today has no field agents using the
  app; building roles now is YAGNI.
- **Decision**: Update ADR-009 with the reframed trigger. Keep the canonical
  `user_roles` + `has_role()` pattern documented and ready. Do not build.

### E. Field operations & mapping

#### E1. Subscriber map view with balance color coding
- **Verdict**: **Strongly Agree** — best finding in the review by ROI.
- **Why**: Data already collected (`latitude`/`longitude`). Leaflet + OSM
  tiles is free. One screen, daily use, real differentiation for a local
  operator. Far higher ROI than cohort analytics.
- **Impact**: High. **Effort**: M. **Risk of not doing**: Low (we just
  lose value).
- **Decision**: Build immediately after go-live blockers. Becomes the new
  "What to build next" item.

#### E2. Route view / proximity clustering / fault clustering from complaints
- **Verdict**: **Agree** on direction, **Disagree** on near-term build.
- **Decision**: Defer until E1 has been used in the field for ≥1 month.
  Real usage will tell us which extension is worth building.

#### E3. House photograph bucket privacy
- **Verdict**: **Agree** — verify immediately.
- **Decision**: Audit storage buckets this week. If a public bucket exists,
  migrate to private + signed URLs. Document in `PRODUCTION_READINESS.md`.

### F. Inventory

#### F1. Add `model` / richer `device_type` to STB inventory; surface ONU
- **Verdict**: **Partially Agree**.
- **Why**: `device_type` already exists (`stb` default) but is unused. Adding
  `model` is a 1-column migration and immediately useful for tech support.
  ONU schema clarification is overdue (the AUDIT_REPORT already lists it).
- **Decision**: Add `model TEXT NULL` within 90 days. Refresh
  DEVELOPER_GUIDE schema sections in the same pass.

### G. Providers

#### G1. Provider cost / margin tracking
- **Verdict**: **Agree** — already on the roadmap as Phase 7.
- **Decision**: No change. Wait until margin analytics is actually
  requested.

#### G2. Shared provider catalog as a SaaS-era evolution
- **Verdict**: **Agree** as a *note*, **Disagree** as a current task.
- **Decision**: Add a paragraph to ADR-007 acknowledging the shared-catalog
  evolution. No code change.

#### G3. "Default Cable Network" / "Default Internet" backfill skews historic
provider mix
- **Verdict**: **Agree**.
- **Decision**: Add the caveat to `ANALYTICS_STRATEGY.md` and to the
  Provider Performance card UI ("pre-2026-06 data attributed to Default
  provider").

### H. Invoices

#### H1. Use snapshot pack name from JSONB, not current pack name
- **Verdict**: **Agree** — covered by A3 above.

#### H2. Build an `invoices` entity now
- **Verdict**: **Disagree**. ADR-006 stands. No GST/legal requirement.

### I. Backups & DR

#### I1. Nightly off-platform `pg_dump` to user-owned storage
- **Verdict**: **Agree**.
- **Why**: Free-tier restore is a support ticket. Our recovery story
  shouldn't depend on that.
- **Decision**: Document a one-pager runbook with a `pg_dump` command and
  a Google Drive / local-disk target. Add to `DEPLOYMENT.md`. The operator
  runs this manually weekly until automation is justified.

#### I2. Test the restore before go-live
- **Verdict**: **Strongly Agree**.
- **Decision**: Mandatory go-live blocker. Time the restore. Record in
  `PRODUCTION_READINESS.md`.

#### I3. `expire_lapsed_subscriptions` concurrent-execution safety
- **Verdict**: **Agree** on testing, **Partially Agree** on risk.
- **Why**: The function is idempotent on a clean dataset but two concurrent
  runs could theoretically double-append history. In practice the hourly
  cron + UI-triggered call almost never overlap. Cheap to make safe with an
  advisory lock at the top of the function.
- **Decision**: Add `pg_advisory_xact_lock` at function start before
  go-live.

### J. What the reviewer says to avoid building
- **Cohort analytics before renewal lineage** — Agree.
- **Invoice entity** — Agree.
- **Native mobile app** — Agree.
- **Analytics warehouse** — Agree.
- **Realtime subscriptions** — Agree.

All five are aligned with our memory rule "keep UI/UX simple and intuitive".
No action required beyond not building them.

---

## 2. Recommendations we are NOT adopting (or down-scoping)

| Recommendation | Reason |
|---|---|
| Normalize to `service_subscriptions` now (B2) | Premature; B1 closes the analytics gap |
| Full transaction soft delete + audit columns now (part of A2) | Over-engineered until staff > 1 |
| Pre-build materialized views before measuring (C1) | Speculative — measure first |
| User roles now (D1) | YAGNI — no field-agent users today |
| Shared provider catalog (G2) | SaaS-era only |
| `invoices` table (H2) | No regulatory trigger |
| Route optimization / clustering (E2) | Build after E1 sees real use |

---

## 3. Updated Roadmap (supersedes prior phasing where in conflict)

### Tier 0 — Go-Live Blockers (this sprint)
1. **A1** Trigger to recalc balances on transaction insert/update/delete.
2. **A2-min** Add `created_by` + `edited_at` + `edited_by` to `transactions`.
3. **A4** Subscriber-ID RPC with advisory lock.
4. **E3** Verify photograph storage bucket is private.
5. **I2** Test restore drill end-to-end; document elapsed time.
6. **I3** Advisory lock in `expire_lapsed_subscriptions`.
7. **C2** Decide fate of `billing_history` (drop or document).

### Tier 1 — First 30 Days
8. **E1** Subscriber map view with balance color coding.
9. **B1** Enrich subscription JSONB with `previousSubscriptionId`, `origin`,
   `cancelReason`, `subscriptionBlobVersion=2`.
10. **E1.a** Morning dashboard (expires today, expired-not-renewed, cash
    yesterday, total outstanding).
11. **A3** Audit invoice/history code paths to always use snapshot pack
    name from JSONB.
12. **I1** Nightly off-platform `pg_dump` runbook in `DEPLOYMENT.md`.
13. **Phase 2 (existing roadmap)** `collected_by` + `payment_method` on
    transactions.

### Tier 2 — Within 90 Days
14. Balance reconciliation reporter (anomaly detector now that A1 prevents
    drift by construction).
15. **F1** Add `model` to STB inventory; refresh DEVELOPER_GUIDE schema.
16. **G3** Document Default-provider analytics caveat in UI + docs.
17. Complaint-rate-by-region/provider card.
18. Performance timing on Analytics page (data-gathering for future C1).

### Tier 3 — Triggered, not Scheduled
- **D1** Roles — trigger: first non-supervised staff user.
- **B2** `service_subscriptions` normalization — trigger: any of
  ADR-008's conditions or "renewal-reminder job needed".
- **C1** Materialized views — trigger: median Analytics load > 1s.
- **G1** Provider cost / margin — trigger: operator asks for margin.

---

## 4. Explicit Buckets

### Implement immediately (Tier 0)
A1, A2-min, A4, E3, I2, I3, C2.

### Implement soon (Tier 1, ≤30 days)
E1, B1, E1.a, A3, I1, Phase 2 metadata.

### Safe to wait (Tier 2/3, trigger-based)
F1, G3, complaint metrics, perf timing; D1, B2, C1, G1 on trigger.

### Over-engineered for our scale (do not build)
Service-subscription normalization now; soft delete + full audit columns
now; pre-built materialized views; shared provider catalog; `invoices`
entity; native app; analytics warehouse; realtime subscriptions; route
optimization before E1 is in use.

---

## 5. Doc Updates Required After This Response

- `ARCHITECTURE_DECISIONS.md`: ADR-008 — tighten revisit conditions
  (concrete 1s/renewal-reminder/third-balance triggers). ADR-009 — adopt
  reviewer's "outside direct supervision" trigger. ADR-007 — note
  shared-catalog as SaaS-era evolution.
- `BUSINESS_RULES.md`: document `current_pack` vs JSONB snapshot invariant
  and the rule "invoice/history reads use JSONB snapshot".
- `ANALYTICS_STRATEGY.md`: add Default-provider caveat; add the metrics
  promoted in C3.
- `PRODUCTION_READINESS.md`: add the reviewer's checklist additions; mark
  restore drill as a hard go-live blocker.
- `DEPLOYMENT.md`: add `pg_dump` off-platform backup runbook.
- `CHANGELOG.md`: note the review and link to this file.

These doc updates are part of the Tier 0 sprint, not a separate phase.
