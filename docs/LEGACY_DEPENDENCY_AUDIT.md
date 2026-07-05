# Legacy Dependency Audit — Batch B and beyond

Audit date: 2026-07-05 (Consolidation Sprint)
Supersedes: `archive/LEGACY_COLUMN_AUDIT_2026-06.md`

## What "legacy" means here

Anything that predates the Phase 4 normalisation (`subscriptions` table +
views) or the Phase 5.1 device-decoupling. Kept around so older code paths
keep working while callers migrate.

## Matrix

| Legacy item | Current purpose | Still referenced? | Files (representative) | Safe to remove? | Planned removal |
|---|---|---|---|---|---|
| `subscribers.current_subscription` (jsonb) | Cache of the ACTIVE cable subscription blob | ✅ Yes — 3 server dependencies | `subscribers_enforce_invariants`, `check_subscriber_deletable`, `expire_lapsed_subscriptions`, `cancel_subscription`, `replace_device` | ❌ No | Batch C (Phase 7) |
| `subscribers.internet_subscription` (jsonb) | Same, internet side | ✅ Same 3 server deps | Same files | ❌ No | Batch C (Phase 7) |
| `subscribers.current_pack` (text) | Cached pack name for the active cable sub | ✅ Yes — 5 UI sites + 1 SQL fn | `Billing.tsx:124`, `Analytics.tsx:298,299,316`, `SubscriberList.tsx:65,85,255`, `is_pack_in_use` | 🟡 After UI migration | **Batch B — Phase 6.5** |
| `subscribers.current_internet_pack` (text) | Same, internet side | ✅ Yes — 3 UI sites + 1 SQL fn | `Billing.tsx:124`, `Analytics.tsx:303,304,316`, `SubscriberList.tsx:256`, `is_pack_in_use` | 🟡 After UI migration | **Batch B — Phase 6.5** |
| `subscribers.current_pack_id` (uuid FK) | FK form of `current_pack` | ❌ No frontend readers | `types.ts` only | ✅ Yes | **DROPPED — Batch A (2026-06-20)** |
| `subscribers.current_internet_pack_id` (uuid FK) | Same, internet | ❌ No frontend readers | `types.ts` only | ✅ Yes | **DROPPED — Batch A (2026-06-20)** |
| `subscribers.stb_number` (text) | Cache of the single cable STB serial | ✅ Yes — invariant trigger + UI list + CSV | `subscribers_enforce_invariants`, `sync_stb_inventory_on_subscriber_change`, `reconcile_stb_inventory`, `SubscriberList.tsx`, `Index.tsx:75`, CSV export | ❌ No — highest blast radius | Batch D (Phase 8) |
| `subscribers.services[]` (text[]) | Declared intent for which services the subscriber wants | ✅ Yes — many | Trigger + several UI sites | ❌ **Keep** — reframed as declared intent, not derived | No planned removal |
| `subscribers.pack` (legacy text) | Even older single-pack field | 🟡 Read as fallback in `SubscriberList.tsx:85,255` | `SubscriberList.tsx` | 🟡 After Batch B | With Batch B |
| `subscribers.stbNumber` (camelCase legacy) | Fallback name for `stb_number` | 🟡 Fallback read only | `SubscriberList.tsx:84,254` | 🟡 After Batch D | With Batch D |
| `src/lib/storage.ts` (585 LoC) | Pre-Supabase localStorage helpers | ✅ Yes — 7 files still import from it | `Settings.tsx`, `VoidTransactionDialog.tsx`, `SubscriberList.tsx`, `SubscriberDetail.tsx`, `TransactionNotesDialog.tsx`, `AddTransactionDialog.tsx`, `CancelSubscriptionDialog.tsx` | ❌ Not yet | Opportunistic — remove one caller at a time when touching for another reason |
| `sync_stb_inventory_on_subscriber_change` trigger | Bidirectional sync between `subscribers.stb_number` and `stb_inventory` | ✅ Yes | Trigger on `subscribers` | ❌ No — dies with `stb_number` | Batch D (Phase 8) |
| JSONB compatibility writes in `create_subscription` / `cancel_subscription` / `expire_lapsed_subscriptions` | Maintain the JSONB caches so legacy readers keep working | ✅ Yes | Those RPCs | ❌ No — die with `current_subscription` / `internet_subscription` | Batch C (Phase 7) |
| `TODO(legacy-cleanup Batch B/C)` markers in `expire_lapsed_subscriptions` | Documented deferral | n/a | RPC body | Marker stays until the columns are dropped | With Batch B/C |
| `useEnabledServices` hook | Backwards-compatible shim over `SettingsContext` | ✅ Yes (called across UI) | `src/hooks/useEnabledServices.tsx` | ❌ Not urgent — shim is 20 LoC | Opportunistic |

## Batch execution status

- **Batch A — DONE (2026-06-20).** `current_pack_id` and
  `current_internet_pack_id` dropped along with their FKs and indexes.
- **Batch B — READY for Phase 6.5.** Frontend migration only. Requires:
  1. Rewrite `is_pack_in_use` to consult `subscriptions.pack_id` (and
     also fix the historical-pack deletion bug documented in
     `DESTRUCTIVE_OPERATIONS_AUDIT.md`).
  2. Migrate `Billing.tsx`, `Analytics.tsx`, `SubscriberList.tsx`,
     `SubscriberDetail.tsx` fallback to read `_activeCable[i].packName`
     and `_activeInternet[i].packName` from the enriched subscriber.
  3. Stop writing `current_pack` / `current_internet_pack` in
     `create_subscription` / `cancel_subscription` /
     `expire_lapsed_subscriptions`.
  4. Drop the columns.
- **Batch C — Phase 7.** Rewrite `subscribers_enforce_invariants`,
  `check_subscriber_deletable`, `expire_lapsed_subscriptions`,
  `cancel_subscription`, `replace_device` to query `subscriptions`
  directly. Then drop `current_subscription` and `internet_subscription`.
- **Batch D — Phase 8.** Rewrite the cable-STB invariant against
  `stb_inventory`; migrate list/CSV/detail to compute "primary device +
  N-1 others" from inventory; retire
  `sync_stb_inventory_on_subscriber_change`; drop `stb_number`. Highest
  risk — do last.

## Items intentionally NOT scheduled for removal

- **`services[]`** — reframed as the *declared intent* cache. Kept
  because:
  - The AddSubscriber form needs a surface to capture intent BEFORE any
    device or subscription exists.
  - The `subscribers_enforce_invariants` trigger uses it as the source
    of truth for service-removal and provider-change guards.
  Deriving it purely from `stb_inventory ∪ subscriptions` loses the
  "prospect who wants Cable but is not yet paired" state.

- **`src/lib/storage.ts`** — non-blocking. Retire one caller at a time
  as they are touched for other reasons.
