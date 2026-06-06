# Future Evolution

> **These are possibilities, not commitments.** Listing an idea here does not
> mean it is on the roadmap. The purpose of this document is to make sure
> today's architectural decisions don't *block* tomorrow's options.

When something here moves from "possible" to "doing it," it should:
1. Get an ADR entry in [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md).
2. Get added to the CHANGELOG when shipped.
3. Be removed (or moved to "done") from this document.

---

## 1. Service Subscription Normalization

**Idea.** Replace the JSONB `current_subscription` / `subscription_history[]`
blobs with a proper `service_subscriptions` table keyed by
`(subscriber_id, service_type)`.

**Why one day.** Concurrent subscriptions per service, cohort analytics, MRR
math, multi-tenant queries. Today's design (ADR-004) defers this — but
deliberately keeps the door open.

**Migration sketch.**
```
service_subscription
  id, subscriber_id, service_type, provider_id, pack_id,
  start_date, end_date, status, origin, previous_subscription_id,
  cancelled_at, cancel_reason
```
Backfill from existing JSONB blobs. Keep the JSONB columns read-only for one
release to allow rollback.

**Trigger.** See ADR-008 revisit conditions.

---

## 2. Invoice & Payment Entities

**Idea.** Introduce a first-class `invoices` table with `invoice_line_items`
and link `payments` to invoices.

**Why one day.** GST / tax compliance, legal invoice register with
tamper-evident sequence numbers, "regenerate the exact PDF I sent in March"
guarantees, partial-payment allocation across invoices.

**Why not today.** The operator does not currently file GST and the dynamic
PDF approach (ADR-006) covers the operational need.

**Trigger.** Tax compliance requirement, OR auditor request, OR multi-tenant
SaaS launch.

---

## 3. Multi-Operator SaaS

**Idea.** One deployment serving many operators with isolation, billing,
shared catalog of providers, and operator onboarding.

**What it implies.**
- Tenant identifier on every row (today: `user_id` doubles as tenant — works
  for single-user operators, not for multi-staff operators).
- A real **role model** (owner / staff / agent / technician) — see ADR-009.
- A shared provider catalog *and* per-tenant provider overrides.
- Operator-level billing (subscription to *us*), separate from the
  subscriber-level billing the system already handles.
- Per-tenant rate limiting and quota.
- Data export / data portability for tenants leaving the platform.

**Why not today.** YAGNI for a single regional operator. But every ADR in the
log has been chosen to *not block* this path.

---

## 4. Multi-Staff Roles & Audit Trail

**Idea.** Add `user_roles` (owner / office / agent / technician) using the
canonical pattern in project memory. Add an audit log of who changed what.

**Why one day.** Even within a single operator, owners want to know "who
deleted this transaction" once they have more than two staff.

**Why not today.** Staff currently share the owner's account; the trust model
is informal.

**Effort.** Moderate. The pattern is well-understood. No data migration; new
rows on existing tables.

---

## 5. Additional Service Categories

**Idea.** IPTV, OTT bundles, Static IP, VoIP, Smart-home services.

**Today.** The wide-row subscriber model (ADR-002) starts to creak around
3+ services. Adding a fourth would justify migrating to ADR-008 (normalized
subscriptions). Until then, new categories can be added as additional service
keys + columns.

---

## 6. Mobile Applications

### 6a. Operator staff app
**Idea.** A field-agent app for recording collections offline, with sync
on reconnect.

**Why one day.** Field agents on motorbikes with patchy networks.

**Why not today.** The web app is responsive and works on phones for the
small operator's current workflow.

### 6b. Subscriber self-service app
**Idea.** Subscribers view their balance, pay online, raise complaints.

**Why one day.** Operator differentiation, reduced cash handling.

**Why not today.** Requires payment gateway integration, customer-facing auth,
and a support contract the operator isn't ready for.

---

## 7. Payment Gateway / UPI Integration

**Idea.** Direct UPI collection links, auto-reconciliation of bank webhooks
into `payment` transactions.

**Why one day.** Eliminates manual data entry, reduces leakage.

**Why not today.** Requires KYC/merchant onboarding the operator hasn't done.
The architecture already separates "transaction" from "collection method," so
adding a `payment_method = 'upi'` and a webhook ingester is a clean add later.

---

## 8. Analytics Warehouse

**Idea.** Mirror data to a warehouse (BigQuery / ClickHouse / DuckDB).

**Why one day.** Cross-tenant analytics in a SaaS scenario, complex cohort
analysis, BI tool integration.

**Why not today.** A handful of materialized views in Postgres beats a
separate stack at our scale ([ANALYTICS_STRATEGY](./ANALYTICS_STRATEGY.md) §5).

---

## 9. Network Provisioning Integration

**Idea.** Talk to RADIUS / OLT / CMTS to actually enable/disable a
subscriber's service when their subscription starts/ends.

**Why one day.** True end-to-end automation.

**Why not today.** Operator currently does this manually. Integration is
vendor-specific and out of scope for an MVP operational tool.

---

## What we will *not* pursue (anti-goals)

- Becoming a generic accounting package (we're not Tally).
- Becoming a CRM (we track operational truth, not sales-pipeline opinions).
- Realtime collaboration (Google-Docs-style multi-cursor editing) — wrong
  primitive for ledger work.
