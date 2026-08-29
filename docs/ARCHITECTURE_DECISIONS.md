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

## ADR-012 — DB-enforced invariants & RPC-mediated writes for lifecycle operations

- **Decision**: Multi-step business operations are no longer composed in client code. Subscription create and cancel now run inside SECURITY DEFINER RPCs (`create_subscription`, `cancel_subscription`) that atomically (a) write the subscription JSONB on `subscribers` and (b) post the matching charge / refund row on the immutable ledger. The existing `transactions_recalc_balance` trigger is the **sole writer** of `cable_balance` / `internet_balance` — direct balance writes from the client are forbidden and have been removed from `AddPackageSubscriptionDialog`, `SubscriberDetail` (cancellation), and `Index.tsx` (manual transactions). This is Phase 1 of a four-phase sprint that will progressively move every business invariant from UI-only checks into DB-level constraints, triggers, and RPCs.
- **Context**: A pattern of "the UI lets me do X" bugs kept surfacing (STB swap mid-subscription, dropping a service while a sub was active, etc.). Root cause audit identified three compounding issues: (1) `subscribers` is a god-row that any client can UPDATE column-by-column with no business-rule gate; (2) `current_subscription` / `internet_subscription` are unvalidated JSONB blobs assembled in client code; (3) balance had two writers — a correct trigger AND three client paths that pre-wrote balance before posting the ledger row, creating a race window where a failed ledger insert left balance permanently inflated.
- **Alternatives**: (a) keep building UI-side guards as bugs surface (status quo, rejected — exponential surface area); (b) jump straight to normalizing `subscriptions` out of JSONB into its own table (rejected for now — large refactor, considered after Phase 4); (c) add CHECK constraints alone without RPCs (rejected — multi-step operations still race); (d) move every column write into a single mega-RPC (rejected — over-engineered for a regional operator).
- **Reasoning**: Wrapping lifecycle operations in DB functions gives transactional integrity for free, makes the balance trigger authoritative, and pushes business rules to the only layer that **every** code path — UI, future scripts, direct API calls, imports — has to pass through. Phasing the work lets each migration ship independently and be tested in isolation.
- **Tradeoffs**: Slightly more friction adding new lifecycle features (must write/update an RPC instead of a client call). RPC error messages need mapping in `dbErrors.ts` to stay user-friendly. The subscription JSONB shape is still validated only by the RPC at write time, not by a schema constraint — that lands in Phase 4.
- **Revisit when**: (a) we decide to normalize `subscriptions` into its own table — these RPCs become the natural insertion point; (b) row-level role checks (collection agent vs owner) — gate at the RPC; (c) period-close locks for accounting periods — same.





## ADR-013 — Reactive snapshot sync is the primary provider integration, not write-through

- **Decision**: Provider integration works by importing the reports the operator exports from the provider portal, diffing them against the last committed import, and letting the operator approve the result. The earlier "write-through-first" direction — our app leads, the portal follows via a `provider_action_intent` row and an assisted-entry tier (A0 checklist / A1 deep link / A2 browser automation) — is **superseded**. Snapshot sync is the mechanism, not a safety net behind something else.
- **Context**: The 2026-07-28 plan assumed the operator would act inside the SMS first. Confirmed on 2026-07-31 that Hathway exposes no API and no write access of any kind, and the operator in fact provisions directly on the Hathway portal. The portal always acts first; the SMS learns about it afterwards from an export.
- **Alternatives**: (a) keep write-through as the default and treat reports as reconciliation only; (b) build A2 browser automation against the portal now; (c) manual double entry with no import at all.
- **Reasoning**: An architecture must describe the workflow that exists. Write-through models a sequence the operator does not follow, so its intent rows would drift out of date the moment the operator touched the portal directly. Reports are the only reliable, complete, operator-obtainable record of what the provider actually did.
- **Tradeoffs**: The SMS is always one export behind reality — there is no live view of the portal. Double entry survives for anything the operator does upstream. Import quality depends on the report format, which the provider can change without notice (mitigated by row-shape validation and a frozen `parser_version`).
- **Revisit when**: The provider exposes an API or webhooks, OR the operator's habit shifts to acting in the SMS first often enough that the assisted-entry tiers above become worth building on top of sync. Supersedes the Mode-A framing in `.lovable/plan.md`; see `docs/PROVIDER_SYNC_IMPLEMENTATION_PLAN.md` for the canonical design.

## ADR-014 — Provider reports are evidence; only a committed import may create a transaction

- **Decision**: Provider reports are **evidence** that a business event occurred upstream, never the ledger itself. Only a **committed** `provider_import_run` may create a transaction. Where a report and the SMS ledger disagree, the ledger stands until an operator explicitly resolves it through a new sync run or a manual adjustment. (INV-46)
- **Context**: The provider portal is not an accounting system. An importer that treats an export as authoritative can silently overwrite financial state, which is unrecoverable in an append-only ledger.
- **Alternatives**: (a) trust the export and reconcile the ledger to it; (b) maintain a second, provider-side ledger alongside the real one; (c) import into a staging ledger that is periodically merged.
- **Reasoning**: One ledger, one write path. `commit_provider_import` is the sole sync write path, so every sync-created row passes the same immutability and FIFO triggers as an operator-entered one, carries `source = 'provider_sync'`, and is attributable to a run.
- **Tradeoffs**: Disagreements are not auto-corrected — they surface as review items and need an operator. That is deliberate.
- **Revisit when**: A provider offers a reconciled statement with contractual authority (i.e. it *is* the invoice), which would justify a formal dispute workflow rather than "ledger wins".

## ADR-015 — Provider sync is insert-only against the ledger

- **Decision**: The import process never edits, deletes, or rewrites existing financial transactions. Sync creates new business events or flags discrepancies for review. Corrections are explicit operator actions (adjustment, reversal, reconciliation), never a silent sync side-effect. (INV-47)
- **Context**: ADR-011 made transactions immutable for humans. Adding an automated writer would have re-opened exactly the hole that ADR closed, at machine speed.
- **Alternatives**: (a) let sync amend a charge it previously created; (b) allow sync to void-and-replace automatically; (c) give sync a privileged bypass of the immutability trigger.
- **Reasoning**: An append-only ledger is only append-only if it has no exceptions. Context that would have been an edit goes into `transaction_notes` (append-only) instead, keeping the audit story unchanged: what was posted stays posted, commentary is added beside it.
- **Tradeoffs**: A sync mistake costs a reversal row rather than a correction in place. Some import runs will legitimately produce nothing but review items.
- **Revisit when**: Never for edits. If bulk reversal of a bad run becomes a real need, add an explicit, role-gated, fully attributed "reverse run" operation that posts reversal rows — not an editing path.

## ADR-016 — Synchronization is operator-approved, never continuous

- **Decision**: Sync is a reconciliation process the operator drives: **upload → review → approve**. Nothing is written before Approve. There are no scheduled imports, no background jobs, and no automatic replication.
- **Context**: The obvious next step after building a diff engine is to run it on a timer. With no API, the input is a file the operator has to fetch anyway, so a schedule would only automate the *writing*, which is the part that needs judgement.
- **Alternatives**: (a) cron-driven import from a watched folder or mailbox; (b) auto-commit runs below a confidence threshold; (c) auto-commit everything and let the operator undo.
- **Reasoning**: Every write is financial or identity-affecting. The review screen is where an unmapped plan, an ambiguous identifier, or a suspicious status change gets caught, and a human is the only component that can catch all three. Approval also gives every write an attributable actor (`committed_by`) and a timestamp.
- **Tradeoffs**: Imports happen only as often as the operator runs them. Large reports need a usable review UI, which cost real effort.
- **Revisit when**: Volume makes per-row review impractical — the first step then is auto-approving *only* the `no_change` bucket, not the whole run.

## ADR-017 — Idempotency by committed-baseline diffing

- **Decision**: A run is diffed only against the most recent **committed** run for the same `(provider_id, report_type)`. Re-uploading an already-committed file yields 100% `no_change` and zero transactions. A cancelled review writes no baseline, so cancelling and re-uploading never causes an event to be treated as already-synced. (INV-48)
- **Context**: Operators re-upload files — by accident, after a crash, or because they were unsure whether the last one worked. Any of these must be harmless.
- **Alternatives**: (a) per-row hashes in a dedicated "already applied" table; (b) file-level checksum rejection of duplicates; (c) diff against the newest run regardless of status.
- **Reasoning**: The baseline query `WHERE status='committed' ORDER BY imported_at DESC LIMIT 1` makes idempotency a property of one query rather than of bookkeeping spread across the codebase. Excluding drafts and cancelled runs means an abandoned review can never poison the next import. Committed runs are themselves immutable, so a baseline cannot be edited after the fact.
- **Tradeoffs**: Whatever happened between two committed runs is only visible as the net difference; intermediate states are not reconstructable. Rejecting a duplicate file outright would be a cheaper UX, but diffing to `no_change` is safer and needs no extra state.
- **Revisit when**: Multiple report types start overlapping on the same rows badly enough that a per-row applied-ledger becomes necessary.

## ADR-018 — Customer identity is SMS-owned; provider writes are opt-in per field

- **Decision**: Provider synchronization never changes subscriber identity fields (name, address, mobile, GST, notes, billing preferences) unless the operator has explicitly enabled that field in `sync_policy`. Defaults deny. (INV-49)
- **Context**: Provider exports carry the identity the *provider* holds, which is often stale, abbreviated, or the name of whoever was home at installation. The operator's own record is usually better.
- **Alternatives**: (a) sync identity by default and let operators turn it off; (b) never sync identity at all; (c) propose identity changes as review items every time.
- **Reasoning**: The SMS owns the customer relationship; the provider owns the service. Default-deny means the worst case of a surprising export is a suppressed proposal, recorded in `suppressed_by_policy` so the operator can see what *would* have changed and enable the flag deliberately.
- **Tradeoffs**: Genuine upstream corrections have to be applied by hand unless a flag is turned on. Some flags exist as defaults with no UI yet — deliberately, so the default exists before the feature.
- **Revisit when**: An operator runs a large onboarding import where provider identity is the *better* source; enable per field for that provider rather than changing the default.

## ADR-019 — `sync_policy` is read only through a merge-with-defaults helper

- **Decision**: `sync_policy` is read only through `getSyncPolicy(provider)`, which merges the stored JSON over the current defaults. A **missing key takes its documented default**, never `false` or `undefined`. Direct `sync_policy.<key>` access is forbidden anywhere else. (INV-50)
- **Context**: `sync_policy` is a JSONB column on `providers` (ADR-rationale: a table keyed 1:1 on `provider_id` is a column set in disguise). Rows written before a flag existed simply lack that key.
- **Alternatives**: (a) a real table with a column per flag and DB defaults; (b) backfill every provider row on each new flag; (c) treat a missing key as `false`.
- **Reasoning**: Reading a missing key as falsy is the silent-failure case: a ninth flag added tomorrow would arrive switched off for every existing provider, and a flag that defaults to *allow* (like `create_charges`) would disable charge creation across the board with no error. One helper makes the default set the single source of truth and removes the need for a backfill migration per flag.
- **Tradeoffs**: A convention the compiler cannot enforce — it relies on review and on `syncPolicy.test.ts`. Defaults live in code, not in the database, so a direct SQL read of the column is not the effective policy.
- **Revisit when**: The flag set stabilises and grows past what a JSON blob comfortably documents, or non-boolean policy values (thresholds, lists) appear.

## ADR-020 — `subscriber_provider_state`: one row per (subscriber, provider)

- **Decision**: Upstream per-provider state — plan name, service window, raw status, provider customer number, last seen — lives in `subscriber_provider_state`, one row per `(subscriber, provider)`. It is not a growing set of per-provider columns on `subscribers`.
- **Context**: `subscribers.cable_provider_id` / `internet_provider_id` record *which* provider serves a subscriber, and 6.5-M added `hathway_customer_nbr`, but there was nowhere to hold upstream plan/window/status. The wide-row habit (ADR-002) would have added another vendor-named column per provider per field.
- **Alternatives**: (a) more columns on `subscribers`; (b) a JSONB blob keyed by provider id on the subscriber row; (c) reuse the `subscriptions` table for upstream state.
- **Reasoning**: The relationship is genuinely many-per-subscriber and unbounded in providers, which is where ADR-002's wide-row reasoning stops applying. A child table keeps provider state out of the god-row, gives each provider link its own attribution and timestamps, and makes "everything we know about this customer at this provider" one query. Mixing upstream state into `subscriptions` would blur evidence with the ledger, which ADR-014 forbids. `hathway_customer_nbr` remains a legacy read path; new writes go to `provider_customer_number`.
- **Tradeoffs**: One more join on the profile screen. Two identity sources coexist until the legacy column is backfilled and dropped.
- **Revisit when**: The legacy column is retired (its own batch), or per-provider state grows enough structure to deserve its own history table.

## ADR-021 — Unknown provider status values are preserved verbatim

- **Decision**: `provider_status` stores the raw provider string, always. Business logic derives `is_active = (raw === 'ACTIVE')` separately. Unrecognised values are never discarded, normalised, or bucketed — they are shown to the operator verbatim. No list of inactive states is hardcoded.
- **Context**: Only `ACTIVE` is confirmed from the sample (400/400 rows). Hathway's full status vocabulary is unknown and can change without notice.
- **Alternatives**: (a) map to a local enum and reject unknown values; (b) map to a local enum with an `unknown` bucket; (c) guess the inactive vocabulary from the provider's UI.
- **Reasoning**: A guessed mapping fails in the most dangerous direction — an unknown status silently bucketed as "inactive" looks like a disconnection and can drive termination logic. Storing the raw string means a new value shows up in review as itself, and the only decision the code makes is one it can actually justify. Related rule: absence from an export is never evidence of termination either; a missing row only ages `last_seen_in_snapshot_at`.
- **Tradeoffs**: No clean enum to filter on; UI shows provider vocabulary rather than ours. Nothing but `ACTIVE` drives automation, so a real disconnection is noticed by a human, not by the system.
- **Revisit when**: The provider documents its status vocabulary, or enough real values are observed to map them confidently — even then, keep the raw string and add the mapping beside it.

## ADR-022 — A manually entered provider account number is a first-class identity key

- **Decision**: A manually entered provider identifier (`subscriber_provider_state.provider_customer_number`, recorded from the customer profile) is a **first-class deterministic identity key**, ranked equally with sync-written links — matching reads the union of both. A number claimed by two customers is ambiguous: it matches nobody and must be corrected by an operator. (INV-52)
- **Context**: Operators know the account number long before an import ever links the customer. Treating an operator-typed key as weaker than a machine-written one would send known customers to `needs_review` for no reason.
- **Alternatives**: (a) trust only sync-written links; (b) treat manual entry as a suggestion surfaced in review; (c) let the most recently written link win a collision.
- **Reasoning**: A key is either deterministic or it is not; who typed it does not change that. Collisions are the real risk, so `save_provider_account` refuses a number already claimed by another customer, and `loadReviewContext` drops ambiguous keys instead of picking a winner. The match order stays VC Id → STB serial → account number; mobile is never a match at any tier, because households share numbers.
- **Tradeoffs**: A typo becomes a hard mismatch rather than a soft one. Collision resolution is manual by design.
- **Revisit when**: A provider issues account numbers that are genuinely shared across customers, which would demote it out of the deterministic tier.

## ADR-023 — A committed import freezes its own interpretation

- **Decision**: A committed provider import is a **historical record**: its interpretation must never depend on mutable reference tables. `provider_plan_key`, `pack_id`, `pack_name`, `pack_price`, `provider_cost` and `parser_version` are frozen onto the run at commit time. Renaming, remapping or repricing a pack later must not change what an old import meant. (INV-51)
- **Context**: Pack mappings, pack names and prices are all operator-editable. A run report that resolves them at read time would quietly rewrite history every time the catalog changed — the same failure mode ADR-006 accepts for PDFs and that is not acceptable for an audit record.
- **Alternatives**: (a) resolve by id at read time; (b) version the catalog (`pack_versions`) and reference a version; (c) accept the drift.
- **Reasoning**: Snapshotting the six fields into `results` is far cheaper than catalog versioning and answers the only question that matters — "what did this import decide, and on what basis?" Freezing `parser_version` extends the same guarantee to the parse step, so a later parser fix cannot retroactively change how an old file was read. Committed runs are immutable, so the snapshot cannot be edited afterwards.
- **Tradeoffs**: Redundant data in `results`. An old run report can show a pack name that no longer exists, which is correct but can confuse — the UI labels these as historical.
- **Revisit when**: Catalog versioning lands for other reasons; the frozen fields could then become version references.

## ADR-024 — Renewal, plan change and activation are distinct operations

- **Decision**: `extend_subscription()` extends an existing active subscription in place — this is a renewal, and it targets a specific device when the subscriber has more than one active subscription. A fresh activation goes through `create_subscription()`. A plan change remains cancel + create, tagged with reason `plan_change`, pending a future dedicated `change_subscription_pack()`.
- **Context**: The first import treated every renewal as a new activation, which produced a second active subscription for the same device and broke the "one active subscription per (subscriber, service_type, device)" rule. Multi-STB households made the device ambiguity concrete: extending "the" subscription is meaningless when there are three.
- **Alternatives**: (a) cancel + create for renewals too; (b) one generic `upsert_subscription()` covering all three; (c) let the import pick any active subscription when the device is ambiguous.
- **Reasoning**: The three cases mean different things to the operator and to analytics, and collapsing them loses that. Extending in place keeps subscription identity stable across renewals, so renewal lineage stays intact. Where the device cannot be resolved, `extend_subscription` raises rather than guessing, and `commit_provider_import` pushes the row to `failed_keys` for review — a failed row that the operator sees beats a silent extension of the wrong connection. Plan change stays cancel + create because it genuinely ends one commercial arrangement and starts another; the reason code makes it distinguishable from a churn cancellation.
- **Tradeoffs**: Three call paths to maintain instead of one. Plan changes still churn the subscription id, so lineage across a plan change is reconstructed from the reason code rather than a foreign key — that is what `change_subscription_pack()` would fix.
- **Revisit when**: Plan changes become frequent enough that analytics needs first-class lineage, or a second provider needs different renewal semantics. The concrete next step when that trigger fires is to build a dedicated `change_subscription_pack()` operation that mutates the subscription in place and preserves its identity, replacing the current cancel + create tagged `plan_change` interim.
