import { ReactNode } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * When present, EmptyState renders as an error state (destructive icon +
   * "Retry" button that calls this function). Pages should pass this when a
   * data load fails so operators can recover without refreshing the browser.
   */
  onRetry?: () => void;
  variant?: 'default' | 'error';
}

/**
 * EmptyState — every list/table must render this when it has no rows.
 * Consistent copy pattern: "No X yet" + short helper + primary action.
 *
 * Error variant: pass `variant="error"` and `onRetry` when a fetch fails.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  onRetry,
  variant,
}: EmptyStateProps) {
  const isError = variant === 'error' || !!onRetry;
  const resolvedIcon = icon ?? (isError ? <AlertCircle className="h-5 w-5" /> : null);
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-16 px-6',
        className,
      )}
    >
      {resolvedIcon && (
        <div
          className={cn(
            'h-12 w-12 rounded-full flex items-center justify-center mb-4',
            isError
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {resolvedIcon}
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      )}
      {(action || onRetry) && (
        <div className="mt-4 flex items-center gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

