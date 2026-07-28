# Provider Integration — Revised Direction (2026-07-28)

Supersedes the earlier "diff-and-apply sync engine" framing. The operator
raised a decisive workflow question that reshapes the design:

> "Instead of doing things on the Hathway portal and syncing to our app, I'd
> rather do it in our app first — and then either (a) go do the same on
> Hathway manually, or (b) have a script open Hathway, log in, and either
> auto-perform the action or at least land me on the right screen."

That flips the model from **reactive reconciliation** (Hathway → us) to
**proactive write-through** (us → Hathway, then reconcile).

## 1. Two integration modes — pick per action

The system will support two complementary modes. Neither is exclusive; both
converge on the same local ledger and audit trail.

### Mode A — Write-through with provider assist  *(new; default for renewals, pack changes, new activations, cancellations)*

The operator performs the action in **our app first**. The app then helps
push the same action to the provider portal, via one of three assist tiers:

| Tier | What it does | Cost | Risk |
|---|---|---|---|
| **A0. Checklist** | After the local action, show a modal with "Now do this on Hathway: 1) log in, 2) go to Pack Management, 3) select MAHARAJ-003, 4) apply plan 'Kannada'". Operator marks it done. | Free, ships this batch. | None. Manual work remains. |
| **A1. Deep-link + prefill** | Open the Hathway portal URL for that specific customer/screen in a new tab (bookmarklet-style). Operator still clicks the final "Apply". | Free, needs URL reverse-engineering per provider. | Low — no automation, just navigation. |
| **A2. Browser automation** | A user-run browser extension or local Playwright script logs in, navigates, and submits. App emits an "intent" JSON the script consumes. | High effort; fragile against portal changes. | Medium — credentials on user's machine, breaks when portal HTML changes. |

**Recommendation:** ship **A0 immediately**, design the intent JSON so **A1
and A2 can plug in later without changing the app**. Do not build A2
in-app — it belongs in a separate user-installed helper (browser extension
or CLI) that reads the intent queue over a signed URL. Reason: Hathway's
portal has no automation-friendly API, uses session cookies + CSRF, and
their T&Cs generally forbid scraping. Keeping automation out-of-process
means the SMS itself stays clean, auditable, and never stores portal
credentials server-side.

### Mode B — Reactive snapshot reconciliation  *(the earlier plan, scoped down)*

Even with write-through, the provider portal remains the source of truth for
**what actually happened upstream**. Periodically (weekly, or on demand)
the operator uploads the Customer Master + Dashboard reports and the app:

- Diffs against the previous snapshot.
- Flags **drift** where our app and Hathway disagree (e.g. a renewal we
  pushed didn't take, or Hathway extended an expiry we didn't).
- Surfaces it in the same Review Dashboard the earlier plan described.

Mode B becomes a **safety net**, not the primary workflow. That drops most
of the auto-create-charge complexity from the earlier plan — charges are
already created by Mode A. Mode B mostly detects "we forgot" and "portal
did something we didn't".

## 2. Provider Action Intent — the shared contract

Every write-through action produces a row in a new `provider_action_intent`
table. This is the single object A0/A1/A2 all consume.

```
provider_action_intent
  id                 uuid pk
  provider_id        fk providers
  subscriber_id      fk subscribers
  local_txn_id       fk transactions  (the local charge/refund already written)
  action_type        enum: renew | new_activation | pack_change | cancel | reactivate
  intent_jsonb       { hathway_customer_nbr, target_pack_key, effective_date, ... }
  status             enum: pending | acknowledged | confirmed | failed | skipped
  operator_note      text
  created_at, updated_at, closed_by
```

- **A0** renders `intent_jsonb` as a checklist and flips status on operator
  confirmation.
- **A1** builds a deep-link URL from `intent_jsonb`.
- **A2** (future extension) polls `pending` rows over a signed endpoint,
  performs the automation, and PATCHes `status` + evidence back.
- **Mode B** diffing marks intents as `confirmed` when the next snapshot
  proves the upstream state matches.

## 3. Internet (BSNL) — unchanged shape, matches this model naturally

BSNL is already fully write-through today: operator records the monthly
cycle in our app, then pays BSNL via CSC. The "provider assist" for BSNL is
just an A0 checklist ("pay ₹X to BSNL, CSC ref goes here"). No portal to
automate. The `provider_action_intent` table serves BSNL cycles identically.

## 4. What ships next (Batch: Provider Integration Phase A′)

Scope is deliberately smaller than the previous plan.

1. **Schema:** `provider_action_intent`, `provider_pack_map`,
   `provider_snapshot`, plus `charge_source` enum (`MANUAL`, `SYNC_HATHWAY`,
   `SYNC_BSNL`, `WRITETHROUGH_HATHWAY`, `WRITETHROUGH_BSNL`) and
   `transactions.charge_source` column. RLS + GRANTs.
2. **Pack mapping UI** in Catalog → Packs: assign each local pack a
   `provider_pack_key`. Required before write-through is enabled.
3. **Write-through hooks** on existing RPCs (`create_subscription`,
   `cancel_subscription`, and a new `change_pack`) — every call also
   inserts a `provider_action_intent` row.
4. **"Push to Provider" tray** — a new sidebar item under Integrations
   showing pending intents grouped by provider. Each row expands into an
   A0 checklist. A "Mark done" button flips to `acknowledged`.
5. **Mode B (snapshot reconcile)** — parse Customer Master + Dashboard,
   store `provider_snapshot`, diff against previous, but the review UI
   is simpler: it only shows **drift vs. expected state** (intents that
   never confirmed, or upstream changes with no matching intent). No
   auto-charge creation — charges already exist from Mode A.
6. **Deep-link table** (`provider_deeplink_template`) — per action_type,
   a URL template with `{hathway_customer_nbr}` placeholders. Populated
   by the operator by pasting URLs from their browser. Enables A1
   without any code changes.

Explicitly **not** in this batch: browser automation (A2), scheduled
polling, GTPL adapter, credential-storing "auto-login" server-side.

## 5. Why this is better than the previous plan

- **Matches how the operator actually works** — the app leads, the portal
  follows.
- **Ledger integrity is unconditional** — local charges are written the
  moment the operator confirms, not conditional on a successful sync.
- **Sync becomes reconciliation, not integration** — much smaller surface,
  much lower blast radius.
- **Automation is optional and out-of-process** — no portal credentials on
  our servers, no legal ambiguity in the core app.
- **BSNL and Hathway share one model** even though only one has a portal.

## 6. Open items to confirm before build starts

1. Is the operator OK with A0 (checklist) as the day-one experience,
   with A1/A2 added later based on real pain?
2. For pack changes mid-cycle: does Hathway pro-rate, or does the operator
   just note the change and let it apply at next renewal? Affects whether
   `change_pack` writes a partial charge or defers.
3. Should `provider_action_intent` be surfaced on the subscriber profile
   ("2 provider actions pending for this customer") in addition to the
   global tray? Recommend yes.
