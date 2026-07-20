import { describe, it, expect } from "vitest";
import {
  getActives,
  getTimeline,
  getHistory,
  primaryActive,
  hasAnyActive,
  hasAnyServiceActive,
  daysUntil,
  isActiveBlob,
  type SubscriptionBlob,
} from "@/lib/activeSubs";

const blob = (over: Partial<SubscriptionBlob> = {}): SubscriptionBlob => ({
  subscriptionId: "s1",
  packId: "p1",
  packName: "Basic",
  packPrice: 300,
  duration: 30,
  startDate: "2026-01-01",
  endDate: new Date(Date.now() + 10 * 86400000).toISOString(),
  status: "active",
  subscribedAt: "2026-01-01",
  ...over,
});

describe("getActives / getTimeline", () => {
  it("returns [] for missing enriched arrays", () => {
    expect(getActives({}, "cable")).toEqual([]);
    expect(getActives({}, "internet")).toEqual([]);
    expect(getTimeline({}, "cable")).toEqual([]);
  });

  it("returns [] when field is not an array", () => {
    expect(getActives({ _activeCable: null }, "cable")).toEqual([]);
    expect(getActives({ _activeCable: "oops" as any }, "cable")).toEqual([]);
  });

  it("reads the correct field per service", () => {
    const s = { _activeCable: [blob({ subscriptionId: "c1" })], _activeInternet: [blob({ subscriptionId: "i1" })] };
    expect(getActives(s, "cable")[0].subscriptionId).toBe("c1");
    expect(getActives(s, "internet")[0].subscriptionId).toBe("i1");
  });
});

describe("getHistory", () => {
  it("filters out subscriptions that are still active", () => {
    const active = blob({ subscriptionId: "a" });
    const past = blob({ subscriptionId: "b", status: "expired" });
    const s = { _activeCable: [active], _timelineCable: [active, past] };
    const h = getHistory(s, "cable");
    expect(h.map((x) => x.subscriptionId)).toEqual(["b"]);
  });
});

describe("primaryActive / hasAnyActive / hasAnyServiceActive", () => {
  it("primaryActive returns null on empty and first entry otherwise", () => {
    expect(primaryActive([])).toBeNull();
    const b = blob();
    expect(primaryActive([b])).toBe(b);
  });

  it("hasAnyActive reflects presence", () => {
    expect(hasAnyActive({ _activeCable: [] }, "cable")).toBe(false);
    expect(hasAnyActive({ _activeCable: [blob()] }, "cable")).toBe(true);
  });

  it("hasAnyServiceActive spans cable and internet", () => {
    expect(hasAnyServiceActive({ _activeInternet: [blob()] })).toBe(true);
    expect(hasAnyServiceActive({})).toBe(false);
  });
});

describe("daysUntil / isActiveBlob", () => {
  it("daysUntil is positive for future, negative for past", () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    expect(daysUntil(future)).toBeGreaterThan(0);
    expect(daysUntil(past)).toBeLessThan(0);
  });

  it("isActiveBlob is true only for future endDate", () => {
    expect(isActiveBlob(null)).toBe(false);
    expect(isActiveBlob(blob({ endDate: new Date(Date.now() + 1000).toISOString() }))).toBe(true);
    expect(isActiveBlob(blob({ endDate: new Date(Date.now() - 1000).toISOString() }))).toBe(false);
  });
});
