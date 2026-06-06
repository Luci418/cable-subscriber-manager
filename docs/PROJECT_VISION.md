# Project Vision

## Purpose

An operational tool for a regional **Subscriber-based Service Operator** —
today a Cable TV + ISP business, tomorrow potentially other connectivity or
content services. The system replaces paper ledgers and spreadsheets used by
small operators to track who subscribes, what they pay, what they owe, and
what equipment is in the field.

The product is sometimes called the "Khatabook for cable operators" — that
analogy is intentional: the bar for adoption is **simpler than a notebook**,
not more powerful than enterprise telecom software.

## Target Users

| Role | Primary needs |
|---|---|
| **Owner** | Revenue/subscriber visibility, growth trends, collection efficiency |
| **Office staff** | Add/edit subscribers, record payments, generate receipts, handle complaints |
| **Collection agent** | Quickly look up balances, log payments in the field |
| **Technician** | See subscriber address/contact, log STB assignments, raise complaints |

## Business Goals

1. **Replace ledgers.** Every payment, charge, and subscription change is
   captured in one place that survives staff turnover.
2. **Cut revenue leakage.** Make outstanding balances and expired subscriptions
   visible so collections happen on time.
3. **Make the owner's decisions data-driven.** Provider performance, regional
   growth, churn, plan mix — surfaced without spreadsheets.
4. **Low operating cost.** Runs on a free-tier backend; one operator should
   never pay more than a coffee per month to keep it online.

## Non-Goals (today)

- Enterprise OSS/BSS, telco-grade billing, or CDR/usage rating.
- Multi-tenant SaaS for many operators sharing one deployment.
- Customer-facing self-service portal or mobile app.
- Real-time bandwidth provisioning or RADIUS integration.
- Field-force routing / dispatch optimization.
- Accounting-grade GL (no double-entry, no tax filings).

These are not forbidden forever — see [FUTURE_EVOLUTION.md](./FUTURE_EVOLUTION.md).
They are simply not what today's design optimizes for.

## Target Scale

- **Subscribers**: hundreds to a few thousand per operator.
- **Transactions**: tens of thousands per year per operator.
- **Concurrent staff users**: 1–10.
- **Geography**: a single town/district per operator instance.

Architectural decisions assume this scale. A redesign would be appropriate
before crossing ~50k subscribers or going multi-tenant.

## Design Philosophy

- **Simple beats clever.** A wide-row subscriber model is easier to read and
  back up than a normalized one — and it's fine at this scale.
- **Operational reality over textbook purity.** Stored balances + reconcilers
  beat "always compute from transactions" because cashiers need instant numbers.
- **Business concepts, not current configuration.** The schema names entities
  (`provider`, `service_type`) so adding BSNL/Fastnet/IPTV/OTT later is data,
  not code.
- **Defer until it hurts.** No invoice entity, no service_subscription table,
  no event bus — until a real pain point demands them.
- **Reversibility > optimality.** Every decision in the ADR has revisit
  conditions. We expect to change our minds.

## Future Possibilities

Tracked separately in [FUTURE_EVOLUTION.md](./FUTURE_EVOLUTION.md). They are
*possibilities*, not roadmap commitments.
