import { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Toolbar — sticky filter/search bar above lists.
 *
 * Layout: search grows, filters/actions dock right. Collapses cleanly on mobile.
 */
interface ToolbarProps {
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Toolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  actions,
  className,
}: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center rounded-lg border border-border bg-card p-2 shadow-xs',
        className,
      )}
    >
      {onSearchChange !== undefined && (
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 border-0 shadow-none focus-visible:ring-1 bg-transparent"
          />
        </div>
      )}
      {(filters || actions) && (
        <div className="flex items-center gap-2 flex-wrap">
          {filters}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}
