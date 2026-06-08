# Financial Record Lifecycle Review — June 2026

> Status: **Philosophy adopted. Schema migrated. UI shipped. Grace window dropped (2026-06-08).**
> Companion to `LIFECYCLE_AUDIT_2026-06.md` and `REVIEW_RESPONSE_2026-06.md`.
> Supersedes the ad-hoc "edit with password / hard delete" model documented
> in earlier versions of `BUSINESS_RULES.md`.

> **Revision note (2026-06-08).** The 5-minute grace window described in
> sections 3–5 below has been **removed**. After implementing the void
> workflow, we re-examined whether the grace window earned its complexity
> and concluded it did not: void already covers fat-finger fixes cleanly,
> the timer added UX surprises ("why can't I edit this anymore?"), and the
> dual delete-vs-void path was a training burden. The operative rule is
> now the simplest possible one:
>
> - Financial fields are immutable from the moment a transaction is saved.
> - Transactions are never deleted.
> - Corrections use **Void** (offsetting reversal row, audit-trailed) and,
>   if needed, a fresh replacement transaction.
> - Refunds remain a separate real-world event posted as `refund` rows.
> - Receipt generation is never blocked by timing logic — every persisted
>   row is already final.
>
> Enforcement is in the database (`transactions_enforce_immutability`
> trigger). The text below preserves the original reasoning that led to
> the grace-window proposal; treat any references to "5-minute window" or
> "grace-window delete" as historical. The current rule is **immutable on
> save**.


This review answers a single question the operator asked:

> Can the system accurately explain how it arrived at the current balance?

Today, the honest answer is **no**. Balances are correct (the new Tier-0
trigger guarantees that), but the *story* behind them is editable and
erasable. This document proposes a coherent philosophy, contrasts it with
the current behavior, and records the architectural decision.

---

## 1. Assessment of the current transaction lifecycle

### 1.1 What exists today

| Action | Mechanism | Audit trace |
|---|---|---|
| Create transaction | `INSERT` into `transactions`; balance trigger updates subscriber | `created_at`, `created_by` (new) |
| Edit transaction | `UPDATE` in place, password-gated (`1234` hard-coded) | `edited_at`, `edited_by` (new) — but **previous values are lost** |
| Delete transaction | `DELETE` row; balance trigger recomputes | **None** — row is gone |
| Cancel subscription with refund | Inserts a `refund` transaction | Good — already append-only |

### 1.2 What this means in practice

- A ₹500 payment edited to ₹550 leaves no record that ₹500 was ever entered.
- A duplicate payment deleted leaves no record it existed.
- A wrong-subscriber payment edited to point at the right subscriber
  silently rewrites *two* subscribers' history.
- The "password" gate (`1234`) is theatre; it neither identifies the editor
  nor prevents accidental destruction.

### 1.3 Why this is a problem now (and was not before)

Until last week, balances were mutated client-side at the same moment as
the transaction, so an edit/delete *was* the audit trail. With the Tier-0
trigger, balances are now derived from the ledger. The ledger is therefore
the single source of financial truth — and a source of truth that is
silently rewritable is not a source of truth.

---

## 2. Risks in the current model

| Risk | Likelihood | Impact |
|---|---|---|
| Lost payment record (delete) | Medium | High — operator can't prove receipt; subscriber dispute is unwinnable |
| Silent amount change | Medium | High — analytics, GST, daily-cash reconciliation all wrong |
| Wrong-subscriber edit | Low | Medium — two subscribers' histories diverge from reality |
| Provider attribution rewritten | Medium | Medium — revenue-by-source reports drift retroactively |
| No "who did this" trail | High | Low today (single operator), High once staff are added |
| Restored backup ≠ current state | Always | High — backups capture rows; if rows are mutable, restore is a snapshot of an undefined moment |

The first three are the operator's real exposure. The rest follow.

---

## 3. Alternative approaches considered

### Option A — Status quo (mutable ledger, password gate)
Cheap, familiar, dangerous. Rejected for the reasons above.

### Option B — Pure immutable ledger (no edits, no deletes ever)
Textbook accounting. Every mistake corrected by a reversing entry. Safest;
also the most disruptive to a one-person operation that currently fixes a
typo in 5 seconds.

### Option C — **Hybrid: immutable financial fields, mutable metadata, void via reversal** ← chosen
- Financial fields (`amount`, `type`, `service_type`, `subscriber_id`,
  `provider_id`, `date`) are **never** edited after insert.
- Operational metadata (`description`, future `notes`, future `payment_method`)
  **is** editable, and the edit history is auditable.
- "Delete" is replaced by **void**, which inserts an offsetting reversal
  row and marks both rows as `voided` / `reversal`. The original stays
  visible.
- A narrow grace window (same operator, ≤ 5 minutes, transaction not yet
  in a closed day) permits hard correction for genuine fat-finger entries.
  Tracked via `created_at` and `created_by` — no separate flag needed.

This is the model adopted. See ADR-011.

---

## 4. Void vs Reversal — applied to real scenarios

**Definitions in this codebase:**

- **Void** = the original entry was a *mistake that never should have existed*.
  Implemented as: insert an offsetting `reversal` row, mark the original
  `status = 'voided'`, link via `reverses_transaction_id`. Net effect on
  balance: zero. Both rows remain visible; reports filter `status = 'posted'`
  by default but can show voided entries for audit.

- **Reversal** = the original entry was *legitimate at the time*, but a real-world
  event later undoes it (refund, chargeback, returned cheque). Implemented
  as: insert a new transaction of opposite type (`refund` against a
  `payment`, or a negative `charge`) with `reverses_transaction_id`
  pointing at the original. The original keeps `status = 'posted'`.

**The structural difference is the status of the original row, not the SQL.**

| Scenario | Treatment | Why |
|---|---|---|
| Wrong amount entered (₹500 vs ₹550) | **Void** original + create correct entry | The ₹500 never happened; the books should reflect the actual ₹550 receipt with a clear "voided typo" audit trail |
| Wrong subscriber selected | **Void** original on subscriber A + create on subscriber B | Same — the entry on A never reflected reality |
| Duplicate payment entry | **Void** the duplicate | The duplicate never happened |
| Charge created accidentally | **Void** the charge | Never billed |
| Subscription cancellation with refund | **Reversal** (refund transaction) | The original payment was real; the refund is a new real event with its own date and reason |
| Cheque bounced after payment recorded | **Reversal** (refund + note) | Same — payment was real, bounce is a later real event |
| Promotional credit later clawed back | **Reversal** | Both events are real |

**Operator-facing UI:** the system uses one verb — **"Void"** — for all
"this entry was a mistake" cases, and **"Refund"** for "give money back".
The void/reversal distinction is implicit in *which* button you pressed.

---

## 5. Recommended Financial-Record Philosophy

These principles govern every future change to financial data.

### What must never be edited
- `amount`, `type`, `service_type`, `subscriber_id`, `provider_id`, `date`
  on any `transactions` row whose `created_at` is older than 5 minutes
  or whose `status` is not `'posted'`.

### What must never be deleted
- Any `transactions` row that has ever been visible to the subscriber
  (printed receipt, displayed in statement, exported in any report).
  Practically: any row older than the 5-minute grace window.

### What may be edited
- `description` / future `notes` — operational metadata only.
  Edits are stamped with `edited_at` / `edited_by`. Prior values are
  *not* retained today (acceptable: description has no financial weight);
  may move to an `audit_log` table if compliance later demands it.

### What may be deleted
- Inside the 5-minute grace window, **by the original creator**, when the
  row's `status = 'posted'` and no later row references it. After the
  window: void only.

### What must always remain historically visible
- Every posted transaction, every void, every reversal, every refund —
  with their links to one another. Filters in the UI may hide voided
  rows by default but the data is never destroyed.

### What is operational state, not history
- Subscriber `cable_balance` / `internet_balance` — derived; can be
  recomputed at any time from the ledger.
- Subscriber `current_subscription` / `internet_subscription` JSONB —
  derived from `subscription_history`; the history is canon.
- STB `status` (`available` / `assigned`) — derived from
  `subscriber_id` linkage.

### What is canon
- The `transactions` table, append-only after the grace window.
- The `subscription_history` JSONB arrays.
- The `subscribers` row's immutable identity fields
  (`subscriber_id`, `created_at`, `user_id`).

---

## 6. Interaction with existing lifecycle findings

| Area | Principle to apply |
|---|---|
| **Subscriber archival vs deletion** (A0.2 in lifecycle audit) | A subscriber with any transaction history can never be hard-deleted. Soft-delete via `status = 'archived'`. The financial-record philosophy *requires* this — deleting a subscriber would `CASCADE` to transactions, destroying the ledger. |
| **Provider attribution** | `provider_id` is a financial field on transactions → frozen after the grace window. Re-attribution requires void + re-post. |
| **Balance recalc trigger** | Already correct. Void/reversal flow through the trigger naturally — voided rows are excluded from the balance sum (see SQL). |
| **Future account statements** | Trivial: `SELECT * FROM transactions WHERE subscriber_id = ? AND status IN ('posted','voided','reversal') ORDER BY date`. The audit story tells itself. |
| **Future audit trails** | The schema is now structured so that a future `transaction_audit_log` table only needs to capture description edits — every financial event is already a row. |
| **Historical analytics** | Reports default to `status = 'posted'` (excludes voided) and net against `reversal` rows. Past periods become stable; closing a month is now meaningful. |

---

## 7. Impact on the roadmap

### Changes implemented this turn
- **ADR-011** recorded (this document's decision).
- **Schema migration** (additive, no destructive changes):
  - `transactions.status` enum: `posted` (default) | `voided` | `reversal`
  - `transactions.reverses_transaction_id` (self-FK, nullable)
  - `transactions.void_reason` (text, nullable)
  - `void_transaction(p_transaction_id uuid, p_reason text)` RPC —
    SECURITY DEFINER, single-transaction, inserts the reversal row and
    flips the original to `voided`. Returns the reversal row id.
  - Balance trigger updated to exclude `status = 'voided'` from the sum
    (reversal rows naturally net to zero against their originals, but
    excluding voided originals is cleaner and faster).
- **Documentation** updated: `BUSINESS_RULES.md`, `LIFECYCLE_AUDIT_2026-06.md`,
  `ARCHITECTURE_DECISIONS.md`, `CHANGELOG.md`, `docs/README.md`.

### Changes staged (next turn, after migration approval + types regen)
- `EditTransactionDialog`: lock `amount`, `type`, `service_type`, `provider_id`
  outside the 5-minute grace window; keep `description` editable always.
  Replace the `1234` password gate with a real confirmation that surfaces
  what is changing.
- `SubscriberDetail` transaction row: replace **Delete** button with **Void**
  outside the grace window; **Delete** remains inside it. Voided rows
  rendered with strikethrough and a "Voided — {reason}" caption.
- Add a "Show voided" toggle on the subscriber transaction list (default off).

### Deferred (explicit, not forgotten)
- Per-description `audit_log` table — defer until compliance or staff
  expansion makes description tampering material.
- "Closed day" / period locking — defer until the operator asks for
  month-end close.
- Reason-code taxonomy for voids (typo / duplicate / wrong-subscriber /
  wrong-service) — start with free-text `void_reason`; promote to enum
  if reporting needs emerge.

### Open questions for the operator
1. Is **5 minutes** the right grace window, or should it be tied to
   "current session" / "before navigating away"?
2. When a subscription is cancelled with a refund, should the system
   prompt to **void** the original payment instead of **refund** when the
   payment was made today (typo vs. real refund)?
3. Should voided transactions be hidden from the *subscriber-facing*
   receipt entirely (cleaner) or shown struck-through (more honest)?

---

## 8. Why this approach over alternatives

- **Why not pure immutability (Option B)?** The 5-minute grace window costs
  almost nothing in audit value (a row deleted within 5 minutes of creation
  by the same operator who created it was, in practice, never real) and
  saves the operator from a workflow regression on day one. The window
  closes the moment any second actor could have seen the row.

- **Why not just "soft-delete" (set `deleted_at`)?** Soft-delete answers
  *whether* a row exists; void answers *what happened*. The reversal row
  carries date, reason, and links, so daily-cash and audit reports are
  correct without special-casing soft-deleted rows everywhere.

- **Why one `transactions` table instead of separate `payments` /
  `charges` / `refunds`?** The current single-table model already works
  with `type` discriminating the row; splitting now would be the kind of
  premature normalization ADR-008 explicitly defers. The void/reversal
  model is fully expressible on the existing shape.

- **Why not a `transaction_audit_log` table for everything?** That's the
  next step if compliance demands it. Building it now would be expensive
  and would duplicate what the void/reversal rows already capture for
  financial fields.

---

## 9. Summary for the operator

> Money in and money out is now write-once. If something was wrong, you
> mark it wrong and write down what really happened — both stay visible.
> You can still fix a typo within 5 minutes of entering it. After that, the
> book is the book.

This is the smallest change that earns back the right to call the ledger
a ledger.
