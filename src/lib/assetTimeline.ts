// Asset Timeline — single source of truth for device ↔ customer history.
//
// All rows come from public.device_assignment_log. Rows with closed_at IS NULL
// are currently active assignments. Both timeline views (customer-side and
// device-side) read this same table; we never denormalise history.
//
// History only exists from Phase 5.1 onward when pairing became mandatory.
// Older assignments are simply absent — we never imply completeness.

import { supabase } from "@/integrations/supabase/client";

export interface AssignmentLogRow {
  id: string;
  user_id: string;
  subscriber_id: string;
  device_serial: string;
  device_type: string;
  service_type: string;
  opened_at: string;
  closed_at: string | null;
  open_reason: string | null;
  close_reason: string | null;
  opened_by: string | null;
  closed_by: string | null;
  notes: string | null;
}

/** Every assignment row this subscriber has ever had, newest first. */
export async function loadCustomerAssignments(
  subscriberId: string
): Promise<AssignmentLogRow[]> {
  const { data, error } = await (supabase as any)
    .from("device_assignment_log")
    .select("*")
    .eq("subscriber_id", subscriberId)
    .order("opened_at", { ascending: false });
  if (error) {
    console.warn("loadCustomerAssignments failed:", error);
    return [];
  }
  return (data || []) as AssignmentLogRow[];
}

/** Every assignment row this physical device has ever had, newest first. */
export async function loadDeviceAssignments(
  deviceSerial: string
): Promise<AssignmentLogRow[]> {
  const { data, error } = await (supabase as any)
    .from("device_assignment_log")
    .select("*")
    .eq("device_serial", deviceSerial)
    .order("opened_at", { ascending: false });
  if (error) {
    console.warn("loadDeviceAssignments failed:", error);
    return [];
  }
  return (data || []) as AssignmentLogRow[];
}

export function isActiveAssignment(row: AssignmentLogRow): boolean {
  return row.closed_at == null;
}

export function durationDays(row: AssignmentLogRow): number {
  const start = new Date(row.opened_at).getTime();
  const end = row.closed_at ? new Date(row.closed_at).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const CLOSE_REASON_LABELS: Record<string, string> = {
  faulty: "Replaced (faulty)",
  upgraded: "Upgraded",
  returned: "Returned",
  replaced: "Replaced",
  customer_closed: "Customer closed",
  downgrade: "Downgraded",
  correction: "Operator correction",
  repair: "Sent for repair",
  other: "Other",
};

export function formatCloseReason(code: string | null): string {
  if (!code) return "—";
  return CLOSE_REASON_LABELS[code] ?? code.replace(/_/g, " ");
}

const OPEN_REASON_LABELS: Record<string, string> = {
  installation: "Installation",
  replacement: "Replacement",
  upgrade: "Upgrade",
  other: "Other",
};

export function formatOpenReason(code: string | null): string {
  if (!code) return "—";
  return OPEN_REASON_LABELS[code] ?? code.replace(/_/g, " ");
}
