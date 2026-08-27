import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ShareBar } from './AnalyticsPrimitives';

export interface RankedItem {
  id: string;
  label: string;
  sub?: string;
  value: string;
  /** Raw number used for the share bar. */
  raw: number;
  to?: string;
  tone?: 'danger' | 'success';
}

/**
 * A short, scannable top-N list. Five rows by default, with an optional
 * "see all" that jumps to the tab holding the full table.
 */
export const RankedList = ({
  title,
  description,
  items,
  empty = 'Nothing here yet',
  onSeeAll,
  seeAllLabel = 'See all',
  limit = 5,
}: {
  title: string;
  description?: string;
  items: RankedItem[];
  empty?: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  limit?: number;
}) => {
  const max = items.reduce((m, i) => Math.max(m, Math.abs(i.raw)), 0);
  const visible = items.slice(0, limit);

  return (
    <section className="rounded-lg border border-border bg-card animate-fade-in">
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((item, i) => {
            const row = (
              <div className="px-4 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="truncate text-sm">{item.label}</span>
                    {item.sub && <span className="truncate text-xs text-muted-foreground">{item.sub}</span>}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-medium tabular-nums',
                      item.tone === 'danger' && 'text-destructive',
                      item.tone === 'success' && 'text-success',
                    )}
                  >
                    {item.value}
                  </span>
                </div>
                <div className="mt-1.5 pl-6">
                  <ShareBar value={Math.abs(item.raw)} max={max} />
                </div>
              </div>
            );
            return (
              <li key={item.id} className="transition-colors hover:bg-accent/40">
                {item.to ? <Link to={item.to} className="block">{row}</Link> : row}
              </li>
            );
          })}
        </ul>
      )}
      {onSeeAll && items.length > limit && (
        <button
          onClick={onSeeAll}
          className="w-full border-t border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40"
        >
          {seeAllLabel}
        </button>
      )}
    </section>
  );
};
