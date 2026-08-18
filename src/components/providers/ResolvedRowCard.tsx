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

import { memo, useState } from "react";
import {
  Check,
  Minus,
  Lock as LockIcon,
  AlertTriangle,
  Link2Off,
  GitBranch,
  ChevronDown,
  ChevronRight,
} from "lucide-react";


/** Same normalisation the resolution layer uses for device keys. */
const normalise = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/**
 * One plain-language outcome sentence (redesign 2026-08-12).
 *
 * Three genuinely different situations, three consistent visual cues:
 *   will    — a tick, stated as a fact with the concrete detail
 *   nothing — a dash, "won't happen because there's nothing to do"
 *   blocked — strikethrough + a spelled-out reason. Strikethrough ALWAYS
 *             means "blocked by your sync settings", never "just off".
 */
function OutcomeLine({
  kind,
  children,
}: {
  kind: "will" | "nothing" | "blocked";
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {kind === "will" ? (
        <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
      ) : kind === "blocked" ? (
        <LockIcon className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
      ) : (
        <Minus className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      )}
      <span className={cn("min-w-0", kind !== "will" && "text-muted-foreground")}>
        {children}
      </span>
    </li>
  );
}

/** The struck-through half of a policy-blocked sentence. */
const Blocked = ({ children }: { children: React.ReactNode }) => (
  <span className="line-through">{children}</span>
);


interface Props {
  row: ResolvedRow;
  subscriberLabelById: Record<string, string>;
  packLabel?: string;
  /**
   * What the commit will post for this row: pack price × periods. Read-only —
   * the charge is a side effect of `create_subscription`, not a typed number.
   */
  chargeAmount?: number;
  chargeDuration?: number;
  packValidityDays?: number;
  /** Item 13 — renewal gap that isn't a clean multiple of the pack validity. */
  renewalMismatch?: { gapDays: number; validityDays: number } | null;
  /** Anomaly rows require an explicit per-row acknowledgement. */
  acknowledged?: boolean;
  onAcknowledge?: (v: boolean) => void;
  /** `create_prospects` policy — gates the "Create new customer" option. */
  allowCreateProspect?: boolean;
  onLinkCustomer?: () => void;
  onCreateProspect?: () => void;
  onUnlink?: () => void;
  /**
   * Operator decisions taken in this review session. The row itself has
   * already been re-resolved against them by `deriveReview`; these only drive
   * the wording of the identity section.
   */
  linkedLabel?: string;
  prospectQueued?: boolean;
  /**
   * True when the vc_id / stb_no the report names is not among the devices
   * currently paired to the matched subscriber.
   */
  deviceMismatch?: boolean;
  /** Inline "Map this plan" action for `unmapped_pack` rows. */
  onMapPack?: () => void;
}

function ResolvedRowCardImpl({
  row,
  subscriberLabelById,
  packLabel,
  chargeAmount,
  chargeDuration,
  packValidityDays,
  renewalMismatch,
  acknowledged,
  onAcknowledge,
  allowCreateProspect,
  onLinkCustomer,
  onCreateProspect,
  onUnlink,
  linkedLabel,
  prospectQueued,
  deviceMismatch,
  onMapPack,
}: Props) {
  const { event, match, pack, writes, suppressed_by_policy: suppressed } = row;
  const suppressedFor = (key: SyncPolicyKey) =>
    suppressed.some((s) => s.policy_key === key) ? key : undefined;

  const isConflict = match.status === "conflict";
  const isAnomaly = row.bucket === "anomaly";
  const resolvedByOperator = !!linkedLabel || !!prospectQueued;

  // Rows that need a human stay open; everything else collapses to one line
  // so a 400-row report reads as a list, not a wall of cards.
  const mustExpand =
    isConflict ||
    isAnomaly ||
    row.bucket === "needs_review" ||
    row.bucket === "unmapped_pack";
  const [open, setOpen] = useState(mustExpand);

  // Item 10 — say which identifier the report key is, never leave it implied.
  const keyKind = normalise(event.current.vc_id) === normalise(row.key) ? "VC" : "STB";

  const identityLine = resolvedByOperator
    ? linkedLabel
      ? `Linked to ${linkedLabel}`
      : "Queued as a new customer"
    : match.status === "matched"
      ? (subscriberLabelById[match.subscriber_id!] ?? match.subscriber_id ?? "")
      : isConflict
        ? "Conflict — identifiers disagree"
        : "Unmatched";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
            {keyKind}
          </span>
          <span className="font-mono text-sm font-medium truncate">{row.key}</span>
          <span className="text-xs text-muted-foreground truncate">
            {event.current.customer_name ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!open && writes.charge && Number.isFinite(chargeAmount as number) && (
            <span className="text-xs font-medium">₹{(chargeAmount as number).toFixed(2)}</span>
          )}
          <Badge variant="outline" className={cn("shrink-0", BUCKET_TONE[row.bucket])}>
            {BUCKET_LABELS[row.bucket]}
          </Badge>
        </div>
      </button>

      {!open && (
        <p className="mt-1.5 pl-6 text-xs text-muted-foreground truncate">{identityLine}</p>
      )}

      {open && (
      <div className="grid gap-4 md:grid-cols-3 mt-3">

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
                    {String((event.previous as unknown as Record<string, unknown> | null)?.[f] ?? "—")}
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
          {/* Operator decision taken in this session. The row has already been
              re-resolved against it — this states it in words. */}
          {resolvedByOperator && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
              <p className="font-medium text-primary flex items-start gap-1.5">
                <Check className="h-4 w-4 mt-0.5 shrink-0" />
                {linkedLabel
                  ? `Linked to ${linkedLabel} — will apply on approve`
                  : "Queued as a new customer — will be created on approve"}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {linkedLabel && onLinkCustomer && (
                  <Button size="sm" variant="outline" onClick={onLinkCustomer}>
                    Change link
                  </Button>
                )}
                {linkedLabel && onUnlink && (
                  <Button size="sm" variant="ghost" onClick={onUnlink}>
                    Unlink
                  </Button>
                )}
                {prospectQueued && onCreateProspect && (
                  <Button size="sm" variant="ghost" onClick={onCreateProspect}>
                    Undo
                  </Button>
                )}
              </div>
            </div>
          )}


          {!resolvedByOperator && match.status === "matched" && (
            <p className="text-sm">
              <Check className="inline h-4 w-4 text-primary mr-1" />
              Matched by{" "}
              <strong>
                {match.method === "vc_id"
                  ? "VC id"
                  : match.method === "serial_number"
                    ? "STB serial"
                    : "account number"}
              </strong>
              {match.matched_value && (
                <span className="font-mono text-xs text-muted-foreground"> {match.matched_value}</span>
              )}
              <br />
              <span className="text-muted-foreground">
                {subscriberLabelById[match.subscriber_id!] ?? match.subscriber_id}
              </span>
            </p>
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

          {!resolvedByOperator && match.status === "unmatched" && (
            <p className="text-sm text-muted-foreground">
              <Link2Off className="inline h-4 w-4 mr-1" />
              <strong className="text-foreground">Unmatched</strong> — no VC id, STB serial
              or account number on this row matched any customer.
            </p>
          )}

          {/* Tier-3 match hygiene: matched on account number, but the hardware
              named in the report is not what is paired locally. Note, never a
              blocker, never auto-pairing. */}
          {deviceMismatch && (
            <p className="mt-2 text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Device on this report doesn't match what's currently paired locally.
            </p>
          )}

          {match.status === "unmatched" && (
            <div className="flex flex-wrap gap-2 mt-2">
              {onLinkCustomer && (
                <Button size="sm" variant="outline" onClick={onLinkCustomer}>
                  {linkedLabel ? "Change link" : "Link customer"}
                </Button>
              )}
              {allowCreateProspect && onCreateProspect && !linkedLabel && (

                <Button
                  size="sm"
                  variant={prospectQueued ? "secondary" : "outline"}
                  onClick={onCreateProspect}
                >
                  {prospectQueued ? "Queued — undo" : "Create new customer"}
                </Button>
              )}
            </div>
          )}
        </Section>


        {/* ── Proposed actions ────────────────────────────────── */}
        <Section label="Proposed actions">
          <ul className="space-y-1.5">
            {/* Charge */}
            {writes.charge ? (
              <OutcomeLine kind="will">
                Will charge{" "}
                <strong>
                  ₹{Number.isFinite(chargeAmount as number) ? (chargeAmount as number).toFixed(2) : "—"}
                </strong>{" "}
                for {packLabel ?? "the mapped pack"}
                {packValidityDays ? ` (${packValidityDays} days` : ""}
                {packValidityDays && chargeDuration && chargeDuration > 1
                  ? ` × ${chargeDuration})`
                  : packValidityDays
                    ? ")"
                    : ""}
              </OutcomeLine>
            ) : suppressedFor("create_charges") ? (
              <OutcomeLine kind="blocked">
                <Blocked>Won't post a charge</Blocked> — your sync settings don't allow
                provider imports to post charges (change this in Settings → Integrations).
              </OutcomeLine>
            ) : (
              <OutcomeLine kind="nothing">{noChargeReason}</OutcomeLine>
            )}

            {/* Plan / validity from the provider */}
            {writes.plan_state ? (
              <OutcomeLine kind="will">
                Will update this customer's plan details from the provider (plan name and
                the dates it runs between)
              </OutcomeLine>
            ) : suppressedFor("update_plan_state") ? (
              <OutcomeLine kind="blocked">
                <Blocked>Won't update the plan details we store from the provider</Blocked>{" "}
                — your sync settings don't allow it (change this in Settings → Integrations).
              </OutcomeLine>
            ) : (
              <OutcomeLine kind="nothing">
                {linked
                  ? "Plan details stay as they are — the report shows the same plan and dates we already have."
                  : "Plan details stay as they are — this row isn't linked to a customer yet."}
              </OutcomeLine>
            )}

            {/* Provider status */}
            {writes.provider_status ? (
              <OutcomeLine kind="will">
                Will record the provider's current status for this connection (
                {event.current.service_status ?? "unknown"})
              </OutcomeLine>
            ) : suppressedFor("update_provider_status") ? (
              <OutcomeLine kind="blocked">
                <Blocked>Won't record the provider's status</Blocked> — your sync settings
                don't allow it (change this in Settings → Integrations).
              </OutcomeLine>
            ) : (
              <OutcomeLine kind="nothing">
                {linked
                  ? "Provider status stays as it is — it hasn't changed since the last import."
                  : "Provider status stays as it is — this row isn't linked to a customer yet."}
              </OutcomeLine>
            )}

            {/* Identity — always policy-blocked when listed */}
            {suppressed
              .filter((s) => s.policy_key.startsWith("update_identity"))
              .map((s) => (
                <OutcomeLine key={s.policy_key} kind="blocked">
                  <Blocked>
                    Won't change this customer's{" "}
                    {s.policy_key === "update_identity_name" ? "name" : "mobile number"} to
                    what the provider has
                  </Blocked>{" "}
                  — your sync settings don't allow provider imports to change customer
                  details (change this in Settings → Integrations).
                </OutcomeLine>
              ))}
          </ul>

          {writes.charge && (
            <p className="mt-2 text-xs text-muted-foreground">
              The charge is posted by creating the subscription — the amount comes from the
              pack's own price, it is never typed in here.
            </p>
          )}


          {renewalMismatch && (
            <p className="mt-2 text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Renewal extends {renewalMismatch.gapDays} days, which isn't a multiple of
              the mapped pack's {renewalMismatch.validityDays}-day validity. Check the
              mapping before approving.
            </p>
          )}


          {row.bucket === "unmapped_pack" && onMapPack && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <p className="text-xs text-destructive">
                “{event.current.base_plan ?? "—"}” has no local pack. No charge can
                be posted until it is mapped.
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={onMapPack}>
                Map this plan
              </Button>
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
      )}
    </div>

  );
}

/** Memoised: a 400-row report mounts 400 of these with live inputs. */
export const ResolvedRowCard = memo(ResolvedRowCardImpl);
