import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { friendlyDbError } from "@/lib/dbErrors";
import type { Subscriber } from "@/hooks/useSubscribers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriber: Subscriber;
  outstandingTotal: number;
  activeSubscriptionCount: number;
  onArchived: () => void;
}

type ReasonCode =
  | "moved_away"
  | "switched_provider"
  | "duplicate"
  | "non_payment"
  | "other";

const REASON_LABELS: Record<ReasonCode, string> = {
  moved_away: "Moved away",
  switched_provider: "Switched provider",
  duplicate: "Duplicate account",
  non_payment: "Non-payment",
  other: "Other",
};

export const ArchiveCustomerDialog = ({
  open,
  onOpenChange,
  subscriber,
  outstandingTotal,
  activeSubscriptionCount,
  onArchived,
}: Props) => {
  const [reasonCode, setReasonCode] = useState<ReasonCode>("moved_away");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleArchive = async () => {
    setSubmitting(true);
    try {
      const { error } = await (supabase as any).rpc("archive_subscriber", {
        p_subscriber_id: subscriber.id,
        p_reason_code: reasonCode,
        p_reason_note: note.trim() || null,
      });
      if (error) {
        toast.error(friendlyDbError(error, "Failed to archive customer"));
        return;
      }
      toast.success(`${subscriber.name} archived`);
      onArchived();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive customer?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Archiving <strong>{subscriber.name}</strong> hides them from
                day-to-day worklists. They remain in analytics, revenue
                history, and mobile search.
              </p>
              {activeSubscriptionCount > 0 && (
                <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  {activeSubscriptionCount} active subscription
                  {activeSubscriptionCount === 1 ? "" : "s"} will be cancelled.
                  Collect any refund first using the per-subscription Cancel
                  workflow — this archive will not refund.
                </p>
              )}
              {outstandingTotal !== 0 && (
                <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  Outstanding balance: ₹{outstandingTotal.toFixed(2)}. Archive
                  anyway?
                </p>
              )}
              <p className="text-muted-foreground">
                All assigned devices will be unpaired and returned to
                Available.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v as ReasonCode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REASON_LABELS) as ReasonCode[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {REASON_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for the audit log"
              rows={2}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleArchive}
            disabled={submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {submitting ? "Archiving…" : "Archive customer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
