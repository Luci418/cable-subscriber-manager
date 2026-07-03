# QA Test Plan
## Companion to BUSINESS_MODEL.md v3.2 and OPERATOR_WORKFLOW_UI_REVIEW.md

> **Purpose:** This is the test suite for verifying Phase 4b (the JSONB→
> relational cutover) before and after the lock/drop of JSONB columns, and
> the ongoing regression suite that Phase 5 and future phases run against.
>
> **Priority markers:**
> - **[BLOCKING]** — must pass before proceeding to the next step
>   (UI swap, JSONB lock, Phase 5 start)
> - **[ONGOING]** — part of the standing regression suite; re-run after
>   any migration or RPC change touching subscriptions/transactions
>
> Where SQL is given, table/column names match BUSINESS_MODEL.md v3.2
> Part 15. Adjust if the actual migration named anything differently —
> and if so, that's itself worth noting back in BUSINESS_MODEL.md.

---

# Part A — View Correctness [BLOCKING — before UI swap]

These directly answer the five questions raised before the swap. Each
should be checked against the actual `v_subscriber_active_subscription`
and `v_subscriber_subscription_timeline` definitions.

**A1 — Column naming.**
Run the view for one subscriber and list its output columns. Compare
against the JSONB field names the current UI components read
(`packName`, `startDate`, `endDate`, `previousSubscriptionId`, etc.).
Pass: either the view aliases to match these names, or there is a
documented full mapping from old field names to new column names that
every affected component has been updated against.

**A2 — Cardinality per service.**
```sql
SELECT subscriber_id, service_type, COUNT(*)
FROM v_subscriber_active_subscription
GROUP BY subscriber_id, service_type
HAVING COUNT(*) > 1;
```
Pass: zero rows returned today (no multi-device subscribers exist yet).
If the view has an implicit `LIMIT 1` or similar to force single-row
output, document that this will need removing when Phase 5 multi-device
ships — don't let it silently truncate future multi-device data.

**A3 — Subscriber-preserving join.**
```sql
SELECT s.id, s.status, s.services
FROM subscribers s
LEFT JOIN v_subscriber_active_subscription v
  ON v.subscriber_id = s.id AND v.service_type = 'cable'
WHERE 'cable' = ANY(s.services)
  AND v.subscriber_id IS NULL;
```
This returns subscribers who declared cable as a service but have no
active cable subscription (prospects, inactive, lapsed-not-yet-renewed).
Pass: these subscribers still appear correctly in the cutover UI's list
view with an appropriate "no active subscription" state — i.e., the
view itself doesn't need to return a row for them, but confirm the
component handles the `LEFT JOIN`-produced null gracefully rather than
expecting the view to always return something.

**A4 — Snapshot, not live join.**
```sql
-- Pick any subscription created before today
SELECT id, pack_id, pack_name_snapshot, pack_price_snapshot
FROM subscriptions
LIMIT 1;

-- Rename or reprice the referenced pack
UPDATE packs SET name = 'TEMP RENAME TEST', price = 99999
WHERE id = '<pack_id from above>';

-- Re-query the view for that subscription
SELECT * FROM v_subscriber_active_subscription
WHERE subscriber_id = '<subscriber_id>';

-- Revert
UPDATE packs SET name = '<original>', price = <original> WHERE id = '<pack_id>';
```
Pass: the view output for `pack_name_snapshot` / `pack_price_snapshot`
is unchanged by the pack rename — confirms the view selects snapshot
columns, not a live join to `packs`.

**A5 — Timeline view scope.**
```sql
SELECT subscriber_id, status, start_date, end_date
FROM v_subscriber_subscription_timeline
WHERE subscriber_id = '<a subscriber with one active + history>'
ORDER BY start_date;
```
Pass: document whether the active subscription appears in this result
(timeline = everything) or only in `v_subscriber_active_subscription`
(timeline = history only). Either is fine — write the answer down as
the mapping for components that previously read `subscription_history`.

---

# Part B — JSONB ↔ Relational Parity [BLOCKING — before UI swap, re-run before JSONB lock]

This is the single most important test in this document. The dual-write
from Phase 4a means both representations exist right now — they must
agree for every subscriber before the swap, and must *still* agree
immediately before the JSONB columns are locked/dropped.

```sql
-- Cable: compare JSONB current_subscription against the view
SELECT
  s.id,
  s.current_subscription->>'packName' AS jsonb_pack,
  v.pack_name_snapshot AS view_pack,
  (s.current_subscription->>'startDate')::date AS jsonb_start,
  v.start_date AS view_start,
  (s.current_subscription->>'endDate')::date AS jsonb_end,
  v.end_date AS view_end
FROM subscribers s
LEFT JOIN v_subscriber_active_subscription v
  ON v.subscriber_id = s.id AND v.service_type = 'cable'
WHERE s.current_subscription IS NOT NULL
  AND (
    s.current_subscription->>'packName' IS DISTINCT FROM v.pack_name_snapshot
    OR (s.current_subscription->>'startDate')::date IS DISTINCT FROM v.start_date
    OR (s.current_subscription->>'endDate')::date IS DISTINCT FROM v.end_date
  );
```
Pass: zero rows. Repeat for `internet_subscription` /
`internet_subscription_history` against the equivalent view filter.

```sql
-- History array length vs row count
SELECT
  s.id,
  jsonb_array_length(COALESCE(s.subscription_history, '[]'::jsonb)) AS jsonb_count,
  COUNT(t.id) AS table_count
FROM subscribers s
LEFT JOIN subscriptions t
  ON t.subscriber_id = s.id AND t.service_type = 'cable' AND t.status != 'active'
GROUP BY s.id, s.subscription_history
HAVING jsonb_array_length(COALESCE(s.subscription_history, '[]'::jsonb)) != COUNT(t.id);
```
Pass: zero rows. Repeat for internet.

**Re-run this entire Part B immediately before the JSONB lock/drop
migration** — not just once after the swap. If anything was written to
the JSONB columns or the new tables independently between the swap and
the lock (shouldn't happen if dual-write is correct, but this is exactly
the kind of drift this whole project has been hardening against), this
catches it while it's still reversible.

---

# Part C — Invariant & Constraint Tests [ONGOING]

Each of these should fail (raise an exception / be blocked) when run.
A passing test here means the operation was correctly rejected. Run
these once after Phase 4b, and re-run after any future migration that
touches `subscriptions`, `payment_allocations`, or `transactions`.

**C1 — Snapshot immutability**
```sql
UPDATE subscriptions SET pack_name_snapshot = 'tampered' WHERE id = '<id>';
-- Expect: exception
```
Repeat for `pack_price_snapshot`, `total_days`, `total_charged`,
`start_date`, `duration`, `previous_subscription_id`.

**C2 — Status transition guard**
```sql
UPDATE subscriptions SET status = 'active' WHERE status = 'expired' AND id = '<id>';
-- Expect: exception (no reverse transitions)

UPDATE subscriptions SET status = 'cancelled' WHERE status = 'expired' AND id = '<id>';
-- Expect: exception (cancelled only from active)
```

**C3 — One active subscription per device (INV-39)**
```sql
-- Find a device with an active subscription
SELECT device_id FROM subscriptions WHERE status = 'active' LIMIT 1;

-- Attempt to insert a second active subscription for the same device
INSERT INTO subscriptions (subscriber_id, service_type, device_id, pack_id, ...)
VALUES (..., '<same device_id>', ..., status default 'active');
-- Expect: unique constraint violation on (device_id) WHERE status='active'
```

**C4 — end_date direct update blocked**
```sql
UPDATE subscriptions SET end_date = end_date + 1 WHERE id = '<id>';
-- Expect: exception (v1 — no direct end_date updates permitted)
```

**C5 — device_serial_snapshot inventory agreement (INV-40)**
```sql
-- Pick a serial that exists in stb_inventory but is NOT assigned to
-- this subscription's subscriber
UPDATE subscriptions SET device_serial_snapshot = '<unrelated serial>'
WHERE id = '<id>';
-- Expect: exception
```

**C6 — Refund cap (INV-42)**
```sql
-- For a subscription where sum(payment_allocations.amount, type='payment') = X
UPDATE subscriptions SET status = 'cancelled', refund_amount = X + 1, cancelled_at = now()
WHERE id = '<id>';
-- Expect: exception (refund_amount > cash_paid)
```

**C7 — payment_allocations immutability (INV-44)**
```sql
UPDATE payment_allocations SET amount = amount + 1 WHERE id = '<id>';
DELETE FROM payment_allocations WHERE id = '<id>';
-- Expect: both raise an exception
```

**C8 — Mobile uniqueness on edit (INV-06)**
```sql
-- Attempt to set subscriber A's mobile to subscriber B's existing mobile
UPDATE subscribers SET mobile = '<B's mobile>' WHERE id = '<A's id>';
-- Expect: unique constraint violation
```

**C9 — INV-02 status trigger scope**

Create a customer with `status = 'archived'`. Trigger any event that
would normally flip `active ↔ inactive` (e.g., expire their only
subscription via `expire_lapsed_subscriptions`).
Pass: `status` remains `'archived'` — the trigger must not overwrite it.
Repeat for `status = 'prospect'`.

---

# Part D — Workflow End-to-End Tests [ONGOING — extend for Phase 5]

These exercise the RPCs already shipped (Phase 3.6, 3.7, 4a). Phase
5-specific workflows (Collect Payment, Pair/Unpair Device) get added to
this part once built — placeholders noted below.

**D1 — New subscription (Activation)**
1. Create a test customer, `status` should become `active` after step 3
2. Assign a device (current mechanism, pre-Pair-Device-workflow)
3. Run `create_subscription`
4. Verify: row in `subscriptions` with `status='active'`,
   snapshot columns populated, `subscription_charge` transaction with
   `subscription_id` set to the new row's id, customer `status` flips
   to `active`

**D2 — Renewal with lineage**
1. Let D1's subscription expire (or manually set `end_date` to past and
   run `expire_lapsed_subscriptions`)
2. Run `create_subscription` again for the same device
3. Verify: new row has `previous_subscription_id` = D1's subscription id,
   old row `status = 'expired'`, unique-active-per-device constraint
   (C3) does not block the new active row since the old one is no
   longer active

**D3 — Cancellation with refund cap**
1. From D1 or D2's active subscription, record one or more payments
   totaling less than `total_charged` (use whatever payment-recording
   path currently exists)
2. Run `cancel_subscription` with `refund_amount` = the suggested
   pro-rata value
3. Verify: `subscriptions.status = 'cancelled'`, `cancel_reason_code`
   set, `refund_amount` ≤ `cash_paid` (sum of `payment_allocations`
   where linked transaction `type='payment'`), `subscription_refund`
   transaction created with `subscription_id` set
4. Attempt step 2 again with `refund_amount` > `cash_paid` — confirm
   C6 blocks it (already covered, but good to confirm via the RPC path,
   not just direct SQL)

**D4 — Replace device (Subscription Portability) — the critical test**
1. Customer has an active subscription on Device A
2. Run `replace_device`: Device A → Device B, reason = `faulty`
3. Verify:
   - Device A: `status='faulty'`, `subscriber_id=NULL`
   - Device B: `status='assigned'`, `subscriber_id=<customer>`
   - `device_assignment_log`: Device A entry closed, Device B entry
     opened, both with correct timestamps and reason
   - `subscriptions.device_serial_snapshot` updated to Device B's serial
   - **`subscriptions.end_date`, `status`, `pack_name_snapshot`,
     `total_charged` — all unchanged**
   - **Zero new rows in `transactions`** — this is the core guarantee;
     check `transactions` row count for this subscriber before and
     after, must be identical

**D5 — Adjustment credit, siloed (Phase 3.7 + INV-28)**
1. Post an `adjustment` transaction on a subscriber's cable account
   (e.g., outage compensation, ₹200)
2. Attempt to use that ₹200 to offset an internet charge via whatever
   cross-service transfer mechanism exists
3. Verify: blocked or not offered — adjustment-sourced credit is
   service-siloed (INV-28). Only payment-sourced credit should be
   eligible for cross-service transfer

**D6 — FIFO trigger current behaviour (pre-Phase-5) — document, don't fix yet**

This is a *discovery* test, not a pass/fail. Phase 4a shipped a FIFO
allocation trigger; Phase 5's "Collect Payment" workflow (Option B)
changes how payments get allocated for the *new* per-bill UI. Before
Phase 5 starts, document what the *current* trigger does with today's
generic payment-recording UI:

1. Create a subscriber with one expired subscription carrying ₹400
   outstanding, and one new active subscription carrying ₹1,000
   outstanding (total ₹1,400 across both)
2. Record a single ₹700 payment via the current (pre-Phase-5) payment UI
3. Inspect `payment_allocations` — how many rows were written, against
   which subscriptions, in what order?

This determines whether Phase 5's "Collect Payment" (Option B, single
targeted allocation) needs to **replace** the existing trigger's logic,
or **bypass** it for the new workflow while leaving it as-is for the
de-emphasised generic "Add Payment" path. Resolve this explicitly before
Phase 5 implementation — don't let two allocation mechanisms coexist
implicitly.

**[Placeholder D7 — Collect Payment, once Phase 5 ships]**
Per-bill payment, Cash/UPI tabs, single targeted allocation row,
overpayment surfaces as advance credit (not auto-FIFO'd), existing
advance credit surfaced and offered (not auto-applied). Test all four
confirmation message variants from OPERATOR_WORKFLOW_UI_REVIEW Workflow 4.

**[Placeholder D8 — Pair/Unpair Device, once Phase 5 ships]**
`pair_device` from available inventory; `unpair_device` as part of
cancellation flow with device-return checkbox.

---

# Part E — Analytics Correctness [ONGOING]

A fixed test sequence with known expected outputs. Run this sequence
against a dedicated test subscriber, then check all 7 analytics surfaces
the recent fix touched.

**Test sequence (single test subscriber, cable service):**

| Step | Action | Type | Amount | Notes |
|------|--------|------|--------|-------|
| 1 | `create_subscription` | charge | ₹1,000 | `subscription_charge` |
| 2 | Record payment | payment | ₹1,000 | full payment |
| 3 | Void the payment from step 2 | reversal | — | creates reversal row |
| 4 | Record payment again | payment | ₹1,000 | "replacement" |
| 5 | Post adjustment | adjustment | ₹200 | goodwill, e.g. |

**Expected values after this sequence:**

| Metric | Expected | Reasoning |
|--------|----------|-----------|
| Gross revenue | ₹1,000 | Only step 4 counts. Step 2 + its reversal (step 3) are excluded entirely, not netted. |
| Charges | ₹1,000 | Step 1 only |
| Net revenue | ₹1,000 | No refunds in this sequence |
| Service credits issued | ₹200 | Step 5, tracked separately, not in revenue |
| Collection efficiency | 100% | ₹1,000 charged, ₹1,000 collected (step 4) |
| ARPU (if this is the only subscriber in the test set) | ₹1,000 | Same basis as gross revenue |
| Subscriber balance | ₹0 cable, with ₹200 adjustment credit recorded separately per D5's siloing | Charge ₹1,000 − Payment ₹1,000 = ₹0; adjustment ₹200 sits as additional credit per its own accounting |

Pass: all 7 surfaces (revenue, charges, net, collection efficiency, ARPU,
top subscribers, pack/region/provider revenue, aging — per Lovable's
fix summary) reflect these values for this test subscriber, with no
contribution from step 2 or step 3.

**Re-run this sequence as a standing fixture** — ideally as an automated
test that runs the 5-step sequence against a throwaway subscriber and
asserts the 7 outputs, so any future change to transaction handling that
reintroduces a ₹2,200-style bug is caught immediately rather than
discovered during manual testing months later.

---

# Part F — Drift / Data Quality Monitoring [ONGOING — run periodically]

These aren't pass/fail gates for Phase 4b specifically, but should be
run after Phase 4b and periodically thereafter — they're the early-warning
system for the state-drift patterns this entire project has been about.

**F1 — Device status ↔ assignment agreement**
```sql
SELECT * FROM stb_inventory
WHERE (status = 'assigned' AND subscriber_id IS NULL)
   OR (status != 'assigned' AND subscriber_id IS NOT NULL);
-- Expect: zero rows
```

**F2 — subscriptions.device_serial_snapshot vs current inventory**
```sql
SELECT s.id, s.device_serial_snapshot, i.serial_number, i.status
FROM subscriptions s
JOIN stb_inventory i ON i.id = s.device_id
WHERE s.status = 'active'
  AND s.device_serial_snapshot != i.serial_number;
-- Expect: zero rows (snapshot should match current inventory for active subs)
```

**F3 — Balance trigger correctness spot-check**
```sql
SELECT
  s.id,
  s.cable_balance,
  COALESCE(SUM(t.amount * CASE
    WHEN t.type IN ('charge') THEN 1
    WHEN t.type IN ('payment','refund') THEN -1
    WHEN t.type = 'adjustment' THEN -1
    WHEN t.type = 'reversal' THEN -1  -- sign depends on what it's reversing; verify against actual trigger logic
    ELSE 0 END), 0) AS computed
FROM subscribers s
LEFT JOIN transactions t ON t.subscriber_id = s.id AND t.service_type = 'cable'
GROUP BY s.id, s.cable_balance
HAVING s.cable_balance != COALESCE(SUM(...), 0);
```
Note: the sign logic here needs to match the actual balance trigger's
logic exactly — treat this query as a template to adapt, not copy
verbatim, since getting the signs wrong will produce false positives.
The point is having *a* periodic cross-check between the trigger's
stored output and an independent computation from the same source rows.

**F4 — payment_allocations sum ≤ total_charged**
```sql
SELECT s.id, s.total_charged, SUM(pa.amount) AS allocated
FROM subscriptions s
JOIN payment_allocations pa ON pa.subscription_id = s.id
JOIN transactions t ON t.id = pa.transaction_id AND t.type = 'payment'
GROUP BY s.id, s.total_charged
HAVING SUM(pa.amount) > s.total_charged;
-- Expect: zero rows (would indicate over-allocation, refund cap data would be wrong)
```

**F5 — Orphaned subscriptions**
```sql
SELECT s.id FROM subscriptions s
LEFT JOIN subscribers sub ON sub.id = s.subscriber_id
WHERE sub.id IS NULL;
-- Expect: zero rows (FK RESTRICT should prevent this entirely — smoke test)
```

---

# Part G — Post-Lock Verification [BLOCKING — after JSONB columns dropped]

1. Re-run Part B in full *before* the drop migration runs — last chance
   to catch parity issues while JSONB still exists as ground truth.
2. After drop: full smoke test of subscriber list, subscriber profile,
   create subscription, cancel subscription, replace device — confirm
   no component throws on a missing JSONB field (grep the codebase for
   any remaining references to `current_subscription`,
   `subscription_history`, `internet_subscription`,
   `internet_subscription_history`, `current_pack`,
   `current_internet_pack` — should return zero results outside of
   migration files themselves).
3. Confirm `npm run build` / type-check passes with the JSONB columns
   gone — any TypeScript types still referencing the old JSONB shape
   should be removed, not just unused.

---

*End of document. Companion to BUSINESS_MODEL.md v3.2 and
OPERATOR_WORKFLOW_UI_REVIEW.md v1.1.*

*Parts A–C can be run now, independent of the view-inspection answers
in chat — Lovable can start on these while the view SQL is being shared.
Part D6 (FIFO discovery) should be resolved before Phase 5 implementation
begins, not just before Phase 4b completes.*

---

# Part H — Error-Propagation Gate [STANDING CODE REVIEW RULE]

**Rule:** The UI must never show a success state when the database
rejected (or silently no-op'd) the operation.

Applies to every new or modified call site that invokes an RPC, an
`insert` / `update` / `delete`, or any hook wrapping one.

### Author checklist — must be satisfied before merge

1. **Return-value inspection.** If the underlying helper returns
   `false | null | undefined` on failure, the caller MUST branch on it:
   ```ts
   const ok = await someRpcOrHookCall(...);
   if (!ok) return;                // no toast, no navigation, no state pivot
   toast.success('…');
   ```
   Do NOT `await` and then unconditionally fire `toast.success`.
2. **Error-throw inspection.** If the helper throws on failure, the
   success path must be *after* the awaited call in the same try block,
   and the catch must not fall through into it. Do not wrap the success
   toast in a `finally`.
3. **`maybeSingle()` writes.** An UPDATE/DELETE returning `maybeSingle()`
   with `data === null` is a silent failure (RLS block, wrong id, race).
   The hook MUST translate this into `return false` and a `toast.error`.
   Never assume "no error = success" for a `maybeSingle()` write.
4. **RPC boolean/void returns.** For RPCs that return `void`, only
   `error` is available — check it. For RPCs that return a status row,
   check both `error` and the returned value.
5. **Optimistic UI.** If the caller mutates local state before the
   awaited write, it MUST roll back on failure before any success toast
   would fire.

### Reviewer checklist

- Grep the diff for `toast.success` and confirm each is preceded by a
  guard against the specific failure mode of the call above it.
- Grep the diff for `.rpc(`, `.insert(`, `.update(`, `.delete(`,
  `.maybeSingle()` and confirm every caller of the surrounding function
  handles the sentinel return.
- Reject any patch where a new hook writes to Postgres and returns
  `true` unconditionally after `if (error) return false` — the
  no-rows-matched case must also return `false`.

### Known references

- `src/hooks/useSubscribers.ts :: updateSubscriber` — canonical example
  of the `maybeSingle()` fix (returns `false` when `data === null`).
- `src/pages/Index.tsx :: handleEditSubscriber` — canonical example of
  propagating the boolean up to a dialog so the dialog can suppress its
  own success toast when the write was rejected.
- `src/components/SubscriberDetail.tsx :: handleAddService` — canonical
  example of a dialog-level guard: `if (result === false) return;`
  before `toast.success` and tab pivot.

Add this gate to every PR description that touches a write path.

