import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { AlertTriangle } from 'lucide-react';
import { SubscriptionEntry } from '@/lib/storage';

interface CancelSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: SubscriptionEntry;
  onConfirm: (refundAmount: number) => void;
}

const calculateRemainingDays = (endDate: string): number => {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const CancelSubscriptionDialog = ({
  open,
  onOpenChange,
  subscription,
  onConfirm
}: CancelSubscriptionDialogProps) => {
  const daysRemaining = calculateRemainingDays(subscription.endDate);
  const totalDays = subscription.duration * 30; // Approximate days in subscription
  const pricePerDay = subscription.packPrice / 30;
  const autoCalculatedRefund = Math.max(0, daysRemaining * pricePerDay);
  
  const [refundAmount, setRefundAmount] = useState(autoCalculatedRefund);

  useEffect(() => {
    setRefundAmount(autoCalculatedRefund);
  }, [autoCalculatedRefund]);

  const handleConfirm = () => {
    onConfirm(refundAmount);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Cancel Active Subscription
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-warning/20 bg-warning/10 p-4">
            <p className="text-sm text-foreground">
              You need to cancel the current active subscription before adding a new one.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Package:</span>
              <span className="font-medium">{subscription.packName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Days Remaining:</span>
              <span className="font-medium">{daysRemaining > 0 ? daysRemaining : 0} days</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Original Price:</span>
              <span className="font-medium">₹{subscription.packPrice.toFixed(2)}/month</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund">Refund Amount (₹)</Label>
            <Input
              id="refund"
              type="number"
              min="0"
              step="0.01"
              value={refundAmount}
              onChange={(e) => setRefundAmount(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              Auto-calculated: ₹{autoCalculatedRefund.toFixed(2)} (based on remaining days)
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep Subscription
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Cancel & Refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
