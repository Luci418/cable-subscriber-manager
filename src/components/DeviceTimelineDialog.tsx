// Device → Customer timeline.
//
// "Asset Timeline" view for a single physical device, opened from each
// inventory card. Shows every customer this device has belonged to. The top
// row is tagged "Current Customer" when the device is currently assigned.

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
      const base = await loadDeviceAssignments(deviceSerial);
      const ids = Array.from(new Set(base.map((r) => r.subscriber_id)));
      let byId = new Map<string, { name: string; subscriber_id: string }>();
      if (ids.length > 0) {
        const { data } = await supabase
          .from("subscribers")
          .select("id, name, subscriber_id")
          .in("id", ids);
        (data || []).forEach((s: any) =>
          byId.set(s.id, { name: s.name, subscriber_id: s.subscriber_id })
        );
      }
      const enriched: Enriched[] = base.map((r) => ({
        ...r,
        subscriber_name: byId.get(r.subscriber_id)?.name,
        subscriber_code: byId.get(r.subscriber_id)?.subscriber_id,
      }));
      if (!cancelled) {
        setRows(enriched);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deviceSerial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{deviceSerial}</DialogTitle>
          <DialogDescription>Asset timeline — customers this device has belonged to.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assignment history recorded.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {rows.map((r) => {
              const active = isActiveAssignment(r);
              return (
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
                    {active ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-700">Current customer</Badge>
                    ) : (
                      <Badge variant="outline">{formatCloseReason(r.close_reason)}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {fmt(r.opened_at)} → {active ? "now" : fmt(r.closed_at)} · {durationDays(r)}d
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground pt-1">
              History reflects assignments tracked since pairing became mandatory
              (Phase 5.1). Earlier assignments may not appear.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
