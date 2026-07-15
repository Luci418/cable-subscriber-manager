import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string; // singular noun for total, e.g. "subscribers"
  className?: string;
}

/**
 * Pagination — shared prev/next control with count summary.
 *
 * Used by the customer list (server-paginated) and the billing worklist
 * (client-paginated). Keeps the pager consistent across the app.
 */
export function Pagination({ page, pageSize, total, onPageChange, label = 'rows', className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-xs text-muted-foreground', className)}>
      <div>
        {total === 0
          ? `0 ${label}`
          : `Showing ${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} ${label}`}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-7 px-2"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline ml-1">Prev</span>
        </Button>
        <span className="tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-7 px-2"
        >
          <span className="hidden sm:inline mr-1">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
