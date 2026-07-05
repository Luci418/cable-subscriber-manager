# Documentation Index

The single directory of truth. Each doc has a distinct job — extend the
existing file instead of creating parallel versions.

## Status & governance

| Document | Purpose |
|---|---|
| [PROJECT_STATUS.md](./PROJECT_STATUS.md) | **Start here.** Current milestone, completed phases, deferred work, technical debt, architecture evolution. |
| [SYSTEM_INVARIANTS.md](./SYSTEM_INVARIANTS.md) | Rules that must never be broken; where each is enforced; test coverage status. |
| [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) | Go-live checklist + Technical Debt section. |
| [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md) | ADR log. Add a new entry; do not silently rewrite. |
| [../CHANGELOG.md](../CHANGELOG.md) | Human-readable changelog. |

## Domain

| Document | Purpose |
|---|---|
| [PROJECT_VISION.md](./PROJECT_VISION.md) | Why the system exists; who it serves; what it is *not*. |
| [BUSINESS_MODEL.md](./BUSINESS_MODEL.md) | Authoritative domain model + invariant catalogue (INV-01…INV-33). |
| [BUSINESS_RULES.md](./BUSINESS_RULES.md) | Plain-language summary of behaviour. Cross-refs BUSINESS_MODEL. |
| [ANALYTICS_STRATEGY.md](./ANALYTICS_STRATEGY.md) | Every metric, why it exists, who uses it. |
| [FUTURE_EVOLUTION.md](./FUTURE_EVOLUTION.md) | Possibilities. Not commitments. |

## Engineering

| Document | Purpose |
|---|---|
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) | Code-level reference: components, hooks, schema, patterns. |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Deploy + operate on the low-cost stack. |
| [TESTING_ARCHITECTURE.md](./TESTING_ARCHITECTURE.md) | Target testing layers and rollout order. |
| [QA_TEST_PLAN.md](./QA_TEST_PLAN.md) | Manual regression checklist + review gates. |
| [DESTRUCTIVE_OPERATIONS_AUDIT.md](./DESTRUCTIVE_OPERATIONS_AUDIT.md) | Every delete/destructive path, gate status, findings. |
| [LEGACY_DEPENDENCY_AUDIT.md](./LEGACY_DEPENDENCY_AUDIT.md) | Remaining legacy columns/wrappers + batch retirement plan. |

## Roles & security

| Document | Purpose |
|---|---|
| [PERMISSION_MATRIX.md](./PERMISSION_MATRIX.md) | Every gated action × role, plus attribution columns. |
| [ROLE_DESIGN.md](./ROLE_DESIGN.md) | What each role is for; job-function definitions. |

## Historical / reference

| Document | Purpose |
|---|---|
| [AUDIT_REPORT.md](./AUDIT_REPORT.md) | One-time doc audit (initial pass). |
| [LIFECYCLE_AUDIT_2026-06.md](./LIFECYCLE_AUDIT_2026-06.md) | Operational lifecycle audit (June 2026). |
| [FINANCIAL_LIFECYCLE_REVIEW_2026-06.md](./FINANCIAL_LIFECYCLE_REVIEW_2026-06.md) | Ledger philosophy (ADR-011). |
| [REVIEW_RESPONSE_2026-06.md](./REVIEW_RESPONSE_2026-06.md) | Response to external architecture review. |
| [INVARIANT_WORKSHEET.md](./INVARIANT_WORKSHEET.md) | Worksheet feeding SYSTEM_INVARIANTS. |
| [INDUSTRY_BENCHMARKING_ADDENDUM.md](./INDUSTRY_BENCHMARKING_ADDENDUM.md) | Benchmarking notes. |
| [OPERATOR_WORKFLOW_UI_REVIEW.md](./OPERATOR_WORKFLOW_UI_REVIEW.md) | UI-workflow review. |
| [releases/](./releases/) | Per-version release notes. |
| [archive/](./archive/) | Superseded phase plans and audits. |

## Conventions

- **Versioning:** semver; see CHANGELOG.md.
- **Decision changes:** add a new ADR; do not silently rewrite old ones.
- **Business-rule changes:** update BUSINESS_RULES.md *and* note in
  CHANGELOG.
- **Status updates:** PROJECT_STATUS.md at the end of every milestone.
- **No duplication:** if two docs say the same thing, one is wrong.
  Cross-reference instead.

## Modeling philosophy

Documents describe *business concepts*, not the current configuration.
"Provider" means *any upstream service source*. "Service Type" means
*any category of service offered*. Today's list is an *example*, never
a constraint baked into the architecture.
