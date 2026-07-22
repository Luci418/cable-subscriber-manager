import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HardDrive, Tv, Wifi, Wrench, CheckCircle2, XCircle, Link2Off, Loader2, History } from 'lucide-react';
import { PageHeader, SectionCard, EmptyState, KeyValue } from '@/components/ui-ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
 * Batch 4 changes:
 *  - All status-changing actions (Mark faulty, Mark repaired, Decommission,
 *    Unpair) now require confirmation via AlertDialog. Accidental status
 *    changes were previously irreversible and left no audit trail.
 *  - Status change history is rendered from device_status_log alongside
 *    assignment history, giving operators one unified device timeline.
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
const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

interface StatusLogRow {
  id: string;
  from_status: StbStatus | null;
  to_status: StbStatus;
  reason: string | null;
  changed_at: string;
  changed_by: string | null;
}

type PendingAction =
  | { kind: 'faulty' }
  | { kind: 'repaired' }
  | { kind: 'decommission' }
  | { kind: 'unpair' };

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
  const [statusLog, setStatusLog] = useState<StatusLogRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [vendorRow, setVendorRow] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [repairNotes, setRepairNotes] = useState('');


  const reload = async () => {
    if (!serial) return;
    const [logRows, vendor, statusRes] = await Promise.all([
      loadDeviceAssignments(serial),
      (supabase as any)
        .from('stb_inventory')
        .select('purchase_date, vendor, purchase_cost, warranty_expiry')
        .eq('serial_number', serial)
        .maybeSingle()
        .then((r: any) => r?.data ?? null)
        .catch(() => null),
      (supabase as any)
        .from('device_status_log')
        .select('id, from_status, to_status, reason, changed_at, changed_by')
        .eq('device_serial', serial)
        .order('changed_at', { ascending: false }),
    ]);
    setRows(logRows);
    setVendorRow(vendor);
    setStatusLog((statusRes?.data as StatusLogRow[]) || []);
  };

  useEffect(() => {
    if (!serial) return;
    let cancelled = false;
    setRowsLoading(true);
    (async () => {
      await reload();
      if (!cancelled) setRowsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const runPending = async () => {
    if (!pending || !device) return;
    setBusy(true);
    try {
      let ok: any = false;
      let msg = '';
      if (pending.kind === 'faulty') { ok = await markAsFaulty(device.id); msg = 'Marked as faulty'; }
      else if (pending.kind === 'repaired') { ok = await markAsRepaired(device.id, repairNotes.trim() || undefined); msg = 'Marked as repaired'; }
      else if (pending.kind === 'decommission') { ok = await decommission(device.id); msg = 'Decommissioned'; }
      else if (pending.kind === 'unpair') { ok = await unassignStb(device.id); msg = 'Device unpaired'; }
      if (ok !== false) {
        toast.success(msg);
        await reloadStbs();
        await reload();
      }
    } finally {
      setBusy(false);
      setPending(null);
      setRepairNotes('');
    }
  };


  const confirmCopy: Record<PendingAction['kind'], { title: string; body: string; confirm: string; destructive?: boolean }> = {
    faulty: {
      title: 'Mark device as faulty?',
      body: device.status === 'assigned'
        ? `${device.serial_number} is currently assigned. Marking it faulty will unassign it from the customer and move it to the faulty bucket.`
        : `${device.serial_number} will be moved to the faulty bucket and become unavailable for new assignments.`,
      confirm: 'Mark faulty',
      destructive: true,
    },
    repaired: {
      title: 'Mark device as repaired?',
      body: `${device.serial_number} will move back to the available bucket and can be assigned to customers again.`,
      confirm: 'Mark repaired',
    },
    decommission: {
      title: 'Decommission this device?',
      body: `${device.serial_number} will be retired permanently. This is not reversible from the UI.`,
      confirm: 'Decommission',
      destructive: true,
    },
    unpair: {
      title: 'Unpair this device?',
      body: `${device.serial_number} will be removed from ${holder?.name ?? 'the current customer'} and returned to the available pool.`,
      confirm: 'Unpair',
      destructive: true,
    },
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
                    to={`/customers/${(holder as any).subscriber_id ?? holder.id}`}
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
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending({ kind: 'unpair' })}>
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
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending({ kind: 'faulty' })}>
                <Wrench className="h-3.5 w-3.5 mr-1.5" /> Mark faulty
              </Button>
            )}
            {device.status === 'faulty' && perms.canReplaceDevice && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending({ kind: 'repaired' })}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark repaired
              </Button>
            )}
            {device.status !== 'assigned' && device.status !== 'decommissioned' && perms.canReplaceDevice && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending({ kind: 'decommission' })}>
                <XCircle className="h-3.5 w-3.5 mr-1.5" /> Decommission
              </Button>
            )}
            {device.status === 'available' && (
              <p className="text-xs text-muted-foreground">
                Assign this device from the customer's <span className="font-medium">Devices</span> tab.
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

      <SectionCard title="Status history" description="Every status change is recorded automatically." className="mt-4">
        {rowsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : statusLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No status changes recorded yet. History is captured from Phase 6.5 Batch 4 onward.
          </p>
        ) : (
          <ol className="space-y-2">
            {statusLog.map((r) => (
              <li key={r.id} className="border rounded-md px-3 py-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  {r.from_status && (
                    <>
                      <Badge variant="outline" className={STATUS_TONE[r.from_status]}>{STATUS_LABEL[r.from_status]}</Badge>
                      <span className="text-xs text-muted-foreground">→</span>
                    </>
                  )}
                  <Badge variant="outline" className={STATUS_TONE[r.to_status]}>{STATUS_LABEL[r.to_status]}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{fmtDateTime(r.changed_at)}</span>
                </div>
                {r.reason && (
                  <div className="text-xs text-muted-foreground mt-1">Reason: {r.reason}</div>
                )}
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

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
                          <Link to={`/customers/${sub.subscriber_id ?? sub.id}`} className="font-medium hover:underline truncate">
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

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy[pending.kind].title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmCopy[pending.kind].body}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={(e) => { e.preventDefault(); runPending(); }}
                  className={confirmCopy[pending.kind].destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
                >
                  {busy ? 'Working…' : confirmCopy[pending.kind].confirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
