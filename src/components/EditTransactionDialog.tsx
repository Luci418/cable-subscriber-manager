import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Transaction } from '@/lib/storage';

interface EditTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
  /** Kept for backwards-compatibility with existing callers; unused now. */
  availableServices?: string[];
  onSubmit: (transactionId: string, updates: { description: string }) => void;
}

/**
 * Per ADR-011 (revised, 2026-06): transactions are an immutable ledger.
 * Financial fields (amount, type, service_type, subscriber, provider, date)
 * cannot be edited after the row is written. Only the human-readable
 * description (a note / memo field) remains editable. To correct an amount,
 * type, or any other financial detail, void the original and post a
 * replacement.
 */
export const EditTransactionDialog = ({
  open,
  onOpenChange,
  transaction,
  onSubmit,
}: EditTransactionDialogProps) => {
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (transaction && open) {
      setDescription(transaction.description ?? '');
    }
  }, [transaction, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error('Description cannot be empty');
      return;
    }
    if (!transaction) return;
    onSubmit(transaction.id, { description: description.trim() });
    onOpenChange(false);
  };

  if (!transaction) return null;

  const svc = ((transaction as any).service_type as string) || 'cable';
  const typeLabel =
    transaction.type === 'payment' ? 'Cash Received'
    : transaction.type === 'refund' ? 'Refund'
    : 'Bill';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Transaction Note</DialogTitle>
          <DialogDescription>
            Only the description can be edited. To change the amount, type, or
            service, void this transaction and post a replacement.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium">{typeLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Service</span>
              <span className="font-medium capitalize">{svc}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold">₹{Number(transaction.amount).toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter transaction details..."
              required
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Save Description
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
