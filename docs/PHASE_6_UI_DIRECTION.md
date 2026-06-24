# Phase 6 — UI Direction (Proposal)

Status: **Draft** · Owner: design pass · Decide before implementation.

This document captures the broader UI overhaul ideas surfaced during the
Phase 5.5/5.6 wrap-up. **Nothing here is built yet.** It exists so we can
pick a direction (and 2–3 prototypes via `design--create_directions`)
before writing app-wide code.

## Problems today

- **Desktop nav is a flat 5-tab strip.** Cramped once Catalog (Packs,
  Providers, Regions), Inventory (Devices), and Imports/Backups need
  first-class entry points.
- **Mobile mirrors desktop**, no grouping. Will hit the same cap sooner.
- **Color over-application.** Red/green on every amount, filled primary on
  every action. The eye desensitizes; exceptional states stop standing out.
  (Item 4 of this pass partially addresses this in the ledger only.)
- **Catalog/Inventory are hidden** as dialogs launched from the Subscriber
  List toolbar — operators don't discover them.
- **Density desktop-tuned.** On a 360px Android phone the operator sees
  ~1.5 subscriber cards per screen.

## Direction (for reaction, not commit)

| Aspect | Proposal |
|---|---|
| Shell | Persistent left **sidebar on desktop** (collapsible, icon-only) + **bottom nav on mobile** with a "More" sheet. Sidebar groups: *Operate* (Subscribers, Worklist, Complaints), *Catalog* (Packs, Providers, Regions), *Inventory* (Devices), *Insights* (Analytics), *Settings*. |
| Theme | Stripe-leaning — near-white canvas, single accent (current blue), heavier reliance on weight/spacing than color. Dark-mode parity. Tabular numerics for ₹ everywhere financial. |
| Mobile / PWA | Install as PWA (`manifest.json`, service worker, offline shell). Field-operator tool, not desk tool. 44px touch targets, one-handed reach (primary actions bottom-right), pull-to-refresh. |
| Density | Two presets — *Comfortable* (current) and *Compact* (~30% more rows per screen). Operator setting. |
| Color discipline | Neutral foreground for all amounts. Red only for voided/disputed/overdue >7d. Green only for refund issued or confirmed-paid. Outline buttons for in-row actions; filled primary reserved for the single primary CTA per screen. |
| Catalog/Inventory entry | Promote out of SubscriberList toolbar into proper nav items. |
| Billing tab | Rename to **"Worklist"** or **"Today"**, drop the redundant Active tab, lead with Expiring + Outstanding totals, move Record Payment into the Expiring row. (Deferred from this pass — see item 6.) |

## Process

1. Approve or revise this direction doc.
2. Run `design--create_directions` to produce 2–3 rendered prototypes for
   the shell + a representative interior page (Subscriber profile).
3. Pick one direction.
4. Land the change as a single deliberate refactor pass with
   before/after screenshots. Do **not** dribble UI changes in feature PRs.

## Out of scope for Phase 6

- Accounting / ledger semantics (locked in Phases 5.4–5.5).
- Schema migrations (legacy column removal continues separately in
  Batch D per the column audit).
- New features. Phase 6 is presentation only.
