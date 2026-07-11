import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — standard top-of-page block used by every route.
 *
 * Slots: back button (optional), title, description, breadcrumbs, actions.
 * Keeps type-scale + spacing consistent so future modules inherit for free.
 */
interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  back?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, breadcrumbs, back, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-6 sm:mb-8', className)}>
      {breadcrumbs && <div className="mb-2 text-sm text-muted-foreground">{breadcrumbs}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex items-start gap-3 min-w-0">
          {back}
          <div className="min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl tracking-tight text-foreground leading-tight truncate">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
