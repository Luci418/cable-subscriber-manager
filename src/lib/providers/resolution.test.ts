import { describe, it, expect } from "vitest";
import { detectEvents } from "./diffEngine";
import {
  resolveEvents,
  resolveEvent,
  normMobile,
  normPackKey,
  type ResolutionContext,
} from "./resolution";
import { SYNC_POLICY_DEFAULTS } from "./syncPolicy";
import type { ProviderReportRow } from "./hathway/types";

function row(over: Partial<ProviderReportRow> = {}): ProviderReportRow {
  return {
    row_number: 1,
    account_number: "ACC1",
    customer_name: "Test Customer",
    vc_id: "VC001",
    stb_no: "STB001",
    mobile: "9999999999",
    base_plan: "Basic Pack",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    total_base_price: 300,
    dpo_total_price: 150,
    service_status: "ACTIVE",
    extra: {},
    ...over,
  };
}

function ctx(over: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    subscriberByVcId: { VC001: "sub-1" },
    subscriberBySerial: { STB001: "sub-1" },
    subscriberByAccountNumber: { ACC1: "sub-1" },
    subscribersByMobile: { "9999999999": ["sub-1"] },
    packIdByProviderKey: { "basic pack": "pack-1" },
    policy: SYNC_POLICY_DEFAULTS,
    ...over,
  };
}

function one(rows: ProviderReportRow[], previous: ProviderReportRow[] | null, c = ctx()) {
  const { events } = detectEvents(previous, rows);
  return resolveEvent(events[0], c);
}

describe("key normalisation", () => {
  it("normalises mobiles to the last 10 digits", () => {
    expect(normMobile("+91 99999-99999")).toBe("9999999999");
    expect(normMobile("12345")).toBeNull();
  });

  it("normalises pack keys case- and whitespace-insensitively", () => {
    expect(normPackKey("  Basic   Pack ")).toBe("basic pack");
    expect(normPackKey("")).toBeNull();
  });
});

describe("subscriber resolution order (§1.5-H)", () => {
  it("matches on vc_id first", () => {
    const r = one([row()], null);
    expect(r.match.status).toBe("matched");
    expect(r.match.method).toBe("vc_id");
    expect(r.match.subscriber_id).toBe("sub-1");
  });

  it("falls back to serial_number when vc_id is unknown", () => {
    const r = one([row({ vc_id: "VCZZZ" })], null);
    expect(r.match.method).toBe("serial_number");
  });

  it("falls back to account_number when no device matches", () => {
    const r = one([row({ vc_id: "VCZZZ", stb_no: "STBZZZ", account_number: "ACC1" })], null, ctx());
    expect(r.match.method).toBe("account_number");
  });

  it("treats a mobile-only hit as a suggestion, never a match", () => {
    const r = one([row({ vc_id: "X", stb_no: "Y", account_number: "Z" })], null);
    expect(r.match.status).toBe("suggested");
    expect(r.match.method).toBe("mobile");
    expect(r.bucket).toBe("needs_review");
  });

  it("offers all candidates when a mobile is shared", () => {
    const c = ctx({
      subscriberByVcId: {},
      subscriberBySerial: {},
      subscriberByAccountNumber: {},
      subscribersByMobile: { "9999999999": ["sub-1", "sub-2"] },
    });
    const r = one([row()], null, c);
    expect(r.match.status).toBe("suggested");
    expect(r.match.subscriber_id).toBeNull();
    expect(r.match.candidates).toHaveLength(2);
  });

  it("flags a vc_id / serial_number disagreement as a conflict, never a silent pick", () => {
    const c = ctx({ subscriberBySerial: { STB001: "sub-2" } });
    const r = one([row()], null, c);
    expect(r.match.status).toBe("conflict");
    expect(r.match.subscriber_id).toBeNull();
    expect(r.bucket).toBe("needs_review");
    expect(new Set(r.match.candidates.map((x) => x.subscriber_id))).toEqual(
      new Set(["sub-1", "sub-2"]),
    );
  });

  it("reports unmatched rows for review", () => {
    const c = ctx({
      subscriberByVcId: {},
      subscriberBySerial: {},
      subscriberByAccountNumber: {},
      subscribersByMobile: {},
    });
    const r = one([row()], null, c);
    expect(r.match.status).toBe("unmatched");
    expect(r.bucket).toBe("needs_review");
    expect(r.writes).toEqual({ charge: false, plan_state: false, provider_status: false });
  });
});

describe("pack resolution", () => {
  it("maps a known plan to a local pack", () => {
    const r = one([row({ base_plan: "  BASIC pack " })], null);
    expect(r.pack).toEqual({ status: "mapped", provider_pack_key: "basic pack", pack_id: "pack-1" });
    expect(r.writes.charge).toBe(true);
  });

  it("buckets an unmapped plan as unmapped_pack and proposes no charge", () => {
    const r = one([row({ base_plan: "Kannada Value" })], null);
    expect(r.bucket).toBe("unmapped_pack");
    expect(r.writes.charge).toBe(false);
  });

  it("treats a plan-less row (dashboard status) as not_applicable", () => {
    const r = one(
      [row({ base_plan: null, service_status: "SUSPENDED" })],
      [row({ base_plan: null })],
    );
    expect(r.pack.status).toBe("not_applicable");
    expect(r.bucket).toBe("status_change");
  });

  it("lists every distinct unmapped plan key once", () => {
    const { events } = detectEvents(null, [
      row({ base_plan: "Kannada Value" }),
      row({ row_number: 2, vc_id: "VC002", base_plan: "kannada value" }),
      row({ row_number: 3, vc_id: "VC003", base_plan: "Sports Add-on" }),
    ]);
    const c = ctx({ subscriberByVcId: { VC001: "a", VC002: "b", VC003: "c" }, subscriberBySerial: {}, subscriberByAccountNumber: {} });
    expect(resolveEvents(events, c).unmapped_pack_keys).toEqual(["kannada value", "sports add-on"]);
  });
});

describe("sync policy filtering (INV-49/INV-50)", () => {
  it("suppresses the charge when create_charges is off and says why", () => {
    const c = ctx({ policy: { ...SYNC_POLICY_DEFAULTS, create_charges: false } });
    const r = one([row()], null, c);
    expect(r.writes.charge).toBe(false);
    expect(r.suppressed_by_policy).toContainEqual({
      policy_key: "create_charges",
      what: "Ledger charge for this event",
    });
  });

  it("never proposes an identity write and records the denial by default", () => {
    const r = one([row()], null);
    const keys = r.suppressed_by_policy.map((s) => s.policy_key);
    expect(keys).toContain("update_identity_name");
    expect(keys).toContain("update_identity_mobile");
  });

  it("suppresses state writes when their flags are off", () => {
    const c = ctx({
      policy: { ...SYNC_POLICY_DEFAULTS, update_plan_state: false, update_provider_status: false },
    });
    const r = one([row()], null, c);
    expect(r.writes.plan_state).toBe(false);
    expect(r.writes.provider_status).toBe(false);
  });

  it("proposes only the state writes the event actually supports", () => {
    const r = one([row({ service_status: "SUSPENDED" })], [row()]);
    expect(r.writes.provider_status).toBe(true);
    expect(r.writes.plan_state).toBe(false);
    expect(r.writes.charge).toBe(false);
  });
});

describe("bucketing", () => {
  it("keeps a truly identical row in no_change", () => {
    expect(one([row()], [row()]).bucket).toBe("no_change");
  });

  it("buckets a no_change event with differing fields as an anomaly, not silence", () => {
    const r = one([row({ end_date: "2026-06-30" })], [row()]);
    expect(r.event.type).toBe("no_change");
    expect(r.bucket).toBe("anomaly");
    expect(r.event.changed).toContain("end_date");
  });

  it("treats a field that parsed to null against a real baseline as an anomaly", () => {
    const r = one([row({ end_date: null })], [row()]);
    expect(r.bucket).toBe("anomaly");
  });

  it("counts a mixed file by bucket", () => {
    const prev = [row({ vc_id: "A" }), row({ vc_id: "B" }), row({ vc_id: "C" })];
    const cur = [
      row({ vc_id: "A" }),
      row({ vc_id: "B", end_date: "2026-08-31" }),
      row({ vc_id: "C", end_date: "2026-06-01" }),
      row({ vc_id: "D" }),
    ];
    const { events } = detectEvents(prev, cur);
    const c = ctx({
      subscriberByVcId: { A: "s1", B: "s2", C: "s3", D: "s4" },
      subscriberBySerial: {},
      subscriberByAccountNumber: {},
    });
    expect(resolveEvents(events, c).counts).toMatchObject({
      no_change: 1,
      renewal: 1,
      anomaly: 1,
      new_activation: 1,
      needs_review: 0,
    });
  });
});
