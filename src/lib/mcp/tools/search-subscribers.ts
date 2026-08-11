import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_subscribers",
  title: "Search subscribers",
  description:
    "Search cable/internet subscribers by name, subscriber ID or mobile number. Returns id, subscriber ID, name, mobile, region, status and balances.",
  inputSchema: {
    query: z.string().trim().describe("Name, subscriber ID or mobile number fragment. Empty for a general list."),
    status: z
      .enum(["all", "active", "inactive", "prospect", "archived"])
      .default("all")
      .describe("Filter by customer status."),
    limit: z.number().int().min(1).max(50).default(20).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("subscribers")
      .select("id, subscriber_id, name, mobile, region, customer_status, cable_balance, internet_balance, services")
      .order("name")
      .limit(limit);

    if (query) {
      const like = `%${query.replace(/[%,]/g, "")}%`;
      q = q.or(`name.ilike.${like},subscriber_id.ilike.${like},mobile.ilike.${like}`);
    }
    if (status !== "all") q = q.eq("customer_status", status);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { subscribers: data ?? [] },
    };
  },
});
