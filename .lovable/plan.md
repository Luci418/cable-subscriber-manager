# Verification of [FIX-NOW] items from PRODUCTION_AUDIT_2026-07

I re-read the codebase and traced each claimed fix against the report. Results below, followed by the one gap that needs closing.

## Verification results

| Claim | Status | Evidence |
|---|---|---|
| Confirmation helper (`@/lib/confirm`) replaces native `window.confirm` app-wide | **Partial** | Only `window.confirm` fallback remains inside `src/lib/confirm.tsx` itself. But two native `prompt()` calls still exist — see gap below. `ConfirmHost` is mounted in `AppLayout.tsx`. |
| `Analytics.tsx` uses `useAppData()` without regressions | **Verified** | `Analytics.tsx:62` reads `subscribers/transactions` from `useAppData`. No page under `src/pages/*` re-fetches `subscribers` directly (only `Billing.tsx` imports the *type*, not the hook). Single fetch path via `AppDataProvider`. |
| Device serial navigation works end-to-end | **Verified** | `Equipment.tsx` (rows + toolbar) and `subscriber-detail/DevicesTab.tsx:233` both navigate to `/equipment/:serial` with `encodeURIComponent`. Route registered in `App.tsx:71` → `EquipmentDetail`. |
| Faulty → DevicesTab guided workflow | **Verified** | `SubscriberDetail.tsx` loads newest closed `device_assignment_log` per service into `lastClosedByService` and passes it to `DevicesTab`. `DevicesTab.tsx:163` renders the highlighted faulty state; non-faulty closes render the neutral "device needed" variant. |
| No duplicate data fetching / stale state | **Verified** | Home/Customers/CustomerDetail/Billing/Analytics all read from `useAppData`. No parallel `useSubscribers()` mounts in page components. |

## Gap to close (small, in-scope)

Two native `prompt()` calls slipped through the audit sweep — they're not `confirm()` but they violate the same "no browser-native modals" rule the audit set:

1. `src/components/StbInventoryDialog.tsx:132` — decommission "Reason (optional)" prompt. The faulty flow next to it was already migrated to a proper `Dialog` with a reason input; decommission should mirror that pattern.
2. `src/pages/Complaints.tsx:450` — "Enter resolution notes" prompt when resolving a complaint. Should become a small shadcn `Dialog` with a `Textarea` + Cancel/Resolve buttons.

## Plan

1. Replace the decommission `prompt()` in `StbInventoryDialog.tsx` with a `Dialog` mirroring the existing Mark-Faulty dialog: title "Decommission device", optional reason input, Cancel / Decommission buttons. Keep the existing `confirm()` step before it (or fold it into the dialog's confirm button — cleaner UX; will fold).
2. Replace the resolution-notes `prompt()` in `Complaints.tsx` with a shadcn `Dialog` containing a `Textarea` (notes optional) and Cancel / Mark resolved buttons.
3. Update `docs/PRODUCTION_AUDIT_2026-07.md`: mark the "native confirm/prompt" item fully closed and note the two additional sites remediated in this pass.

No schema, no RPC, no data-flow change. Roughly one focused edit per file.

## Not doing (out of scope for verification pass)

- The audit's Critical/High items already flagged for later workstreams (encrypted credentials, per-device financial rollups, etc.) remain queued — this pass is only about confirming the [FIX-NOW] slice actually landed.
