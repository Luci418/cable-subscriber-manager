import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_subscriber",
  title: "Get subscriber profile",
  description:
    "Full profile for one subscriber: contact details, balances, subscriptions, paired devices and open complaints. Accepts the human subscriber ID (e.g. MAHARAJ-003) or the internal UUID.",
  inputSchema: {
    subscriber_id: z.string().trim().min(1).describe("Human subscriber ID or internal UUID."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ subscriber_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriber_id);

    const { data: subscriber, error } = await supabase
      .from("subscribers")
      .select("*")
      .eq(isUuid ? "id" : "subscriber_id", subscriber_id)
      .maybeSingle();

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!subscriber) {
      return { content: [{ type: "text", text: `No subscriber found for "${subscriber_id}"` }], isError: true };
    }

    const [subs, devices, complaints] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("id, service_type, pack_name_snapshot, pack_price_snapshot, start_date, end_date, status, total_charged")
        .eq("subscriber_id", subscriber.id)
        .order("start_date", { ascending: false })
        .limit(20),
      supabase
        .from("stb_inventory")
        .select("id, serial_number, vc_id, device_type, service_type, status")
        .eq("subscriber_id", subscriber.id),
      supabase
        .from("complaints")
        .select("id, date, category, priority, status, description")
        .eq("subscriber_id", subscriber.id)
        .order("date", { ascending: false })
        .limit(10),
    ]);

    const firstError = subs.error ?? devices.error ?? complaints.error;
    if (firstError) return { content: [{ type: "text", text: firstError.message }], isError: true };

    const profile = {
      subscriber: {
        id: subscriber.id,
        subscriber_id: subscriber.subscriber_id,
        name: subscriber.name,
        mobile: subscriber.mobile,
        region: subscriber.region,
        services: subscriber.services,
        customer_status: subscriber.customer_status,
        join_date: subscriber.join_date,
        cable_balance: subscriber.cable_balance,
        internet_balance: subscriber.internet_balance,
      },
      subscriptions: subs.data ?? [],
      devices: devices.data ?? [],
      complaints: complaints.data ?? [],
    };

    return {
      content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
      structuredContent: profile,
    };
  },
});
