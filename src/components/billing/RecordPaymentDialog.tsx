import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ServiceLine } from './types';

export const RecordPaymentDialog = ({
  line,
  amount,
  saving,
  onAmountChange,
  onClose,
  onSubmit,
}: {
  line: ServiceLine | null;
  amount: string;
  saving: boolean;
  onAmountChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) => (
  <Dialog open={!!line} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Record Payment</DialogTitle>
        <DialogDescription>
          {line && (
            <>
              {line.subscriber.name} · {line.service === 'cable' ? 'Cable' : 'Internet'} ·{' '}
              Outstanding:{' '}
              <span className="font-medium text-destructive">₹{line.balance.toFixed(2)}</span>
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="pay-amt">Amount received (₹)</Label>
        <Input
          id="pay-amt"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Posts a payment to the immutable ledger. Use Void from the subscriber page if entered
          incorrectly.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={onSubmit} disabled={saving}>{saving ? 'Saving…' : 'Mark as Paid'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
