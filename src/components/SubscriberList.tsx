import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Settings2, Upload, Download, HardDrive, Package, MapPin, Wifi, Tv, Building, MoreHorizontal, Wallet, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { PageHeader, Toolbar, DataTable, EmptyState, Pagination, Money, SectionCard, type DataTableColumn } from '@/components/ui-ext';
import { useAuth } from '@/hooks/useAuth';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useRegions } from '@/hooks/useRegions';
import { useSubscribersPaged, type ServiceFilter, type StatusFilter, type BalanceFilter } from '@/hooks/useSubscribersPaged';
import { computeNextActionChip, chipToneClasses } from '@/lib/financialPosition';
import { CollectPaymentDialog } from '@/components/CollectPaymentDialog';
import type { Subscriber } from '@/hooks/useSubscribers';

interface SubscriberListProps {
  onSelectSubscriber: (id: string) => void;
  onAddNew: () => void;
  onExport: () => void;
  onImport: () => void;
  onManagePacks: () => void;
  onManageRegions: () => void;
  onManageProviders: () => void;
  onManageStbs: () => void;
  /** Bumped by the parent (e.g. after import) to force refetch. */
  refreshKey?: number;
}

const PAGE_SIZE = 50;

/**
 * SubscriberList (Batch B rewrite).
 *
 * Server-paginated, URL-bound filters, DataTable-based rows with inline
 * primary actions (Collect / Renew) and an overflow menu for less-frequent
 * ones. Replaces the card grid + client-side filter loop.
 */
export const SubscriberList = ({
  onSelectSubscriber,
  onAddNew,
  onExport,
  onImport,
  onManagePacks,
  onManageRegions,
  onManageProviders,
  onManageStbs,
  refreshKey = 0,
}: SubscriberListProps) => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { regions } = useRegions(user?.id);
  const [params, setParams] = useSearchParams();

  const search = params.get('q') ?? '';
  const service = (params.get('service') ?? 'all') as ServiceFilter;
  const region = params.get('region') ?? 'all';
  const status = (params.get('status') ?? 'active') as StatusFilter;
  const balance = (params.get('balance') ?? 'all') as BalanceFilter;
  const page = Math.max(1, Number(params.get('page') ?? '1'));

  const setParam = (key: string, value: string | null, resetPage = true) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '' || (key !== 'q' && value === 'all')) next.delete(key);
    else next.set(key, value);
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };
  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete('page');
    else next.set('page', String(p));
    setParams(next, { replace: true });
  };

  const { rows, total, loading } = useSubscribersPaged({
    userId: user?.id,
    search,
    service,
    region,
    status,
    balance,
    page,
    pageSize: PAGE_SIZE,
    refreshKey,
  });

  const [collect, setCollect] = useState<{
    sub: Subscriber;
    service: 'cable' | 'internet';
    balance: number;
  } | null>(null);

  const columns: DataTableColumn<Subscriber>[] = useMemo(() => {
    const cols: DataTableColumn<Subscriber>[] = [
      {
        id: 'who',
        header: 'Subscriber',
        cell: (s) => (
          <div className="min-w-0">
            <div className="font-medium truncate">{s.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              <span className="font-mono">{(s as any).subscriber_id}</span>
              {s.mobile ? ` · ${s.mobile}` : ''}
              {s.region ? ` · ${s.region}` : ''}
            </div>
          </div>
        ),
      },
      {
        id: 'services',
        header: 'Services',
        hideBelow: 'sm',
        cell: (s) => {
          const services: string[] = (s as any).services || ['cable'];
          const hasCable = cableEnabled && services.includes('cable');
          const hasInternet = internetEnabled && services.includes('internet');
          return (
            <div className="flex gap-1">
              {hasCable && (
                <Badge variant="secondary" className="gap-1 h-5 text-[10px]">
                  <Tv className="h-3 w-3" /> Cable
                </Badge>
              )}
              {hasInternet && (
                <Badge variant="secondary" className="gap-1 h-5 text-[10px]">
                  <Wifi className="h-3 w-3" /> Net
                </Badge>
              )}
              {!hasCable && !hasInternet && (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      {
        id: 'action',
        header: 'Next action',
        hideBelow: 'md',
        cell: (s) => {
          const chip = computeNextActionChip(s);
          return (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${chipToneClasses(chip.tone)}`}
            >
              <span aria-hidden>{chip.icon}</span>
              {chip.label}
            </span>
          );
        },
      },
      {
        id: 'balance',
        header: 'Balance',
        align: 'right',
        cell: (s) => {
          const cable = Number((s as any).cable_balance || 0);
          const net = Number((s as any).internet_balance || 0);
          const total = cable + net;
          if (total === 0) return <span className="text-muted-foreground text-sm">—</span>;
          return (
            <Money
              value={total}
              className={total > 0 ? 'text-destructive font-semibold' : 'text-success font-medium'}
            />
          );
        },
      },
    ];
    return cols;
  }, [cableEnabled, internetEnabled]);

  const rowActions = (s: Subscriber) => {
    const cable = Number((s as any).cable_balance || 0);
    const net = Number((s as any).internet_balance || 0);
    const owedService: 'cable' | 'internet' | null = cable > 0 ? 'cable' : net > 0 ? 'internet' : null;

    // Renew hint: any active sub expiring within 7d
    const actives = [
      ...((s as any)._activeCable ?? []),
      ...((s as any)._activeInternet ?? []),
    ];
    const expiringSoon = actives.some((a: any) => {
      if (!a?.endDate) return false;
      const days = Math.ceil((new Date(a.endDate).getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 7;
    });

    return (
      <div className="flex items-center gap-1 justify-end">
        {owedService && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() =>
              setCollect({
                sub: s,
                service: owedService,
                balance: owedService === 'cable' ? cable : net,
              })
            }
          >
            <Wallet className="h-3.5 w-3.5 mr-1" /> Collect
          </Button>
        )}
        {!owedService && expiringSoon && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => onSelectSubscriber((s as any).subscriber_id)}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Renew
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onSelectSubscriber((s as any).subscriber_id)}>
              <ExternalLink className="h-4 w-4 mr-2" /> Open profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelectSubscriber((s as any).subscriber_id)}>
              View ledger
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSelectSubscriber((s as any).subscriber_id)}>
              Edit identity
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelectSubscriber((s as any).subscriber_id)}>
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="Search, filter, and collect. Server-paginated for large operator books."
        actions={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Settings2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Manage</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Catalog</DropdownMenuLabel>
                <DropdownMenuItem onClick={onManagePacks}>
                  <Package className="h-4 w-4 mr-2" /> Packs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onManageRegions}>
                  <MapPin className="h-4 w-4 mr-2" /> Regions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onManageProviders}>
                  <Building className="h-4 w-4 mr-2" /> Providers
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Inventory</DropdownMenuLabel>
                <DropdownMenuItem onClick={onManageStbs}>
                  {internetEnabled && !cableEnabled ? (
                    <><Wifi className="h-4 w-4 mr-2" /> ONU / Router Inventory</>
                  ) : bothEnabled ? (
                    <><HardDrive className="h-4 w-4 mr-2" /> Device Inventory</>
                  ) : (
                    <><Tv className="h-4 w-4 mr-2" /> STB Inventory</>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Data</DropdownMenuLabel>
                <DropdownMenuItem onClick={onImport}>
                  <Upload className="h-4 w-4 mr-2" /> Import
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onExport}>
                  <Download className="h-4 w-4 mr-2" /> Export
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={onAddNew} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Subscriber
            </Button>
          </div>
        }
      />

      <Toolbar
        searchValue={search}
        onSearchChange={(v) => setParam('q', v)}
        searchPlaceholder="Search by name, mobile, subscriber ID, or STB…"
        filters={
          <>
            {bothEnabled && (
              <Select value={service} onValueChange={(v) => setParam('service', v)}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Service" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  <SelectItem value="cable">Cable</SelectItem>
                  <SelectItem value="internet">Internet</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={region} onValueChange={(v) => setParam('region', v)}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Region" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setParam('status', v)}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="prospect">Prospect</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={balance} onValueChange={(v) => setParam('balance', v)}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Balance" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any balance</SelectItem>
                <SelectItem value="dues">Has dues</SelectItem>
                <SelectItem value="credit">Has credit</SelectItem>
                <SelectItem value="settled">Settled</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        className="mb-4"
      />

      <SectionCard padded={false}>
        <DataTable
          rows={rows}
          rowKey={(s) => s.id}
          columns={columns}
          loading={loading}
          onRowClick={(s) => onSelectSubscriber((s as any).subscriber_id)}
          rowActions={rowActions}
          empty={
            <EmptyState
              title="No subscribers match"
              description={
                search || service !== 'all' || region !== 'all' || balance !== 'all' || status !== 'active'
                  ? 'Try clearing filters or searching a different term.'
                  : 'Add your first subscriber to get started.'
              }
            />
          }
        />
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          label="subscribers"
          onPageChange={setPage}
        />
      </SectionCard>

      {collect && (
        <CollectPaymentDialog
          open={!!collect}
          onOpenChange={(o) => { if (!o) setCollect(null); }}
          subscriberId={collect.sub.id}
          subscriberName={collect.sub.name}
          service={collect.service}
          serviceBalance={collect.balance}
          onCollected={() => setCollect(null)}
        />
      )}
    </>
  );
};
