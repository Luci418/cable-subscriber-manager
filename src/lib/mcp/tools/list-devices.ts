import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_devices",
  title: "List devices",
  description:
    "Set-top boxes, ONUs and routers in inventory with status, serial number, VC id and current assignment.",
  inputSchema: {
    status: z.string().trim().default("").describe("Inventory status filter, e.g. available, assigned, faulty. Empty for all."),
    query: z.string().trim().default("").describe("Serial number or VC id fragment. Empty for all."),
    limit: z.number().int().min(1).max(100).default(50).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("stb_inventory")
      .select("id, serial_number, vc_id, mac_address, device_type, service_type, status, subscriber_id, notes")
      .order("serial_number")
      .limit(limit);

    if (status) q = q.eq("status", status);
    if (query) {
      const like = `%${query.replace(/[%,]/g, "")}%`;
      q = q.or(`serial_number.ilike.${like},vc_id.ilike.${like}`);
    }

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { devices: data ?? [] },
    };
  },
});
