// Previous Devices section on the subscriber profile.
//
// Shows every device this customer has ever been assigned, EXCLUDING the
// currently-paired devices (those are already rendered as device cards above).
// "Asset Timeline" is the internal naming so this can later include repairs,
// relocations, etc., without a UI rename.
//
// History only exists from Phase 5.1 onward (when pairing became mandatory).
// We never claim completeness for older assignments.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, History as HistoryIcon } from "lucide-react";
import {
  loadCustomerAssignments,
  isActiveAssignment,
  durationDays,
  formatCloseReason,
  type AssignmentLogRow,
} from "@/lib/assetTimeline";

interface Props {
  subscriberId: string;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—";

export const AssetTimelineCustomer = ({ subscriberId }: Props) => {
  const [rows, setRows] = useState<AssignmentLogRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCustomerAssignments(subscriberId).then((r) => {
      if (!cancelled) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [subscriberId]);

  // Only previous (closed) assignments — currently paired devices live in the
  // device cards above the timeline.
  const previous = rows.filter((r) => !isActiveAssignment(r));

  if (loading) return null;
  if (previous.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          className="flex items-center justify-between w-full text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <CardTitle className="text-base flex items-center gap-2">
            <HistoryIcon className="h-4 w-4" />
            Previous Devices
            <Badge variant="secondary" className="ml-1">{previous.length}</Badge>
          </CardTitle>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {previous.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="font-mono font-medium">{r.device_serial}</div>
                <div className="text-xs text-muted-foreground uppercase">
                  {r.device_type} · {r.service_type}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {fmt(r.opened_at)} → {fmt(r.closed_at)} · {durationDays(r)}d
              </div>
              <Badge variant="outline" className="text-xs">
                {formatCloseReason(r.close_reason)}
              </Badge>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground pt-1">
            History reflects assignments tracked since pairing became mandatory
            (Phase 5.1). Earlier assignments may not appear.
          </p>
        </CardContent>
      )}
    </Card>
  );
};
