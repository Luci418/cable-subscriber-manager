import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_expiring_subscriptions",
  title: "List expiring subscriptions",
  description:
    "Active subscriptions ending within the next N days, oldest expiry first. Use for renewal follow-up lists.",
  inputSchema: {
    days: z.number().int().min(0).max(90).default(7).describe("Look-ahead window in days."),
    limit: z.number().int().min(1).max(100).default(50).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const today = new Date();
    const until = new Date(today.getTime() + days * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("subscriptions")
      .select("id, subscriber_id, service_type, pack_name_snapshot, pack_price_snapshot, start_date, end_date, status")
      .eq("status", "active")
      .gte("end_date", iso(today))
      .lte("end_date", iso(until))
      .order("end_date")
      .limit(limit);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const ids = Array.from(new Set((data ?? []).map((r) => r.subscriber_id)));
    const names = new Map<string, { subscriber_id: string; name: string; mobile: string }>();
    if (ids.length) {
      const { data: people, error: peopleError } = await supabase
        .from("subscribers")
        .select("id, subscriber_id, name, mobile")
        .in("id", ids);
      if (peopleError) return { content: [{ type: "text", text: peopleError.message }], isError: true };
      for (const p of people ?? []) names.set(p.id, { subscriber_id: p.subscriber_id, name: p.name, mobile: p.mobile });
    }

    const rows = (data ?? []).map((r) => ({ ...r, subscriber: names.get(r.subscriber_id) ?? null }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { expiring: rows },
    };
  },
});
