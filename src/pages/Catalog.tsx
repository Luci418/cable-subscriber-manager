import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Tv, Wifi, Archive, RotateCcw, Trash2, Edit2 } from 'lucide-react';
import { PageHeader } from '@/components/ui-ext/PageHeader';
import { DataTable, DataTableColumn } from '@/components/ui-ext/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui-ext/EmptyState';
import { usePacks } from '@/hooks/usePacks';
import { useProviders, type Provider, type ProviderServiceType } from '@/hooks/useProviders';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { PackManagementDialog } from '@/components/PackManagementDialog';
import { ProviderManagementDialog } from '@/components/ProviderManagementDialog';
import { toast } from 'sonner';
import { confirm } from '@/lib/confirm';
import { cn } from '@/lib/utils';

/**
 * Catalog — dedicated page for pack + provider management (/catalog).
 *
 * Replaces the Settings-nested Pack/Provider dialogs by giving each catalog
 * entity a first-class DataTable view with filters, retire/reactivate
 * actions and margin visibility on packs. The existing PackManagement and
 * ProviderManagement dialogs are reused as the create/edit surface so
 * validation and error handling stay in one place.
 */

type PackRow = ReturnType<typeof usePacks>['packs'][number] & {
  service_type?: string | null;
  billing_type?: string | null;
  validity_days?: number | null;
  provider_id?: string | null;
  provider_cost?: number | null;
};

// Deterministic colour per provider name (small palette, semantic tokens).
const PROVIDER_HUE_CLASSES = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
];

function hueFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PROVIDER_HUE_CLASSES[Math.abs(hash) % PROVIDER_HUE_CLASSES.length];
}

export default function Catalog() {
  const { user } = useAuth();
  const { subscribers } = useAppData();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'packs' | 'providers') || 'packs';

  const {
    packs, deletePack, retirePack, reactivatePack, reloadPacks,
  } = usePacks(user?.id);
  const {
    providers, deleteProvider, retireProvider, reactivateProvider, reloadProviders,
  } = useProviders(user?.id);

  const [showPackDialog, setShowPackDialog] = useState(false);
  const [showProviderDialog, setShowProviderDialog] = useState(false);

  // ── Filters (packs) ────────────────────────────────────────────────
  const providerFilter = params.get('provider') || 'all';
  const serviceFilter = (params.get('service') as 'cable' | 'internet' | 'all') || 'all';
  const statusFilter = (params.get('status') as 'active' | 'retired' | 'all') || 'active';
  const query = params.get('q') || '';

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (!v || v === 'all' || v === '') p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };

  // ── Active subscriber counts per provider (from active subs on subscribers) ──
  const providerActiveCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of subscribers as any[]) {
      const subs = [...(s.cable_subscriptions ?? []), ...(s.internet_subscriptions ?? [])];
      for (const sub of subs) {
        if (sub.status !== 'active') continue;
        const pid = sub.provider_id as string | null;
        if (!pid) continue;
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      }
    }
    return counts;
  }, [subscribers]);

  // ── Packs table rows ───────────────────────────────────────────────
  const packRows = useMemo(() => {
    return (packs as PackRow[])
      .filter(p => {
        if (serviceFilter !== 'all' && (p.service_type || 'cable') !== serviceFilter) return false;
        if (providerFilter !== 'all' && p.provider_id !== providerFilter) return false;
        if (statusFilter === 'active' && p.is_active === false) return false;
        if (statusFilter === 'retired' && p.is_active !== false) return false;
        if (query && !p.name.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      });
  }, [packs, serviceFilter, providerFilter, statusFilter, query]);

  const providerRows = useMemo(() => {
    return providers.filter(p => {
      if (serviceFilter !== 'all' && p.service_type !== serviceFilter) return false;
      if (statusFilter === 'active' && !p.is_active) return false;
      if (statusFilter === 'retired' && p.is_active) return false;
      if (query && !p.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [providers, serviceFilter, statusFilter, query]);

  // ── Pack actions ───────────────────────────────────────────────────
  const handleRetirePack = async (p: PackRow) => {
    if (await confirm({
      title: `Retire "${p.name}"?`,
      description: 'The pack will be hidden from new subscriptions. Existing subscriptions on this pack continue unchanged.',
      confirmText: 'Retire',
    })) {
      if (await retirePack(p.id)) toast.success('Pack retired');
    }
  };
  const handleReactivatePack = async (p: PackRow) => {
    if (await reactivatePack(p.id)) toast.success('Pack reactivated');
  };
  const handleDeletePack = async (p: PackRow) => {
    if (await confirm({
      title: `Delete "${p.name}"?`,
      description: 'Only works if no subscription has ever used this pack. Otherwise, retire it.',
      confirmText: 'Delete',
      destructive: true,
    })) {
      if (await deletePack(p.id)) toast.success('Pack deleted');
    }
  };

  const handleRetireProvider = async (p: Provider) => {
    if (await confirm({
      title: `Retire "${p.name}"?`,
      description: 'The provider will be hidden from new packs and subscriptions. Existing data is unchanged.',
      confirmText: 'Retire',
    })) {
      if (await retireProvider(p.id)) toast.success('Provider retired');
    }
  };
  const handleReactivateProvider = async (p: Provider) => {
    if (await reactivateProvider(p.id)) toast.success('Provider reactivated');
  };
  const handleDeleteProvider = async (p: Provider) => {
    if (await confirm({
      title: `Delete "${p.name}"?`,
      description: 'Only works if nothing references it (packs, subscriptions, transactions, subscribers). Otherwise, retire.',
      confirmText: 'Delete',
      destructive: true,
    })) {
      if (await deleteProvider(p.id)) toast.success('Provider deleted');
    }
  };

  // ── Columns ────────────────────────────────────────────────────────
  const packColumns: DataTableColumn<PackRow>[] = [
    {
      id: 'name',
      header: 'Pack',
      cell: (p) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{p.name}</div>
          {p.service_type === 'cable' && p.channels && p.channels !== '-' && (
            <div className="text-xs text-muted-foreground truncate">{p.channels}</div>
          )}
        </div>
      ),
    },
    {
      id: 'provider',
      header: 'Provider',
      cell: (p) => {
        const prov = providers.find(x => x.id === p.provider_id);
        if (!prov) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className={cn('font-normal border', hueFor(prov.name))}>
            {prov.name}
          </Badge>
        );
      },
    },
    {
      id: 'service',
      header: 'Service',
      cell: (p) => (
        <span className="inline-flex items-center gap-1 text-xs capitalize text-muted-foreground">
          {p.service_type === 'internet'
            ? <><Wifi className="h-3 w-3" /> Internet</>
            : <><Tv className="h-3 w-3" /> Cable</>}
        </span>
      ),
      hideBelow: 'sm',
    },
    {
      id: 'price',
      header: 'Price',
      align: 'right',
      cell: (p) => (
        <span className="tabular-nums">
          ₹{Number(p.price).toFixed(0)}
          <span className="text-xs text-muted-foreground ml-1">
            /{p.billing_type === 'prepaid' ? `${p.validity_days ?? 30}d` : 'mo'}
          </span>
        </span>
      ),
    },
    {
      id: 'cost',
      header: 'Provider cost',
      align: 'right',
      hideBelow: 'md',
      cell: (p) => p.provider_cost != null
        ? <span className="tabular-nums">₹{Number(p.provider_cost).toFixed(0)}</span>
        : <span className="text-xs text-muted-foreground">cost not set</span>,
    },
    {
      id: 'margin',
      header: 'Margin',
      align: 'right',
      hideBelow: 'md',
      cell: (p) => {
        if (p.provider_cost == null || Number(p.price) <= 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const pct = ((Number(p.price) - Number(p.provider_cost)) / Number(p.price)) * 100;
        return <span className={cn('tabular-nums text-xs', pct < 0 && 'text-destructive')}>{pct.toFixed(1)}%</span>;
      },
    },
    {
      id: 'validity',
      header: 'Validity',
      hideBelow: 'lg',
      cell: (p) => (
        <span className="text-xs text-muted-foreground">
          {p.billing_type === 'prepaid' ? `${p.validity_days ?? 30} days` : 'Monthly'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => p.is_active === false
        ? <Badge variant="secondary" className="text-xs">Retired</Badge>
        : <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-300">Active</Badge>,
    },
  ];

  const providerColumns: DataTableColumn<Provider>[] = [
    {
      id: 'name',
      header: 'Provider',
      cell: (p) => (
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={cn('font-normal border', hueFor(p.name))}>{p.name}</Badge>
        </div>
      ),
    },
    {
      id: 'service',
      header: 'Service',
      cell: (p) => (
        <span className="inline-flex items-center gap-1 text-xs capitalize text-muted-foreground">
          {p.service_type === 'internet'
            ? <><Wifi className="h-3 w-3" /> Internet</>
            : <><Tv className="h-3 w-3" /> Cable</>}
        </span>
      ),
    },
    {
      id: 'notes',
      header: 'Contact / notes',
      hideBelow: 'md',
      cell: (p) => <span className="text-xs text-muted-foreground truncate block max-w-md">{p.notes || '—'}</span>,
    },
    {
      id: 'subscribers',
      header: 'Active subs',
      align: 'right',
      cell: (p) => <span className="tabular-nums">{providerActiveCounts.get(p.id) ?? 0}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => p.is_active
        ? <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-300">Active</Badge>
        : <Badge variant="secondary" className="text-xs">Retired</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Manage the packages you sell and the upstream providers behind them."
        actions={
          <Button onClick={() => (tab === 'packs' ? setShowPackDialog(true) : setShowProviderDialog(true))}>
            <Plus className="mr-2 h-4 w-4" />
            {tab === 'packs' ? 'Add Pack' : 'Add Provider'}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setParam('tab', v === 'packs' ? null : v)}>
        <TabsList>
          <TabsTrigger value="packs">Packs ({packs.length})</TabsTrigger>
          <TabsTrigger value="providers">Providers ({providers.length})</TabsTrigger>
        </TabsList>

        {/* Shared filter bar */}
        <div className="flex flex-wrap gap-2 mt-4 mb-3">
          <Input
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setParam('q', e.target.value || null)}
            className="max-w-xs"
          />
          <Select value={serviceFilter} onValueChange={(v) => setParam('service', v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              <SelectItem value="cable">Cable</SelectItem>
              <SelectItem value="internet">Internet</SelectItem>
            </SelectContent>
          </Select>
          {tab === 'packs' && (
            <Select value={providerFilter} onValueChange={(v) => setParam('provider', v)}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Provider" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {providers.filter(p => p.is_active).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={statusFilter} onValueChange={(v) => setParam('status', v === 'active' ? null : v)}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="packs" className="mt-0">
          <DataTable
            columns={packColumns}
            rows={packRows}
            rowKey={(p) => p.id}
            onRowClick={() => setShowPackDialog(true)}
            empty={<EmptyState title="No packs match" description="Adjust filters or add a new pack." />}
            rowActions={(p) => (
              <div className="flex justify-end gap-1">
                <Button size="icon" variant="ghost" title="Edit" onClick={() => setShowPackDialog(true)}>
                  <Edit2 className="h-4 w-4" />
                </Button>
                {p.is_active === false ? (
                  <Button size="icon" variant="ghost" title="Reactivate" onClick={() => handleReactivatePack(p)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="icon" variant="ghost" title="Retire" onClick={() => handleRetirePack(p)}>
                    <Archive className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" title="Delete" onClick={() => handleDeletePack(p)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )}
          />
        </TabsContent>

        <TabsContent value="providers" className="mt-0">
          <DataTable
            columns={providerColumns}
            rows={providerRows}
            rowKey={(p) => p.id}
            onRowClick={() => setShowProviderDialog(true)}
            empty={<EmptyState title="No providers match" description="Adjust filters or add a new provider." />}
            rowActions={(p) => (
              <div className="flex justify-end gap-1">
                <Button size="icon" variant="ghost" title="Edit" onClick={() => setShowProviderDialog(true)}>
                  <Edit2 className="h-4 w-4" />
                </Button>
                {p.is_active ? (
                  <Button size="icon" variant="ghost" title="Retire" onClick={() => handleRetireProvider(p)}>
                    <Archive className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="icon" variant="ghost" title="Reactivate" onClick={() => handleReactivateProvider(p)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" title="Delete" onClick={() => handleDeleteProvider(p)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )}
          />
        </TabsContent>
      </Tabs>

      <PackManagementDialog
        open={showPackDialog}
        onOpenChange={(o) => { setShowPackDialog(o); if (!o) reloadPacks(); }}
      />
      <ProviderManagementDialog
        open={showProviderDialog}
        onOpenChange={(o) => { setShowProviderDialog(o); if (!o) reloadProviders(); }}
      />
    </>
  );
}
