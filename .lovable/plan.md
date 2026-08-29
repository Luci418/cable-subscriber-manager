# Documentation fix: ADR-024 "Revisit when" trigger

## Problem
ADR-024 documents that plan changes currently use cancel + create, tagged with reason `plan_change`, as an interim solution pending a future dedicated `change_subscription_pack()`. However, the "Revisit when" field only describes the *conditions* (plan-change frequency, analytics need for lineage, second provider) and does not explicitly name the concrete follow-up work. This makes the interim solution read more permanently than intended.

## Change
Update ADR-024's "Revisit when" bullet in `docs/ARCHITECTURE_DECISIONS.md` to explicitly flag the future work: build a dedicated `change_subscription_pack()` RPC (or equivalent) that preserves subscription identity across plan changes instead of churning the subscription id.

## Proposed new wording
```
- **Revisit when**: Plan changes become frequent enough that analytics needs first-class lineage, or a second provider needs different renewal semantics. The concrete next step when that trigger fires is to build a dedicated `change_subscription_pack()` operation that mutates the subscription in place and preserves its identity, replacing the current cancel + create tagged `plan_change` interim.
```

## Scope
- Single-file edit: `docs/ARCHITECTURE_DECISIONS.md`, lines 235 only.
- No code changes, no schema changes, no tests required.

## Acceptance
- ADR-024 "Revisit when" explicitly mentions `change_subscription_pack()` as the planned replacement for the interim cancel+create approach.
- No other ADR content changes.
