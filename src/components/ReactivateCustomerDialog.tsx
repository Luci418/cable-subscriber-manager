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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { friendlyDbError } from "@/lib/dbErrors";
import type { Subscriber } from "@/hooks/useSubscribers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriber: Subscriber;
  onReactivated: () => void;
}

export const ReactivateCustomerDialog = ({
  open,
  onOpenChange,
  subscriber,
  onReactivated,
}: Props) => {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleReactivate = async () => {
    setSubmitting(true);
    try {
      const { error } = await (supabase as any).rpc("reactivate_subscriber", {
        p_subscriber_id: subscriber.id,
        p_reason_note: note.trim() || null,
      });
      if (error) {
        toast.error(friendlyDbError(error, "Failed to reactivate customer"));
        return;
      }
      toast.success(`${subscriber.name} reactivated`);
      onReactivated();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reactivate customer?</AlertDialogTitle>
          <AlertDialogDescription>
            {subscriber.name} will become visible in worklists again. The
            customer record is preserved — no new account is created. You will
            need to pair devices and add subscriptions to resume service.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5 py-2">
          <Label>Note (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this customer being reactivated?"
            rows={2}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleReactivate} disabled={submitting}>
            {submitting ? "Reactivating…" : "Reactivate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
