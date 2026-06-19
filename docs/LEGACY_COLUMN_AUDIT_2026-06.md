# Legacy Column Dependency Audit — Phase 5.1 follow-up

Date: 2026-06-19
Scope: Determine whether the seven legacy `subscribers` columns can be
dropped, demoted to derived caches, or must remain temporarily for
back-compat. **No columns are dropped in this audit** — it is informational
only. A second migration after sign-off will action the decisions.

Authoritative sources after Phase 4b / 5.1:
- `subscriptions` table (relational, one row per device-subscription)
- `v_subscriber_active_subscription` view (one row per ACTIVE sub)
- `v_subscriber_subscription_timeline` view (active + history)
- `stb_inventory` table (one row per device; `subscriber_id` = current pairing)

Conventions:
- **Reader** = code that SELECTs / reads the column.
- **Writer** = code that INSERTs / UPDATEs the column.
- **Replacement** = the authoritative source to migrate the reader to.
- **Safe to drop?** = whether removal is non-breaking after readers migrate.

---

## 1. `current_subscription` (jsonb)

**Purpose (legacy):** Snapshot of the single active cable subscription,
shaped like a `SubscriptionBlob`.

**Readers**
| Site | Notes |
|---|---|
| `check_subscriber_deletable` RPC | Blocks delete while cable end_date > now(). |
| `expire_lapsed_subscriptions` RPC | Clears blob and writes history when expiring. |
| `subscribers_enforce_invariants` trigger | Detects "active cable sub exists" to forbid service-removal and provider-change. |
| `cancel_subscription` RPC | Reads to mark history entry as cancelled. |
| `replace_device` RPC | Updates `stbNumber` field inside the blob. |
| Subscriber edit/save paths (server triggers only) | — |
| Frontend | No direct reader after Phase 4b. UI reads `_activeCable` from views. |

**Writers**
- `create_subscription` RPC (sets blob)
- `cancel_subscription` RPC (NULLs blob — now guarded against sibling devices)
- `expire_lapsed_subscriptions` (NULLs blob)
- `replace_device` (mutates `stbNumber` in blob)
- `Index.tsx:75` (creation path — passes `null`)

**Replacement source:** `v_subscriber_active_subscription` (server-side) and
`subscriptions WHERE status='active'` (RPC-internal).

**Safe to drop?** No — yet. Three server-side dependencies prevent it:
1. `subscribers_enforce_invariants` uses it to guard provider/service changes.
2. `check_subscriber_deletable` uses it for the delete preflight.
3. `expire_lapsed_subscriptions` clears it.

Migration path: rewrite the three RPCs/triggers above to query
`subscriptions` directly, then drop the column. Until then, keep writing
it. **Verdict: keep as a server-maintained cache; drop in a later phase
after the three server consumers are migrated.**

---

## 2. `internet_subscription` (jsonb)

Identical shape and consumers as `current_subscription`, for the internet
service. Same readers (`expire_lapsed_subscriptions`,
`subscribers_enforce_invariants`, `check_subscriber_deletable`,
`cancel_subscription`), same writers. UI reads `_activeInternet` from the
view, not this column.

**Verdict:** same as #1. Keep as cache, migrate server consumers first.

---

## 3. `current_pack` (text)

**Purpose:** Cached pack name for the active cable subscription.

**Readers**
| Site | Notes |
|---|---|
| `src/pages/Billing.tsx:116` | Header summary per service. |
| `src/pages/Analytics.tsx:298,299,316` | Pack-mix analytics buckets. |
| `src/components/SubscriberList.tsx:61,67,213` | List filter chip + row display. |
| `is_pack_in_use` SQL function | Blocks pack deletion while in use. |

**Writers**
- `create_subscription` RPC (sets to new pack name).
- `cancel_subscription` RPC (NULLs).
- `expire_lapsed_subscriptions` (NULLs).
- `Index.tsx:76` (sets to `null` on creation).

**Replacement source:** `v_subscriber_active_subscription.blob->>'packName'`
(already available on each subscriber as `_activeCable[i].packName`).
For `is_pack_in_use`: `EXISTS (SELECT 1 FROM subscriptions WHERE pack_id = X AND status='active')`.

**Safe to drop?** Not yet. Four UI readers + one SQL function still depend
on it. Multi-device break: shows only one pack name even when the
subscriber has multiple devices on different packs — already broken under
the multi-device model.

**Verdict:** demote to **derived/informational** once UI readers switch to
`_activeCable`. `is_pack_in_use` should be rewritten against
`subscriptions`. Then drop.

---

## 4. `current_pack_id` (uuid → packs.id)

**Purpose:** FK form of `current_pack`. Foreign key in DB.

**Readers**
- None in frontend (search shows only types.ts type definitions).
- No SQL function reads it for business logic.

**Writers**
- `create_subscription` RPC.
- `cancel_subscription` RPC.

**Replacement source:** `subscriptions.pack_id WHERE status='active'`.

**Safe to drop?** Yes, once the FK is dropped first. No reader depends
on it. **Verdict:** safest of the seven to remove — schedule for first
drop batch.

---

## 5. `current_internet_pack` + `current_internet_pack_id`

Identical to #3 and #4 for internet.

**Readers (name):** `Billing.tsx:116`, `Analytics.tsx:303,304,316`,
`SubscriberList.tsx:214`, `SubscriberDetail.tsx:633` (fallback display),
`is_pack_in_use`.

**Readers (id):** None.

**Writers:** Same RPCs as #3/#4.

**Replacement source:** `_activeInternet[i].packName` /
`subscriptions.pack_id`.

**Verdict:** same as #3/#4. `current_internet_pack_id` is safe to drop now;
`current_internet_pack` after UI migration.

---

## 6. `stb_number` (text)

**Purpose:** Cached serial of the one cable STB assigned to the subscriber.
Pre-Phase-5.1 this was the only place the cable STB serial was recorded.

**Readers**
| Site | Notes |
|---|---|
| `subscribers_enforce_invariants` trigger | Inventory-agreement check (`'cable' ∈ services` ⇒ `stb_number IS NOT NULL`). |
| `sync_stb_inventory_on_subscriber_change` trigger | Bidirectional inventory sync — claims/releases inventory rows. |
| `reconcile_stb_inventory` RPC | Cross-checks inventory against this field. |
| `check_subscriber_deletable` RPC | Indirect (via inventory-assigned query). |
| `SubscriberList.tsx:66,212` | Display + search. |
| `SubscriberDetail.tsx` (overview header) | Display fallback. |
| CSV export | Customer roster export. |

**Writers**
- `create_subscription` RPC (does NOT touch).
- `cancel_subscription` RPC (does NOT touch).
- `pair_device` RPC (sets when empty).
- `unpair_device` RPC (clears when releasing the cable STB it represents).
- `replace_device` RPC (overwrites with new serial).
- `Index.tsx:75` (set from form on create).

**Replacement source:** `stb_inventory WHERE subscriber_id = X AND service_type = 'cable' AND status = 'assigned'` — returns N rows under the multi-device model.

**Safe to drop?** No. The **cable-STB invariant trigger** depends on it
and is the entire reason single-device subscribers stay consistent. UI
list/CSV depend on it as the canonical "primary STB" surface.

Under multi-device: only ever shows one of N cable STBs (the one that was
first paired, per `pair_device` logic). Already informational/lossy.

**Verdict:** keep as a server-maintained cache of the primary cable STB.
Rewrite the invariant trigger to query `stb_inventory` directly, migrate
list/CSV consumers to a derived "device count + primary serial", then
drop. **Highest blast-radius column of the seven** — schedule last.

---

## 7. `services[]` (text[])

**Purpose:** Declared services the subscriber subscribes to. CHECK
constraint requires `array_length(services, 1) >= 1`.

**Readers**
| Site | Notes |
|---|---|
| `subscribers_enforce_invariants` trigger | Service↔STB consistency rule. |
| `create_subscription` RPC | Validates `p_service_type ∈ services`. |
| `Billing.tsx:137`, `Analytics.tsx:122,297,371,436` | Tab/segment filtering. |
| `AddTransactionDialog.tsx:50` | Service dropdown options. |
| `SubscriberList.tsx:225` | Filter chip. |
| `SubscriberDetail.tsx:104` | Shows/hides Cable/Internet tabs. |
| `AddSubscriberForm.tsx:61–132` | Service checkboxes on create. |

**Writers**
- `pair_device` RPC (auto-appends service on pair).
- `unpair_device` RPC (auto-removes on last-device unpair, if doing so leaves ≥1 service).
- `Index.tsx:69` (on create).
- Frontend form via `subscribers` UPDATE through `EditSubscriberDialog` (post-Phase-5.1 the dialog no longer touches this).

**Replacement source:** Derivable from `stb_inventory` (assigned devices'
`service_type`) **union** `subscriptions` (any active sub's `service_type`).
Two-source union required because:
- A subscriber with no device but a queued plan still declares the service.
- A subscriber with a device but no active sub still declares the service.

**Safe to drop?** Not yet — and the cost-benefit favors keeping it as an
**operator-declared cache** for two reasons:
1. The "declared services" intent precedes both device pairing and
   subscription creation. Without `services[]`, the AddSubscriber form
   has no surface to capture intent.
2. The `subscribers_enforce_invariants` trigger uses it as the source of
   truth for the cable-STB invariant.

**Verdict:** keep. Reposition documentation: `services[]` is the declared
intent; `stb_inventory` / `subscriptions` are the realized state. The RPCs
keep it in agreement. No removal planned.

---

## Summary matrix

| # | Column | Safe to drop now? | Recommended next step |
|---|---|---|---|
| 1 | `current_subscription` | No | Migrate 3 server consumers, then drop |
| 2 | `internet_subscription` | No | Same as #1 |
| 3 | `current_pack` | No | Migrate 5 readers to view, then drop |
| 4 | `current_pack_id` | **Yes (FK first)** | Drop in next migration batch |
| 5a | `current_internet_pack` | No | Same as #3 |
| 5b | `current_internet_pack_id` | **Yes (FK first)** | Drop in next migration batch |
| 6 | `stb_number` | No (high risk) | Rewrite invariant trigger + UI, drop last |
| 7 | `services[]` | No (keep) | Reframe as declared-intent cache; no drop |

## Recommended drop order

1. **Batch A (low risk, no UI):** `current_pack_id`, `current_internet_pack_id`. Drop FKs, drop columns, remove from RPC writes.
2. **Batch B (UI churn):** `current_pack`, `current_internet_pack`. Switch `Billing`, `Analytics`, `SubscriberList`, `SubscriberDetail` fallback, and `is_pack_in_use` to `subscriptions` / view-derived values.
3. **Batch C (server rewrite):** `current_subscription`, `internet_subscription`. Rewrite `expire_lapsed_subscriptions`, `subscribers_enforce_invariants`, `check_subscriber_deletable`, `cancel_subscription` history-mutation, `replace_device` stbNumber update to operate against `subscriptions` + `stb_inventory`.
4. **Batch D (highest risk):** `stb_number`. Rewrite the cable-STB invariant in `subscribers_enforce_invariants` against `stb_inventory`. Update list/CSV/detail to compute "primary device + count of N" from `stb_inventory`. Migrate `sync_stb_inventory_on_subscriber_change` away (its only purpose is `stb_number` bidirectional sync; with `stb_number` gone, the trigger is also gone).
5. **No drop:** `services[]` stays as declared-intent cache.

No code changes are made by this audit. Awaiting decision on which
batches to execute.
