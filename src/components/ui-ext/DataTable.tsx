import { ReactNode, Key } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  align?: 'left' | 'right' | 'center';
  hideBelow?: 'sm' | 'md' | 'lg';
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
  /** Right-aligned per-row slot for primary action + overflow */
  rowActions?: (row: T) => ReactNode;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' };
const hideClass = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

/**
 * DataTable — one table style for the whole app.
 *
 * - Sticky, quiet header
 * - Row hover, no zebra
 * - Row click navigates (usually to a detail page); rowActions gives dedicated
 *   per-row buttons + overflow menu so operators don't hunt through a menu
 *   for the most common actions.
 * - Built-in loading + empty states.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  className,
  rowActions,
}: DataTableProps<T>) {
  return (
    <div className={cn('rounded-lg border border-border bg-card shadow-xs overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    'px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide',
                    alignClass[col.align ?? 'left'],
                    col.hideBelow && hideClass[col.hideBelow],
                    col.headerClassName,
                  )}
                >
                  {col.header}
                </th>
              ))}
              {rowActions && <th className="px-4 py-2.5 w-1" />}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length + (rowActions ? 1 : 0)} className="p-8">
                  <div className="flex justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (rowActions ? 1 : 0)}>{empty}</td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border last:border-0 transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-accent/40',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-4 py-3 align-middle',
                        alignClass[col.align ?? 'left'],
                        col.hideBelow && hideClass[col.hideBelow],
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                  {rowActions && (
                    <td
                      className="px-4 py-3 align-middle text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
