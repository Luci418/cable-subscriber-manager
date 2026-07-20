import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing the module.
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

import {
  createRegionPrefix,
  isValidSubscriberId,
  generateSubscriberId,
} from "@/lib/subscriberIdGenerator";

describe("createRegionPrefix", () => {
  it("uppercases and takes the first word", () => {
    expect(createRegionPrefix("north zone")).toBe("NORTH");
    expect(createRegionPrefix("Maharaj Ganj")).toBe("MAHARAJ");
  });

  it("strips non-alphanumerics from the first word", () => {
    expect(createRegionPrefix("St. Peter's")).toBe("ST"); // splits on spaces only → first word "St."
    expect(createRegionPrefix("Ward#7")).toBe("WARD7");
  });

  it("falls back to DEFAULT for empty / whitespace", () => {
    expect(createRegionPrefix("")).toBe("DEFAULT");
    expect(createRegionPrefix("   ")).toBe("DEFAULT");
  });

  it("caps prefix at 10 characters", () => {
    expect(createRegionPrefix("Supercalifragilistic")).toHaveLength(10);
  });

  it("splits on spaces, hyphens, and underscores", () => {
    expect(createRegionPrefix("north-zone")).toBe("NORTH");
    expect(createRegionPrefix("north_zone")).toBe("NORTH");
  });
});

describe("isValidSubscriberId", () => {
  it("accepts REGION-NNN pattern", () => {
    expect(isValidSubscriberId("NORTH-001")).toBe(true);
    expect(isValidSubscriberId("MAHARAJ-1234")).toBe(true);
    expect(isValidSubscriberId("A-1")).toBe(true);
  });

  it("rejects malformed IDs", () => {
    expect(isValidSubscriberId("north-001")).toBe(false); // lowercase
    expect(isValidSubscriberId("NORTH001")).toBe(false);  // no dash
    expect(isValidSubscriberId("NORTH-")).toBe(false);
    expect(isValidSubscriberId("-001")).toBe(false);
    expect(isValidSubscriberId("TOOLONGPREFIX-1")).toBe(false); // >10 chars prefix
  });
});

describe("generateSubscriberId", () => {
  beforeEach(() => rpcMock.mockReset());

  it("returns the RPC result on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: "NORTH-042", error: null });
    const id = await generateSubscriberId("north zone");
    expect(rpcMock).toHaveBeenCalledWith("generate_subscriber_id", { p_region_name: "north zone" });
    expect(id).toBe("NORTH-042");
  });

  it("falls back to a timestamp-derived id when the RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    const id = await generateSubscriberId("north zone");
    expect(id).toMatch(/^NORTH-\d{3,}$/);
  });

  it("passes an empty string when region is nullish", async () => {
    rpcMock.mockResolvedValueOnce({ data: "DEFAULT-001", error: null });
    await generateSubscriberId(undefined as any);
    expect(rpcMock).toHaveBeenCalledWith("generate_subscriber_id", { p_region_name: "" });
  });
});
