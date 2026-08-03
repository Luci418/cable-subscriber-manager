import { describe, it, expect } from "vitest";
import { detectEvents, findStaleEntries, rowKey } from "./diffEngine";
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

describe("rowKey", () => {
  it("prefers vc_id, falls back to stb_no", () => {
    expect(rowKey(row())).toBe("VC001");
    expect(rowKey(row({ vc_id: null }))).toBe("STB001");
    expect(rowKey(row({ vc_id: null, stb_no: null }))).toBeNull();
  });
});

describe("detectEvents", () => {
  it("treats every row as new_activation when there is no baseline", () => {
    const r = detectEvents(null, [row(), row({ row_number: 2, vc_id: "VC002" })]);
    expect(r.counts.new_activation).toBe(2);
    expect(r.events.every((e) => e.previous === null)).toBe(true);
  });

  it("a cancelled review leaves no baseline, so rows are new_activation again (INV-48)", () => {
    // A cancelled run is simply never passed in as a baseline.
    const first = detectEvents(null, [row()]);
    const second = detectEvents(null, [row()]);
    expect(first.counts.new_activation).toBe(1);
    expect(second.counts.new_activation).toBe(1);
  });

  it("re-diffing an identical committed snapshot yields all no_change", () => {
    const snapshot = [row(), row({ row_number: 2, vc_id: "VC002" })];
    const r = detectEvents(snapshot, snapshot);
    expect(r.counts.no_change).toBe(2);
    expect(r.counts.renewal).toBe(0);
    expect(r.events.every((e) => e.changed.length === 0)).toBe(true);
  });

  it("classifies a later end_date as renewal", () => {
    const r = detectEvents([row()], [row({ start_date: "2026-08-01", end_date: "2026-08-31" })]);
    expect(r.counts.renewal).toBe(1);
    expect(r.events[0].changed).toContain("end_date");
    expect(r.events[0].changed).toContain("start_date");
  });

  it("does not call an earlier or equal end_date a renewal", () => {
    const r = detectEvents([row()], [row({ end_date: "2026-06-30" })]);
    expect(r.counts.renewal).toBe(0);
    expect(r.counts.no_change).toBe(1);
    expect(r.events[0].changed).toContain("end_date");
  });

  it("plan_change takes precedence over a simultaneous renewal", () => {
    const r = detectEvents(
      [row()],
      [row({ base_plan: "Premium Pack", end_date: "2026-08-31" })],
    );
    expect(r.events[0].type).toBe("plan_change");
    expect(r.events[0].changed).toEqual(expect.arrayContaining(["base_plan", "end_date"]));
  });

  it("classifies a status difference with no window change as status_change", () => {
    // Logic-verified only: no real non-ACTIVE row exists in any sample export yet.
    const r = detectEvents([row()], [row({ service_status: "SUSPENDED" })]);
    expect(r.events[0].type).toBe("status_change");
    expect(r.events[0].is_active).toBe(false);
    expect(r.events[0].provider_status).toBe("SUSPENDED");
  });

  it("preserves an unrecognised status verbatim and treats it as not active", () => {
    // Logic-verified only — Hathway's inactive vocabulary is unconfirmed.
    const r = detectEvents(null, [row({ service_status: "TEMP-DISCONNECT" })]);
    expect(r.events[0].provider_status).toBe("TEMP-DISCONNECT");
    expect(r.events[0].is_active).toBe(false);
  });

  it("ignores case/whitespace when comparing status but never rewrites it", () => {
    const r = detectEvents([row()], [row({ service_status: " active " })]);
    expect(r.events[0].type).toBe("no_change");
    expect(r.events[0].provider_status).toBe(" active ");
    expect(r.events[0].is_active).toBe(true);
  });

  it("absence is never termination — a missing key produces no event", () => {
    const r = detectEvents([row(), row({ row_number: 2, vc_id: "VC002" })], [row()]);
    expect(r.missing_keys).toEqual(["VC002"]);
    expect(r.events).toHaveLength(1);
    expect(r.counts.status_change).toBe(0);
  });

  it("collects rows with no identifier instead of diffing them", () => {
    const r = detectEvents(null, [row({ row_number: 3, vc_id: null, stb_no: null })]);
    expect(r.events).toHaveLength(0);
    expect(r.unkeyed).toEqual([
      { row_number: 3, reason: expect.stringContaining("VC Id") },
    ]);
  });

  it("matches baseline rows keyed only by stb_no", () => {
    const prev = [row({ vc_id: null })];
    const r = detectEvents(prev, [row({ vc_id: null, end_date: "2026-08-31" })]);
    expect(r.events[0].type).toBe("renewal");
  });

  it("counts a mixed file correctly", () => {
    const prev = [
      row({ vc_id: "A" }),
      row({ vc_id: "B" }),
      row({ vc_id: "C" }),
      row({ vc_id: "D" }),
    ];
    const cur = [
      row({ vc_id: "A" }),
      row({ vc_id: "B", end_date: "2026-08-31" }),
      row({ vc_id: "C", base_plan: "Premium Pack" }),
      row({ vc_id: "D", service_status: "SUSPENDED" }),
      row({ vc_id: "E" }),
    ];
    expect(detectEvents(prev, cur).counts).toEqual({
      no_change: 1,
      renewal: 1,
      plan_change: 1,
      status_change: 1,
      new_activation: 1,
    });
  });
});

describe("findStaleEntries", () => {
  const now = new Date("2026-08-03T00:00:00Z");

  it("flags entries not seen for 14+ days, sorted most stale first", () => {
    const stale = findStaleEntries(
      { A: "2026-08-01", B: "2026-07-01", C: "2026-07-20" },
      now,
    );
    expect(stale.map((s) => s.key)).toEqual(["B", "C"]);
    expect(stale[0].days_stale).toBe(33);
  });

  it("reports never-seen entries with a null age", () => {
    const stale = findStaleEntries({ A: null }, now);
    expect(stale).toEqual([{ key: "A", last_seen_at: null, days_stale: null }]);
  });

  it("honours a custom threshold", () => {
    expect(findStaleEntries({ A: "2026-08-01" }, now, 2)).toHaveLength(1);
    expect(findStaleEntries({ A: "2026-08-01" }, now, 3)).toHaveLength(0);
  });
});
