import { describe, it, expect } from "vitest";
import {
  getSyncPolicy,
  isSyncAllowed,
  SYNC_POLICY_DEFAULTS,
  SYNC_POLICY_LABELS,
  type SyncPolicyKey,
} from "./syncPolicy";

describe("getSyncPolicy (INV-50)", () => {
  it("returns all defaults for a provider with no policy", () => {
    expect(getSyncPolicy({ sync_policy: null })).toEqual(SYNC_POLICY_DEFAULTS);
    expect(getSyncPolicy(null)).toEqual(SYNC_POLICY_DEFAULTS);
    expect(getSyncPolicy(undefined)).toEqual(SYNC_POLICY_DEFAULTS);
    expect(getSyncPolicy({})).toEqual(SYNC_POLICY_DEFAULTS);
  });

  it("resolves an absent key to its documented default, not false", () => {
    const policy = getSyncPolicy({ sync_policy: { create_charges: false } });
    expect(policy.create_charges).toBe(false);
    expect(policy.create_prospects).toBe(true);
    expect(policy.update_plan_state).toBe(true);
    expect(policy.update_provider_status).toBe(true);
  });

  it("ignores unknown keys and non-boolean values", () => {
    const policy = getSyncPolicy({
      sync_policy: {
        create_charges: "yes",
        update_plan_state: 0,
        future_flag_nobody_knows: true,
      },
    });
    expect(policy).toEqual(SYNC_POLICY_DEFAULTS);
    expect("future_flag_nobody_knows" in policy).toBe(false);
  });

  it("denies identity writes by default (INV-49)", () => {
    const policy = getSyncPolicy({ sync_policy: {} });
    expect(policy.update_identity_name).toBe(false);
    expect(policy.update_identity_mobile).toBe(false);
    expect(policy.update_identity_address).toBe(false);
    expect(policy.auto_pair_devices).toBe(false);
  });

  it("accepts a bare jsonb value as well as a provider row", () => {
    expect(getSyncPolicy({ update_identity_name: true }).update_identity_name).toBe(true);
    expect(
      getSyncPolicy({ sync_policy: { update_identity_name: true } }).update_identity_name,
    ).toBe(true);
  });

  it("tolerates malformed policy shapes", () => {
    expect(getSyncPolicy({ sync_policy: [] })).toEqual(SYNC_POLICY_DEFAULTS);
    expect(getSyncPolicy({ sync_policy: "nope" })).toEqual(SYNC_POLICY_DEFAULTS);
    expect(getSyncPolicy({ sync_policy: 42 })).toEqual(SYNC_POLICY_DEFAULTS);
  });

  it("isSyncAllowed reads a single flag through the same merge", () => {
    expect(isSyncAllowed({ sync_policy: {} }, "create_charges")).toBe(true);
    expect(isSyncAllowed({ sync_policy: { create_charges: false } }, "create_charges")).toBe(false);
    expect(isSyncAllowed(null, "update_identity_mobile")).toBe(false);
  });

  it("every default flag has an operator-facing label", () => {
    const keys = Object.keys(SYNC_POLICY_DEFAULTS) as SyncPolicyKey[];
    for (const key of keys) {
      expect(SYNC_POLICY_LABELS[key]).toBeTruthy();
    }
    expect(Object.keys(SYNC_POLICY_LABELS).sort()).toEqual([...keys].sort());
  });
});
