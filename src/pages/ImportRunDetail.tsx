/**
 * Import run detail — the record of what one committed import actually did.
 *
 * Read-only. Everything shown comes from the run itself (`results.rows`,
 * `snapshot_data`) joined against the customers and transactions those rows
 * reference. `results.rows[].frozen` carries the pack values as of commit
 * time (INV-51), so this page keeps telling the truth even if the pack is
 * later edited.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Search } from 'lucide-react';

import { PageHeader, SectionCard, StatCard, EmptyState, Money } from '@/components/ui-ext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImportRunRowCard } from '@/components/providers/ImportRunRowCard';

import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/lib/permissions';
import {
  buildRunReport,
  filterRunReport,
  type RunReport,
  type RunResults,
  type RunSubscriber,
  type RunTransaction,
} from '@/lib/providers/runReport';
import type { ProviderReportRow } from '@/lib/providers/hathway/types';

interface RunRow {
  id: string;
  file_name: string | null;
  report_type: string;
  status: string;
  row_count: number;
  imported_at: string;
  committed_at: string | null;
  parser_version: string | null;
  results: RunResults | null;
  snapshot_data: ProviderReportRow[] | null;
  provider: { name: string } | null;
  committer: { full_name: string | null; email: string } | null;
}

export default function ImportRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { canSyncProvider, loading: permsLoading } = usePermissions();

  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<RunRow | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!runId) return;
      setLoading(true);

      const { data, error } = await (supabase as any)
        .from('provider_import_runs')
        .select(
          'id, file_name, report_type, status, row_count, imported_at, committed_at, parser_version, results, snapshot_data, provider:providers(name), committer:profiles!provider_import_runs_committed_by_fkey(full_name, email)',
        )
        .eq('id', runId)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        setRun(null);
        setLoading(false);
        return;
      }

      const runRow = data as RunRow;
      const resultRows = runRow.results?.rows ?? [];
      const subIds = [...new Set(resultRows.map((r) => r.subscriber_id).filter(Boolean))] as string[];
      const txIds = [...new Set(resultRows.map((r) => r.transaction_id).filter(Boolean))] as string[];

      const [subsRes, txnRes] = await Promise.all([
        subIds.length
          ? supabase.from('subscribers').select('id, subscriber_id, name, created_at').in('id', subIds)
          : Promise.resolve({ data: [] as any[] }),
        txIds.length
          ? supabase.from('transactions').select('id, amount, date').in('id', txIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      if (cancelled) return;

      const subscribersById: Record<string, RunSubscriber> = {};
      ((subsRes as any).data ?? []).forEach((s: RunSubscriber) => (subscribersById[s.id] = s));
      const transactionsById: Record<string, RunTransaction> = {};
      ((txnRes as any).data ?? []).forEach((t: RunTransaction) => (transactionsById[t.id] = t));

      setRun(runRow);
      setReport(
        buildRunReport({
          results: runRow.results,
          snapshotRows: runRow.snapshot_data,
          subscribersById,
          transactionsById,
          committedAt: runRow.committed_at ?? runRow.imported_at,
        }),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const filtered = useMemo(() => (report ? filterRunReport(report, query) : null), [report, query]);

  if (!permsLoading && !canSyncProvider) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState title="Not available" description="Provider sync is limited to owners and office admins." />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          title="Import not found"
          description="This import run no longer exists."
          action={
            <Button variant="outline" onClick={() => navigate('/integrations/hathway/runs')}>
              Back to import history
            </Button>
          }
        />
      </div>
    );
  }

  const res = run.results ?? {};
  const when = new Date(run.committed_at ?? run.imported_at).toLocaleString();
  const who = run.committer?.full_name || run.committer?.email || null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        back={
          <Button variant="ghost" size="icon" onClick={() => navigate('/integrations/hathway/runs')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title={run.file_name ?? 'Customer Master'}
        description={
          `${run.provider?.name ?? 'Provider'} · ${when}` +
          (who ? ` · by ${who}` : '') +
          ` · ${run.row_count} rows` +
          (run.status !== 'committed' ? ` · ${run.status}` : '')
        }
      />

      {run.status !== 'committed' ? (
        <EmptyState
          title={run.status === 'draft' ? 'Not committed yet' : 'Import cancelled'}
          description={
            run.status === 'draft'
              ? 'This review was started but never approved, so nothing was posted.'
              : 'This review was cancelled. Nothing was posted.'
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total charged" value={<Money value={Number(res.total_charged ?? 0)} />} />
            <StatCard label="Charges posted" value={res.charges_created ?? 0} />
            <StatCard label="New customers" value={res.prospects_created ?? 0} />
            <StatCard
              label="Rows failed"
              value={res.errors ?? 0}
              hint={`${res.states_updated ?? 0} provider records updated`}
            />
          </div>

          <SectionCard
            title="Customers affected"
            description="Everything this import changed, grouped by what happened."
            actions={
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search customer or ID"
                  className="pl-8"
                />
              </div>
            }
          >
            {!filtered || filtered.groups.length === 0 ? (
              <EmptyState
                title={query ? 'No matches' : 'No changes recorded'}
                description={
                  query
                    ? 'No customer in this import matches your search.'
                    : 'This import committed without applying any changes.'
                }
              />
            ) : (
              <div className="space-y-4">
                {filtered.groups.map((g) => (
                  <Collapsible key={g.id} defaultOpen={g.id !== 'state_only'}>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 bg-muted/40 px-4 py-2.5 text-left hover:bg-muted/60">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {g.title}{' '}
                            <span className="text-muted-foreground font-normal">({g.rows.length})</span>
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{g.blurb}</p>
                        </div>
                        {g.total > 0 && <Money value={g.total} className="text-sm shrink-0" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="divide-y divide-border">
                          {g.rows.map((row) => (
                            <ImportRunRowCard key={`${g.id}-${row.key}`} row={row} />
                          ))}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
              </div>
            )}
          </SectionCard>

          <p className="text-xs text-muted-foreground">
            Parser {run.parser_version ?? '—'} ·{' '}
            <Link to="/integrations/hathway/runs" className="hover:underline">
              All imports
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
