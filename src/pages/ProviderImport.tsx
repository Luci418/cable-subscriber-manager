/**
 * Phase 5/6 — Provider import review screen.
 *
 * Pipeline: pick file → parse → load committed baseline + lookup tables →
 * diff (Phase 3) → resolve (Phase 4) → render → **commit (Phase 6)**.
 *
 * Re-derivation model (2026-08-06): every operator decision — link a
 * customer, queue a prospect, map a plan — changes the *context* and the
 * whole report is resolved again through `deriveReview`. Nothing patches a
 * resolved row by hand any more. That is what makes a just-linked row
 * eligible for a charge, which it never was while the flags were frozen at
 * parse time.
 *
 * Money model: the amount is not free-typed. A provider charge is a side
 * effect of `create_subscription` (BUSINESS_RULES §4.3), so the review shows
 * exactly what the server will post — the mapped pack's price × the number of
 * validity periods the reported window covers.
 *
 * Write model:
 *  - Parsing a file inserts ONE `provider_import_runs` row with
 *    `status='draft'`. This is the single intentional exception to "review is
 *    dry-run"; it exists so an abandoned review is visible and so Phase 6
 *    commits an *existing* run rather than inventing one.
 *  - Everything else stays in local state until an explicit "Save draft".
 *  - Cancelling marks the run `status='cancelled'`. The Phase 3 baseline query
 *    only ever reads `status='committed'` (INV-48).
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
import { useAppDataLazy } from '@/contexts/AppDataContext';
import { parseCustomerMaster, CUSTOMER_MASTER_PARSER_VERSION } from '@/lib/providers/hathway/parseCustomerMaster';
import { detectEvents } from '@/lib/providers/diffEngine';
import { normKey, type ResolutionBucket, type ResolvedRow } from '@/lib/providers/resolution';
import {
  deriveReview,
  chargePlan,
  renewalValidityMismatch,
  isProspectPlaceholder,
} from '@/lib/providers/reviewModel';
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
  parseErrors: ParseError[];
  /** The context as loaded from the DB. Operator decisions are layered on top. */
  baseCtx: ReviewContext;
}

export default function ProviderImport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canSyncProvider, loading: permsLoading } = usePermissions();
  const { providers } = useProviders(user?.id);
  const { packs } = usePacks(user?.id);
  const { invalidateAppData } = useAppDataLazy();

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
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [prospects, setProspects] = useState<Record<string, boolean>>({});
  const [links, setLinks] = useState<Record<string, SubscriberComboboxValue>>({});
  const [packOverrides, setPackOverrides] = useState<Record<string, string>>({});
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkPick, setLinkPick] = useState<SubscriberComboboxValue | null>(null);
  const [mapTarget, setMapTarget] = useState<{ key: string; label: string } | null>(null);
  const [mapPick, setMapPick] = useState<string>('');
  /**
   * Cross-provider mapping guard: a Hathway plan mapped to a pack owned by a
   * different provider silently rewrites the customer's recorded provider.
   * Warn — never block; some cross-provider mappings are legitimate.
   */
  const crossProviderPack = useMemo(() => {
    if (!mapPick) return null;
    const pack = packs.find((p) => p.id === mapPick);
    const packProviderId = (pack as { provider_id?: string | null } | undefined)?.provider_id ?? null;
    if (!pack || !packProviderId || !providerId || packProviderId === providerId) return null;
    return {
      pack: pack.name,
      packProvider: providers.find((p) => p.id === packProviderId)?.name ?? 'another provider',
      importProvider: providers.find((p) => p.id === providerId)?.name ?? 'this provider',
    };
  }, [mapPick, packs, providers, providerId]);

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /** The single source of truth for the screen. Recomputed on every decision. */
  const derived = useMemo(() => {
    if (!review) return null;
    const linkIds: Record<string, string> = {};
    for (const [k, v] of Object.entries(links)) linkIds[k] = v.id;
    return deriveReview(review.baseCtx, review.parsedRows, {
      links: linkIds,
      prospects,
      packOverrides,
    });
  }, [review, links, prospects, packOverrides]);

  const clearLocal = () => {
    setReview(null);
    setAcked({});
    setProspects({});
    setLinks({});
    setPackOverrides({});
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
        const baseCtx = await loadReviewContext(providerId, 'customer_master');
        const { events } = detectEvents(baseCtx.baseline, parsed.rows);

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
            parser_version: CUSTOMER_MASTER_PARSER_VERSION,
            results: {},
            imported_by: user!.id,
          })
          .select('id')
          .single();
        if (runErr) throw runErr;

        setAcked({});
        setProspects({});
        setLinks({});
        setPackOverrides({});
        setQuery('');
        setExpanded({});
        setReview({
          runId: run.id as string,
          fileName: file.name,
          parsedRows: parsed.rows,
          parseErrors: parsed.errors,
          baseCtx,
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

  const packFor = useCallback(
    (r: ResolvedRow) => (r.pack.pack_id ? derived?.ctx.packById[r.pack.pack_id] : undefined),
    [derived],
  );

  const planFor = useCallback(
    (r: ResolvedRow) =>
      r.writes.charge
        ? chargePlan(packFor(r), r.event.current.start_date, r.event.current.end_date)
        : null,
    [packFor],
  );

  /**
   * Hardware hygiene (display-only). Fires for a tier-3 (account number)
   * automatic match AND for a manual link — the real-world risk is identical:
   * the box Hathway reports isn't the box we have paired locally.
   */
  const deviceMismatch = useCallback(
    (r: ResolvedRow) => {
      const sid = r.match.status === 'matched' ? r.match.subscriber_id : null;
      if (!sid || isProspectPlaceholder(sid)) return false;
      const manual = !!links[r.key];
      if (!manual && r.match.method !== 'account_number') return false;
      const reported = [normKey(r.event.current.vc_id), normKey(r.event.current.stb_no)].filter(
        Boolean,
      ) as string[];
      if (reported.length === 0) return false;
      const local = review?.baseCtx.deviceKeysBySubscriber[sid] ?? [];
      return !reported.some((k) => local.includes(k));
    },
    [links, review],
  );

  const buildDecisions = useCallback(() => {
    if (!derived) return [];
    return derived.rows
      .filter((r) => {
        if (r.bucket === 'anomaly' && !acked[r.key]) return false;
        if (r.match.status !== 'matched') return false;
        return r.writes.charge || r.writes.plan_state || r.writes.provider_status;
      })
      .map((r) => {
        const sid = r.match.subscriber_id!;
        const isNew = isProspectPlaceholder(sid);
        const c = r.event.current;
        const plan = planFor(r);
        return {
          key: r.key,
          bucket: r.bucket,
          provider_plan_key: r.pack.provider_pack_key,
          subscriber_id: isNew ? null : sid,
          create_prospect: isNew,
          customer_name: c.customer_name,
          mobile: c.mobile,
          account_number: c.account_number,
          vc_id: c.vc_id,
          stb_no: c.stb_no,
          base_plan: c.base_plan,
          start_date: c.start_date,
          end_date: c.end_date,
          service_status: c.service_status,
          charge: r.writes.charge,
          pack_id: r.pack.pack_id,
          duration: plan?.duration ?? 1,
          amount: plan?.amount ?? 0,
          plan_state: r.writes.plan_state,
          provider_status: r.writes.provider_status,
        };
      });
  }, [derived, acked, planFor]);

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
    const byEvent = (data?.by_event ?? {}) as Record<string, number>;
    const breakdown = Object.entries(byEvent)
      .filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`)
      .join(', ');
    toast.success(
      `Committed — ₹${Number(data?.total_charged ?? 0).toFixed(2)} charged` +
        (breakdown ? ` · ${breakdown}` : '') +
        ` · ${data?.states_updated ?? 0} upstream records, ${data?.prospects_created ?? 0} new customers` +
        (data?.errors ? ` · ${data.errors} rows failed and will return for review` : ''),
    );
    // A commit creates customers, subscriptions and charges server-side, so
    // the shared snapshot is stale the moment it succeeds. Invalidate rather
    // than waiting for the 15s age-out (the operator clicks straight through
    // to a newly created customer).
    invalidateAppData();
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
    setPackOverrides((o) => ({ ...o, [mapTarget.key]: mapPick }));
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

  const visibleRows = useMemo(() => (derived?.rows ?? []).filter(matches), [derived, matches]);

  const chargingRows = (derived?.rows ?? []).filter(
    (r) => r.writes.charge && (r.bucket !== 'anomaly' || acked[r.key]),
  );
  const totalCharges = chargingRows.reduce((sum, r) => sum + (planFor(r)?.amount ?? 0), 0);
  const unackedAnomalies = (derived?.counts.anomaly ?? 0)
    - (derived?.rows.filter((r) => r.bucket === 'anomaly' && acked[r.key]).length ?? 0);

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

        {review && derived && (
          <div className="mt-4 text-sm text-muted-foreground space-y-1">
            <p><span className="text-foreground font-medium">{review.fileName}</span> · {derived.rows.length} rows</p>
            <p>
              Baseline:{' '}
              {review.baseCtx.baselineImportedAt
                ? `last committed run of ${new Date(review.baseCtx.baselineImportedAt).toLocaleString()}`
                : 'none — every row reads as a new activation'}
            </p>
            {review.parseErrors.length > 0 && (
              <p className="text-destructive">{review.parseErrors.length} rows skipped as unreadable</p>
            )}
            {review.baseCtx.ambiguousAccountNumbers.length > 0 && (
              <p className="text-destructive">
                Needs a fix in customer records: account number{review.baseCtx.ambiguousAccountNumbers.length > 1 ? 's' : ''}{' '}
                {review.baseCtx.ambiguousAccountNumbers.join(', ')}{' '}
                {review.baseCtx.ambiguousAccountNumbers.length > 1 ? 'are each recorded on' : 'is recorded on'} more than one
                customer, so rows carrying {review.baseCtx.ambiguousAccountNumbers.length > 1 ? 'them' : 'it'} will not match
                automatically. Clear the number from the wrong customer's profile (Overview → Provider accounts) and re-upload.
              </p>
            )}
            {derived.unmapped_pack_keys.length > 0 && (
              <p className="text-destructive">
                Unmapped plans:{' '}
                {derived.unmapped_pack_keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && ', '}
                    {/* Clickable regardless of which bucket its rows landed in —
                        an unmapped plan on an unmatched row has no row-level
                        action, so the summary itself has to be the action. */}
                    <button
                      type="button"
                      className="underline underline-offset-2 font-medium"
                      onClick={() => { setMapPick(''); setMapTarget({ key: k, label: k }); }}
                    >
                      {k}
                    </button>
                  </span>
                ))}{' '}
                — click a plan to map it.
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {review && derived && (
        <>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BUCKET_ORDER.filter((b) => derived.counts[b] > 0).map((b) => (
              <div key={b} className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">{BUCKET_LABELS[b]}</p>
                <p className="text-2xl font-semibold">{derived.counts[b]}</p>
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
              {visibleRows.length} of {derived.rows.length} rows match.
            </p>
          )}

          <div className="mt-6 space-y-6">
            {BUCKET_ORDER.filter((b) => derived.counts[b] > 0).map((bucket) => {
              const all = visibleRows.filter((r) => r.bucket === bucket);
              if (all.length === 0) return null;
              const showAll = expanded[bucket] || all.length <= PAGE;
              const rows = showAll ? all : all.slice(0, PAGE);
              const body = (
                <div className="space-y-3">
                  {rows.map((r) => {
                    const pack = packFor(r);
                    const plan = planFor(r);
                    return (
                      <ResolvedRowCard
                        key={r.key}
                        row={r}
                        subscriberLabelById={derived.ctx.subscriberLabelById}
                        packLabel={pack?.name}
                        chargeAmount={plan?.amount}
                        chargeDuration={plan?.duration}
                        packValidityDays={pack?.validity_days ?? undefined}
                        renewalMismatch={
                          r.bucket === 'renewal'
                            ? renewalValidityMismatch(
                                pack,
                                r.event.previous?.end_date,
                                r.event.current.end_date,
                              )
                            : null
                        }
                        acknowledged={acked[r.key]}
                        onAcknowledge={(v) => setAcked((a) => ({ ...a, [r.key]: v }))}
                        allowCreateProspect={derived.ctx.policy.create_prospects}
                        linkedLabel={
                          links[r.key] ? `${links[r.key].name} · ${links[r.key].subscriber_id}` : undefined
                        }
                        prospectQueued={!!prospects[r.key]}
                        deviceMismatch={deviceMismatch(r)}
                        onLinkCustomer={() => { setLinkPick(links[r.key] ?? null); setLinkTarget(r.key); }}
                        onUnlink={
                          links[r.key]
                            ? () => setLinks((l) => { const n = { ...l }; delete n[r.key]; return n; })
                            : undefined
                        }
                        onCreateProspect={() =>
                          setProspects((p) => ({ ...p, [r.key]: !p[r.key] }))
                        }
                        onMapPack={
                          r.pack.status === 'unmapped' && r.pack.provider_pack_key
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
                    );
                  })}
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
                {chargingRows.length} subscriptions · {unackedAnomalies} anomalies awaiting acknowledgement
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
                  toast.success('Linked — the row has been re-evaluated');
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
          {crossProviderPack && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">This pack belongs to a different provider</p>
              <p className="text-muted-foreground mt-1">
                “{crossProviderPack.pack}” is owned by {crossProviderPack.packProvider}, but this
                import is for {crossProviderPack.importProvider}. Customers matched on this plan
                will be recorded against {crossProviderPack.packProvider}. Continue only if that
                is intended.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMapTarget(null)}>Cancel</Button>
            <Button onClick={mapPack} disabled={!mapPick}>
              {crossProviderPack ? 'Save anyway' : 'Save mapping'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
