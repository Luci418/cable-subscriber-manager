import { useState, useEffect, useRef } from 'react';
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
import { hasAnyActive } from '@/lib/activeSubs';
import { useProviders } from '@/hooks/useProviders';

type ServiceType = 'cable' | 'internet';

interface AddPackageSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  subscriberName: string;
  onSuccess: () => void;
  /** Which service this subscription belongs to. Defaults to 'cable' for backward compat. */
  serviceType?: ServiceType;
  /**
   * Phase 5.1 multi-device fix: explicit device id to renew/subscribe ON.
   * When provided, the server (create_subscription RPC) pins the new
   * subscription to this device instead of picking "most-recently-updated
   * assigned device for this service". Pass null/undefined for the legacy
   * fallback (single-device subscribers / no specific device context).
   */
  deviceId?: string | null;
}

export const AddPackageSubscriptionDialog = ({
  open,
  onOpenChange,
  subscriberId,
  subscriberName,
  onSuccess,
  serviceType = 'cable',
  deviceId = null,
}: AddPackageSubscriptionDialogProps) => {
  const { user, loading: authLoading } = useAuth();
  const { packs, loading: packsLoading, reloadPacks, getActivePacks } = usePacks(user?.id);
  const { providers } = useProviders(user?.id);
  const [selectedPack, setSelectedPack] = useState<string>('');
  const [duration, setDuration] = useState<number>(1);
  const [currentSubscriber, setCurrentSubscriber] = useState<any>(null);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [subscriberLoading, setSubscriberLoading] = useState(false);

  const serviceLabel = serviceType === 'internet' ? 'Internet' : 'Cable';

  // Batch 4 fix: filter packs by provider.
  // - If subscriber has an active subscription for this service, only that
  //   provider's packs are selectable (mirrors the DB invariant that blocks
  //   provider changes while an active sub exists).
  // - If no active sub, all packs for this service are shown, grouped and
  //   labelled by provider so the operator knows what they're picking.
  const providerNameById = new Map(providers.map((p) => [p.id, p.name] as const));
  const allServicePacks = getActivePacks().filter(
    (p: any) => (p.service_type || 'cable') === serviceType,
  );
  const activePacks = activeProviderId
    ? allServicePacks.filter((p: any) => p.provider_id === activeProviderId)
    : allServicePacks;
  const selectedPackData: any = activePacks.find((p) => p.name === selectedPack);
  const isPrepaid = selectedPackData?.billing_type === 'prepaid';
  const validityDays = Number(selectedPackData?.validity_days) || 30;

  const startDate = new Date();
  const endDate = new Date();
  if (isPrepaid) {
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

  // Load active-subscription count AND the pinned provider for this service
  // so pack filtering matches the DB invariant.
  const loadSubscriber = async () => {
    if (!subscriberId) return;
    setSubscriberLoading(true);
    const [viewRes, subRes] = await Promise.all([
      (supabase as any)
        .from('v_subscriber_active_subscription')
        .select('subscription_id')
        .eq('subscriber_id', subscriberId)
        .eq('service_type', serviceType),
      (supabase as any)
        .from('subscribers')
        .select('cable_provider_id, internet_provider_id')
        .eq('id', subscriberId)
        .maybeSingle(),
    ]);
    const activeCount = (viewRes?.data as any[] | null)?.length || 0;
    setCurrentSubscriber({ activeCount });
    // Only pin the provider when at least one active sub exists — otherwise
    // let the operator pick any provider's pack (first sub for this service).
    const pinned = activeCount > 0
      ? (serviceType === 'internet'
          ? subRes?.data?.internet_provider_id
          : subRes?.data?.cable_provider_id) ?? null
      : null;
    setActiveProviderId(pinned);
    setSubscriberLoading(false);
  };

  const hasActiveSubscription = (currentSubscriber?.activeCount || 0) > 0;

  // Ref-based lock so a fast double-click can never fire two submits — React
  // state updates are async, so `loading` in the guard below may still read
  // `false` on the second synchronous invocation. The RPC also holds an
  // advisory lock, but silently deduplicating in the UI avoids the duplicate
  // error toast operators saw before.
  const submittingRef = useRef(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!selectedPack || loading) {
      if (!selectedPack) toast.error('Please select a package');
      return;
    }
    if (hasActiveSubscription) {
      toast.error(`Please cancel the current ${serviceLabel.toLowerCase()} subscription first`);
      return;
    }
    submittingRef.current = true;
    try {
      await addNewSubscription();
    } finally {
      submittingRef.current = false;
    }
  };


  const addNewSubscription = async () => {
    setLoading(true);
    if (!selectedPackData) {
      toast.error('Package not found');
      setLoading(false);
      return;
    }

    // Phase 1 (ADR-012): subscription creation goes through a single atomic
    // RPC. The server inserts the charge transaction AND updates the
    // subscription/history/pack/provider in one transaction. The balance
    // trigger then recomputes cable_balance / internet_balance from the
    // ledger — we never write balance from the client.
    const { error } = await (supabase as any).rpc('create_subscription', {
      p_subscriber_id: subscriberId,
      p_service_type: serviceType,
      p_pack_id: selectedPackData.id,
      p_duration: duration,
      p_device_id: deviceId,
    });

    if (error) {
      toast.error(error.message || `Failed to add ${serviceLabel.toLowerCase()} subscription`);
      console.error(error);
      setLoading(false);
      return;
    }

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
                    activePacks.map((pack: any) => {
                      const providerName = pack.provider_id
                        ? providerNameById.get(pack.provider_id) ?? 'Unknown provider'
                        : 'No provider';
                      return (
                        <SelectItem key={pack.id} value={pack.name}>
                          <span className="font-medium">{pack.name}</span>
                          <span className="text-muted-foreground"> — {providerName}</span>
                          {' · ₹'}
                          {Number(pack.price).toFixed(2)}
                          {pack.billing_type === 'prepaid'
                            ? ` / ${pack.validity_days || 30}d`
                            : ' / month'}
                        </SelectItem>
                      );
                    })
                  ) : (
                    <div className="px-2 py-3 text-sm text-muted-foreground flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {activeProviderId
                        ? `No active packs from the current ${serviceLabel.toLowerCase()} provider. Add one, or cancel the active subscription to switch providers.`
                        : `No active ${serviceLabel.toLowerCase()} packages. Create one first.`}
                    </div>
                  )}
                </SelectContent>
              </Select>
              {activeProviderId && (
                <p className="text-[11px] text-muted-foreground">
                  Only packs from{' '}
                  <span className="font-medium">
                    {providerNameById.get(activeProviderId) ?? 'the current provider'}
                  </span>{' '}
                  are shown. Cancel the active {serviceLabel.toLowerCase()} subscription first to switch providers.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">
                {isPrepaid ? `Recharges (× ${validityDays} days each)` : 'Duration (months)'}
              </Label>
              <Select value={duration.toString()} onValueChange={(val) => setDuration(parseInt(val))}>
                <SelectTrigger id="duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isPrepaid ? (
                    <>
                      <SelectItem value="1">1 × {validityDays} days</SelectItem>
                      <SelectItem value="2">2 × {validityDays} days</SelectItem>
                      <SelectItem value="3">3 × {validityDays} days</SelectItem>
                      <SelectItem value="6">6 × {validityDays} days</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="1">1 Month</SelectItem>
                      <SelectItem value="3">3 Months</SelectItem>
                      <SelectItem value="6">6 Months</SelectItem>
                      <SelectItem value="12">12 Months</SelectItem>
                    </>
                  )}
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
