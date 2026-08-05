/**
 * Phase 5/6 — Provider import review screen.
 *
 * Pipeline: pick file → parse → load committed baseline + lookup tables →
 * diff (Phase 3) → resolve (Phase 4) → render → **commit (Phase 6)**.
 *
 * Write model (decision 2026-08-05):
 *  - Parsing a file inserts ONE `provider_import_runs` row with
 *    `status='draft'`. This is the single intentional exception to "review is
 *    dry-run"; it exists so an abandoned review is visible and so Phase 6
 *    commits an *existing* run rather than inventing one.
 *  - Everything else the operator does in review (amounts, acknowledgements,
 *    links, queued prospects, pack mappings) stays in local state and is
 *    written to the draft row only on an **explicit "Save draft"** action —
 *    not on every keystroke. Chosen over autosave because a 400-row report
 *    with live inputs would otherwise fire a write per character.
 *  - Cancelling marks the run `status='cancelled'`. The Phase 3 baseline query
 *    only ever reads `status='committed'`, so neither a draft nor a cancelled
 *    run can become a baseline (INV-48).
 *  - Approve calls `commit_provider_import(run_id, decisions)`, which flips the
 *    same draft row to `committed`. Insert-only for the ledger (INV-46/47).
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, FileUp, Loader2, RotateCcw, Save, Search } from 'lucide-react';

import { PageHeader, SectionCard, EmptyState } from '@/components/ui-ext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SubscriberCombobox, type SubscriberComboboxValue } from '@/components/ui-ext/SubscriberCombobox';
import { ResolvedRowCard, BUCKET_LABELS } from '@/components/providers/ResolvedRowCard';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/lib/permissions';
import { useProviders } from '@/hooks/useProviders';
import { usePacks } from '@/hooks/usePacks';
import { parseCustomerMaster } from '@/lib/providers/hathway/parseCustomerMaster';
import { detectEvents } from '@/lib/providers/diffEngine';
import {
  resolveEvents,
  normKey,
  type ResolutionBucket,
  type ResolvedRow,
} from '@/lib/providers/resolution';
import { loadReviewContext, type ReviewContext } from '@/lib/providers/loadResolutionContext';
import type { ParseError, ProviderReportRow } from '@/lib/providers/hathway/types';

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

/** Rows rendered per bucket before "show all" — keeps a 400-row file snappy. */
const PAGE = 40;

interface ReviewState {
  runId: string;
  fileName: string;
  parsedRows: ProviderReportRow[];
  rows: ResolvedRow[];
  counts: Record<ResolutionBucket, number>;
  unmappedKeys: string[];
  parseErrors: ParseError[];
  ctx: ReviewContext;
}

export default function ProviderImport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canSyncProvider, loading: permsLoading } = usePermissions();
  const { providers } = useProviders(user?.id);
  const { packs } = usePacks(user?.id);

  const cableProviders = useMemo(
    () => providers.filter((p) => p.service_type === 'cable' && p.is_active),
    [providers],
  );
  const cablePacks = useMemo(
    () => packs.filter((p) => (p.service_type ?? 'cable') === 'cable' && p.is_active !== false),
    [packs],
  );

  const [providerId, setProviderId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [prospects, setProspects] = useState<Record<string, boolean>>({});
  const [links, setLinks] = useState<Record<string, SubscriberComboboxValue>>({});
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkPick, setLinkPick] = useState<SubscriberComboboxValue | null>(null);
  const [mapTarget, setMapTarget] = useState<{ key: string; label: string } | null>(null);
  const [mapPick, setMapPick] = useState<string>('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const clearLocal = () => {
    setReview(null);
    setAmounts({});
    setAcked({});
    setProspects({});
    setLinks({});
    setQuery('');
    setExpanded({});
  };

  const cancelReview = async () => {
    const runId = review?.runId;
    clearLocal();
    if (runId) {
      const { error } = await (supabase as any).rpc('cancel_provider_import', { p_run_id: runId });
      if (error) toast.error('Review closed, but the draft could not be marked cancelled');
      else toast.success('Review cancelled — nothing was written');
    }
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

        // The one intentional write in the review flow: persist the draft run.
        const { data: run, error: runErr } = await (supabase as any)
          .from('provider_import_runs')
          .insert({
            user_id: user!.id,
            provider_id: providerId,
            report_type: 'customer_master',
            file_name: file.name,
            status: 'draft',
            row_count: parsed.rows.length,
            snapshot_data: parsed.rows,
            events_detected: events,
            results: {},
            imported_by: user!.id,
          })
          .select('id')
          .single();
        if (runErr) throw runErr;

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
        setQuery('');
        setExpanded({});
        setReview({
          runId: run.id as string,
          fileName: file.name,
          parsedRows: parsed.rows,
          rows: resolved.rows,
          counts: resolved.counts,
          unmappedKeys: resolved.unmapped_pack_keys,
          parseErrors: parsed.errors,
          ctx,
        });
        toast.success(`Parsed ${parsed.rows.length} rows — draft saved, nothing posted yet`);
      } catch (err) {
        console.error('[provider-import]', err);
        toast.error('Could not read this report');
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  /** Effective subscriber for a row: operator link wins over the auto-match. */
  const effectiveSubscriberId = useCallback(
    (r: ResolvedRow) => links[r.key]?.id ?? (r.match.status === 'matched' ? r.match.subscriber_id : null),
    [links],
  );

  /**
   * Tier-3 hygiene check (display-only): matched by account number, but the
   * hardware named on this report isn't paired to that customer locally.
   */
  const deviceMismatch = useCallback(
    (r: ResolvedRow) => {
      if (r.match.status !== 'matched' || r.match.method !== 'account_number') return false;
      const reported = [normKey(r.event.current.vc_id), normKey(r.event.current.stb_no)].filter(
        Boolean,
      ) as string[];
      if (reported.length === 0) return false;
      const local = review?.ctx.deviceKeysBySubscriber[r.match.subscriber_id!] ?? [];
      return !reported.some((k) => local.includes(k));
    },
    [review],
  );

  const buildDecisions = () =>
    (review?.rows ?? [])
      .filter((r) => {
        if (r.bucket === 'anomaly' && !acked[r.key]) return false;
        const sid = effectiveSubscriberId(r);
        const willCreate = !sid && prospects[r.key];
        if (!sid && !willCreate) return false;
        return r.writes.charge || r.writes.plan_state || r.writes.provider_status || willCreate || !!links[r.key];
      })
      .map((r) => {
        const sid = effectiveSubscriberId(r);
        const c = r.event.current;
        const linkedNow = !!links[r.key];
        return {
          key: r.key,
          subscriber_id: sid,
          create_prospect: !sid && !!prospects[r.key],
          customer_name: c.customer_name,
          mobile: c.mobile,
          account_number: c.account_number,
          base_plan: c.base_plan,
          start_date: c.start_date,
          end_date: c.end_date,
          service_status: c.service_status,
          // A row the operator just linked/created had every write zeroed by
          // the Phase 4 circuit-breaker (it was unlinked at resolve time).
          // The mirror write is safe and expected; the charge is not
          // re-derived here — only rows the engine already proposed carry one.
          charge: r.writes.charge && !!sid,
          amount: r.writes.charge ? (Number.isFinite(amounts[r.key]) ? amounts[r.key] : 0) : 0,
          plan_state: r.writes.plan_state || (linkedNow && r.ctxPlanState !== false),
          provider_status: r.writes.provider_status || linkedNow || (!sid && !!prospects[r.key]),
        };
      });

  const saveDraft = async () => {
    if (!review) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from('provider_import_runs')
      .update({
        results: {
          draft: true,
          saved_at: new Date().toISOString(),
          decisions: buildDecisions(),
        },
      })
      .eq('id', review.runId);
    setSaving(false);
    if (error) toast.error('Could not save the draft');
    else toast.success('Draft saved');
  };

  const approve = async () => {
    if (!review) return;
    setCommitting(true);
    const { data, error } = await (supabase as any).rpc('commit_provider_import', {
      p_run_id: review.runId,
      p_decisions: buildDecisions(),
    });
    setCommitting(false);
    if (error) {
      toast.error(error.message || 'Commit failed');
      return;
    }
    toast.success(
      `Committed — ${data?.charges_created ?? 0} charges (₹${Number(data?.total_charged ?? 0).toFixed(2)}), ` +
        `${data?.states_updated ?? 0} upstream records, ${data?.prospects_created ?? 0} new customers` +
        (data?.errors ? `, ${data.errors} rows failed` : ''),
    );
    clearLocal();
  };

  const mapPack = async () => {
    if (!review || !mapTarget || !mapPick) return;
    const { error } = await (supabase as any).from('provider_pack_mappings').upsert(
      {
        user_id: user!.id,
        provider_id: providerId,
        provider_plan_key: mapTarget.key,
        provider_plan_label: mapTarget.label,
        pack_id: mapPick,
      },
      { onConflict: 'user_id,provider_id,provider_plan_key' },
    );
    if (error) {
      toast.error('Could not save the mapping');
      return;
    }
    // Re-resolve locally against the updated mapping table — pure, no refetch.
    const ctx: ReviewContext = {
      ...review.ctx,
      packIdByProviderKey: { ...review.ctx.packIdByProviderKey, [mapTarget.key]: mapPick },
    };
    const { events } = detectEvents(ctx.baseline, review.parsedRows);
    const resolved = resolveEvents(events, ctx);
    setAmounts((prev) => {
      const next = { ...prev };
      for (const r of resolved.rows) {
        if (r.writes.charge && r.pack.pack_id && next[r.key] === undefined) {
          next[r.key] = ctx.packById[r.pack.pack_id]?.price ?? 0;
        }
      }
      return next;
    });
    setReview({
      ...review,
      ctx,
      rows: resolved.rows,
      counts: resolved.counts,
      unmappedKeys: resolved.unmapped_pack_keys,
    });
    setMapTarget(null);
    setMapPick('');
    toast.success('Plan mapped — rows re-evaluated');
  };

  const matches = useCallback(
    (r: ResolvedRow) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const c = r.event.current;
      return [c.customer_name, c.vc_id, c.stb_no, c.account_number, c.mobile]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    },
    [query],
  );

  const visibleRows = useMemo(() => (review?.rows ?? []).filter(matches), [review, matches]);

  const chargingRows = (review?.rows ?? []).filter(
    (r) => r.writes.charge && (r.bucket !== 'anomaly' || acked[r.key]),
  );
  const totalCharges = chargingRows.reduce((sum, r) => {
    const v = amounts[r.key];
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
  const unackedAnomalies = (review?.counts.anomaly ?? 0)
    - (review?.rows.filter((r) => r.bucket === 'anomaly' && acked[r.key]).length ?? 0);

  if (!permsLoading && !canSyncProvider) {
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
        description="Upload a Customer Master report to preview what sync would do. Nothing is posted until you approve."
        actions={
          review && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={saveDraft} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save draft
              </Button>
              <Button variant="outline" onClick={cancelReview}>
                <RotateCcw className="mr-2 h-4 w-4" /> Cancel review
              </Button>
            </div>
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
                Unmapped plans: {review.unmappedKeys.join(', ')} — use “Map this plan” on any affected row.
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

          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, VC id, STB serial, account number or mobile…"
              className="pl-9"
            />
          </div>
          {query.trim() && (
            <p className="mt-2 text-xs text-muted-foreground">
              {visibleRows.length} of {review.rows.length} rows match.
            </p>
          )}

          <div className="mt-6 space-y-6">
            {BUCKET_ORDER.filter((b) => review.counts[b] > 0).map((bucket) => {
              const all = visibleRows.filter((r) => r.bucket === bucket);
              if (all.length === 0) return null;
              const showAll = expanded[bucket] || all.length <= PAGE;
              const rows = showAll ? all : all.slice(0, PAGE);
              const body = (
                <div className="space-y-3">
                  {rows.map((r) => (
                    <ResolvedRowCard
                      key={r.key}
                      row={r}
                      subscriberLabelById={review.ctx.subscriberLabelById}
                      packLabel={r.pack.pack_id ? review.ctx.packById[r.pack.pack_id]?.name : undefined}
                      amount={amounts[r.key]}
                      onAmountChange={(v) => setAmounts((a) => ({ ...a, [r.key]: v }))}
                      acknowledged={acked[r.key]}
                      onAcknowledge={(v) => setAcked((a) => ({ ...a, [r.key]: v }))}
                      allowCreateProspect={review.ctx.policy.create_prospects}
                      linkedLabel={
                        links[r.key] ? `${links[r.key].name} · ${links[r.key].subscriber_id}` : undefined
                      }
                      prospectQueued={!!prospects[r.key]}
                      deviceMismatch={deviceMismatch(r)}
                      onLinkCustomer={() => { setLinkPick(links[r.key] ?? null); setLinkTarget(r.key); }}
                      onCreateProspect={() =>
                        setProspects((p) => ({ ...p, [r.key]: !p[r.key] }))
                      }
                      onMapPack={
                        r.pack.provider_pack_key
                          ? () => {
                              setMapPick('');
                              setMapTarget({
                                key: r.pack.provider_pack_key!,
                                label: r.event.current.base_plan ?? r.pack.provider_pack_key!,
                              });
                            }
                          : undefined
                      }
                    />
                  ))}
                  {!showAll && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setExpanded((e) => ({ ...e, [bucket]: true }))}
                    >
                      Show the remaining {all.length - PAGE} rows
                    </Button>
                  )}
                </div>
              );

              if (bucket === 'no_change') {
                return (
                  <Collapsible key={bucket}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span>{BUCKET_LABELS[bucket]} · {all.length} rows identical to baseline</span>
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
                  title={`${BUCKET_LABELS[bucket]} · ${all.length}`}
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
              <Button variant="outline" onClick={cancelReview}>Cancel</Button>
              <Button onClick={approve} disabled={committing}>
                {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {committing ? 'Committing…' : 'Approve & post'}
              </Button>
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
                  setProspects((p) => ({ ...p, [linkTarget]: false }));
                  toast.success('Linked for this review — applied on approve');
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

      <Dialog open={!!mapTarget} onOpenChange={(o) => !o && setMapTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map “{mapTarget?.label}”</DialogTitle>
            <DialogDescription>
              Pick the local pack this provider plan corresponds to. The mapping is
              saved for this provider and every affected row is re-evaluated.
            </DialogDescription>
          </DialogHeader>
          <Select value={mapPick} onValueChange={setMapPick}>
            <SelectTrigger><SelectValue placeholder="Select a pack" /></SelectTrigger>
            <SelectContent>
              {cablePacks.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · ₹{Number(p.price).toFixed(2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMapTarget(null)}>Cancel</Button>
            <Button onClick={mapPack} disabled={!mapPick}>Save mapping</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
