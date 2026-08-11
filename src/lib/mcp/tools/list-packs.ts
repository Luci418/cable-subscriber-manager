import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_packs",
  title: "List packs",
  description: "Available cable/internet packs with price, validity and provider cost.",
  inputSchema: {
    service_type: z
      .enum(["all", "cable", "internet"])
      .default("all")
      .describe("Filter packs by service type."),
    active_only: z.boolean().default(true).describe("Only return packs currently on sale."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ service_type, active_only }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("packs")
      .select("id, name, service_type, price, provider_cost, validity_days, billing_type, channels, is_active")
      .order("name");
    if (service_type !== "all") q = q.eq("service_type", service_type);
    if (active_only) q = q.eq("is_active", true);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { packs: data ?? [] },
    };
  },
});
