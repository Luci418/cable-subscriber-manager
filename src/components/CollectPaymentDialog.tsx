import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, Wallet, Banknote, QrCode, Tv, Wifi } from 'lucide-react';

type ServiceType = 'cable' | 'internet';
type PaymentMethod = 'cash' | 'upi';

interface CollectPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  subscriberName: string;
  /** Service the device card represents. The payment is posted against this service. */
  service: ServiceType;
  /**
   * Specific subscription (and its device) the operator clicked Collect on.
   * Stored on the transaction row for traceability. Note: ledger allocation
   * is FIFO (oldest unpaid first within the same (subscriber, service)
   * scope) — this id captures intent, not allocation.
   */
  subscriptionId?: string | null;
  /** Pack name shown for context on the bill row. */
  packName?: string | null;
  /** Outstanding for the specific subscription (pre-calculated). */
  outstandingForSubscription?: number;
  /** Outstanding across the whole service line (cable_balance / internet_balance). */
  serviceBalance: number;
  onCollected?: () => void;
}

/**
 * Phase 5.3 — Collect Payment ("Mark as Paid").
 *
 * Bill-first per OPERATOR_WORKFLOW_UI_REVIEW.md Workflow 4 +
 * INDUSTRY_BENCHMARKING_ADDENDUM.md "Refinement detail":
 *
 *   - Top: subscriber + service header.
 *   - Middle: this device card's outstanding bill (selectable). If the
 *     wider service line has additional outstanding, surface it as a
 *     secondary "Settle service balance" choice.
 *   - Method tabs: Cash | UPI (UPI shows an inline QR encoding the standard
 *     upi:// URI built from the operator's stored VPA).
 *   - Custom amount override + UTR / reference field.
 *
 * Submission inserts a single `payment` transaction row with:
 *   source = 'subscription_payment'
 *   payment_method = 'cash' | 'upi'
 *   service_type = <service>
 *   subscription_id = <intent>
 *   amount = <selected>
 *
 * The `transactions_fifo_allocate_trg` BEFORE trigger then allocates the
 * payment across the subscriber's unpaid subscriptions in that service
 * (oldest start_date first). `recalc_subscriber_balance` updates
 * cable_balance / internet_balance.
 */
export const CollectPaymentDialog = ({
  open,
  onOpenChange,
  subscriberId,
  subscriberName,
  service,
  subscriptionId,
  packName,
  outstandingForSubscription,
  serviceBalance,
  onCollected,
}: CollectPaymentDialogProps) => {
  const { user } = useAuth();
  const Icon = service === 'cable' ? Tv : Wifi;

  // Default the selection to the device card's bill. If that is zero / not
  // provided, fall back to the wider service balance.
  const billAmount = Math.max(0, Number(outstandingForSubscription || 0));
  const serviceOwed = Math.max(0, Number(serviceBalance || 0));
  const initialAmount = billAmount > 0 ? billAmount : serviceOwed;

  const [amount, setAmount] = useState<string>(initialAmount > 0 ? initialAmount.toFixed(2) : '');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [vpa, setVpa] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [billSelected, setBillSelected] = useState(billAmount > 0);
  const [serviceSelected, setServiceSelected] = useState(billAmount === 0 && serviceOwed > 0);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setAmount(initialAmount > 0 ? initialAmount.toFixed(2) : '');
    setReference('');
    setBillSelected(billAmount > 0);
    setServiceSelected(billAmount === 0 && serviceOwed > 0);
    setMethod('cash');
  }, [open]);

  // Recalculate suggested amount when bill/service selection changes.
  useEffect(() => {
    let next = 0;
    if (billSelected) next += billAmount;
    if (serviceSelected) {
      // service balance includes the bill amount; avoid double-counting
      next = Math.max(next, serviceOwed);
    }
    setAmount(next > 0 ? next.toFixed(2) : '');
  }, [billSelected, serviceSelected, billAmount, serviceOwed]);

  // Load operator UPI VPA for the QR.
  useEffect(() => {
    if (!open || !user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('settings')
        .select('operator_upi_vpa')
        .eq('user_id', user.id)
        .maybeSingle();
      setVpa((data as any)?.operator_upi_vpa || null);
    })();
  }, [open, user?.id]);

  const amountNum = Number(amount) || 0;

  // upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<note>&cu=INR
  const upiUri = useMemo(() => {
    if (!vpa || amountNum <= 0) return null;
    const params = new URLSearchParams({
      pa: vpa,
      pn: 'Operator',
      am: amountNum.toFixed(2),
      tn: `${subscriberName} — ${service}`,
      cu: 'INR',
    });
    return `upi://pay?${params.toString()}`;
  }, [vpa, amountNum, subscriberName, service]);

  const qrSrc = upiUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}`
    : null;

  const handleSubmit = async () => {
    if (amountNum <= 0) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    if (method === 'upi' && !vpa) {
      toast.error('Set an operator UPI ID in Settings before collecting UPI payments');
      return;
    }
    if (!user?.id) {
      toast.error('Not signed in');
      return;
    }

    setSubmitting(true);
    const description = [
      `Payment received — ${service === 'cable' ? 'Cable' : 'Internet'}`,
      packName ? `(${packName})` : null,
      method === 'upi' && reference ? `UPI ref ${reference}` : null,
      method === 'cash' ? 'Cash' : 'UPI',
    ].filter(Boolean).join(' · ');

    const { error } = await supabase.from('transactions').insert({
      user_id: user.id,
      subscriber_id: subscriberId,
      type: 'payment',
      amount: amountNum,
      service_type: service,
      source: 'subscription_payment',
      payment_method: method,
      description,
      date: new Date().toISOString(),
      status: 'posted',
      subscription_id: subscriptionId || null,
    } as any);

    setSubmitting(false);
    if (error) {
      toast.error(error.message || 'Failed to record payment');
      console.error(error);
      return;
    }

    toast.success(`Collected ₹${amountNum.toFixed(2)} from ${subscriberName}`);
    onOpenChange(false);
    onCollected?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Collect Payment
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            {subscriberName} · {service === 'cable' ? 'Cable' : 'Internet'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bills / outstanding selection */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Outstanding
            </Label>

            {billAmount > 0 && (
              <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={billSelected}
                  onChange={(e) => setBillSelected(e.target.checked)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {packName || 'This subscription'}
                    </span>
                    <span className="font-semibold">₹{billAmount.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Bill on the selected device
                  </p>
                </div>
              </label>
            )}

            {serviceOwed > 0 && serviceOwed > billAmount && (
              <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={serviceSelected}
                  onChange={(e) => setServiceSelected(e.target.checked)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      All {service === 'cable' ? 'cable' : 'internet'} dues
                    </span>
                    <span className="font-semibold">₹{serviceOwed.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Includes any older unpaid bills on this service
                  </p>
                </div>
              </label>
            )}

            {billAmount === 0 && serviceOwed === 0 && (
              <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                No outstanding dues. Any amount collected here will sit as advance credit.
              </div>
            )}
          </div>

          {/* Custom amount */}
          <div className="space-y-2">
            <Label htmlFor="collect-amount">Amount (₹)</Label>
            <Input
              id="collect-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            {amountNum > Math.max(billAmount, serviceOwed) && (
              <p className="text-xs text-yellow-700 dark:text-yellow-400">
                Excess of ₹{(amountNum - Math.max(billAmount, serviceOwed)).toFixed(2)} will sit as advance credit on {service}.
              </p>
            )}
          </div>

          {/* Method tabs */}
          <Tabs value={method} onValueChange={(v) => setMethod(v as PaymentMethod)} className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="cash"><Banknote className="h-3.5 w-3.5 mr-1.5" />Cash</TabsTrigger>
              <TabsTrigger value="upi"><QrCode className="h-3.5 w-3.5 mr-1.5" />UPI</TabsTrigger>
            </TabsList>
            <TabsContent value="cash" className="mt-3">
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                Hand the receipt over after collecting cash. The ledger row goes in immediately.
              </div>
            </TabsContent>
            <TabsContent value="upi" className="mt-3 space-y-3">
              {vpa ? (
                <>
                  <div className="flex flex-col items-center gap-2 rounded-lg border p-3">
                    {qrSrc ? (
                      <img
                        src={qrSrc}
                        alt={`UPI QR for ₹${amountNum.toFixed(2)} to ${vpa}`}
                        className="w-44 h-44 bg-white p-2 rounded"
                      />
                    ) : (
                      <div className="w-44 h-44 flex items-center justify-center bg-muted text-xs text-muted-foreground rounded">
                        Enter an amount to render QR
                      </div>
                    )}
                    <Badge variant="outline" className="font-mono text-xs">{vpa}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="upi-ref">UPI Reference / UTR (optional)</Label>
                    <Input
                      id="upi-ref"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. 412334567890"
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No operator UPI ID set. Add one in Settings to generate UPI QR codes.
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting || amountNum <= 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : `Record ₹${(amountNum || 0).toFixed(2)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
