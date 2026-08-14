import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarPlus, Loader2, Tv, Wifi } from 'lucide-react';
import { daysUntil, type SubscriptionBlob } from '@/lib/activeSubs';
import { supabase } from '@/integrations/supabase/client';
import { friendlyDbError } from '@/lib/dbErrors';
import { confirm } from '@/lib/confirm';
import { usePermissions } from '@/lib/permissions';

interface SubscriptionsTabProps {
  subscriberId?: string;
  showCableTab: boolean;
  showInternetTab: boolean;
  cableActives: SubscriptionBlob[];
  internetActives: SubscriptionBlob[];
  cableHistory: SubscriptionBlob[];
  internetHistory: SubscriptionBlob[];
  onReload?: () => void;
}

/**
 * History item rendering (extracted from SubscriberDetail — Batch 4).
 * For cancelled subs shows the actual served period + original validity.
 */
function renderHistoryItem(sub: SubscriptionBlob) {
  const start = new Date(sub.startDate);
  const isCancelled = sub.status === 'cancelled';
  const cancelledAt = sub.cancelledAt ? new Date(sub.cancelledAt) : null;
  const scheduledEnd = new Date(sub.endDate);
  const actualEnd = isCancelled && cancelledAt ? cancelledAt : scheduledEnd;
  const dayMs = 1000 * 60 * 60 * 24;
  const actualDays = Math.max(0, Math.floor((actualEnd.getTime() - start.getTime()) / dayMs));
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtShort = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const statusLabel = isCancelled
    ? `Cancelled after ${actualDays} day${actualDays === 1 ? '' : 's'}`
    : sub.status === 'expired' ? 'Expired' : 'Ended';
  const statusTone = isCancelled
    ? 'bg-red-500/10 text-red-700 dark:text-red-400'
    : 'bg-muted text-muted-foreground';
  return (
    <div key={sub.subscriptionId} className="rounded-lg border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-medium">{sub.packName}</span>
        <span className={`text-xs px-2 py-1 rounded-full ${statusTone}`}>
          {isCancelled ? 'Cancelled' : 'Expired'}
        </span>
      </div>
      {isCancelled && cancelledAt && (
        <p className="text-xs text-muted-foreground">
          Cancelled on <span className="font-medium text-foreground">{fmt(cancelledAt)}</span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="block text-muted-foreground">Original validity</span>
          <span className="font-medium text-foreground">
            {fmtShort(start)} – {fmtShort(scheduledEnd)}
          </span>
        </div>
        <div>
          <span className="block text-muted-foreground">Status</span>
          <span className="font-medium text-foreground">{statusLabel}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * SUBSCRIPTIONS TAB — consolidated timeline across services. Active
 * packs, cancellations, expirations. Renew / Cancel actions still live
 * on device cards in the Devices tab (they're per-device).
 */
export function SubscriptionsTab({
  subscriberId,
  showCableTab,
  showInternetTab,
  cableActives,
  internetActives,
  cableHistory,
  internetHistory,
  onReload,
}: SubscriptionsTabProps) {
  const perms = usePermissions();
  const [extending, setExtending] = useState<string | null>(null);

  const groups = [
    { key: 'cable' as const, show: showCableTab, actives: cableActives, history: cableHistory, label: 'Cable', Icon: Tv },
    { key: 'internet' as const, show: showInternetTab, actives: internetActives, history: internetHistory, label: 'Internet', Icon: Wifi },
  ].filter((g) => g.show);

  /**
   * "Extend" is the manual twin of the renewal path `commit_provider_import`
   * takes: same `extend_subscription` RPC, so the charge, the end-date maths
   * and the extension counters stay in one place.
   */
  const extend = async (service: 'cable' | 'internet', sub: SubscriptionBlob, activesForService: SubscriptionBlob[]) => {
    if (!subscriberId || !sub.packId) {
      toast.error('This subscription has no pack on record and cannot be extended.');
      return;
    }
    // Multi-connection subscribers: the device is the only thing that says
    // WHICH box is being renewed. Never let the RPC guess.
    const multi = activesForService.length > 1;
    if (multi && !sub.deviceId) {
      toast.error(
        'This customer has more than one active connection for this service. Pair this subscription to a device before extending it.',
      );
      return;
    }
    const ok = await confirm({
      title: `Extend ${sub.packName}?`,
      description:
        `Adds one more period to ${multi ? `the connection on ${sub.stbNumber || 'this device'}` : 'the current subscription'}` +
        ` and posts a charge of ₹${Number(sub.packPrice || 0).toFixed(0)}.`,
      confirmText: 'Extend',
    });
    if (!ok) return;
    setExtending(sub.subscriptionId);
    const { error } = await (supabase as any).rpc('extend_subscription', {
      p_subscriber_id: subscriberId,
      p_service_type: service,
      p_pack_id: sub.packId,
      p_periods: 1,
      p_device_id: sub.deviceId ?? null,
    });
    setExtending(null);
    if (error) {
      toast.error(friendlyDbError(error, 'Could not extend the subscription'));
      return;
    }
    toast.success('Subscription extended');
    onReload?.();
  };


  return (
    <>
      {groups.map((g) => (
        <Card key={g.key}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <g.Icon className="h-4 w-4" /> {g.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {g.actives.length === 0 && g.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subscriptions on record.</p>
            ) : (
              <>
                {g.actives.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Active</p>
                    {g.actives.map((sub) => {
                      const daysLeft = daysUntil(sub.endDate);
                      return (
                        <div key={sub.subscriptionId} className="rounded-lg border p-3 text-sm">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-medium">{sub.packName}</span>
                            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/10">
                              {daysLeft !== null && daysLeft < 0
                                ? `Expired ${Math.abs(daysLeft)}d ago`
                                : daysLeft === 0 ? 'Expires today'
                                : `${daysLeft}d remaining`}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(sub.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {' → '}
                            {new Date(sub.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {sub.stbNumber && <> · <span className="font-mono">{sub.stbNumber}</span></>}
                          </p>
                          {perms.canCancelSubscription && subscriberId && (
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={extending === sub.subscriptionId}
                                onClick={() => extend(g.key, sub)}
                              >
                                {extending === sub.subscriptionId ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                  <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                                )}
                                Extend
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {g.history.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">History</p>
                    {g.history
                      .slice()
                      .sort((a, b) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                      .map((sub) => renderHistoryItem(sub))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
