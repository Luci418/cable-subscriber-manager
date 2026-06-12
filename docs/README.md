# Documentation Index

This directory is the single source of truth for the Subscriber Management System.
Each document has a distinct purpose — please extend the existing file instead
of creating parallel versions.

## Map

| Document | Purpose | Audience |
|---|---|---|
| [PROJECT_VISION.md](./PROJECT_VISION.md) | Why this system exists, who it serves, what it is *not* | Everyone |
| [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md) | ADR log: every significant design decision, context, and revisit conditions | Engineers, reviewers |
| [BUSINESS_MODEL.md](./BUSINESS_MODEL.md) | **Authoritative** business model, lifecycle decisions, and invariant matrix (INV-01…INV-33). Read before any Phase 3/4/5 work. | Everyone |
| [BUSINESS_RULES.md](./BUSINESS_RULES.md) | Plain-language summary of domain behavior. Cross-refs BUSINESS_MODEL.md. | Owner, staff, engineers |
| [ANALYTICS_STRATEGY.md](./ANALYTICS_STRATEGY.md) | Every metric, why it exists, who uses it | Owner, product |
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) | Code-level reference: components, hooks, schema, patterns | Engineers |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | How to deploy and operate the system on a low-cost stack | Operator, on-call |
| [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) | Checklist: can this be safely run today? | Owner, engineers |
| [FUTURE_EVOLUTION.md](./FUTURE_EVOLUTION.md) | Possibilities (SaaS, multi-operator, service lines). Not commitments. | Strategy |
| [AUDIT_REPORT.md](./AUDIT_REPORT.md) | One-time documentation audit + recommended structure | Reviewers |
| [LIFECYCLE_AUDIT_2026-06.md](./LIFECYCLE_AUDIT_2026-06.md) | Operational lifecycle integrity audit — states, transitions, deletion/archive rules, invalid states, A0 fixes | Reviewers, engineers |
| [REVIEW_RESPONSE_2026-06.md](./REVIEW_RESPONSE_2026-06.md) | Response to external architecture review + revised roadmap | Reviewers |
| [FINANCIAL_LIFECYCLE_REVIEW_2026-06.md](./FINANCIAL_LIFECYCLE_REVIEW_2026-06.md) | Financial-record philosophy: append-only ledger, void vs reversal, edit/delete rules (ADR-011) | Owner, reviewers, engineers |
| [releases/](./releases/) | Per-version release notes | Operator |
| [../CHANGELOG.md](../CHANGELOG.md) | Human-readable changelog | Everyone |

## Conventions

- **Versioning**: Semantic versioning (Major.Minor.Patch). See CHANGELOG.md.
- **Decision changes**: Add a new ADR entry; do not silently rewrite old ones.
- **Business rule changes**: Update BUSINESS_RULES.md *and* note in CHANGELOG.
- **No duplication**: If two docs say the same thing, one is wrong. Cross-reference instead.

## Modeling philosophy

Documents describe *business concepts*, not the current configuration.
"Provider" means *any upstream service source* (carrier, franchisee, internal
network, reseller, future operator). "Service Type" means *any category of
service offered to subscribers* (Cable TV, Internet, IPTV, OTT, Static IP,
future categories). Today's list of providers and services is an *example*,
never a constraint baked into the architecture.
