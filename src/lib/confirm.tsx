/**
 * Imperative confirm dialog — replaces native `window.confirm()` with a
 * shadcn AlertDialog so destructive actions look consistent with the rest
 * of the app (Archive, Cancel, Void, etc.).
 *
 * Usage:
 *   const ok = await confirm({
 *     title: 'Delete complaint?',
 *     description: 'This cannot be undone.',
 *     confirmText: 'Delete',
 *     destructive: true,
 *   });
 *   if (!ok) return;
 *
 * Mount <ConfirmHost /> once at the app root (already done in AppLayout).
 */
import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

type Resolver = (ok: boolean) => void;
type Listener = (opts: ConfirmOptions, resolve: Resolver) => void;

let listener: Listener | null = null;

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      // Fallback so the app never breaks if the host isn't mounted yet.
      resolve(window.confirm(`${opts.title}${opts.description ? '\n\n' + opts.description : ''}`));
      return;
    }
    listener(opts, resolve);
  });
}

export function ConfirmHost() {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: Resolver } | null>(null);

  useEffect(() => {
    listener = (opts, resolve) => setState({ opts, resolve });
    return () => { listener = null; };
  }, []);

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const opts = state?.opts;
  return (
    <AlertDialog open={!!state} onOpenChange={(o) => { if (!o) close(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description && (
            <AlertDialogDescription>{opts.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {opts?.cancelText ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            className={opts?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {opts?.confirmText ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
