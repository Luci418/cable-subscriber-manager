import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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

type ServiceType = 'cable' | 'internet';

interface AddPackageSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  subscriberName: string;
  onSuccess: () => void;
  /** Which service this subscription belongs to. Defaults to 'cable' for backward compat. */
  serviceType?: ServiceType;
}

export const AddPackageSubscriptionDialog = ({
  open,
  onOpenChange,
  subscriberId,
  subscriberName,
  onSuccess,
  serviceType = 'cable',
}: AddPackageSubscriptionDialogProps) => {
  const { user, loading: authLoading } = useAuth();
  const { packs, loading: packsLoading, reloadPacks, getActivePacks } = usePacks(user?.id);
  const [selectedPack, setSelectedPack] = useState<string>('');
  const [duration, setDuration] = useState<number>(1);
  const [currentSubscriber, setCurrentSubscriber] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [subscriberLoading, setSubscriberLoading] = useState(false);

  // Service-aware column names so the same dialog works for cable + internet.
  const subscriptionCol = serviceType === 'internet' ? 'internet_subscription' : 'current_subscription';
  const historyCol = serviceType === 'internet' ? 'internet_subscription_history' : 'subscription_history';
  const packCol = serviceType === 'internet' ? 'current_internet_pack' : 'current_pack';
  const balanceCol = serviceType === 'internet' ? 'internet_balance' : 'cable_balance';
  const serviceLabel = serviceType === 'internet' ? 'Internet' : 'Cable';

  // Pull the live pack metadata to determine billing model + validity.
  const activePacks = getActivePacks().filter((p: any) => (p.service_type || 'cable') === serviceType);
  const selectedPackData: any = activePacks.find(p => p.name === selectedPack);
  const isPrepaid = selectedPackData?.billing_type === 'prepaid';
  const validityDays = Number(selectedPackData?.validity_days) || 30;

  const startDate = new Date();
  const endDate = new Date();
  if (isPrepaid) {
    // Prepaid: validity in days × number of recharges
    endDate.setDate(endDate.getDate() + validityDays * duration);
  } else {
    endDate.setMonth(endDate.getMonth() + duration);
  }

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

    if (data) setCurrentSubscriber(data);
    setSubscriberLoading(false);
  };

  const hasActiveSubscription = currentSubscriber?.[subscriptionCol]
    ? isSubscriptionActive(currentSubscriber[subscriptionCol])
    : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPack || loading) {
      if (!selectedPack) toast.error('Please select a package');
      return;
    }
    if (hasActiveSubscription) {
      toast.error(`Please cancel the current ${serviceLabel.toLowerCase()} subscription first`);
      return;
    }
    await addNewSubscription();
  };

  const addNewSubscription = async () => {
    setLoading(true);
    // Only show packs of the matching service type.
    const activePacks = getActivePacks().filter((p: any) => (p.service_type || 'cable') === serviceType);
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
      subscribedAt: new Date().toISOString(),
    };

    const subscriptionHistory = (currentSubscriber?.[historyCol] || []).map((sub: any) => ({
      ...sub,
      status: 'expired',
    }));

    const chargeAmount = Number(selectedPackData.price) * duration;
    const newBalance = Number(currentSubscriber?.[balanceCol] || 0) + chargeAmount;

    const updates: Record<string, any> = {
      [packCol]: selectedPackData.name,
      [subscriptionCol]: newSubscription,
      [historyCol]: [...subscriptionHistory, newSubscription],
      [balanceCol]: newBalance,
    };
    const { error } = await (supabase
      .from('subscribers') as any)
      .update(updates)
      .eq('id', subscriberId);

    if (error) {
      toast.error('Failed to add subscription');
      console.error(error);
      setLoading(false);
      return;
    }

    await supabase.from('transactions').insert({
      subscriber_id: subscriberId,
      user_id: currentSubscriber?.user_id,
      type: 'charge',
      amount: chargeAmount,
      service_type: serviceType,
      description: `${serviceLabel} subscription charge: ${selectedPackData.name} (${duration} month${duration > 1 ? 's' : ''})`,
      date: new Date().toISOString(),
    });

    setLoading(false);
    toast.success(`${serviceLabel} subscription added`);
    setSelectedPack('');
    setDuration(1);
    onOpenChange(false);
    onSuccess();
  };

  // (activePacks/selectedPackData declared near the top of the component)
  const isLoading = authLoading || packsLoading || subscriberLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {serviceLabel} Package</DialogTitle>
          <DialogDescription>Add a new {serviceLabel.toLowerCase()} package subscription for {subscriberName}</DialogDescription>
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
              <Label htmlFor="package">Select {serviceLabel} Package</Label>
              <Select value={selectedPack} onValueChange={setSelectedPack}>
                <SelectTrigger id="package">
                  <SelectValue placeholder="Choose a package" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  {activePacks.length > 0 ? (
                    activePacks.map((pack) => (
                      <SelectItem key={pack.id} value={pack.name}>
                        {pack.name} - ₹{Number(pack.price).toFixed(2)}/month
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2 py-3 text-sm text-muted-foreground flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      No active {serviceLabel.toLowerCase()} packages. Create one first.
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
                      ₹{(Number(selectedPackData.price) * duration).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1" disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? 'Adding...' : 'Add Subscription'}
              </Button>
            </div>

            {hasActiveSubscription && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 mt-3 text-sm">
                <p className="text-yellow-700 dark:text-yellow-400">
                  ⚠️ This subscriber has an active {serviceLabel.toLowerCase()} subscription. Cancel it first.
                </p>
              </div>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
