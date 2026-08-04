/**
 * Phase 5 — Provider import review screen (dry-run, zero DB writes).
 *
 * Pipeline: pick file → parse → load committed baseline + lookup tables →
 * diff (Phase 3) → resolve (Phase 4) → render.
 *
 * Nothing here writes. Approve lands in Phase 6 and is deliberately disabled
 * with the reason shown, so an operator can dry-run a real report today and
 * walk away having changed nothing.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, FileUp, Loader2, RotateCcw } from 'lucide-react';

import { PageHeader, SectionCard, EmptyState } from '@/components/ui-ext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SubscriberCombobox, type SubscriberComboboxValue } from '@/components/ui-ext/SubscriberCombobox';
import { ResolvedRowCard, BUCKET_LABELS } from '@/components/providers/ResolvedRowCard';

import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/lib/permissions';
import { useProviders } from '@/hooks/useProviders';
import { parseCustomerMaster } from '@/lib/providers/hathway/parseCustomerMaster';
import { detectEvents } from '@/lib/providers/diffEngine';
import { resolveEvents, type ResolutionBucket, type ResolvedRow } from '@/lib/providers/resolution';
import { loadReviewContext, type ReviewContext } from '@/lib/providers/loadResolutionContext';
import type { ParseError } from '@/lib/providers/hathway/types';

/** Display order. `no_change` last — the only collapsible bucket. */
const BUCKET_ORDER: ResolutionBucket[] = [
  'needs_review',
  'anomaly',
  'unmapped_pack',
  'new_activation',
  'renewal',
  'plan_change',
  'status_change',
  'no_change',
];

interface ReviewState {
  fileName: string;
  rows: ResolvedRow[];
  counts: Record<ResolutionBucket, number>;
  unmappedKeys: string[];
  parseErrors: ParseError[];
  ctx: ReviewContext;
}

export default function ProviderImport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: permsLoading } = usePermissions();
  const { providers } = useProviders(user?.id);

  const cableProviders = useMemo(
    () => providers.filter((p) => p.service_type === 'cable' && p.is_active),
    [providers],
  );

  const [providerId, setProviderId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [prospects, setProspects] = useState<Record<string, boolean>>({});
  const [links, setLinks] = useState<Record<string, SubscriberComboboxValue>>({});
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkPick, setLinkPick] = useState<SubscriberComboboxValue | null>(null);

  const reset = () => {
    setReview(null);
    setAmounts({});
    setAcked({});
    setProspects({});
    setLinks({});
  };

  const runImport = () => {
    if (!providerId) {
      toast.error('Pick a provider first');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xls,.xlsx,.csv,.tsv,.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const text = await file.text();
        const parsed = parseCustomerMaster(text);
        if (parsed.rows.length === 0) {
          toast.error('No usable rows found in this file');
          return;
        }
        const ctx = await loadReviewContext(providerId, 'customer_master');
        const { events } = detectEvents(ctx.baseline, parsed.rows);
        const resolved = resolveEvents(events, ctx);

        const nextAmounts: Record<string, number> = {};
        for (const r of resolved.rows) {
          if (r.writes.charge && r.pack.pack_id) {
            nextAmounts[r.key] = ctx.packById[r.pack.pack_id]?.price ?? 0;
          }
        }
        setAmounts(nextAmounts);
        setAcked({});
        setProspects({});
        setLinks({});
        setReview({
          fileName: file.name,
          rows: resolved.rows,
          counts: resolved.counts,
          unmappedKeys: resolved.unmapped_pack_keys,
          parseErrors: parsed.errors,
          ctx,
        });
        toast.success(`Parsed ${parsed.rows.length} rows — nothing written yet`);
      } catch (err) {
        console.error('[provider-import]', err);
        toast.error('Could not read this report');
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  const chargingRows = review?.rows.filter((r) => r.writes.charge) ?? [];
  const totalCharges = chargingRows.reduce((sum, r) => sum + (amounts[r.key] ?? 0), 0);
  const unackedAnomalies = (review?.counts.anomaly ?? 0)
    - (review?.rows.filter((r) => r.bucket === 'anomaly' && acked[r.key]).length ?? 0);

  if (!permsLoading && !isAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState title="Not available" description="Provider sync is limited to owners and office admins." />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        back={
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings/integrations')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title="Hathway import"
        description="Upload a Customer Master report to preview what sync would do. Nothing is written until you approve."
        actions={
          review && (
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Cancel review
            </Button>
          )
        }
      />

      <SectionCard title="Report" description="Customer Master Summary (tab-separated .xls export).">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="text-xs text-muted-foreground">Provider</label>
            <Select value={providerId} onValueChange={setProviderId} disabled={!!review}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a cable provider" />
              </SelectTrigger>
              <SelectContent>
                {cableProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runImport} disabled={busy || !providerId || !!review}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            {busy ? 'Reading…' : 'Choose report'}
          </Button>
        </div>

        {review && (
          <div className="mt-4 text-sm text-muted-foreground space-y-1">
            <p><span className="text-foreground font-medium">{review.fileName}</span> · {review.rows.length} rows</p>
            <p>
              Baseline:{' '}
              {review.ctx.baselineImportedAt
                ? `last committed run of ${new Date(review.ctx.baselineImportedAt).toLocaleString()}`
                : 'none — every row reads as a new activation'}
            </p>
            {review.parseErrors.length > 0 && (
              <p className="text-destructive">{review.parseErrors.length} rows skipped as unreadable</p>
            )}
            {review.unmappedKeys.length > 0 && (
              <p className="text-destructive">
                Unmapped plans: {review.unmappedKeys.join(', ')}
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {review && (
        <>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BUCKET_ORDER.filter((b) => review.counts[b] > 0).map((b) => (
              <div key={b} className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">{BUCKET_LABELS[b]}</p>
                <p className="text-2xl font-semibold">{review.counts[b]}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 space-y-6">
            {BUCKET_ORDER.filter((b) => review.counts[b] > 0).map((bucket) => {
              const rows = review.rows.filter((r) => r.bucket === bucket);
              const body = (
                <div className="space-y-3">
                  {rows.map((r) => (
                    <ResolvedRowCard
                      key={r.key}
                      row={r}
                      subscriberLabelById={{
                        ...review.ctx.subscriberLabelById,
                        ...(links[r.key]
                          ? { [links[r.key].id]: `${links[r.key].name} · ${links[r.key].subscriber_id}` }
                          : {}),
                      }}
                      packLabel={r.pack.pack_id ? review.ctx.packById[r.pack.pack_id]?.name : undefined}
                      amount={amounts[r.key]}
                      onAmountChange={(v) => setAmounts((a) => ({ ...a, [r.key]: v }))}
                      acknowledged={acked[r.key]}
                      onAcknowledge={(v) => setAcked((a) => ({ ...a, [r.key]: v }))}
                      allowCreateProspect={review.ctx.policy.create_prospects}
                      onLinkCustomer={() => { setLinkPick(links[r.key] ?? null); setLinkTarget(r.key); }}
                      onCreateProspect={() => {
                        setProspects((p) => ({ ...p, [r.key]: true }));
                        toast.info('Queued as a new customer — created on approve (Phase 6)');
                      }}
                    />
                  ))}
                </div>
              );

              if (bucket === 'no_change') {
                return (
                  <Collapsible key={bucket}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span>{BUCKET_LABELS[bucket]} · {rows.length} rows identical to baseline</span>
                        <span className="text-xs text-muted-foreground">Show</span>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3">{body}</CollapsibleContent>
                  </Collapsible>
                );
              }

              return (
                <SectionCard
                  key={bucket}
                  title={`${BUCKET_LABELS[bucket]} · ${rows.length}`}
                  description={
                    bucket === 'anomaly'
                      ? 'Values changed with no business event. Writes are blocked; acknowledge each row individually.'
                      : bucket === 'needs_review'
                        ? 'No confirmed customer. Nothing here can be written until the identity is resolved.'
                        : undefined
                  }
                  bodyClassName="p-4"
                  padded={false}
                >
                  {body}
                </SectionCard>
              );
            })}
          </div>

          <div className="mt-6 sticky bottom-0 rounded-lg border border-border bg-card p-4 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Total charges to post</p>
              <p className="text-2xl font-semibold">₹{totalCharges.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">
                {chargingRows.length} rows · {unackedAnomalies} anomalies awaiting acknowledgement
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button disabled title="Commit lands in Phase 6">Approve (Phase 6)</Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!linkTarget} onOpenChange={(o) => !o && setLinkTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link this row to a customer</DialogTitle></DialogHeader>
          <SubscriberCombobox value={linkPick} onChange={setLinkPick} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (linkTarget && linkPick) {
                  setLinks((l) => ({ ...l, [linkTarget]: linkPick }));
                  toast.success('Linked for this review — applied on approve (Phase 6)');
                }
                setLinkTarget(null);
              }}
              disabled={!linkPick}
            >
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
