/**
 * Import history — every provider import run, newest first.
 *
 * Drafts and cancelled reviews are listed too (greyed): an abandoned review
 * should be visible, not invisible. Committed runs link through to the
 * per-customer breakdown.
 */

import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, FileUp, Loader2 } from 'lucide-react';

import { PageHeader, SectionCard, EmptyState, Money } from '@/components/ui-ext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/lib/permissions';

interface RunListRow {
  id: string;
  file_name: string | null;
  status: string;
  row_count: number;
  imported_at: string;
  committed_at: string | null;
  results: Record<string, any> | null;
  provider: { name: string } | null;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  committed: 'default',
  draft: 'secondary',
  cancelled: 'outline',
};

export default function ImportRuns() {
  const navigate = useNavigate();
  const { canSyncProvider, loading: permsLoading } = usePermissions();
  const [runs, setRuns] = useState<RunListRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from('provider_import_runs')
        .select('id, file_name, status, row_count, imported_at, committed_at, results, provider:providers(name)')
        .order('imported_at', { ascending: false })
        .limit(100);
      if (!cancelled) {
        setRuns((data as RunListRow[]) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!permsLoading && !canSyncProvider) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState title="Not available" description="Provider sync is limited to owners and office admins." />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        back={
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings/integrations')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title="Import history"
        description="Every provider report reviewed in this account. Open a committed import to see exactly what it changed."
        actions={
          <Button asChild variant="outline">
            <Link to="/integrations/hathway">
              <FileUp className="mr-2 h-4 w-4" /> Import report
            </Link>
          </Button>
        }
      />

      <SectionCard title="Runs">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <EmptyState title="No imports yet" description="Nothing has been imported for any provider." />
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {runs.map((r) => {
              const res = (r.results ?? {}) as Record<string, any>;
              const committed = r.status === 'committed';
              const body = (
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">{r.file_name ?? 'Customer Master'}</span>
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'} className="capitalize">
                        {r.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.provider?.name ?? 'Provider'} ·{' '}
                      {new Date(r.committed_at ?? r.imported_at).toLocaleString()} · {r.row_count} rows
                      {committed && (
                        <>
                          {' · '}
                          {res.charges_created ?? 0} charges · {res.prospects_created ?? 0} new customers
                          {Number(res.errors ?? 0) > 0 && (
                            <span className="text-destructive"> · {res.errors} failed</span>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  {committed && (
                    <Money value={Number(res.total_charged ?? 0)} className="shrink-0 text-sm font-semibold" />
                  )}
                </div>
              );

              return committed ? (
                <Link
                  key={r.id}
                  to={`/integrations/hathway/runs/${r.id}`}
                  className="block hover:bg-accent/40 transition-colors"
                >
                  {body}
                </Link>
              ) : (
                <div key={r.id} className="opacity-70">
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
