import { describe, it, expect } from "vitest";
import {
  buildLedgerEntries,
  buildGrossComponents,
  type LedgerRawTransaction,
  type LedgerSubscription,
  type LedgerAllocation,
} from "@/lib/ledgerRendering";

const sub = (over: Partial<LedgerSubscription> = {}): LedgerSubscription => ({
  id: "sub1",
  service_type: "cable",
  pack_name_snapshot: "Basic",
  start_date: "2026-01-01",
  end_date: "2026-01-31",
  device_serial_snapshot: "STB-001",
  previous_subscription_id: null,
  ...over,
});

const tx = (over: Partial<LedgerRawTransaction> = {}): LedgerRawTransaction => ({
  id: "t1",
  date: "2026-01-05T10:00:00Z",
  type: "payment",
  amount: 300,
  description: null,
  service_type: null,
  source: "collection",
  status: "posted",
  payment_method: "cash",
  subscription_id: null,
  reverses_transaction_id: null,
  void_reason: null,
  void_reason_code: null,
  ...over,
});

describe("buildLedgerEntries — classification", () => {
  it("classifies subscription_charge as activated for new subs", () => {
    const s = sub();
    const t = tx({
      id: "t1", type: "charge", source: "subscription_charge",
      subscription_id: s.id, amount: 300,
    });
    const [e] = buildLedgerEntries([t], { [s.id]: s }, {});
    expect(e.kind).toBe("subscription_activated");
    expect(e.title).toBe("Cable TV Basic activated");
    expect(e.sign).toBe("debit");
    expect(e.service).toBe("cable");
    expect(e.subtitle).toContain("STB-001");
  });

  it("classifies as renewed when previous_subscription_id is set", () => {
    const s = sub({ previous_subscription_id: "prev" });
    const t = tx({ id: "t1", type: "charge", source: "subscription_charge", subscription_id: s.id, amount: 300 });
    const [e] = buildLedgerEntries([t], { [s.id]: s }, {});
    expect(e.kind).toBe("subscription_renewed");
    expect(e.title).toContain("renewed");
  });

  it("classifies subscription_refund with cancel context in subtitle", () => {
    const s = sub({ cancelled_at: "2026-01-15T00:00:00Z", cancel_reason_note: "Moved out" });
    const t = tx({
      id: "t1", type: "refund", source: "subscription_refund",
      subscription_id: s.id, amount: 150,
    });
    const [e] = buildLedgerEntries([t], { [s.id]: s }, {});
    expect(e.kind).toBe("subscription_refund");
    expect(e.title).toContain("Refund issued");
    expect(e.subtitle).toContain("Cancelled on");
    expect(e.subtitle).toContain("Moved out");
    expect(e.sign).toBe("credit");
  });

  it("renders payment with method label when description is generic", () => {
    const [e] = buildLedgerEntries([tx({ description: "Payment", payment_method: "upi" })], {}, {});
    expect(e.kind).toBe("payment_received");
    expect(e.title).toBe("Payment received — UPI");
    expect(e.sign).toBe("credit");
  });

  it("preserves operator description when meaningful", () => {
    const [e] = buildLedgerEntries([tx({ description: "Collected at door", payment_method: "cash" })], {}, {});
    expect(e.title).toBe("Collected at door");
  });

  it("manual charge falls out of a charge with no subscription", () => {
    const t = tx({ type: "charge", source: "manual", description: "Late fee", amount: 50 });
    const [e] = buildLedgerEntries([t], {}, {});
    expect(e.kind).toBe("manual_charge");
    expect(e.title).toBe("Manual charge — Late fee");
    expect(e.sign).toBe("debit");
  });
});

describe("buildLedgerEntries — allocations & voids", () => {
  it("computes allocations and unallocated remainder for payments", () => {
    const s1 = sub({ id: "s1", pack_name_snapshot: "Cable Basic" });
    const s2 = sub({ id: "s2", pack_name_snapshot: "Internet Fast", service_type: "internet" });
    const payment = tx({ id: "pay", amount: 500 });
    const allocs: LedgerAllocation[] = [
      { transaction_id: "pay", subscription_id: "s1", amount: 300, allocated_by: "targeted_bill" },
      { transaction_id: "pay", subscription_id: "s2", amount: 100, allocated_by: "fifo" },
    ];
    const [e] = buildLedgerEntries([payment], { s1, s2 }, { pay: allocs });
    expect(e.allocations).toHaveLength(2);
    expect(e.allocations[0].targeted).toBe(true);
    expect(e.allocations[1].targeted).toBe(false);
    expect(e.unallocatedRemainder).toBe(100);
  });

  it("collapses a payment and its reversal into one voided entry", () => {
    const original = tx({ id: "orig", amount: 300, description: "Payment" });
    const reversal = tx({
      id: "rev", amount: -300, status: "reversal",
      reverses_transaction_id: "orig", description: "Reversal: duplicate entry",
      date: "2026-01-06T10:00:00Z",
    });
    const entries = buildLedgerEntries([original, reversal], {}, {});
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("voided_pair");
    expect(entries[0].voided).toBe(true);
    expect(entries[0].voidReason).toBe("duplicate entry");
    expect(entries[0].sourceTransactionIds).toEqual(["orig", "rev"]);
  });

  it("uses void_reason directly when transaction status is voided", () => {
    const t = tx({ status: "voided", void_reason: "wrong customer" });
    const [e] = buildLedgerEntries([t], {}, {});
    expect(e.voided).toBe(true);
    expect(e.voidReason).toBe("wrong customer");
  });
});

describe("buildLedgerEntries — ordering", () => {
  it("sorts newest first", () => {
    const older = tx({ id: "a", date: "2026-01-01T00:00:00Z" });
    const newer = tx({ id: "b", date: "2026-02-01T00:00:00Z" });
    const entries = buildLedgerEntries([older, newer], {}, {});
    expect(entries.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("buildGrossComponents", () => {
  it("emits per-subscription outstanding lines and per-service advance lines", () => {
    const s1 = sub({ id: "s1", pack_name_snapshot: "Cable Basic", device_serial_snapshot: "STB-001" });
    const lines = buildGrossComponents(
      { cable_balance: 300, internet_balance: -100, services: ["cable", "internet"] },
      { s1: 300 },
      { s1 },
    );
    const kinds = lines.map((l) => l.kind).sort();
    expect(kinds).toEqual(["available_credit", "outstanding"]);
    const outstanding = lines.find((l) => l.kind === "outstanding")!;
    expect(outstanding.label).toContain("₹300 outstanding");
    expect(outstanding.label).toContain("STB-001");
    expect(outstanding.label).toContain("Cable Basic");
    const credit = lines.find((l) => l.kind === "available_credit")!;
    expect(credit.amount).toBe(100);
    expect(credit.label).toContain("Internet");
  });

  it("skips zero and positive balances on the credit side", () => {
    const lines = buildGrossComponents({ cable_balance: 0, internet_balance: 0 }, {}, {});
    expect(lines).toEqual([]);
  });
});
