/**
 * Provider sync policy (INV-50).
 *
 * `providers.sync_policy` is a jsonb column holding a fixed set of boolean
 * flags. It MUST only ever be read through `getSyncPolicy()`, which merges the
 * stored JSON over the current default map. Direct `sync_policy.<key>` access
 * is forbidden anywhere in the codebase: a missing key must resolve to its
 * documented default, never to `false`/`undefined`, otherwise a future flag
 * would silently disable itself for every existing provider row.
 *
 * Removed 2026-08-04: `update_identity_address`. The Hathway parser never
 * promoted an address into `ProviderReportRow`, so no layer could gate it and
 * the flag was inert. A checkbox that does nothing when toggled is worse than
 * no checkbox. Re-add it together with a canonical `address` field and the
 * matching suppression check in `resolveEvent`, never before.
 */

export type SyncPolicy = {
  /** Create ledger charges from detected renewal / activation events. */
  create_charges: boolean;
  /** Create `prospect` subscribers for unmatched provider rows. */
  create_prospects: boolean;
  /** Write upstream plan name / window into `subscriber_provider_state`. */
  update_plan_state: boolean;
  /** Write the raw upstream status string into `subscriber_provider_state`. */
  update_provider_status: boolean;
  /** Identity fields — denied by default (INV-49). */
  update_identity_name: boolean;
  update_identity_mobile: boolean;
  /**
   * RESERVED — not live (decision 2026-08-04). Phase 6's commit path never
   * auto-pairs a device regardless of this flag, and no other layer reads it.
   * Kept in the map so the default exists the day pairing is implemented;
   * Phase 8 MUST NOT render a checkbox for it until then.
   */
  auto_pair_devices: boolean;
};

export type SyncPolicyKey = keyof SyncPolicy;

/**
 * The single source of truth for defaults. Adding a flag here makes it appear
 * — with its default — for every existing provider row, with no backfill.
 */
export const SYNC_POLICY_DEFAULTS: SyncPolicy = {
  create_charges: true,
  create_prospects: true,
  update_plan_state: true,
  update_provider_status: true,
  update_identity_name: false,
  update_identity_mobile: false,
  auto_pair_devices: false,
};

export const SYNC_POLICY_LABELS: Record<SyncPolicyKey, string> = {
  create_charges: "Create charges for renewals and activations",
  create_prospects: "Create prospect customers for unmatched rows",
  update_plan_state: "Update upstream plan name and validity window",
  update_provider_status: "Update upstream service status",
  update_identity_name: "Allow sync to change customer name",
  update_identity_mobile: "Allow sync to change customer mobile",
  auto_pair_devices: "Automatically pair devices found in the report (reserved — no effect yet)",
};

type PolicySource =
  | { sync_policy?: unknown }
  | null
  | undefined;

function coerce(raw: unknown): Partial<SyncPolicy> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<SyncPolicy> = {};
  for (const key of Object.keys(SYNC_POLICY_DEFAULTS) as SyncPolicyKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * Resolve the effective sync policy for a provider row. Accepts the provider
 * object, a bare jsonb value, or null/undefined.
 */
export function getSyncPolicy(provider: PolicySource | unknown): SyncPolicy {
  const raw =
    provider && typeof provider === "object" && "sync_policy" in provider
      ? (provider as { sync_policy?: unknown }).sync_policy
      : provider;

  return { ...SYNC_POLICY_DEFAULTS, ...coerce(raw) };
}

/** Convenience single-flag read. Never bypass this with direct key access. */
export function isSyncAllowed(
  provider: PolicySource | unknown,
  key: SyncPolicyKey,
): boolean {
  return getSyncPolicy(provider)[key];
}
