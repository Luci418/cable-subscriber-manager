import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Subscriber } from '@/lib/storage';
import { Tv, Wifi } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useProviders } from '@/hooks/useProviders';

type ManualTxnType = 'payment' | 'charge' | 'adjustment';

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { type: ManualTxnType; amount: number; description: string; service_type: 'cable' | 'internet'; provider_id?: string | null; payment_method?: 'cash' | 'upi' | 'other' | null }) => void;
  subscriber: Subscriber;
}

/**
 * Manual transaction entry.
 *
 * Provider is intentionally NOT operator-selectable here: every transaction
 * inherits the provider that's already linked to the subscriber's service
 * (cable_provider_id / internet_provider_id). This keeps the provider as a
 * property of the *service relationship*, not a per-transaction free choice,
 * and prevents mismatched provider attribution. We surface the chosen
 * provider read-only so the operator can confirm what will be recorded.
 */
export const AddTransactionDialog = ({
  open,
  onOpenChange,
  onSubmit,
  subscriber,
}: AddTransactionDialogProps) => {
  const subscriberServices: string[] = (subscriber as any).services?.length
    ? (subscriber as any).services
    : ['cable'];
  const hasCable = subscriberServices.includes('cable');
  const hasInternet = subscriberServices.includes('internet');
  const showServicePicker = hasCable && hasInternet;
  const defaultService: 'cable' | 'internet' = hasCable ? 'cable' : 'internet';

  const { user } = useAuth();
  const { providers } = useProviders(user?.id);

  const providerIdFor = (svc: 'cable' | 'internet') =>
    (svc === 'internet'
      ? (subscriber as any).internet_provider_id
      : (subscriber as any).cable_provider_id) || null;

  const providerNameFor = (svc: 'cable' | 'internet') => {
    const id = providerIdFor(svc);
    return id ? providers.find(p => p.id === id)?.name || null : null;
  };

  const [formData, setFormData] = useState({
    type: 'payment' as ManualTxnType,
    amount: '',
    description: '',
    service_type: defaultService,
    payment_method: 'cash' as 'cash' | 'upi' | 'other',
  });

  useEffect(() => {
    if (open) {
      setFormData(f => ({ ...f, service_type: defaultService }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultService]);

  const providerName = providerNameFor(formData.service_type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) { toast.error('Please enter a valid amount'); return; }
    if (!formData.description.trim()) { toast.error('Please enter a description'); return; }

    onSubmit({
      type: formData.type,
      amount,
      description: formData.description,
      service_type: formData.service_type,
      provider_id: providerIdFor(formData.service_type),
      payment_method: formData.type === 'payment' ? formData.payment_method : null,
    });

    setFormData({
      type: 'payment',
      amount: '',
      description: '',
      service_type: defaultService,
      payment_method: 'cash',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {showServicePicker && (
            <div className="space-y-2">
              <Label htmlFor="service">Service</Label>
              <Select
                value={formData.service_type}
                onValueChange={(value: 'cable' | 'internet') => setFormData({ ...formData, service_type: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cable">
                    <span className="flex items-center gap-2"><Tv className="h-3.5 w-3.5" /> Cable</span>
                  </SelectItem>
                  <SelectItem value="internet">
                    <span className="flex items-center gap-2"><Wifi className="h-3.5 w-3.5" /> Internet</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Provider:{' '}
            <span className="font-medium text-foreground">
              {providerName || 'Not assigned for this service'}
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select
              value={formData.type}
              onValueChange={(value: ManualTxnType) => setFormData({ ...formData, type: value })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="payment">Cash Received</SelectItem>
                <SelectItem value="charge">Bill / Charge</SelectItem>
                <SelectItem value="adjustment">Adjustment (goodwill / non-cash credit)</SelectItem>
              </SelectContent>
            </Select>
            {formData.type === 'adjustment' && (
              <p className="text-xs text-muted-foreground">
                Non-cash credit. Reduces what the subscriber owes but stays separate from cash collected in reports.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (₹)</Label>
            <Input
              id="amount" type="number" inputMode="decimal" min="0.01" step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              placeholder="0.00" required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Enter transaction details..." required
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1">Add Transaction</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
