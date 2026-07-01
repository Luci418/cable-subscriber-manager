// Device → Customer history.
//
// Operator-facing label: "Customer History" (answers "who has had this
// device?"). Internal code naming remains AssetTimeline for consistency with
// the shared query helpers.
//
// Two data sources are combined so the current customer always appears, even
// for assignments that pre-date Phase 5.1 (when device_assignment_log started
// populating):
//   1. stb_inventory.subscriber_id — authoritative for the CURRENT assignment
//   2. device_assignment_log       — historical closed assignments
//
// If (1) is set but no matching open log row exists, we synthesise a
// "Current customer" entry so the operator sees continuity.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  loadDeviceAssignments,
  isActiveAssignment,
  durationDays,
  formatCloseReason,
  type AssignmentLogRow,
} from "@/lib/assetTimeline";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceSerial: string;
}

interface Enriched extends AssignmentLogRow {
  subscriber_name?: string;
  subscriber_code?: string;
  synthetic?: boolean; // derived from stb_inventory, not a real log row
}

const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
    : "—";

export const DeviceTimelineDialog = ({ open, onOpenChange, deviceSerial }: Props) => {
  const [rows, setRows] = useState<Enriched[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // 1. Historical rows from the assignment log.
      const base = await loadDeviceAssignments(deviceSerial);

      // 2. Authoritative current assignment from stb_inventory.
      const { data: invRow } = await supabase
        .from("stb_inventory")
        .select("id, subscriber_id, device_type, service_type, updated_at, created_at")
        .eq("serial_number", deviceSerial)
        .maybeSingle();

      const currentSubscriberId = (invRow as any)?.subscriber_id ?? null;

      // Gather all subscriber ids we need names for.
      const ids = new Set(base.map((r) => r.subscriber_id));
      if (currentSubscriberId) ids.add(currentSubscriberId);

      let byId = new Map<string, { name: string; subscriber_id: string }>();
      if (ids.size > 0) {
        const { data } = await supabase
          .from("subscribers")
          .select("id, name, subscriber_id")
          .in("id", Array.from(ids));
        (data || []).forEach((s: any) =>
          byId.set(s.id, { name: s.name, subscriber_id: s.subscriber_id })
        );
      }

      let combined: Enriched[] = base.map((r) => ({
        ...r,
        subscriber_name: byId.get(r.subscriber_id)?.name,
        subscriber_code: byId.get(r.subscriber_id)?.subscriber_id,
      }));

      // If inventory says the device is currently assigned but no OPEN log
      // row covers that (e.g. assignment predates Phase 5.1), synthesise one
      // so the operator sees the current customer at the top.
      if (currentSubscriberId) {
        const hasOpenRowForCurrent = combined.some(
          (r) => isActiveAssignment(r) && r.subscriber_id === currentSubscriberId
        );
        if (!hasOpenRowForCurrent) {
          combined = [
            {
              id: `synthetic-${deviceSerial}`,
              user_id: "",
              subscriber_id: currentSubscriberId,
              device_serial: deviceSerial,
              device_type: (invRow as any)?.device_type ?? "",
              service_type: (invRow as any)?.service_type ?? "",
              opened_at:
                (invRow as any)?.updated_at ?? (invRow as any)?.created_at ?? new Date().toISOString(),
              closed_at: null,
              open_reason: null,
              close_reason: null,
              opened_by: null,
              closed_by: null,
              notes: null,
              subscriber_name: byId.get(currentSubscriberId)?.name,
              subscriber_code: byId.get(currentSubscriberId)?.subscriber_id,
              synthetic: true,
            },
            ...combined,
          ];
        }
      }

      if (!cancelled) {
        setRows(combined);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deviceSerial]);

  const activeRows = rows.filter((r) => isActiveAssignment(r));
  const historicalRows = rows.filter((r) => !isActiveAssignment(r));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{deviceSerial}</DialogTitle>
          <DialogDescription>Customer History — customers this device has belonged to.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customer history recorded.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {activeRows.map((r) => (
              <div key={r.id} className="border rounded-md px-3 py-2 text-sm border-emerald-200 bg-emerald-50/50">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {r.subscriber_name ?? "(unknown subscriber)"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.subscriber_code ?? r.subscriber_id.slice(0, 8)}
                    </div>
                  </div>
                  <Badge className="bg-emerald-600 hover:bg-emerald-700">Current customer</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {r.synthetic
                    ? "Assignment predates history tracking"
                    : `${fmt(r.opened_at)} → now · ${durationDays(r)}d`}
                </div>
              </div>
            ))}

            {historicalRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No previous assignment history.</p>
            ) : (
              historicalRows.map((r) => (
                <div key={r.id} className="border rounded-md px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {r.subscriber_name ?? "(unknown subscriber)"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.subscriber_code ?? r.subscriber_id.slice(0, 8)}
                      </div>
                    </div>
                    <Badge variant="outline">{formatCloseReason(r.close_reason)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {fmt(r.opened_at)} → {fmt(r.closed_at)} · {durationDays(r)}d
                  </div>
                </div>
              ))
            )}

            <p className="text-[11px] text-muted-foreground pt-1">
              Detailed assignment history is tracked from Phase 5.1 onward.
              Earlier assignments show only the current customer.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
