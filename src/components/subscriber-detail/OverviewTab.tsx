import { Plus, Tv, Wifi } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { Subscriber } from '@/lib/storage';
import { daysUntil } from '@/lib/activeSubs';
import {
  chipToneClasses,
  computeNextActionChip,
  computeOverallPosition,
  positionToneClasses,
} from '@/lib/financialPosition';
import { buildGrossComponents, type LedgerSubscription } from '@/lib/ledgerRendering';

interface PairedDevice {
  id: string;
  serial_number: string;
  device_type: 'stb' | 'onu' | 'router';
  service_type: 'cable' | 'internet';
}

interface OverviewTabProps {
  subscriber: Subscriber;
  subscriberServices: string[];
  accountStatus: { label: string; tone: string };
  showCableTab: boolean;
  showInternetTab: boolean;
  cableEnabled: boolean;
  internetEnabled: boolean;
  isArchived: boolean;
  pairedDevices: PairedDevice[];
  outstandingBySub: Record<string, number>;
  subsById: Record<string, LedgerSubscription>;
  providerNames: { cable?: string; internet?: string };
  formatDate: (d: string) => string;
  onAddServiceRequest: (svc: 'cable' | 'internet') => void;
}

/**
 * OVERVIEW TAB — subscriber profile card + BUSINESS_MODEL §G1 overall
 * position with per-device breakdown, and the "Add another service" CTA
 * (Item #8).
 */
export function OverviewTab({
  subscriber,
  subscriberServices,
  accountStatus,
  showCableTab,
  showInternetTab,
  cableEnabled,
  internetEnabled,
  isArchived,
  pairedDevices,
  outstandingBySub,
  subsById,
  providerNames,
  formatDate,
  onAddServiceRequest,
}: OverviewTabProps) {
  const position = computeOverallPosition(subscriber);
  const chip = computeNextActionChip(subscriber);
  const gross = buildGrossComponents(subscriber as any, outstandingBySub, subsById);
  const hasDebt = gross.some((g) => g.kind === 'outstanding');
  const hasCredit = gross.some((g) => g.kind === 'available_credit' || g.kind === 'service_credit');
  const showGross = hasDebt && hasCredit;

  const missing: ('cable' | 'internet')[] = [];
  if (cableEnabled && !subscriberServices.includes('cable')) missing.push('cable');
  if (internetEnabled && !subscriberServices.includes('internet')) missing.push('internet');

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">{subscriber.name}</CardTitle>
              <p className="text-muted-foreground mt-1">
                <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                  ID: {(subscriber as any).subscriber_id || 'N/A'}
                </span>
              </p>
              <p className="text-muted-foreground mt-2">{subscriber.mobile}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`text-xs px-2 py-1 rounded-full ${accountStatus.tone}`}>
                {accountStatus.label}
              </span>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {subscriberServices.includes('cable') && (
                  <Badge variant="secondary" className="gap-1"><Tv className="h-3 w-3" />Cable</Badge>
                )}
                {subscriberServices.includes('internet') && (
                  <Badge variant="secondary" className="gap-1"><Wifi className="h-3 w-3" />Internet</Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Region/Cluster</p>
              <p className="font-medium">{subscriber.region || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Joined</p>
              <p className="font-medium">
                {(subscriber as any).join_date
                  ? formatDate((subscriber as any).join_date)
                  : (subscriber.createdAt ? formatDate(subscriber.createdAt) : 'N/A')}
              </p>
            </div>
            {subscriber.latitude && subscriber.longitude && (
              <div className="md:col-span-2">
                <p className="text-sm text-muted-foreground">Location Coordinates</p>
                <p className="font-medium">
                  📍 Lat: {(subscriber.latitude || 0).toFixed(6)}, Long: {(subscriber.longitude || 0).toFixed(6)}
                </p>
              </div>
            )}
          </div>

          <Separator />

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall position</p>
                <p className={`text-2xl font-bold ${positionToneClasses(position.kind)}`}>
                  {position.label}
                </p>
                {showGross && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {gross.map((g) => g.label).join(' · ')}
                  </p>
                )}
              </div>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${chipToneClasses(chip.tone)}`}
              >
                <span aria-hidden>{chip.icon}</span>
                {chip.label}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              {position.breakdown.map((svc) => {
                const svcLabel = svc.service === 'cable' ? 'Cable TV' : 'Internet';
                const ServiceIcon = svc.service === 'cable' ? Tv : Wifi;
                const devices = pairedDevices.filter((d) => d.service_type === svc.service);
                const rows = devices.map((dev) => {
                  const sub = svc.actives.find((a) => a.deviceId === dev.id);
                  const outstanding = sub?.subscriptionId
                    ? (outstandingBySub[sub.subscriptionId] || 0)
                    : 0;
                  const daysLeft = sub ? daysUntil(sub.endDate) : null;
                  let statusText: string;
                  let statusClass = 'text-muted-foreground';
                  if (!sub) {
                    statusText = 'No active subscription';
                    statusClass = 'text-yellow-700 dark:text-yellow-400';
                  } else if (daysLeft !== null && daysLeft < 0) {
                    statusText = `Expired ${Math.abs(daysLeft)}d ago${outstanding > 0 ? ` · ₹${outstanding.toFixed(0)} due` : ''}`;
                    statusClass = 'text-red-700 dark:text-red-400';
                  } else if (outstanding > 0) {
                    statusText = `₹${outstanding.toFixed(0)} due`;
                    statusClass = 'text-red-700 dark:text-red-400';
                  } else {
                    statusText = 'Settled';
                  }
                  return {
                    key: dev.id,
                    primary: `${dev.serial_number}${sub?.packName ? ` (${sub.packName})` : ''}`,
                    statusText,
                    statusClass,
                  };
                });
                svc.actives
                  .filter((a) => !a.deviceId || !devices.some((d) => d.id === a.deviceId))
                  .forEach((a) => {
                    const outstanding = a.subscriptionId
                      ? (outstandingBySub[a.subscriptionId] || 0)
                      : 0;
                    rows.push({
                      key: a.subscriptionId,
                      primary: `${a.packName} (no device)`,
                      statusText: outstanding > 0 ? `₹${outstanding.toFixed(0)} due` : 'Settled',
                      statusClass: outstanding > 0 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
                    });
                  });
                const svcNet = svc.balance;
                const svcSummary =
                  svcNet > 0 ? `Outstanding ₹${svcNet.toFixed(0)}` :
                  svcNet < 0 ? `Available Credit ₹${Math.abs(svcNet).toFixed(0)}` :
                  'Settled';
                return (
                  <div key={svc.service} className="rounded-md bg-background/60 p-3 border">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <ServiceIcon className="h-3.5 w-3.5" /> {svcLabel}
                      </div>
                      <span className={`text-xs font-medium ${positionToneClasses(svcNet > 0 ? 'outstanding' : svcNet < 0 ? 'available_credit' : 'settled')}`}>
                        {svcSummary}
                      </span>
                    </div>
                    {rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No device paired</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {rows.map((r) => (
                          <li key={r.key} className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-mono truncate">{r.primary}</span>
                            <span className={`shrink-0 ${r.statusClass}`}>{r.statusText}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Provider:{' '}
              {showCableTab && <span className="mr-2"><Tv className="inline h-3 w-3 mr-0.5" />{providerNames.cable || '—'}</span>}
              {showInternetTab && <span><Wifi className="inline h-3 w-3 mr-0.5" />{providerNames.internet || '—'}</span>}
            </p>
          </div>
        </CardContent>
      </Card>

      {missing.length > 0 && !isArchived && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Add another service</p>
              <p className="text-xs text-muted-foreground">
                This customer does not have {missing.map((m) => (m === 'cable' ? 'Cable TV' : 'Internet')).join(' or ')} yet.
              </p>
            </div>
            <div className="flex gap-2">
              {missing.map((svc) => {
                const SvcIcon = svc === 'cable' ? Tv : Wifi;
                return (
                  <Button
                    key={svc}
                    size="sm"
                    variant="outline"
                    onClick={() => onAddServiceRequest(svc)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    <SvcIcon className="h-4 w-4 mr-1" />
                    Add {svc === 'cable' ? 'Cable TV' : 'Internet'}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
