import { ArrowLeftRight, Link2, Link2Off, RefreshCw, Tv, Wallet, Wifi, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Subscriber } from '@/lib/storage';
import { daysUntil, type SubscriptionBlob } from '@/lib/activeSubs';
import { getSubscriptionStatus, type SubscriptionEntry } from '@/lib/subscriptionUtils';
import { formatCloseReason } from '@/lib/assetTimeline';
import { AssetTimelineCustomer } from '@/components/AssetTimelineCustomer';

export interface PairedDevice {
  id: string;
  serial_number: string;
  device_type: 'stb' | 'onu' | 'router';
  service_type: 'cable' | 'internet';
}

/** Most recent CLOSED assignment for a service — drives the "device needed" state. */
export interface LastClosedAssignment {
  device_serial: string;
  closed_at: string;
  close_reason: string | null;
  closed_by_name: string | null;
}

interface DevicesTabProps {
  subscriber: Subscriber;
  showCableTab: boolean;
  showInternetTab: boolean;
  pairedDevices: PairedDevice[];
  cableActives: SubscriptionBlob[];
  internetActives: SubscriptionBlob[];
  outstandingBySub: Record<string, number>;
  providerNames: { cable?: string; internet?: string };
  lastClosedByService: { cable: LastClosedAssignment | null; internet: LastClosedAssignment | null };
  perms: {
    canCollectPayment: boolean;
    canReplaceDevice: boolean;
    canPairDevice: boolean;
    canCancelSubscription: boolean;
  };
  onCollect: (target: {
    service: 'cable' | 'internet';
    subscriptionId: string | null;
    packName: string | null;
    outstandingForSubscription: number;
  }) => void;
  onRenew: (service: 'cable' | 'internet', deviceId: string | null) => void;
  onReplace: (device: PairedDevice) => void;
  onUnpair: (device: PairedDevice) => void;
  onCancel: (target: { service: 'cable' | 'internet'; subscriptionId: string; blob: SubscriptionBlob }) => void;
  onPair: (service: 'cable' | 'internet') => void;
}

const getBalanceColor = (balance: number) => {
  if (balance > 0) return 'text-success';
  if (balance < 0) return 'text-destructive';
  return 'text-muted-foreground';
};

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * DEVICES TAB — per-service device cards plus the "device needed" guided
 * workflow when the service has an active subscription but no paired
 * device (Batch 4 addition).
 *
 * Guided-state logic:
 *   - No active sub                → existing "No device paired" empty state
 *   - Active sub AND last close = 'faulty'
 *                                  → highlighted faulty state naming the
 *                                    replaced device + "Assign Replacement"
 *   - Active sub AND last close ≠ 'faulty' (or unknown)
 *                                  → simple "Subscription active" + "Pair Device"
 */
export function DevicesTab(props: DevicesTabProps) {
  const {
    subscriber,
    showCableTab,
    showInternetTab,
    pairedDevices,
    cableActives,
    internetActives,
    outstandingBySub,
    providerNames,
    lastClosedByService,
    perms,
    onCollect,
    onRenew,
    onReplace,
    onUnpair,
    onCancel,
    onPair,
  } = props;

  const renderCard = (service: 'cable' | 'internet') => {
    const isCable = service === 'cable';
    const devicesForService = pairedDevices.filter((d) => d.service_type === service);
    const actives = isCable ? cableActives : internetActives;
    const balance = isCable
      ? (subscriber.cable_balance || 0)
      : ((subscriber as any).internet_balance || 0);
    const provider = isCable ? providerNames.cable : providerNames.internet;
    const Icon = isCable ? Tv : Wifi;
    const title = isCable ? 'Cable' : 'Internet';
    const lastClosed = isCable ? lastClosedByService.cable : lastClosedByService.internet;

    const matchedActiveIds = new Set(
      devicesForService
        .map((d) => actives.find((a) => a.deviceId === d.id)?.subscriptionId)
        .filter(Boolean) as string[]
    );
    const orphanActives = actives.filter(
      (a) => !a.subscriptionId || !matchedActiveIds.has(a.subscriptionId)
    );

    // Guided empty state — Batch 4. When we have subscription(s) but no
    // paired device, replace the flat "No device paired" text with an
    // actionable card. Orphan actives (sub w/ no matched device) count
    // toward "has active" too so we still surface the issue.
    const hasActive = actives.length > 0;
    const noDevices = devicesForService.length === 0 && orphanActives.length === 0;
    const showGuidedNoDevice = noDevices && hasActive;

    // Days-remaining hint: prefer the most recent active sub.
    const referenceSub = actives[0] || null;
    const daysLeft = referenceSub ? daysUntil(referenceSub.endDate) : null;
    const daysLabel =
      daysLeft === null
        ? ''
        : daysLeft < 0
          ? `Expired ${Math.abs(daysLeft)}d ago`
          : daysLeft === 0
            ? 'expires today'
            : `${daysLeft} days remaining`;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{title}</CardTitle>
            <div className="text-xs text-muted-foreground text-right">
              <p>Provider: <span className="font-medium text-foreground">{provider || '—'}</span></p>
              <p>
                Balance:{' '}
                <span className={`font-medium ${getBalanceColor(balance)}`}>
                  ₹{Math.abs(balance).toFixed(2)} {balance >= 0 ? 'dues' : 'advance'}
                </span>
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {noDevices && !hasActive ? (
            <div className="text-center py-6 text-muted-foreground">
              <Icon className="h-8 w-8 mx-auto opacity-40 mb-2" />
              <p className="text-sm">No device paired</p>
            </div>
          ) : showGuidedNoDevice ? (
            lastClosed?.close_reason === 'faulty' ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold">{title} — No device assigned</p>
                    <p className="text-xs text-muted-foreground">
                      Previous device{' '}
                      <span className="font-mono font-medium text-foreground">{lastClosed.device_serial}</span>
                      {' '}marked faulty on{' '}
                      <span className="font-medium text-foreground">{formatDateShort(lastClosed.closed_at)}</span>
                      {lastClosed.closed_by_name && (
                        <> by <span className="font-medium text-foreground">{lastClosed.closed_by_name}</span></>
                      )}.
                    </p>
                    {referenceSub && (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Subscription is still active — </span>
                        <span className="font-medium">{daysLabel}</span>.
                      </p>
                    )}
                  </div>
                </div>
                {perms.canPairDevice && (
                  <Button size="sm" className="w-full" onClick={() => onPair(service)}>
                    <Link2 className="h-4 w-4 mr-1.5" />
                    Assign Replacement Device
                  </Button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-4 space-y-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold">{title} — No device assigned</p>
                  {referenceSub && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Subscription active — </span>
                      <span className="font-medium">{daysLabel}</span>.
                    </p>
                  )}
                  {lastClosed?.close_reason && (
                    <p className="text-[11px] text-muted-foreground">
                      Previous device{' '}
                      <span className="font-mono">{lastClosed.device_serial}</span> —{' '}
                      {formatCloseReason(lastClosed.close_reason).toLowerCase()} on{' '}
                      {formatDateShort(lastClosed.closed_at)}.
                    </p>
                  )}
                </div>
                {perms.canPairDevice && (
                  <Button size="sm" className="w-full" onClick={() => onPair(service)}>
                    <Link2 className="h-4 w-4 mr-1.5" />
                    Pair Device
                  </Button>
                )}
              </div>
            )
          ) : (
            <>
              {devicesForService.map((dev) => {
                const sub = actives.find((a) => a.deviceId === dev.id) || null;
                const dLeft = sub ? daysUntil(sub.endDate) : null;
                const subStatus = sub ? getSubscriptionStatus(sub as unknown as SubscriptionEntry) : null;

                return (
                  <div key={dev.id} className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-medium">{dev.serial_number}</span>
                          <Badge variant="outline" className="text-xs uppercase">{dev.device_type}</Badge>
                        </div>
                        {sub ? (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">Active — </span>
                            <span className="font-medium">{sub.packName}</span>
                            {dLeft !== null && (
                              <span className={`ml-2 text-xs ${
                                dLeft < 0
                                  ? 'text-destructive'
                                  : dLeft <= 3
                                    ? 'text-yellow-600 dark:text-yellow-400'
                                    : 'text-muted-foreground'
                              }`}>
                                {dLeft < 0
                                  ? `Expired ${Math.abs(dLeft)}d ago`
                                  : dLeft === 0
                                    ? 'Expires today'
                                    : `${dLeft}d remaining`}
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-sm mt-1 text-muted-foreground">No active subscription</p>
                        )}
                      </div>
                      {sub ? (
                        <Badge className={
                          subStatus?.statusColor === 'yellow'
                            ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10'
                            : 'bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/10'
                        }>
                          {subStatus?.statusText || 'Active'}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Idle</Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!perms.canCollectPayment}
                        title={!perms.canCollectPayment ? 'You do not have permission to collect payments' : undefined}
                        onClick={() => {
                          onCollect({
                            service,
                            subscriptionId: sub?.subscriptionId || null,
                            packName: sub?.packName || null,
                            outstandingForSubscription:
                              sub?.subscriptionId
                                ? (outstandingBySub[sub.subscriptionId] || 0)
                                : 0,
                          });
                        }}
                      >
                        <Wallet className="h-3.5 w-3.5 mr-1.5" />Collect
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRenew(service, dev.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        {sub ? 'Renew' : 'Subscribe'}
                      </Button>

                      {perms.canReplaceDevice && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onReplace(dev)}
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" />Replace
                        </Button>
                      )}

                      {perms.canPairDevice && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUnpair(dev)}
                        >
                          <Link2Off className="h-3.5 w-3.5 mr-1.5" />Unpair
                        </Button>
                      )}
                    </div>

                    {sub && perms.canCancelSubscription && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-destructive hover:text-destructive"
                        onClick={() =>
                          onCancel({ service, subscriptionId: sub.subscriptionId, blob: sub })
                        }
                      >
                        Cancel Subscription
                      </Button>
                    )}
                  </div>
                );
              })}

              {orphanActives.map((sub) => (
                <div key={sub.subscriptionId} className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
                  <p className="font-medium">{sub.packName}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Active subscription with no paired device (legacy data). Use the inventory screen to reconcile.
                  </p>
                </div>
              ))}
            </>
          )}

          {/* Pair CTA remains available at the bottom for adding additional
              devices to a service that already has one paired. Hidden when
              the guided no-device state is showing (which has its own CTA). */}
          {!showGuidedNoDevice && perms.canPairDevice && (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={() => onPair(service)}
            >
              <Link2 className="h-4 w-4 mr-1.5" />
              {devicesForService.length === 0 ? 'Pair Device' : 'Pair Another Device'}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      {showCableTab && renderCard('cable')}
      {showInternetTab && renderCard('internet')}
      <AssetTimelineCustomer subscriberId={subscriber.id} />
    </>
  );
}
