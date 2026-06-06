# Documentation Audit Report

_Date: 2026-06-06_

## 1. Inventory (before this pass)

| File | Status | Notes |
|---|---|---|
| `README.md` | Present | Default Lovable scaffold; non-project-specific. |
| `docs/DEVELOPER_GUIDE.md` | Present, 1,763 lines | Comprehensive code-level reference. **Stale** on the data model: predates the cable/internet split, the per-service balances (`cable_balance`, `internet_balance`), and the Provider entity. ER diagram in §4 is outdated. |
| `mem://` project memory | Present | Captures rules (subscription mgmt, invoices, STB inventory, balances, providers, etc.). Authoritative for behavior; should be reflected in BUSINESS_RULES.md. |
| Architecture overview doc | Missing | No standalone doc; informal architecture lives in chat history + DEVELOPER_GUIDE §2/§4. |
| ER diagram | Stale | The one in DEVELOPER_GUIDE is pre-internet, pre-provider. |
| Roadmap docs | Missing as committed files | Roadmaps existed only in chat history. |
| Architecture Decision Record | Missing | Decisions scattered across DEVELOPER_GUIDE "Why these choices" subsections — not in ADR shape. |
| CHANGELOG | Missing | No release history. |
| Release notes | Missing | No per-version notes. |
| Deployment doc | Missing | Default Lovable README references "Publish" only. |
| Analytics doc | Missing | Implementation lives in code; intent undocumented. |
| Production readiness checklist | Missing | No formal pre-go-live review. |
| Security memory | Present (system) | Managed via tooling; no app-specific memory yet. |

## 2. Quality assessment of existing docs

### `docs/DEVELOPER_GUIDE.md`
- **Strengths**: thorough; covers components, hooks, utility functions, RLS, PDF generation, common patterns.
- **Weaknesses**:
  - ER diagram and schema sections describe a single `balance` column and a single subscription blob — the schema has since split into per-service columns.
  - Pack table description omits `service_type`, `provider_id`, `validity_days`, `billing_type`.
  - No mention of providers, internet subscriptions, regions table, services array, or STB device_type/service_type.
  - No cross-references to business rules, ADRs, or operational docs (because none existed).
- **Recommendation**: **keep as the code-level reference** and add a header pointing to the new docs. Schema/ER refresh can happen incrementally during the next focused pass — they're worth fixing but not in this single doc commit.

### `README.md`
- Default Lovable scaffold. Acceptable; project-specific content lives under `docs/`.

## 3. Missing documentation (now created)

| New file | Role |
|---|---|
| `docs/README.md` | Doc index; the single map. |
| `docs/PROJECT_VISION.md` | Purpose, users, goals, non-goals, scale, philosophy. |
| `docs/ARCHITECTURE_DECISIONS.md` | ADR log with revisit conditions. |
| `docs/BUSINESS_RULES.md` | Domain behavior in plain language. |
| `docs/ANALYTICS_STRATEGY.md` | Every metric tied to a decision. |
| `docs/FUTURE_EVOLUTION.md` | Possibilities, not commitments. |
| `docs/PRODUCTION_READINESS.md` | Pre-go-live checklist + DR. |
| `docs/DEPLOYMENT.md` | Vercel + Supabase reference, sizing, operational checks. |
| `docs/releases/v0.9.0.md` | Provider rollout release notes. |
| `CHANGELOG.md` | Human-readable history. |

## 4. Recommended documentation structure

```
/
├── README.md                  ← project intro (links into docs/)
├── CHANGELOG.md               ← what changed, when, why (human-readable)
└── docs/
    ├── README.md              ← documentation index (this map)
    ├── PROJECT_VISION.md      ← why we exist
    ├── ARCHITECTURE_DECISIONS.md ← ADR log
    ├── BUSINESS_RULES.md      ← domain behavior
    ├── ANALYTICS_STRATEGY.md  ← metric intent + audiences
    ├── DEVELOPER_GUIDE.md     ← code-level reference (existing)
    ├── DEPLOYMENT.md          ← how to deploy / operate
    ├── PRODUCTION_READINESS.md ← go-live checklist + DR
    ├── FUTURE_EVOLUTION.md    ← possibilities (not roadmap)
    ├── AUDIT_REPORT.md        ← this file (kept for traceability)
    └── releases/
        ├── v0.9.0.md
        └── v0.10.0.md (future)
```

## 5. Cross-reference rules

- **DEVELOPER_GUIDE** is the code reference. It links *out* to BUSINESS_RULES
  for "why this happens" and to ARCHITECTURE_DECISIONS for "why it's built
  this way."
- **BUSINESS_RULES** is the behavior reference. It does not contain code.
- **ARCHITECTURE_DECISIONS** is append-mostly. To revise a decision, add a
  new ADR superseding the old one.
- **ANALYTICS_STRATEGY** owns every metric definition. The Analytics page
  should not introduce a metric not listed here.
- **FUTURE_EVOLUTION** is non-binding ideas. Promotion to "doing" requires an
  ADR.
- **CHANGELOG + releases/** is the history. Every user-visible change lands
  in both.

## 6. Follow-ups (not done in this pass)

These are deliberately deferred to keep this pass focused on **structure**:

1. **Refresh DEVELOPER_GUIDE.md §4–§5** to reflect the current schema
   (per-service balances, providers, internet subscriptions, services array,
   STB device_type, regions table). Estimated 1–2 hours; safe to do in a
   dedicated PR.
2. **Add a real ER diagram** (Mermaid or dbdiagram.io export) committed under
   `docs/diagrams/`.
3. **Quarterly doc-drift review** — add to operator's calendar.
