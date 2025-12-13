import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Calendar, Clock, AlertCircle } from 'lucide-react';
import { usePacks } from '@/hooks/usePacks';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isSubscriptionActive } from '@/lib/subscriptionUtils';

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
  const { user, loading: authLoading } = useAuth();
  const { packs, loading: packsLoading, reloadPacks, getActivePacks } = usePacks(user?.id);
  const [selectedPack, setSelectedPack] = useState<string>('');
  const [duration, setDuration] = useState<number>(1);
  const [currentSubscriber, setCurrentSubscriber] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [subscriberLoading, setSubscriberLoading] = useState(false);
  
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + duration);

  // Reload packs when dialog opens
  useEffect(() => {
    if (open && user?.id) {
      reloadPacks();
      loadSubscriber();
    }
  }, [open, user?.id]);

  const loadSubscriber = async () => {
    if (!subscriberId) return;
    setSubscriberLoading(true);
    const { data } = await supabase
      .from('subscribers')
      .select('*')
      .eq('id', subscriberId)
      .single();
    
    if (data) {
      setCurrentSubscriber(data);
    }
    setSubscriberLoading(false);
  };

  // Check if current subscription is actually active (not just exists)
  const hasActiveSubscription = currentSubscriber?.current_subscription 
    ? isSubscriptionActive(currentSubscriber.current_subscription)
    : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedPack || loading) {
      if (!selectedPack) toast.error('Please select a package');
      return;
    }

    // Check if subscriber has an ACTIVE subscription (not just any subscription)
    if (hasActiveSubscription) {
      toast.error('Please cancel the current subscription before adding a new one');
      return;
    }

    // No active subscription, proceed with adding new one
    await addNewSubscription();
  };

  const addNewSubscription = async () => {
    setLoading(true);
    const activePacks = getActivePacks();
    const selectedPackData = activePacks.find(p => p.name === selectedPack);
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

    // Update history - mark all old subscriptions as expired
    const subscriptionHistory = (currentSubscriber?.subscription_history || []).map((sub: any) => ({
      ...sub,
      status: 'expired'
    }));
    
    // Calculate the charge amount
    const chargeAmount = selectedPackData.price * duration;
    const newBalance = (currentSubscriber?.balance || 0) + chargeAmount;

    const { error } = await supabase
      .from('subscribers')
      .update({
        current_pack: selectedPackData.name,
        current_subscription: newSubscription,
        subscription_history: [...subscriptionHistory, newSubscription],
        balance: newBalance
      })
      .eq('id', subscriberId);

    if (error) {
      toast.error('Failed to add subscription');
      console.error(error);
      setLoading(false);
      return;
    }

    // Add charge transaction
    await supabase.from('transactions').insert({
      subscriber_id: subscriberId,
      user_id: currentSubscriber?.user_id,
      type: 'charge',
      amount: chargeAmount,
      description: `Subscription charge: ${selectedPackData.name} (${duration} month${duration > 1 ? 's' : ''})`,
      date: new Date().toISOString(),
    });

    setLoading(false);
    toast.success('Package subscription added successfully');
    setSelectedPack('');
    setDuration(1);
    onOpenChange(false);
    onSuccess();
  };

  const activePacks = getActivePacks();
  const selectedPackData = activePacks.find(p => p.name === selectedPack);

  const isLoading = authLoading || packsLoading || subscriberLoading;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Package Subscription</DialogTitle>
          <p className="text-sm text-muted-foreground">for {subscriberName}</p>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="package">Select Package</Label>
            <Select value={selectedPack} onValueChange={setSelectedPack}>
              <SelectTrigger id="package">
                <SelectValue placeholder="Choose a package" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {activePacks && activePacks.length > 0 ? (
                  activePacks.map((pack) => (
                    <SelectItem key={pack.id} value={pack.name}>
                      {pack.name} - ₹{Number(pack.price).toFixed(2)}/month
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    No active packages available. Please create packages first.
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

          {hasActiveSubscription && (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 mt-3 text-sm">
              <p className="text-yellow-700 dark:text-yellow-400">
                ⚠️ This subscriber has an active subscription. Please cancel it first before adding a new one.
              </p>
            </div>
          )}
        </form>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
};
