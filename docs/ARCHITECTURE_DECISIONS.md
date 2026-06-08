# Architecture Decision Record

This is the authoritative log of significant architectural decisions. Each
entry uses the same shape:

> **Decision** — what was chosen
> **Context** — what problem prompted it
> **Alternatives** — what else was considered
> **Reasoning** — why this option won
> **Tradeoffs** — what we give up
> **Revisit when** — the conditions that should trigger a re-evaluation

Newer decisions are at the bottom. Do not edit old entries silently — add a
new ADR superseding the old one and link both ways.

---

## ADR-001 — Supabase as the entire backend

- **Decision**: Use Supabase (Postgres + Auth + RLS + Edge Functions) instead of a custom backend.
- **Context**: Single-developer project, small operator scale, need auth + DB + hosting fast.
- **Alternatives**: Node/Express + own Postgres; Firebase; self-hosted PocketBase.
- **Reasoning**: RLS gives per-user isolation without a custom API layer. Free tier covers target scale. Auto-generated TypeScript types remove a class of bugs.
- **Tradeoffs**: Vendor lock-in on auth + RLS dialect. Migrations live in `supabase/migrations`.
- **Revisit when**: We outgrow free tier, need multi-tenant data partitioning, or want to self-host on a single box.

## ADR-002 — Wide-row Subscriber model (cable + internet on the same row)

- **Decision**: `subscribers` table carries per-service columns: `cable_balance`, `internet_balance`, `current_subscription`, `internet_subscription`, `cable_provider_id`, `internet_provider_id`, etc.
- **Context**: Almost every UI screen shows a subscriber and *all* their services at once. A normalized `service_subscriptions` table would force a JOIN on every read.
- **Alternatives**: Normalized `subscriber → service_subscriptions → packs` model.
- **Reasoning**: At target scale (few thousand subscribers, 1–3 services per subscriber) the wide row is faster to query, easier to back up, and easier to reason about. Each service column is independent — a new service category can be added as additional columns or migrated later.
- **Tradeoffs**: Adding a 4th or 5th service type would feel cramped. Cross-service analytics requires unpivoting at query time.
- **Revisit when**: We add a third long-lived service type, OR we need a subscriber to hold multiple concurrent subscriptions of the same service type (e.g. two internet plans).

## ADR-003 — Stored balances (`cable_balance`, `internet_balance`) instead of computed-on-read

- **Decision**: Persist running balances on the subscriber row; update them transactionally when charges/payments happen.
- **Context**: Cashiers need to read the balance instantly when a customer walks in. Scanning transactions every read is wasteful.
- **Alternatives**: Compute `SUM(charges) - SUM(payments)` on every read; materialized view refreshed periodically.
- **Reasoning**: Stored value = O(1) read, matches the mental model of a ledger ("what does Ramesh owe right now?").
- **Tradeoffs**: Drift is possible if a transaction is inserted without updating the balance, or a balance is hand-edited. Requires a reconciliation tool.
- **Revisit when**: Drift incidents > 1/month, or we add a second writer (background job, mobile app) that could race the UI.
- **Mitigation planned**: Phase 3 of the roadmap adds `reconcile_balances()` / `repair_balances()` RPCs and a `balance_audit` table.

## ADR-004 — JSONB `current_subscription` / `subscription_history[]` instead of a subscriptions table

- **Decision**: Store the active subscription as a JSONB blob on the subscriber row, and history as a JSONB array.
- **Context**: Subscriptions are almost always read in the context of their subscriber. History is append-mostly.
- **Alternatives**: Dedicated `subscriptions` table with FK to subscriber.
- **Reasoning**: Same as ADR-002 — read locality. Schema can evolve without a migration on millions of rows.
- **Tradeoffs**: Hard to query "all subscriptions expiring next week" across subscribers; the current Billing/Analytics pages unpivot in code. Renewal/cohort analytics is awkward.
- **Revisit when**: We need first-class lifecycle analytics (churn, renewal rate, MRR cohorts). The Phase 6 plan in the roadmap addresses this incrementally by enriching the blob first, then optionally normalizing.

## ADR-005 — Soft-delete (`is_active`) for catalog entities

- **Decision**: Packs and providers use `is_active = false` instead of hard delete. Deletion is blocked when the entity is in use (RPC: `is_pack_in_use`, `is_provider_in_use`).
- **Context**: Historical transactions and subscription snapshots reference catalog entries by id and by name.
- **Alternatives**: Hard delete with cascade; refuse delete only.
- **Reasoning**: Preserves history for analytics and audit while letting operators phase out plans cleanly.
- **Tradeoffs**: UI must filter inactive items from "new subscription" pickers.
- **Revisit when**: We add formal versioning of catalog entries (e.g. `pack_versions`).

## ADR-006 — Dynamic PDF invoices instead of an `invoices` table

- **Decision**: Receipts and invoices are generated on demand from subscriber + transaction + subscription data via `src/lib/pdf.ts` (jsPDF). No `invoices` table.
- **Context**: An invoice today is a *view* over existing data; nothing about it needs to be stored separately to operate the business.
- **Alternatives**: First-class `invoices` + `invoice_line_items` entities.
- **Reasoning**: Avoids duplicating data, avoids needing a numbering authority, avoids reconciliation between stored invoices and the underlying ledger. Cheaper to ship.
- **Tradeoffs**: No "regenerate the exact PDF I sent in March" guarantee — if a pack name changes, an old invoice regenerated today reflects the new name. No legal invoice register out of the box.
- **Revisit when**: Tax/GST compliance requires a tamper-evident invoice register, or operators need bulk invoice runs with stored sequence numbers.

## ADR-007 — Provider-first architecture (multi-source revenue attribution)

- **Decision**: Introduce a generic `providers` entity. Tag `packs`, `transactions`, and the current per-service provider on `subscribers`. Every service-bearing record points to *some* provider, including the operator's own network.
- **Context**: Operators rarely own everything end-to-end. Internet is often resold from BSNL/Fastnet; cable may be a mix of own headend and third-party. Without provider attribution, revenue can't be split, commissions can't be reconciled, and growth-by-source is invisible.
- **Alternatives**: Hardcode "service_type = internet" → upstream = BSNL; carry provider only on transactions; don't model it at all.
- **Reasoning**: "Provider" is the business abstraction that already exists in the operator's head. Modeling it once unlocks revenue, subscriber, and inventory analytics by source without further schema churn. The term is intentionally generic — it can later represent franchisees, resellers, or other operators in a SaaS world.
- **Tradeoffs**: Every write path now needs to remember a `provider_id`. Existing rows had to be backfilled to a "Default" provider.
- **Revisit when**: We outgrow per-user provider lists (e.g. shared provider catalog across operators in a SaaS deployment) or providers themselves need versioning (rate cards, contract dates).

## ADR-008 — Defer `service_subscriptions` normalization

- **Decision**: Do *not* introduce a separate `service_subscriptions` table now, even though it would be the textbook design.
- **Context**: While reviewing Phase 6 (renewal lifecycle), it became clear that most analytics gaps can be closed by enriching the JSONB blob (origin, previousSubscriptionId, cancelReason) rather than restructuring.
- **Alternatives**: Migrate to normalized `subscriber → service_subscription → invoices → payments` now.
- **Reasoning**: Migration risk is non-trivial; today's wide-row + JSONB design serves the operator well. The cost of *waiting* is moderate (some cross-subscriber subscription analytics is awkward), the cost of *migrating prematurely* is high (touches every screen).
- **Tradeoffs**: Locks in the wide-row design for longer. Future SaaS evolution will likely require this migration.
- **Revisit when**: Any of: (a) operator needs concurrent multiple subscriptions per service, (b) we go multi-tenant SaaS, (c) cohort/MRR analytics becomes a top-3 user request, (d) a third long-lived service type joins.

## ADR-009 — Per-user data isolation via RLS, no admin/role table

- **Decision**: Every operational table is filtered by `auth.uid() = user_id`. No `user_roles` table exists today; the "owner" is implicitly the auth user.
- **Context**: Single-operator deployments. Staff currently share the owner's account.
- **Alternatives**: Build roles (owner/staff/agent) with `user_roles` + `has_role()` security-definer function from day one.
- **Reasoning**: YAGNI at current scale. Adding roles later is straightforward (project memory documents the canonical pattern).
- **Tradeoffs**: No per-staff audit trail. Any staff member can do anything the owner can.
- **Revisit when**: An operator hires field agents who should *not* see all data, OR we move to multi-tenant SaaS (mandatory then).

## ADR-010 — Documentation as a single source of truth under `docs/`

- **Decision**: All long-form documentation lives under `docs/`, indexed by `docs/README.md`. CHANGELOG and release notes are the only history; old ADRs are superseded, not deleted.
- **Context**: Prior to this, only `DEVELOPER_GUIDE.md` existed and had drifted from the schema.
- **Reasoning**: A coherent doc system reduces onboarding cost and keeps AI-assisted edits grounded.
- **Revisit when**: The project splits into multiple repositories.

## ADR-011 — Transactions are a fully immutable, source-tagged ledger; corrections via void + replacement or subscription lifecycle

- **Decision**: `public.transactions` is an append-only ledger. Every row carries an explicit `source` (`manual_charge`, `manual_payment`, `subscription_charge`, `subscription_refund`, `reversal`, `adjustment`) at insert time — behaviour is never inferred from description text. Once written, **every** column except status (via void) is immutable: `amount`, `type`, `service_type`, `subscriber_id`, `provider_id`, `date`, `reverses_transaction_id`, `description`, and `source` are all frozen. Corrections happen in one of two ways: (a) for manual ad-hoc rows, the operator voids via the `void_transaction(p_transaction_id, p_reason_code, p_reason)` RPC (offsetting reversal + flip to `status = 'voided'`) and optionally posts a replacement; (b) for subscription-generated rows (`source IN ('subscription_charge','subscription_refund')`) the ledger row cannot be voided directly — the correction must go through the subscription lifecycle (cancel / refund) so the subscription and its ledger stay consistent. The RPC enforces this rejection at the database level. Void rows carry a structured `void_reason_code` enum (`data_entry_error`, `duplicate`, `wrong_subscriber`, `wrong_amount`, `customer_dispute`, `other`), an optional free-text `void_reason`, and accountability columns `voided_by` / `voided_at`. Operator-facing reversal descriptions read `Reversal — <reason label> (<note>)` — no UUIDs are surfaced; the audit link is the `reverses_transaction_id` FK. Additional context goes into a separate append-only `transaction_notes` table (per-row notes with author + timestamp; UPDATE/DELETE rejected at the DB level), never into the immutable description. Enforcement lives in the `transactions_enforce_immutability` BEFORE UPDATE/DELETE trigger.
- **Context**: With the Tier-0 balance trigger the ledger is the single source of financial truth, and a rewritable source of truth is not a source of truth. The original revision allowed a 5-minute grace window for genuine fat-finger fixes; the second revision adopted full immediate immutability but left two latent footguns: (1) the editable `description` allowed silent rewrites of subscription-generated rows; (2) voiding a subscription's charge in isolation left the active subscription on the subscriber row, producing an inconsistent state and creating a fraud vector for staff collecting cash. The third revision (this one) closes both. See `docs/FINANCIAL_LIFECYCLE_REVIEW_2026-06.md`.
- **Alternatives**: (a) status quo with editable description; (b) infer source from description text long-term (rejected — fragile and locale-sensitive); (c) allow void of subscription rows and reconcile asynchronously; (d) per-field audit log instead of forbidding edits; (e) split into separate `payments` / `charges` / `refunds` tables.
- **Reasoning**: Explicit `source` lets the system reason about row provenance without parsing strings, and is the natural place to gate void eligibility. Forbidding edits across the row keeps the audit story trivial — "what you saved is what's posted, forever; context goes in notes." Routing subscription corrections through the subscription lifecycle keeps the wide-row `current_subscription` JSONB and the ledger in lockstep. The reason-code enum gives owners queryable visibility into *why* voids happen; the Recent Voids widget makes them obvious operational events rather than hidden actions. Notes are append-only by trigger to preserve the same immutability guarantee.
- **Tradeoffs**: A typo in `amount` always costs two rows (void + replacement) instead of a silent in-place fix — the explicit cost of the audit trail. Subscription-row corrections require operators to learn one more concept ("cancel the subscription, don't void its charge"). The fraud vector is reduced but not eliminated without staff roles; a collection agent with full access can still void a manual cash receipt, which is why the Recent Voids widget exists. Description edits are gone entirely; notes are slightly more friction but cleaner.
- **Revisit when**: (a) compliance (GST audit, statutory invoice register) requires more granular per-field history → introduce `transaction_audit_log`; (b) staff roles land → gate the void RPC by role and add time-bound limits for cash receipts; (c) the operator requests month-end period locks → add a `closed_periods` table that gates the void RPC and subscription cancellation; (d) `description` edits become a real operational pain → reconsider, but the current rule is intentional.


