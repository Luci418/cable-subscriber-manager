# Business Invariant Worksheet

> Fill in each section in plain English. Don't worry about DB/code — that's my job once we have your answers.
> Mark unknowns as `???` and I'll propose a default with reasoning.

---

## A. Subscriber lifecycle

A1. When a new subscriber is created, what is the **minimum** valid state?
- Must have: name, mobile, region, services[]
- For cable service: STB assigned? Or allowed to be assigned later?
- For internet service: ONU/Router assigned? Or allowed later?
- Initial balance: always 0? Or can carry forward from paper records (opening balance)?

> Your answer:

A2. Can a subscriber exist with **zero services**? (e.g., temporarily suspended account that you keep on the books)
> Your answer:

A3. When deleting a subscriber, what's the operator's intent — "remove from list" or "permanently erase"? We currently block delete if there's any transaction history. Is that right, or do you want a "soft archive" instead?
> Your answer:

---

## B. Subscriptions (cable/internet pack assignments)

B1. Can the same subscriber have **two active cable subscriptions** at once? (e.g., upgrade mid-cycle without cancelling the old one)
> Your answer:

B2. **Mid-cycle pack change** — operator wants to switch a subscriber from "Basic" to "Premium" on day 10 of a 30-day cycle. What's the correct workflow?
- a) Cancel old (auto-refund unused days), then create new
- b) Cancel old with no refund, create new (operator decides manually)
- c) Direct "change pack" action that prorates automatically
> Your answer:

B3. **Pause / suspend** — does this exist as a concept, or is "cancel + recreate later" enough?
> Your answer:

B4. When a subscription **expires** (endDate passes), should we auto-charge the renewal (postpaid) or do nothing (prepaid waits for operator)?
> Your answer:

B5. For prepaid: if subscriber pays late (5 days after expiry), does the new cycle start from today, or from the original expiry date?
> Your answer:

---

## C. Devices / Inventory

C1. Can one STB ever be assigned to two subscribers? (Obviously no — but: what about *historical* assignment? If subscriber A had STB-123 last year and returned it, and now subscriber B has it, do we need that history?)
> Your answer:

C2. Can a subscriber have **multiple STBs**? (multi-room setups)
> Your answer:

C3. Same questions for ONU/Router.
> Your answer:

C4. Faulty device workflow: subscriber's STB breaks. What happens?
- Replace STB serial on subscriber? (Phase 2 trigger currently blocks this while subscription active)
- Or: keep subscription, swap inventory rows, log the swap?
> Your answer:

---

## D. Money / Ledger

D1. **Sign convention** — confirm: positive balance = subscriber owes you, negative = you owe subscriber (advance/credit). Yes/no?
> Your answer:

D2. **Partial payments** — subscriber owes ₹1000, pays ₹400. Allowed? (Today: yes.) Any minimum?
> Your answer:

D3. **Overpayment** — subscriber owes ₹1000, pays ₹1500. What happens to the ₹500?
- Sits as credit on cable_balance
- Auto-applied to next charge
- Operator must explicitly refund or transfer
> Your answer:

D4. **Cross-service credit** — subscriber has +₹200 cable credit and owes ₹500 internet. Can the credit auto-cover internet? Or strictly siloed?
> Your answer:

D5. **Refunds** — when cancelling a subscription mid-cycle, what's the default refund formula?
- Pro-rata by days remaining: `price × (days_left / total_days)`
- Pro-rata by months remaining
- Zero (operator types the number)
- Other
> Your answer (MAHARAJ-003 showed ₹966 of ₹1000 — confirm the rule)

D6. **Voiding subscription-generated rows** — currently blocked (must use cancel). Correct?
> Your answer:

D7. **Manual adjustments** — operator wants to write off ₹50 as goodwill. Today this would be a `payment` with description "goodwill". Want a dedicated `adjustment` type for clarity in reports?
> Your answer:

---

## E. Providers

E1. Can a subscriber's **provider change** without a new subscription? (e.g., you switched downstream providers; same pack name, same price, different provider). Or does provider change always imply a new subscription record?
> Your answer:

E2. When a pack is reassigned to a new provider in `packs` table, what happens to past transactions tagged with the old provider?
- Stay tagged with old provider (historical truth)
- Re-tag to new provider (reporting simplicity)
> Your answer:

---

## F. Time & events

F1. Can a transaction be backdated? (operator forgot to record yesterday's cash)
> Your answer:

F2. Maximum allowed backdating window? (1 day / 7 days / unlimited)
> Your answer:

F3. Can a subscription be backdated? (entered into system 3 days after it really started)
> Your answer:

F4. If yes to F1/F3 — should backdated entries affect balance immediately or be flagged for review?
> Your answer:

---

## G. Operator communicability (the MAHARAJ-003 problem)

G1. When operator opens a subscriber profile, what's the **single most important number** they need to see at the top?
- Current balance (debt or credit)
- Next due date
- Active pack + days remaining
- Other
> Your answer:

G2. For each transaction in the ledger, what 3 things must be unambiguously clear at a glance?
> Your answer (e.g., date, type+amount, running balance after this txn, …)

G3. After a cancellation+refund, the profile should explicitly say: ______
> Your answer (e.g., "Subscription cancelled on X. Refund of ₹Y issued. Net position: ₹Z owed to subscriber.")

G4. Do you want a **subscriber statement** view (chronological running balance like a bank passbook)?
> Your answer:

G5. Should the system surface a **"next action"** chip on each subscriber? ("Collect ₹1000", "Renew cable", "Return ₹34 credit", "OK")
> Your answer:

---

## H. Workflow boundaries

H1. List every place a subscriber can be **created** (besides the Add form):
- CSV import — yes
- Anywhere else?
> Your answer:

H2. List every place a transaction can be **created**:
- AddTransactionDialog
- create_subscription RPC (charge)
- cancel_subscription RPC (refund)
- void_transaction RPC (reversal)
- Anywhere else? Bulk?
> Your answer:

H3. List every place a subscriber can be **edited**:
- EditSubscriberDialog
- Anywhere else?
> Your answer:

---

## I. Roles & access

I1. Today every authenticated user is the owner of their own data. Will there ever be a multi-user setup (e.g., owner + collector + viewer)? If "not for v1", we document and defer.
> Your answer:

---

## J. Anything else

J1. Categories of "loose ends" you've personally hit that aren't covered above:
> Your answer:

J2. Reports/exports you rely on that would break if balance/ledger semantics change:
> Your answer:
