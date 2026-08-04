/**
 * Phase 5 — one resolved provider row, rendered as three structurally
 * separate sections (decision 2026-08-04):
 *
 *   Event            — what the diff engine saw
 *   Identity         — who this row is, stated in words (never implied by
 *                      which buttons happen to be visible)
 *   Proposed actions — all three writes, always listed, with policy-denied
 *                      ones struck through and labelled "(policy)"
 *
 * Purely presentational. All state lives in the parent screen.
 */

import { Check, X, AlertTriangle, Link2Off, GitBranch, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ResolvedRow, ResolutionBucket } from "@/lib/providers/resolution";
import { SYNC_POLICY_LABELS, type SyncPolicyKey } from "@/lib/providers/syncPolicy";

export const BUCKET_LABELS: Record<ResolutionBucket, string> = {
  new_activation: "New activation",
  renewal: "Renewal",
  plan_change: "Plan change",
  status_change: "Status change",
  needs_review: "Needs review",
  unmapped_pack: "Unmapped pack",
  anomaly: "Anomaly",
  no_change: "No change",
};

const BUCKET_TONE: Record<ResolutionBucket, string> = {
  new_activation: "bg-primary/10 text-primary border-primary/20",
  renewal: "bg-primary/10 text-primary border-primary/20",
  plan_change: "bg-accent text-accent-foreground border-border",
  status_change: "bg-muted text-muted-foreground border-border",
  needs_review: "bg-destructive/10 text-destructive border-destructive/20",
  unmapped_pack: "bg-destructive/10 text-destructive border-destructive/20",
  anomaly: "bg-destructive/10 text-destructive border-destructive/20",
  no_change: "bg-muted text-muted-foreground border-border",
};

const FIELD_LABELS: Record<string, string> = {
  base_plan: "Plan",
  start_date: "Start date",
  end_date: "End date",
  service_status: "Provider status",
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

function WriteLine({
  label,
  allowed,
  suppressedBy,
}: {
  label: string;
  allowed: boolean;
  suppressedBy?: SyncPolicyKey;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {allowed ? (
        <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
      ) : (
        <X className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      )}
      <span
        className={cn(
          "min-w-0",
          !allowed && "text-muted-foreground",
          suppressedBy && "line-through",
        )}
      >
        {label}
      </span>
      {suppressedBy && (
        <span
          className="text-xs text-destructive shrink-0"
          title={SYNC_POLICY_LABELS[suppressedBy]}
        >
          (policy)
        </span>
      )}
    </li>
  );
}

interface Props {
  row: ResolvedRow;
  subscriberLabelById: Record<string, string>;
  packLabel?: string;
  /** Editable charge amount, only meaningful when `row.writes.charge`. */
  amount?: number;
  onAmountChange?: (v: number) => void;
  /** Anomaly rows require an explicit per-row acknowledgement. */
  acknowledged?: boolean;
  onAcknowledge?: (v: boolean) => void;
  /** `create_prospects` policy — gates the "Create new customer" option. */
  allowCreateProspect?: boolean;
  onLinkCustomer?: () => void;
  onCreateProspect?: () => void;
}

export function ResolvedRowCard({
  row,
  subscriberLabelById,
  packLabel,
  amount,
  onAmountChange,
  acknowledged,
  onAcknowledge,
  allowCreateProspect,
  onLinkCustomer,
  onCreateProspect,
}: Props) {
  const { event, match, pack, writes, suppressed_by_policy: suppressed } = row;
  const suppressedFor = (key: SyncPolicyKey) =>
    suppressed.some((s) => s.policy_key === key) ? key : undefined;

  const isConflict = match.status === "conflict";
  const isAnomaly = row.bucket === "anomaly";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="font-mono text-sm font-medium truncate">{row.key}</span>
          <span className="text-xs text-muted-foreground truncate">
            {event.current.customer_name ?? "—"}
          </span>
        </div>
        <Badge variant="outline" className={cn("shrink-0", BUCKET_TONE[row.bucket])}>
          {BUCKET_LABELS[row.bucket]}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* ── Event ───────────────────────────────────────────── */}
        <Section label="Event">
          {event.changed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {event.previous === null
                ? "Not present in the last committed report"
                : "Identical to the last committed report"}
            </p>
          ) : (
            <ul className="space-y-1">
              {event.changed.map((f) => (
                <li key={f} className="text-sm">
                  <span className="text-muted-foreground">{FIELD_LABELS[f] ?? f}: </span>
                  <span className="line-through text-muted-foreground">
                    {String((event.previous as Record<string, unknown> | null)?.[f] ?? "—")}
                  </span>
                  <span className="mx-1">→</span>
                  <span className="font-medium">
                    {String((event.current as unknown as Record<string, unknown>)[f] ?? "—")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Plan: {event.current.base_plan ?? "—"}
            {pack.status === "unmapped" && (
              <span className="text-destructive"> · no local pack mapped</span>
            )}
            {pack.status === "mapped" && packLabel && <span> → {packLabel}</span>}
          </p>
        </Section>

        {/* ── Identity ────────────────────────────────────────── */}
        <Section label="Identity">
          {match.status === "matched" && (
            <p className="text-sm">
              <Check className="inline h-4 w-4 text-primary mr-1" />
              Matched by <strong>{match.method === "vc_id" ? "VC id" : match.method === "serial_number" ? "STB serial" : "account number"}</strong>
              <br />
              <span className="text-muted-foreground">
                {subscriberLabelById[match.subscriber_id!] ?? match.subscriber_id}
              </span>
            </p>
          )}

          {match.status === "suggested" && (
            <div className="text-sm">
              <p className="text-muted-foreground">
                <HelpCircle className="inline h-4 w-4 mr-1" />
                <strong className="text-foreground">Suggested by mobile</strong> — not confirmed
              </p>
              <ul className="mt-1 space-y-0.5">
                {match.candidates.map((c) => (
                  <li key={c.subscriber_id} className="text-muted-foreground">
                    {subscriberLabelById[c.subscriber_id] ?? c.subscriber_id}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isConflict && (
            <div className="text-sm">
              <p className="text-destructive font-medium">
                <GitBranch className="inline h-4 w-4 mr-1" />
                Conflict — identifiers disagree
              </p>
              <ul className="mt-1 space-y-0.5">
                {match.candidates.map((c) => (
                  <li key={`${c.method}-${c.subscriber_id}`} className="text-muted-foreground">
                    {c.method === "vc_id" ? "VC id" : c.method === "serial_number" ? "STB serial" : "Account no."}
                    {" → "}
                    {subscriberLabelById[c.subscriber_id] ?? c.subscriber_id}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-1">
                Fix the identifiers on the two customers. Creating a new customer
                does not resolve this.
              </p>
            </div>
          )}

          {match.status === "unmatched" && (
            <p className="text-sm text-muted-foreground">
              <Link2Off className="inline h-4 w-4 mr-1" />
              <strong className="text-foreground">Unmatched</strong> — no VC id, serial,
              account number or mobile matched any customer.
            </p>
          )}

          {(match.status === "unmatched" || match.status === "suggested") && (
            <div className="flex flex-wrap gap-2 mt-2">
              {onLinkCustomer && (
                <Button size="sm" variant="outline" onClick={onLinkCustomer}>
                  Link customer
                </Button>
              )}
              {match.status === "unmatched" && allowCreateProspect && onCreateProspect && (
                <Button size="sm" variant="outline" onClick={onCreateProspect}>
                  Create new customer
                </Button>
              )}
            </div>
          )}
        </Section>

        {/* ── Proposed actions ────────────────────────────────── */}
        <Section label="Proposed actions">
          <ul className="space-y-1">
            <WriteLine
              label="Post ledger charge"
              allowed={writes.charge}
              suppressedBy={suppressedFor("create_charges")}
            />
            <WriteLine
              label="Update upstream plan & validity"
              allowed={writes.plan_state}
              suppressedBy={suppressedFor("update_plan_state")}
            />
            <WriteLine
              label="Update upstream status"
              allowed={writes.provider_status}
              suppressedBy={suppressedFor("update_provider_status")}
            />
            {suppressed
              .filter((s) => s.policy_key.startsWith("update_identity"))
              .map((s) => (
                <WriteLine
                  key={s.policy_key}
                  label={s.what}
                  allowed={false}
                  suppressedBy={s.policy_key}
                />
              ))}
          </ul>

          {writes.charge && (
            <div className="mt-3">
              <label className="text-xs text-muted-foreground">Charge amount (₹)</label>
              <Input
                type="number"
                inputMode="decimal"
                className="h-8 mt-1"
                value={amount ?? 0}
                onChange={(e) => onAmountChange?.(Number(e.target.value))}
              />
            </div>
          )}

          {isAnomaly && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Values changed but no business event was detected. All writes are
                blocked until you acknowledge this row.
              </p>
              <label className="flex items-center gap-2 mt-2 text-xs">
                <Checkbox
                  checked={!!acknowledged}
                  onCheckedChange={(v) => onAcknowledge?.(v === true)}
                />
                I have reviewed this row
              </label>
            </div>
          )}

          {isConflict && (
            <p className="text-xs text-muted-foreground mt-2">
              No writes are possible while the identity is ambiguous.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
