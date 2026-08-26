# Provider integration — direction note (superseded plan)

> **This file is not the current architecture.**
> The canonical document for provider integration is
> **`docs/PROVIDER_SYNC_IMPLEMENTATION_PLAN.md`**. Read that first.
> Status of the workstream lives in `docs/PROJECT_STATUS.md`.

## What changed

An earlier version of this file (2026-07-28) described a
**write-through-first** design: the operator would act inside the SMS, the
app would record a `provider_action_intent` row, and the operator would then
be guided to reproduce the same action on the Hathway portal (checklist →
deep link → optional browser automation). Reactive snapshot import was
framed as a safety net behind it.

**That direction was reversed on 2026-07-31.** Hathway gives the operator no
API and no write access of any kind, and in practice the operator provisions
directly on the Hathway portal — the portal always acts first. A model where
our app leads and the portal follows describes a workflow that does not
exist.

## What is actually built

**Reactive snapshot synchronization is the primary integration mechanism**,
not a fallback:

1. The operator exports a report from the Hathway portal
   (Customer Master or Dashboard Status).
2. The report is uploaded and parsed into rows.
3. The rows are diffed against the last **committed** import run.
4. The operator reviews every proposed change and approves the run.
5. `commit_provider_import` writes the approved changes — and only then.

Nothing is written before approval, and nothing runs on a schedule.
See ADR-013 … ADR-024 in `docs/ARCHITECTURE_DECISIONS.md` for the decisions
behind each part, and `docs/SYSTEM_INVARIANTS.md` for the rules the code
enforces.

## The write-through-assist idea (possible future direction)

The A0/A1/A2 tiering is kept here as an idea, **not** as current
architecture:

- **A0 — checklist.** After an in-app action, show the operator the exact
  steps to repeat on the portal.
- **A1 — deep link.** Open the relevant portal screen pre-filled where the
  portal URL scheme allows it.
- **A2 — assisted automation.** An out-of-process browser agent replays the
  action on the portal under operator supervision.

This would only become worth building if the operator starts to act in the
SMS *before* the portal often enough that the double entry becomes the main
pain point. Even then it sits **on top of** reactive sync, which stays the
system of record for what the provider actually did. There is no
`provider_action_intent` table, and none is planned.
