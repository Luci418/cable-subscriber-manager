import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CancelSubscriptionDialog } from './CancelSubscriptionDialog';
import { toast } from 'sonner';
import { Calendar, Clock } from 'lucide-react';
import { usePacks } from '@/hooks/usePacks';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface AddPackageSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  subscriberName: string;
  onSuccess: () => void;
}

export const AddPackageSubscriptionDialog = ({
  open,
  onOpenChange,
  subscriberId,
  subscriberName,
  onSuccess
}: AddPackageSubscriptionDialogProps) => {
  const { user } = useAuth();
  const { packs } = usePacks(user?.id);
  const [selectedPack, setSelectedPack] = useState<string>('');
  const [duration, setDuration] = useState<number>(1);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [currentSubscriber, setCurrentSubscriber] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + duration);

  useEffect(() => {
    if (open && subscriberId) {
      loadSubscriber();
    }
  }, [open, subscriberId]);

  const loadSubscriber = async () => {
    const { data } = await supabase
      .from('subscribers')
      .select('*')
      .eq('id', subscriberId)
      .single();
    
    if (data) {
      setCurrentSubscriber(data);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedPack || loading) {
      if (!selectedPack) toast.error('Please select a package');
      return;
    }

    // Check if subscriber has an active subscription
    const currentSub = currentSubscriber?.current_subscription as any;
    if (currentSub?.status === 'active') {
      setShowCancelDialog(true);
      return;
    }

    // No active subscription, proceed with adding new one
    await addNewSubscription();
  };

  const addNewSubscription = async () => {
    setLoading(true);
    const selectedPackData = packs.find(p => p.name === selectedPack);
    if (!selectedPackData) {
      toast.error('Package not found');
      setLoading(false);
      return;
    }

    const newSubscription = {
      id: `sub-${Date.now()}`,
      packName: selectedPackData.name,
      packPrice: selectedPackData.price,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      duration,
      status: 'active',
      subscribedAt: new Date().toISOString()
    };

    const subscriptionHistory = currentSubscriber?.subscription_history || [];
    
    const { error } = await supabase
      .from('subscribers')
      .update({
        current_pack: selectedPackData.name,
        current_subscription: newSubscription,
        subscription_history: [...subscriptionHistory, newSubscription]
      })
      .eq('id', subscriberId);

    setLoading(false);

    if (error) {
      toast.error('Failed to add subscription');
      console.error(error);
      return;
    }

    toast.success('Package subscription added successfully');
    setSelectedPack('');
    setDuration(1);
    onOpenChange(false);
    onSuccess();
  };

  const handleCancelAndAdd = async (refundAmount: number) => {
    setLoading(true);
    
    // Update subscriber balance with refund (positive value increases balance)
    const newBalance = (currentSubscriber?.balance || 0) + refundAmount;
    
    const { error } = await supabase
      .from('subscribers')
      .update({
        current_subscription: null,
        balance: newBalance
      })
      .eq('id', subscriberId);

    if (error) {
      toast.error('Failed to cancel subscription');
      console.error(error);
      setLoading(false);
      return;
    }

    toast.success(`Subscription cancelled. Refund: ₹${refundAmount.toFixed(2)}`);
    
    // Reload subscriber and add new subscription
    await loadSubscriber();
    await addNewSubscription();
    setShowCancelDialog(false);
    setLoading(false);
  };

  const selectedPackData = packs.find(p => p.name === selectedPack);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Package Subscription</DialogTitle>
          <p className="text-sm text-muted-foreground">for {subscriberName}</p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="package">Select Package</Label>
            <Select value={selectedPack} onValueChange={setSelectedPack}>
              <SelectTrigger id="package">
                <SelectValue placeholder="Choose a package" />
              </SelectTrigger>
              <SelectContent>
                {packs && packs.length > 0 ? (
                  packs.map((pack) => (
                    <SelectItem key={pack.id} value={pack.name}>
                      {pack.name} - ₹{pack.price.toFixed(2)}/month
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No packages available. Please create packages first.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration (months)</Label>
            <Select value={duration.toString()} onValueChange={(val) => setDuration(parseInt(val))}>
              <SelectTrigger id="duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 Month</SelectItem>
                <SelectItem value="3">3 Months</SelectItem>
                <SelectItem value="6">6 Months</SelectItem>
                <SelectItem value="12">12 Months</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedPackData && (
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                <span className="font-medium">Start Date:</span>
                <span>{startDate.toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4" />
                <span className="font-medium">Expiry Date:</span>
                <span>{endDate.toLocaleDateString()}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Total Amount:</span>
                  <span className="text-lg font-bold">
                    ₹{(selectedPackData.price * duration).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? 'Adding...' : 'Add Subscription'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    {currentSubscriber?.currentSubscription && (
      <CancelSubscriptionDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        subscription={currentSubscriber.currentSubscription}
        onConfirm={handleCancelAndAdd}
      />
    )}
    </>
  );
};
