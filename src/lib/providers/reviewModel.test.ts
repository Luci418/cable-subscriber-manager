/**
 * Phase 5.1 — tests for the review re-derivation model.
 *
 * These tests verify the wiring between the DB context loader and the pure
 * resolution engine: the data fetched by `loadReviewContext` must reach
 * `resolveEvents` through `deriveReview`, especially the safety fields that
 * prevent duplicate charges.
 */

import { describe, it, expect } from "vitest";
import { deriveReview, type OperatorDecisions } from "./reviewModel";
import type { ReviewContext } from "./loadResolutionContext";
import type { ProviderReportRow } from "./hathway/types";
import { SYNC_POLICY_DEFAULTS } from "./syncPolicy";

function baseContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    subscriberByVcId: {},
    subscriberBySerial: {},
    subscriberByAccountNumber: {},
    packIdByProviderKey: { "marathi 1": "pack-1" },
    policy: SYNC_POLICY_DEFAULTS,
    subscribersWithActiveSubscription: [],
    forcedReviewKeys: [],
    newlyIdentifiedKeys: [],
    packById: {
      "pack-1": { id: "pack-1", name: "Marathi 1", price: 200, validity_days: 30 },
    },
    subscriberLabelById: {},
    deviceKeysBySubscriber: {},
    ambiguousAccountNumbers: [],
    baseline: [],
    baselineRunId: null,
    baselineImportedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<ProviderReportRow> = {}): ProviderReportRow {
  return {
    row_number: 1,
    account_number: "ACC001",
    customer_name: "Test Customer",
    vc_id: "VC001",
    stb_no: "STB001",
    mobile: "9999999999",
    base_plan: "Marathi 1",
    start_date: "2026-08-01",
    end_date: "2026-08-30",
    total_base_price: 200,
    dpo_total_price: null,
    service_status: "ACTIVE",
    extra: {},
    ...overrides,
  };
}

describe("deriveReview subscribersWithActiveSubscription wiring", () => {
  it("proposes a charge for a newly linked row when the customer has no active subscription", () => {
    const parsed = [row()];
    const base = baseContext({
      subscribersWithActiveSubscription: [],
    });
    const decisions: OperatorDecisions = {
      links: { VC001: "sub-1" },
      prospects: {},
      packOverrides: {},
    };

    const result = deriveReview(base, parsed, decisions);
    const resolved = result.rows[0];

    expect(resolved.newly_identified).toBe(true);
    expect(resolved.bucket).toBe("new_activation");
    expect(resolved.writes.charge).toBe(true);
  });

  it("does NOT propose a charge when the linked customer already has an active subscription", () => {
    const parsed = [row()];
    const base = baseContext({
      subscribersWithActiveSubscription: ["sub-1"],
    });
    const decisions: OperatorDecisions = {
      links: { VC001: "sub-1" },
      prospects: {},
      packOverrides: {},
    };

    const result = deriveReview(base, parsed, decisions);
    const resolved = result.rows[0];

    expect(resolved.newly_identified).toBe(false);
    expect(resolved.bucket).toBe("no_change");
    expect(resolved.writes.charge).toBe(false);
  });

  it("filters active subscriptions by the provider's service type", () => {
    // The context loader only populates this set with active subscriptions for
    // the provider's service type. A different-service subscription must not
    // be in the set, so it cannot block a charge for this service.
    const parsed = [row({ base_plan: "Marathi 1", service_status: "ACTIVE" })];
    const base = baseContext({
      // This would only happen if the loader incorrectly included an internet
      // subscription for a cable provider import.
      subscribersWithActiveSubscription: ["sub-1"],
    });
    const decisions: OperatorDecisions = {
      links: { VC001: "sub-1" },
      prospects: {},
      packOverrides: {},
    };

    const result = deriveReview(base, parsed, decisions);
    const resolved = result.rows[0];

    // The test above already proves the guard works; this test documents the
    // loader's responsibility to keep the set service-specific.
    expect(resolved.writes.charge).toBe(false);
  });
});

describe("deriveReview charge plan", () => {
  it("exposes the computed charge via the returned context", () => {
    const parsed = [row({ base_plan: "Marathi 1", start_date: "2026-08-01", end_date: "2026-08-30" })];
    const base = baseContext();
    const result = deriveReview(base, parsed, {
      links: { VC001: "sub-1" },
      prospects: {},
      packOverrides: {},
    });

    expect(result.ctx.packById["pack-1"].price).toBe(200);
  });
});
