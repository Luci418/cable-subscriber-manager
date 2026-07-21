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
| `subscribers.current_subscription` (jsonb) | Cache of the ACTIVE cable subscription blob | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch C (2026-07-08)** |
| `subscribers.subscription_history` (jsonb[]) | Cable subscription history array | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch C (2026-07-08)** |
| `subscribers.internet_subscription` (jsonb) | Cache of the ACTIVE internet subscription blob | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch C (2026-07-08)** |
| `subscribers.internet_subscription_history` (jsonb[]) | Internet subscription history array | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch C (2026-07-08)** |
| `subscribers.current_pack` (text) | Cached pack name for the active cable sub | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch B (2026-07-07)** |
| `subscribers.current_internet_pack` (text) | Same, internet side | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch B (2026-07-07)** |
| `subscribers.current_pack_id` (uuid FK) | FK form of `current_pack` | ❌ No frontend readers | `types.ts` only | ✅ Yes | **DROPPED — Batch A (2026-06-20)** |
| `subscribers.current_internet_pack_id` (uuid FK) | Same, internet | ❌ No frontend readers | `types.ts` only | ✅ Yes | **DROPPED — Batch A (2026-06-20)** |
| `subscribers.stb_number` (text) | Cache of the single cable STB serial | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch D (2026-07-21)** |
| `subscribers.services[]` (text[]) | Declared intent for which services the subscriber wants | ✅ Yes — many | Trigger + several UI sites | ❌ **Keep** — reframed as declared intent, not derived | No planned removal |
| `src/lib/storage.ts` (585 LoC) | Pre-Supabase localStorage helpers | ✅ Yes — 7 files still import from it | Various | ❌ Not yet | Opportunistic |
| `sync_stb_inventory_on_subscriber_change` trigger | Bidirectional sync between `subscribers.stb_number` and `stb_inventory` | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch D (2026-07-21)** |
| `reconcile_stb_inventory()` RPC | Legacy reconciler that treated `stb_number` as source of truth | ❌ No — dropped | (removed) | ✅ Yes | **DROPPED — Batch D (2026-07-21)** |
| `useEnabledServices` hook | Backwards-compatible shim over `SettingsContext` | ✅ Yes (called across UI) | `src/hooks/useEnabledServices.tsx` | ❌ Not urgent — shim is 20 LoC | Opportunistic |

## Batch execution status

- **Batch A — DONE (2026-06-20).** `current_pack_id` /
  `current_internet_pack_id` dropped along with their FKs and indexes.
- **Batch B — DONE (2026-07-07).** `current_pack` / `current_internet_pack`
  dropped. `is_pack_in_use` rewritten to `subscriptions.pack_id`. Compat
  writes stripped from `create_subscription`, `cancel_subscription`,
  `expire_lapsed_subscriptions`. Frontend migrated to
  `_activeCable[i].packName` / `_activeInternet[i].packName`.
- **Batch C — DONE (2026-07-08).** JSONB blob columns retired:
  `current_subscription`, `subscription_history`, `internet_subscription`,
  `internet_subscription_history` all dropped. Server-side callers
  rewritten to consult the normalised `subscriptions` table directly:
  `subscribers_enforce_invariants` (service-removal + provider-change
  guards), `check_subscriber_deletable`, `create_subscription` (no more
  blob write), `cancel_subscription` (no more blob read/clear), and
  `expire_lapsed_subscriptions` (blob maintenance loops removed —
  `UPDATE subscriptions SET status='expired' WHERE end_date <= today` is
  now the only work it does). `replace_device` never touched the blobs
  and needed no change. Frontend was already fully on the view-backed
  `_activeCable` / `_activeInternet` / `_timelineCable` /
  `_timelineInternet` arrays (Phase 4b), so no UI change was required.
- **Batch D — Phase 8.** Rewrite cable-STB invariant against
  `stb_inventory`; migrate list/CSV/detail to compute "primary device +
  N-1 others" from inventory; retire
  `sync_stb_inventory_on_subscriber_change`; drop `stb_number`. Highest
  blast radius — do last.

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
