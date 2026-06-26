## Goal

Make the database the single source of truth for Business Configuration. Remove the localStorage cache for company/payment/service-module settings, replace it with a React context hydrated from `public.settings` after login, and reserve localStorage strictly for transient UI state.

## 1. Schema migration — extend `public.settings`

Add columns (all nullable except where noted, with sensible defaults):

```text
name                  text          NOT NULL DEFAULT 'My Cable Company'
address               text          NOT NULL DEFAULT ''
phone                 text          NOT NULL DEFAULT ''
email                 text          NOT NULL DEFAULT ''
enabled_services      text[]        NOT NULL DEFAULT ARRAY['cable']
receipt_prefix        text          NOT NULL DEFAULT 'RCP'
receipt_footer        text          NOT NULL DEFAULT 'Thank you for your business.'
default_currency      text          NOT NULL DEFAULT 'INR'
default_timezone      text          NOT NULL DEFAULT 'Asia/Kolkata'
settings_version      integer       NOT NULL DEFAULT 1
-- existing: backdating_window_days, operator_upi_vpa, updated_at
```

Add CHECK: `array_length(enabled_services,1) >= 1` and each element in (`cable`,`internet`).

Add an RPC `ensure_settings_row()` (SECURITY DEFINER) that inserts a defaults row for `auth.uid()` if missing and returns it. Called once on app load.

No backfill in SQL — legacy localStorage import is a one-time client-side operation gated on "row still at defaults".

## 2. New `SettingsContext`

`src/contexts/SettingsContext.tsx`:

- Provider mounted in `App.tsx` *inside* `BrowserRouter`, wrapping authenticated routes.
- On mount (when `user` is present): call `ensure_settings_row()`, then `select * from settings`.
- Exposes `{ settings, loading, updateSettings(patch), enabledServices, cableEnabled, internetEnabled, bothEnabled }`.
- `updateSettings` does optimistic update + `update ... where user_id = auth.uid()` + toast on error rollback.
- Clears state on sign-out.
- No localStorage reads or writes anywhere in this module.

Replace `useEnabledServices` with a thin re-export from this context so existing call sites keep working with one import change.

## 3. One-time legacy import (client-side, idempotent)

In the Provider, after first fetch:

```text
if (row.settings_version === 1 && row matches all defaults
    && localStorage has 'cable_company_settings') {
  parse legacy JSON, map fields, call updateSettings(patch + settings_version=2),
  then localStorage.removeItem('cable_company_settings').
}
```

Guard: never overwrite a row whose any business field differs from defaults. After successful import bump `settings_version` to 2 so re-runs no-op. Wrapped in try/catch — failure logs a console warning and leaves DB untouched.

## 4. Refactor call sites

- `src/lib/storage.ts`: delete `getCompanySettings` / `saveCompanySettings` / `CompanySettings` interface / `COMPANY_SETTINGS_KEY`. Keep the other localStorage helpers (legacy subscriber/transaction/pack caches) untouched — out of scope.
- `src/lib/pdf.ts`, `src/lib/pdfStatement.ts`: accept a `company` argument from the caller rather than reading storage. Update every invoker (`SubscriberDetail`, `CollectPaymentDialog`, `Billing`, etc.) to pull from `useSettings()` and pass it in.
- `src/pages/Settings.tsx`: read & write through `useSettings()`. Add new fields (receipt prefix, footer, currency, timezone) to the form.
- `src/hooks/useEnabledServices.tsx`: replace body with `const { enabledServices, ... } = useSettings(); return ...;` — keeps existing imports working.
- Backup/restore (`src/lib/storage.ts`): drop `companySettings` from the backup payload (DB is authoritative); on restore, skip that key.

## 5. Repository-wide storage audit (deliverable in chat)

Classify every `localStorage` / `sessionStorage` reference:

| Key | File | Classification | Action |
|---|---|---|---|
| `cable_company_settings` | storage.ts | Business Config | **Remove** (migrated) |
| `cable_subscribers/transactions/packs/regions/complaints/billing_history` | storage.ts | Legacy caches (pre-Supabase) | Out of scope — leave for separate cleanup pass |
| `cable_invoice_counter` | storage.ts | UI/local counter | Leave |
| `sb-…-auth-token` | supabase client | Auth session | Leave (required) |

If the audit surfaces any other Business Config keys, migrate them in this same pass.

## 6. Verification protocol

After implementation, run these and report results before declaring done:

1. **Fresh incognito**: log in → Settings shows DB defaults, not "Cable TV Company".
2. **Cross-browser**: change company name in Browser A → reload Browser B (same user) → new name visible.
3. **Cache cleared**: DevTools → Clear site data → reload → settings persist from DB.
4. **Logout/login**: change a setting, sign out, sign in as same user → setting persists; sign in as different user → that user's own settings load.
5. **Legacy import**: seed `localStorage['cable_company_settings']` with a known payload on a fresh user whose DB row is at defaults → reload → DB row updated, localStorage key removed, `settings_version=2`. Re-run: no overwrite.
6. **`rg "localStorage|sessionStorage" src`** final grep: only auth-session, legacy non-business caches, and `cable_invoice_counter` remain.

## 7. Out of scope (explicit)

- Migrating the legacy subscriber/transaction/pack localStorage caches (those are dead-code reads behind Supabase hooks; cleanup tracked separately).
- Phase 6 UI work.

## Files touched

New: `supabase/migrations/<ts>_settings_full_business_config.sql`, `src/contexts/SettingsContext.tsx`.
Edited: `src/App.tsx`, `src/lib/storage.ts`, `src/lib/pdf.ts`, `src/lib/pdfStatement.ts`, `src/hooks/useEnabledServices.tsx`, `src/pages/Settings.tsx`, plus every caller of `getCompanySettings` (3 files) and any PDF caller that needs to pass `company` through.

Confirm and I'll ship the migration first, then the context + refactor in one pass, then run the verification protocol.