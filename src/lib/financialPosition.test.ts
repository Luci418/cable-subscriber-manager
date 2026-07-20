import { describe, it, expect } from "vitest";
import {
  computeOverallPosition,
  computeNextActionChip,
  labelForKind,
  chipToneClasses,
  positionToneClasses,
} from "@/lib/financialPosition";

// Helper: subscriber factory
const sub = (over: Partial<any> = {}) => ({
  services: ["cable"],
  cable_balance: 0,
  internet_balance: 0,
  _activeCable: [],
  _activeInternet: [],
  ...over,
});

const activeBlob = (over: Partial<any> = {}) => ({
  subscriptionId: "s1",
  packId: "p1",
  packName: "Basic",
  packPrice: 300,
  duration: 30,
  startDate: new Date(Date.now() - 5 * 86400000).toISOString(),
  endDate: new Date(Date.now() + 25 * 86400000).toISOString(),
  status: "active" as const,
  subscribedAt: new Date().toISOString(),
  ...over,
});

describe("labelForKind", () => {
  it("formats each kind with ₹ and Indian grouping", () => {
    expect(labelForKind("outstanding", 1800)).toBe("Outstanding ₹1,800");
    expect(labelForKind("available_credit", 250)).toBe("Available Credit ₹250");
    expect(labelForKind("service_credit", 100)).toBe("Service Credit ₹100");
    expect(labelForKind("refund_due", 500)).toBe("Refund Due ₹500");
    expect(labelForKind("settled", 0)).toBe("Settled");
  });
});

describe("computeOverallPosition", () => {
  it("returns settled at zero", () => {
    const r = computeOverallPosition(sub());
    expect(r.kind).toBe("settled");
    expect(r.amount).toBe(0);
    expect(r.label).toBe("Settled");
  });

  it("returns outstanding when net > 0", () => {
    const r = computeOverallPosition(sub({ cable_balance: 500 }));
    expect(r.kind).toBe("outstanding");
    expect(r.amount).toBe(500);
  });

  it("returns available_credit when net < 0", () => {
    const r = computeOverallPosition(sub({ cable_balance: -200 }));
    expect(r.kind).toBe("available_credit");
    expect(r.amount).toBe(200);
  });

  it("nets balances across cable + internet services", () => {
    const r = computeOverallPosition(
      sub({ services: ["cable", "internet"], cable_balance: 300, internet_balance: -100 }),
    );
    expect(r.kind).toBe("outstanding");
    expect(r.amount).toBe(200);
    expect(r.breakdown).toHaveLength(2);
  });

  it("defaults to cable service when none declared", () => {
    const r = computeOverallPosition({ cable_balance: 100 });
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].service).toBe("cable");
  });
});

describe("computeNextActionChip", () => {
  it("archived beats everything", () => {
    const r = computeNextActionChip(sub({ archived: true, cable_balance: 500 }));
    expect(r.tone).toBe("muted");
    expect(r.label).toBe("Archived");
  });

  it("collect & renew when expired with debt", () => {
    const r = computeNextActionChip(
      sub({
        cable_balance: 400,
        _activeCable: [
          activeBlob({ endDate: new Date(Date.now() - 86400000).toISOString() }),
        ],
      }),
    );
    expect(r.tone).toBe("danger");
    expect(r.label).toContain("Collect ₹400");
    expect(r.label).toContain("renew Cable");
  });

  it("collect when active + outstanding, not near expiry", () => {
    const r = computeNextActionChip(
      sub({ cable_balance: 250, _activeCable: [activeBlob()] }),
    );
    expect(r.tone).toBe("warning");
    expect(r.label).toBe("Collect ₹250");
  });

  it("renewal reminder within 7 days when settled", () => {
    const r = computeNextActionChip(
      sub({
        _activeCable: [
          activeBlob({ endDate: new Date(Date.now() + 3 * 86400000).toISOString() }),
        ],
      }),
    );
    expect(r.tone).toBe("warning");
    expect(r.label).toContain("renewal due in");
  });

  it("available credit chip when net negative", () => {
    const r = computeNextActionChip(
      sub({ cable_balance: -150, _activeCable: [activeBlob()] }),
    );
    expect(r.tone).toBe("info");
    expect(r.label).toContain("₹150 credit");
  });

  it("no action required when all settled", () => {
    const r = computeNextActionChip(sub({ _activeCable: [activeBlob()] }));
    expect(r.tone).toBe("success");
    expect(r.label).toBe("No action required");
  });

  it("renew when service has no actives and settled", () => {
    const r = computeNextActionChip(sub());
    expect(r.tone).toBe("danger");
    expect(r.label).toBe("Renew Cable");
  });
});

describe("tone class helpers", () => {
  it("returns a non-empty string for every tone", () => {
    for (const t of ["success", "warning", "danger", "info", "muted"] as const) {
      expect(chipToneClasses(t)).toBeTruthy();
    }
  });
  it("returns a non-empty string for every position kind", () => {
    for (const k of ["outstanding", "available_credit", "service_credit", "refund_due", "settled"] as const) {
      expect(positionToneClasses(k)).toBeTruthy();
    }
  });
});
