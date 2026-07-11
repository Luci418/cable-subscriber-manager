import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HardDrive, Tv, Wifi, Router, Wrench, CheckCircle2, XCircle, Link2Off, Loader2 } from 'lucide-react';
import { PageHeader, SectionCard, EmptyState, KeyValue } from '@/components/ui-ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { useStbInventory, type StbStatus } from '@/hooks/useStbInventory';
import {
  loadDeviceAssignments,
  isActiveAssignment,
  durationDays,
  formatCloseReason,
  formatOpenReason,
  type AssignmentLogRow,
} from '@/lib/assetTimeline';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { usePermissions } from '@/lib/permissions';

/**
 * /equipment/:serial — per-device workspace.
 *
 * Batch 3 promotes device history from a modal to a first-class page so
 * "Assigned to" links from the equipment list resolve here. Sections:
 *  - Identity (serial, type, service, status)
 *  - Current assignment (subscriber + opened-at + reason)
 *  - Customer History (assignment_log rows — the agreed operator label)
 *  - Vendor info (optional; blank until vendor columns are populated)
 *  - Contextual actions based on status
 *
 * Vendor columns (purchase_date, vendor, purchase_cost, warranty_expiry)
 * are read defensively — they may not yet exist in every deployment;
 * the section renders only when at least one field has a value.
 */
const STATUS_LABEL: Record<StbStatus, string> = {
  available: 'Available',
  assigned: 'Assigned',
  faulty: 'Faulty',
  decommissioned: 'Decommissioned',
};
const STATUS_TONE: Record<StbStatus, string> = {
  available: 'bg-success/15 text-success border-success/30',
  assigned: 'bg-primary/15 text-primary border-primary/30',
  faulty: 'bg-warning/15 text-warning border-warning/30',
  decommissioned: 'bg-muted text-muted-foreground border-border',
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export default function EquipmentDetail() {
  const { serial = '' } = useParams<{ serial: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = usePermissions();
  const { subscribers } = useAppData();
  const { stbs, loading, markAsFaulty, markAsRepaired, decommission, unassignStb, reloadStbs } =
    useStbInventory(user?.id);

  const device = useMemo(
    () => stbs.find((d) => d.serial_number === serial) || null,
    [stbs, serial],
  );
  const holder = useMemo(
    () => (device?.subscriber_id ? subscribers.find((s) => s.id === device.subscriber_id) : null),
    [subscribers, device],
  );

  const [rows, setRows] = useState<AssignmentLogRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [vendorRow, setVendorRow] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!serial) return;
    let cancelled = false;
    setRowsLoading(true);
    (async () => {
      const [logRows, vendor] = await Promise.all([
        loadDeviceAssignments(serial),
        (supabase as any)
          .from('stb_inventory')
          .select('purchase_date, vendor, purchase_cost, warranty_expiry')
          .eq('serial_number', serial)
          .maybeSingle()
          .then((r: any) => r?.data ?? null)
          .catch(() => null),
      ]);
      if (cancelled) return;
      setRows(logRows);
      setVendorRow(vendor);
      setRowsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [serial]);

  const subscribersById = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of subscribers) m.set(s.id, s);
    return m;
  }, [subscribers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!device) {
    return (
      <EmptyState
        icon={<HardDrive className="h-5 w-5" />}
        title="Device not found"
        description="This serial number is not in your inventory."
        action={<Button onClick={() => navigate('/equipment')}>Back to equipment</Button>}
      />
    );
  }

  const ServiceIcon = device.service_type === 'internet' ? Wifi : Tv;
  const activeRow = rows.find((r) => isActiveAssignment(r)) || null;
  const historicalRows = rows.filter((r) => !isActiveAssignment(r));

  const hasVendorInfo =
    !!vendorRow && (vendorRow.purchase_date || vendorRow.vendor || vendorRow.purchase_cost || vendorRow.warranty_expiry);

  const doAction = async (fn: () => Promise<any>, successMsg: string) => {
    setBusy(true);
    try {
      const ok = await fn();
      if (ok !== false) {
        toast.success(successMsg);
        await reloadStbs();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{device.serial_number}</span>}
        description={
          <span className="flex items-center gap-2">
            <ServiceIcon className="h-3.5 w-3.5" />
            <span className="uppercase tracking-wide text-xs">{device.device_type}</span>
            <span className="text-muted-foreground">·</span>
            <span className="capitalize">{device.service_type}</span>
          </span>
        }
        actions={
          <Badge variant="outline" className={STATUS_TONE[device.status]}>
            {STATUS_LABEL[device.status]}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Current assignment" className="lg:col-span-2">
          {device.status === 'assigned' && holder ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <Link
                    to={`/customers/${holder.id}`}
                    className="text-base font-medium hover:underline"
                  >
                    {holder.name}
                  </Link>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {(holder as any).subscriber_id ?? holder.id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{holder.mobile}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>
                    Assigned:{' '}
                    <span className="text-foreground font-medium">
                      {fmt(activeRow?.opened_at ?? device.updated_at ?? device.created_at)}
                    </span>
                  </p>
                  {activeRow?.open_reason && (
                    <p className="mt-0.5">Reason: {formatOpenReason(activeRow.open_reason)}</p>
                  )}
                </div>
              </div>
              {perms.canPairDevice && (
                <div className="pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => doAction(() => unassignStb(device.id), 'Device unpaired')}
                  >
                    <Link2Off className="h-3.5 w-3.5 mr-1.5" /> Unpair
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not currently assigned to a customer.</p>
          )}
        </SectionCard>

        <SectionCard title="Actions">
          <div className="flex flex-col gap-2">
            {device.status !== 'faulty' && device.status !== 'decommissioned' && perms.canReplaceDevice && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => doAction(() => markAsFaulty(device.id), 'Marked as faulty')}
              >
                <Wrench className="h-3.5 w-3.5 mr-1.5" /> Mark faulty
              </Button>
            )}
            {device.status === 'faulty' && perms.canReplaceDevice && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => doAction(() => markAsRepaired(device.id), 'Marked as repaired')}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark repaired
              </Button>
            )}
            {device.status !== 'assigned' && device.status !== 'decommissioned' && perms.canReplaceDevice && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => doAction(() => decommission(device.id), 'Decommissioned')}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" /> Decommission
              </Button>
            )}
            {device.status === 'available' && (
              <p className="text-xs text-muted-foreground">
                Assign this device from the customer's{' '}
                <span className="font-medium">Devices</span> tab.
              </p>
            )}
            {device.status === 'decommissioned' && (
              <p className="text-xs text-muted-foreground">
                Retired device — no further actions available.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      {hasVendorInfo && (
        <SectionCard title="Vendor & procurement" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
            <KeyValue label="Vendor" value={vendorRow.vendor ?? '—'} />
            <KeyValue label="Purchased" value={fmt(vendorRow.purchase_date)} />
            <KeyValue
              label="Purchase cost"
              value={vendorRow.purchase_cost != null ? `₹${Number(vendorRow.purchase_cost).toFixed(2)}` : '—'}
            />
            <KeyValue label="Warranty expiry" value={fmt(vendorRow.warranty_expiry)} />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Customer History" className="mt-4">
        {rowsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 && !holder ? (
          <p className="text-sm text-muted-foreground">
            No customer history recorded. Assignment history is tracked from Phase 5.1 onward.
          </p>
        ) : (
          <div className="space-y-2">
            {historicalRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No previous customers.</p>
            ) : (
              historicalRows.map((r) => {
                const sub = subscribersById.get(r.subscriber_id);
                return (
                  <div key={r.id} className="border rounded-md px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        {sub ? (
                          <Link to={`/customers/${sub.id}`} className="font-medium hover:underline truncate">
                            {sub.name}
                          </Link>
                        ) : (
                          <span className="font-medium truncate">(unknown subscriber)</span>
                        )}
                        <div className="text-xs text-muted-foreground font-mono">
                          {sub?.subscriber_id ?? r.subscriber_id.slice(0, 8)}
                        </div>
                      </div>
                      <Badge variant="outline">{formatCloseReason(r.close_reason)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {fmt(r.opened_at)} → {fmt(r.closed_at)} · {durationDays(r)}d
                    </div>
                  </div>
                );
              })
            )}
            <p className="text-[11px] text-muted-foreground pt-1">
              Detailed assignment history is tracked from Phase 5.1 onward.
            </p>
          </div>
        )}
      </SectionCard>
    </>
  );
}
