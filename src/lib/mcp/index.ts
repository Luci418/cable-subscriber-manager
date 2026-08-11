import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchSubscribers from "./tools/search-subscribers";
import getSubscriber from "./tools/get-subscriber";
import listExpiringSubscriptions from "./tools/list-expiring-subscriptions";
import listTransactions from "./tools/list-transactions";
import listPacks from "./tools/list-packs";
import listDevices from "./tools/list-devices";
import businessSummary from "./tools/business-summary";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "cable-subscriber-manager",
  title: "Cable Subscriber Manager",
  version: "0.1.0",
  instructions:
    "Read-only tools for a cable TV / internet operator's subscriber book. Use `search_subscribers` to find a customer, `get_subscriber` for their full profile (subscriptions, devices, complaints), `list_expiring_subscriptions` for renewal follow-ups, `list_transactions` for the payment ledger, `list_packs` and `list_devices` for the catalog and inventory, and `business_summary` for an overall snapshot. All data is scoped to the signed-in operator.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    searchSubscribers,
    getSubscriber,
    listExpiringSubscriptions,
    listTransactions,
    listPacks,
    listDevices,
    businessSummary,
  ],
});
