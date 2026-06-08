import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { friendlyDbError } from '@/lib/dbErrors';
import type { Transaction } from '@/lib/storage';

export type VoidReasonCode =
  | 'data_entry_error'
  | 'duplicate'
  | 'wrong_subscriber'
  | 'wrong_amount'
  | 'customer_dispute'
  | 'other';

const REASON_OPTIONS: { value: VoidReasonCode; label: string }[] = [
  { value: 'data_entry_error', label: 'Data entry error' },
  { value: 'duplicate',        label: 'Duplicate entry' },
  { value: 'wrong_subscriber', label: 'Wrong subscriber' },
  { value: 'wrong_amount',     label: 'Wrong amount' },
  { value: 'customer_dispute', label: 'Customer dispute' },
  { value: 'other',            label: 'Other' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
  onVoided: () => void;
}

/**
 * Void dialog with structured reason code (ADR-011 hardening).
 *
 * The reason code is a stable, queryable taxonomy; the optional note is
 * free text for the operator. Both are persisted on the original row AND
 * on the offsetting reversal row. Subscription-sourced rows are rejected
 * at the database level — the button shouldn't render for them, but if it
 * does we surface the DB error cleanly.
 */
export const VoidTransactionDialog = ({ open, onOpenChange, transaction, onVoided }: Props) => {
  const [reasonCode, setReasonCode] = useState<VoidReasonCode | ''>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setReasonCode(''); setNote(''); }
  }, [open]);

  if (!transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonCode) { toast.error('Pick a reason'); return; }
    setSubmitting(true);
    const { error } = await (supabase as any).rpc('void_transaction', {
      p_transaction_id: transaction.id,
      p_reason_code: reasonCode,
      p_reason: note.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(friendlyDbError(error, 'Failed to void transaction'));
      return;
    }
    toast.success('Transaction voided. An offsetting reversal has been posted.');
    onOpenChange(false);
    onVoided();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Void Transaction
          </DialogTitle>
          <DialogDescription>
            This will post an offsetting reversal and mark the original as voided.
            Both rows remain in the ledger permanently.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium">
                {transaction.type === 'payment' ? 'Cash Received' : transaction.type === 'refund' ? 'Refund' : 'Bill'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold">₹{Number(transaction.amount).toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as VoidReasonCode)}>
              <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="void-note">Note (optional)</Label>
            <Textarea
              id="void-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Extra context — visible in the ledger and on the reversal row"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={submitting}>
              {submitting ? 'Voiding…' : 'Void Transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
