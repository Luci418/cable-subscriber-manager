import { Link } from 'react-router-dom';
import { Search, Tv, Wallet, Wifi } from 'lucide-react';
import {
  SectionCard,
  DataTable,
  EmptyState,
  Toolbar,
  Money,
  Pagination,
  type DataTableColumn,
} from '@/components/ui-ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusChip } from './StatusChip';
import type { ServiceLine, ServiceFilter, StatusFilter } from './types';

const PAGE_SIZE = 25;

export const ServiceLinesTable = ({
  rows,
  bothEnabled,
  service,
  status,
  query,
  page,
  onPageChange,
  onServiceChange,
  onStatusChange,
  onQueryChange,
  onCollect,
}: {
  rows: ServiceLine[];
  bothEnabled: boolean;
  service: ServiceFilter;
  status: StatusFilter;
  query: string;
  page: number;
  onPageChange: (p: number) => void;
  onServiceChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onQueryChange: (v: string) => void;
  onCollect: (line: ServiceLine) => void;
}) => {
  const columns: DataTableColumn<ServiceLine>[] = [
    {
      id: 'subscriber',
      header: 'Subscriber',
      cell: (l) => (
        <div className="min-w-0">
          <Link
            to={`/customers/${(l.subscriber as any).subscriber_id ?? l.subscriber.id}`}
            className="font-medium hover:underline truncate block max-w-[220px]"
          >
            {l.subscriber.name}
          </Link>
          <div className="text-xs text-muted-foreground font-mono">
            {(l.subscriber as any).subscriber_id ?? l.subscriber.mobile}
          </div>
        </div>
      ),
    },
    ...(bothEnabled
      ? [
          {
            id: 'service',
            header: 'Service',
            cell: (l: ServiceLine) => (
              <Badge variant="outline" className="gap-1">
                {l.service === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {l.service === 'internet' ? 'Internet' : 'Cable'}
              </Badge>
            ),
            hideBelow: 'sm' as const,
          },
        ]
      : []),
    {
      id: 'pack',
      header: 'Pack',
      cell: (l) => <span className="text-sm">{l.pack ?? '—'}</span>,
      hideBelow: 'md',
    },
    {
      id: 'endDate',
      header: 'Ends',
      cell: (l) =>
        l.sub?.endDate ? (
          <span className="text-xs tabular-nums">
            {new Date(l.sub.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      hideBelow: 'md',
    },
    { id: 'status', header: 'Status', cell: (l) => <StatusChip line={l} /> },
    {
      id: 'balance',
      header: 'Balance',
      cell: (l) => (
        <Money
          value={l.balance}
          className={l.balance > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}
        />
      ),
      align: 'right',
    },
  ];

  return (
    <SectionCard title="All service lines" padded={false}>
      <Toolbar
        searchValue={query}
        onSearchChange={onQueryChange}
        searchPlaceholder="Search name, mobile, ID, pack…"
        filters={
          <>
            {bothEnabled && (
              <Select value={service} onValueChange={onServiceChange}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  <SelectItem value="cable">Cable</SelectItem>
                  <SelectItem value="internet">Internet</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={status} onValueChange={onStatusChange}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="expiring">Expiring ≤7d</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title="No matching service lines"
          description="Adjust the filters or search to see other lines."
        />
      ) : (
        <>
          <DataTable
            rows={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
            rowKey={(l) => l.key}
            columns={columns}
            rowActions={(l) =>
              l.balance > 0 ? (
                <Button size="sm" variant="outline" onClick={() => onCollect(l)}>
                  <Wallet className="h-3.5 w-3.5 mr-1" /> Collect
                </Button>
              ) : null
            }
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={rows.length}
            label="service lines"
            onPageChange={onPageChange}
          />
        </>
      )}
    </SectionCard>
  );
};
