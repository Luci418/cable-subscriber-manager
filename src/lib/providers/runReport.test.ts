import { describe, it, expect } from "vitest";
import { buildRunReport, filterRunReport, type RunResults } from "./runReport";
import type { ProviderReportRow } from "./hathway/types";

const snap = (over: Partial<ProviderReportRow>): ProviderReportRow => ({
  row_number: 1,
  account_number: null,
  customer_name: null,
  vc_id: null,
  stb_no: null,
  mobile: null,
  base_plan: null,
  start_date: null,
  end_date: null,
  total_base_price: null,
  dpo_total_price: null,
  service_status: "ACTIVE",
  extra: {},
  ...over,
});

const COMMITTED = "2026-07-01T10:00:00Z";

const results: RunResults = {
  rows: [
    {
      key: "VC1",
      bucket: "renewal",
      outcome: "applied",
      subscriber_id: "s1",
      transaction_id: "t1",
      frozen: { pack_name: "Basic", pack_price: 250, validity_days: 30 },
    },
    {
      key: "VC2",
      bucket: "new_activation",
      outcome: "applied",
      subscriber_id: "s2",
      transaction_id: "t2",
      frozen: { pack_name: "Premium", pack_price: 400, validity_days: 30 },
    },
    { key: "VC3", bucket: "status_change", outcome: "applied", subscriber_id: "s1" },
    { key: "VC4", outcome: "skipped", reason: "Sync policy blocks renewals" },
    { key: "VC5", outcome: "error", reason: "No pack mapping" },
  ],
};

const base = {
  results,
  snapshotRows: [
    snap({ vc_id: "VC1", base_plan: "HD Pack", end_date: "2026-08-01" }),
    snap({ vc_id: "VC2", customer_name: "Report Name", end_date: "2026-08-01" }),
    snap({ vc_id: "VC3", base_plan: "HD Pack" }),
    snap({ vc_id: "VC4" }),
    snap({ vc_id: "VC5", stb_no: "STB5" }),
  ],
  subscribersById: {
    s1: { id: "s1", subscriber_id: "NORTH-001", name: "Old Customer", created_at: "2026-01-01T00:00:00Z" },
    s2: { id: "s2", subscriber_id: "NORTH-002", name: "Fresh Customer", created_at: COMMITTED },
  },
  transactionsById: {
    t1: { id: "t1", amount: 250 },
    t2: { id: "t2", amount: 400 },
  },
  committedAt: COMMITTED,
};

describe("buildRunReport", () => {
  it("groups rows by what actually happened", () => {
    const r = buildRunReport(base);
    expect(r.counts).toMatchObject({
      renewal: 1,
      new_customer: 1,
      state_only: 1,
      skipped: 1,
      failed: 1,
      plan_change: 0,
      new_activation: 0,
    });
  });

  it("treats a subscriber created by this run as a new customer, not an activation", () => {
    const r = buildRunReport(base);
    expect(r.rows.find((x) => x.key === "VC2")?.group).toBe("new_customer");
  });

  it("sums only charges recorded against the run", () => {
    expect(buildRunReport(base).totalCharged).toBe(650);
  });

  it("describes a renewal from the frozen pack, not the report plan", () => {
    const row = buildRunReport(base).rows.find((x) => x.key === "VC1")!;
    expect(row.description).toContain("Basic");
    expect(row.amount).toBe(250);
  });

  it("keeps a chargeless row out of the money groups", () => {
    const row = buildRunReport(base).rows.find((x) => x.key === "VC3")!;
    expect(row.group).toBe("state_only");
    expect(row.amount).toBeNull();
  });

  it("surfaces the server reason verbatim for failures and skips", () => {
    const rows = buildRunReport(base).rows;
    expect(rows.find((x) => x.key === "VC5")?.description).toBe("No pack mapping");
    expect(rows.find((x) => x.key === "VC4")?.description).toBe("Sync policy blocks renewals");
  });

  it("falls back to the report name when the row never linked to a customer", () => {
    const row = buildRunReport(base).rows.find((x) => x.key === "VC4")!;
    expect(row.customerName).toBe("Unknown customer");
    expect(row.subscriberSlug).toBeNull();
  });

  it("returns empty structures for a run with no results", () => {
    const r = buildRunReport({ ...base, results: null, snapshotRows: null });
    expect(r.rows).toEqual([]);
    expect(r.groups).toEqual([]);
    expect(r.totalCharged).toBe(0);
  });
});

describe("filterRunReport", () => {
  it("matches on customer id and device identifiers", () => {
    const r = buildRunReport(base);
    expect(filterRunReport(r, "north-002").rows.map((x) => x.key)).toEqual(["VC2"]);
    expect(filterRunReport(r, "STB5").rows.map((x) => x.key)).toEqual(["VC5"]);
    expect(filterRunReport(r, "  ").rows).toHaveLength(5);
  });

  it("recomputes group totals for the filtered set", () => {
    const filtered = filterRunReport(buildRunReport(base), "Fresh");
    expect(filtered.totalCharged).toBe(400);
  });
});
