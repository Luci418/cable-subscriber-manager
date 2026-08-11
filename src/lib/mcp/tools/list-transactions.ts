import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_transactions",
  title: "List transactions",
  description:
    "Recent ledger transactions (payments, charges, refunds) across the business or for one subscriber, newest first.",
  inputSchema: {
    from_date: z.string().trim().default("").describe("Start date YYYY-MM-DD. Empty for no lower bound."),
    to_date: z.string().trim().default("").describe("End date YYYY-MM-DD. Empty for no upper bound."),
    subscriber_uuid: z.string().trim().default("").describe("Internal subscriber UUID to filter by. Empty for all."),
    type: z.string().trim().default("").describe("Transaction type filter, e.g. payment or charge. Empty for all."),
    limit: z.number().int().min(1).max(100).default(50).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_date, to_date, subscriber_uuid, type, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("transactions")
      .select("id, date, subscriber_id, type, amount, service_type, payment_method, status, description")
      .order("date", { ascending: false })
      .limit(limit);

    if (from_date) q = q.gte("date", from_date);
    if (to_date) q = q.lte("date", to_date);
    if (subscriber_uuid) q = q.eq("subscriber_id", subscriber_uuid);
    if (type) q = q.eq("type", type);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const total = (data ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    return {
      content: [{ type: "text", text: JSON.stringify({ count: data?.length ?? 0, total, rows: data ?? [] }, null, 2) }],
      structuredContent: { count: data?.length ?? 0, total, rows: data ?? [] },
    };
  },
});
