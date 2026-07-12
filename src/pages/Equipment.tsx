import { useMemo, useState } from 'react';
import { Router, Tv, Wifi, Plus, Search, HardDrive, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { PageHeader, StatCard, SectionCard, EmptyState, Toolbar, DataTable } from '@/components/ui-ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { useStbInventory, type StbStatus } from '@/hooks/useStbInventory';
import { StbInventoryDialog } from '@/components/StbInventoryDialog';
import { DeviceTimelineDialog } from '@/components/DeviceTimelineDialog';

/**
 * Equipment — dedicated page for device inventory.
 *
 * Batch 2: promoted from a dialog to a real route (/equipment) so operators
 * can bookmark, share, and land directly on the device workbench. The status
 * filter and search live in the URL (?status=&q=) for the same reason —
 * a supervisor can send "the list of faulty ONUs" as a link.
 *
 * Actions that mutate (add device, mark faulty, decommission, delete)
 * continue to use the existing StbInventoryDialog, opened as a workbench.
 * Batch 3 will extract those actions into inline row menus and add a
 * per-device detail page (/equipment/:serial) with the full assignment
 * history + timeline.
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

export default function Equipment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { subscribers } = useAppData();
  const { stbs, loading } = useStbInventory(user?.id);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historySerial, setHistorySerial] = useState<string | null>(null);

  const status = (params.get('status') ?? 'all') as StbStatus | 'all';
  const q = params.get('q') ?? '';

  const subById = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of subscribers) m.set(s.id, s);
    return m;
  }, [subscribers]);

  const stats = useMemo(() => {
    const counts: Record<StbStatus | 'total', number> = {
      total: stbs.length,
      available: 0,
      assigned: 0,
      faulty: 0,
      decommissioned: 0,
    };
    for (const s of stbs) counts[s.status]++;
    return counts;
  }, [stbs]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return stbs.filter((d) => {
      if (status !== 'all' && d.status !== status) return false;
      if (!term) return true;
      const holder = d.subscriber_id ? subById.get(d.subscriber_id) : null;
      return (
        d.serial_number.toLowerCase().includes(term) ||
        (d.notes ?? '').toLowerCase().includes(term) ||
        (holder?.name ?? '').toLowerCase().includes(term) ||
        (holder?.subscriber_id ?? '').toLowerCase().includes(term)
      );
    });
  }, [stbs, status, q, subById]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '' || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Equipment"
        description="Every set-top box, ONU, and router on your books — where it is, who has it, and what state it's in."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Manage inventory
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          label="Total devices"
          value={stats.total}
          icon={<HardDrive className="h-4 w-4" />}
          onClick={() => setParam('status', null)}
        />
        <StatCard
          label="Assigned"
          value={stats.assigned}
          hint="Deployed with customers"
          icon={<CheckCircle2 className="h-4 w-4" />}
          onClick={() => setParam('status', 'assigned')}
        />
        <StatCard
          label="Available"
          value={stats.available}
          hint="Ready to deploy"
          icon={<Router className="h-4 w-4" />}
          onClick={() => setParam('status', 'available')}
        />
        <StatCard
          label="Faulty"
          value={stats.faulty}
          hint="Needs attention"
          icon={<Wrench className="h-4 w-4" />}
          onClick={() => setParam('status', 'faulty')}
        />
      </div>

      <SectionCard padded={false}>
        <Toolbar
          searchValue={q}
          onSearchChange={(v) => setParam('q', v)}
          searchPlaceholder="Search serial, subscriber, notes…"
          filters={
            <Select value={status} onValueChange={(v) => setParam('status', v)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="faulty">Faulty</SelectItem>
                <SelectItem value="decommissioned">Decommissioned</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading inventory…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<HardDrive className="h-5 w-5" />}
            title={stbs.length === 0 ? 'No devices yet' : 'No matches'}
            description={
              stbs.length === 0
                ? 'Add STBs, ONUs, or routers to start tracking your inventory.'
                : 'Adjust filters or search to see other devices.'
            }
            action={
              stbs.length === 0 ? (
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Add device
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            rows={filtered}
            rowKey={(d) => d.id}
            columns={[
              {
                id: 'serial',
                header: 'Serial',
                cell: (d) => (
                  <button
                    className="flex items-center gap-2 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/equipment/${encodeURIComponent(d.serial_number)}`);
                    }}
                  >
                    {d.service_type === 'internet' ? (
                      <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Tv className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="font-mono text-sm">{d.serial_number}</span>
                  </button>
                ),
              },
              {
                id: 'type',
                header: 'Type',
                cell: (d) => (
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {d.device_type}
                  </span>
                ),
                hideBelow: 'sm',
              },
              {
                id: 'status',
                header: 'Status',
                cell: (d) => (
                  <Badge variant="outline" className={STATUS_TONE[d.status]}>
                    {STATUS_LABEL[d.status]}
                  </Badge>
                ),
              },
              {
                id: 'holder',
                header: 'Assigned to',
                cell: (d) => {
                  const holder = d.subscriber_id ? subById.get(d.subscriber_id) : null;
                  if (!holder) return <span className="text-xs text-muted-foreground">—</span>;
                  return (
                    <button
                      className="text-left hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/customers/${holder.subscriber_id}`);
                      }}
                    >
                      <div className="font-medium truncate max-w-[220px]">{holder.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {holder.subscriber_id}
                      </div>
                    </button>
                  );
                },
              },
              {
                id: 'notes',
                header: 'Notes',
                cell: (d) => (
                  <span className="text-xs text-muted-foreground line-clamp-1 max-w-[260px]">
                    {d.notes ?? '—'}
                  </span>
                ),
                hideBelow: 'md',
              },
            ]}
            rowActions={(d) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/equipment/${encodeURIComponent(d.serial_number)}`)}
              >
                Open
              </Button>
            )}
          />
        )}
      </SectionCard>

      <StbInventoryDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      {historySerial && (
        <DeviceTimelineDialog
          open={!!historySerial}
          onOpenChange={(o) => !o && setHistorySerial(null)}
          deviceSerial={historySerial}
        />
      )}
    </>
  );
}

