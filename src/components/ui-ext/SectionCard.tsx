import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * SectionCard — bordered surface for grouping related content on a page.
 *
 * Prefer over raw <Card> when the section has a header/actions row. Keeps
 * padding and header rhythm consistent across the app.
 */
interface SectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}

export function SectionCard({
  title,
  description,
  actions,
  icon,
  children,
  className,
  bodyClassName,
  padded = true,
}: SectionCardProps) {
  const hasHeader = title || description || actions;
  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-xs',
        className,
      )}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="flex items-start gap-3 min-w-0">
            {icon && <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>}
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(padded && 'p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
