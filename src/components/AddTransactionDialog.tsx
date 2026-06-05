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

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { type: 'payment' | 'charge'; amount: number; description: string; service_type: 'cable' | 'internet'; provider_id?: string | null }) => void;
  subscriber: Subscriber;
}

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
  const { getActiveProviders } = useProviders(user?.id);

  const subscriberProviderFor = (svc: 'cable' | 'internet') =>
    (svc === 'internet'
      ? (subscriber as any).internet_provider_id
      : (subscriber as any).cable_provider_id) || '';

  const [formData, setFormData] = useState({
    type: 'payment' as 'payment' | 'charge',
    amount: '',
    description: '',
    service_type: defaultService,
    provider_id: subscriberProviderFor(defaultService),
  });

  useEffect(() => {
    if (open) {
      setFormData(f => ({
        ...f,
        service_type: defaultService,
        provider_id: subscriberProviderFor(defaultService),
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultService]);

  // Keep provider in sync when user flips service
  useEffect(() => {
    setFormData(f => ({ ...f, provider_id: subscriberProviderFor(f.service_type) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.service_type]);

  const providersForService = getActiveProviders(formData.service_type);
  const showProviderPicker = providersForService.length > 1;

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
      provider_id: formData.provider_id || null,
    });

    setFormData({
      type: 'payment',
      amount: '',
      description: '',
      service_type: defaultService,
      provider_id: subscriberProviderFor(defaultService),
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

          {showProviderPicker && (
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={formData.provider_id}
                onValueChange={(v) => setFormData({ ...formData, provider_id: v })}
              >
                <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>
                  {providersForService.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select
              value={formData.type}
              onValueChange={(value: 'payment' | 'charge') => setFormData({ ...formData, type: value })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="payment">Cash Received</SelectItem>
                <SelectItem value="charge">Bill</SelectItem>
              </SelectContent>
            </Select>
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
