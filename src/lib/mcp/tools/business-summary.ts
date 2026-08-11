import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "business_summary",
  title: "Business summary",
  description:
    "Snapshot of the operation: subscriber counts by status, active subscriptions, outstanding balances, collections over a recent window and open complaints.",
  inputSchema: {
    days: z.number().int().min(1).max(90).default(30).describe("Collection window in days."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const [people, activeSubs, payments, openComplaints] = await Promise.all([
      supabase.from("subscribers").select("customer_status, cable_balance, internet_balance"),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("transactions").select("amount, type, status").gte("date", since),
      supabase.from("complaints").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    ]);

    const firstError = people.error ?? activeSubs.error ?? payments.error ?? openComplaints.error;
    if (firstError) return { content: [{ type: "text", text: firstError.message }], isError: true };

    const byStatus: Record<string, number> = {};
    let outstanding = 0;
    let credit = 0;
    for (const p of people.data ?? []) {
      byStatus[p.customer_status] = (byStatus[p.customer_status] ?? 0) + 1;
      const bal = Number(p.cable_balance ?? 0) + Number(p.internet_balance ?? 0);
      if (bal > 0) outstanding += bal;
      else credit += -bal;
    }

    const collected = (payments.data ?? [])
      .filter((t) => t.type === "payment" && t.status !== "voided")
      .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);

    const summary = {
      window_days: days,
      subscribers_total: people.data?.length ?? 0,
      subscribers_by_status: byStatus,
      active_subscriptions: activeSubs.count ?? 0,
      outstanding_dues: outstanding,
      customer_credit: credit,
      collected_in_window: collected,
      open_complaints: openComplaints.count ?? 0,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
