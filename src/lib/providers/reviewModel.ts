/**
 * Phase 5.1 — re-derivation model for the review screen (pure).
 *
 * Root-cause fix (2026-08-06): `resolveEvent()` used to run exactly once, at
 * parse time, and every later operator decision (link a customer, queue a
 * prospect, map a plan) was patched onto the result by hand. That is how a
 * linked row could never produce a charge: `writes.charge` was computed while
 * the row was still unmatched, and nothing recomputed it.
 *
 * The rule now: an operator decision never patches a resolved row. It changes
 * the *context*, and the whole report is resolved again. `mapPack()` already
 * worked this way; this module generalises it to identity as well.
 *
 * A queued-but-not-yet-created prospect has no subscriber id, so it gets a
 * synthetic one (`prospect:<row key>`). It behaves exactly like a real match
 * through resolution — the commit layer translates it back into
 * `create_prospect: true` with a null subscriber id.
 */

import { detectEvents } from "./diffEngine";
import { normKey, resolveEvents, type ResolutionResult } from "./resolution";
import type { ReviewContext, PackInfo } from "./loadResolutionContext";
import type { ProviderReportRow } from "./hathway/types";

export const PROSPECT_PREFIX = "prospect:";

export const isProspectPlaceholder = (id: string | null | undefined) =>
  !!id && id.startsWith(PROSPECT_PREFIX);

export interface OperatorDecisions {
  /** Row key → real subscriber id the operator linked. */
  links: Record<string, string>;
  /** Row key → true when the operator queued a new customer for it. */
  prospects: Record<string, boolean>;
  /** Normalised provider plan key → local pack id, mapped in this session. */
  packOverrides: Record<string, string>;
}

export interface DerivedReview extends ResolutionResult {
  ctx: ReviewContext;
}

/**
 * Rebuild the entire resolution from the parsed rows plus whatever the
 * operator has decided so far. Cheap enough to run on every decision: a
 * 400-row report resolves in single-digit milliseconds and nothing here
 * touches the network.
 */
export function deriveReview(
  base: ReviewContext,
  parsedRows: ProviderReportRow[],
  decisions: OperatorDecisions,
): DerivedReview {
  const { events } = detectEvents(base.baseline, parsedRows);

  const subscriberByVcId = { ...base.subscriberByVcId };
  const subscriberBySerial = { ...base.subscriberBySerial };
  const subscriberByAccountNumber = { ...base.subscriberByAccountNumber };
  const subscriberLabelById = { ...base.subscriberLabelById };
  /**
   * Rows the operator identified in THIS session. Identity itself is a trigger
   * for writes when the customer has nothing running — see `resolveEvent`.
   */
  const newlyIdentifiedKeys: string[] = [];

  for (const e of events) {
    const target =
      decisions.links[e.key] ??
      (decisions.prospects[e.key] ? `${PROSPECT_PREFIX}${e.key}` : null);
    if (!target) continue;

    newlyIdentifiedKeys.push(e.key);

    if (isProspectPlaceholder(target)) {
      subscriberLabelById[target] = "New customer — created on approve";
    }

    const vc = normKey(e.current.vc_id);
    const sn = normKey(e.current.stb_no);
    const acc = normKey(e.current.account_number);
    if (vc) subscriberByVcId[vc] = target;
    if (sn) subscriberBySerial[sn] = target;
    if (acc) subscriberByAccountNumber[acc] = target;
  }

  const ctx: ReviewContext = {
    ...base,
    subscriberByVcId,
    subscriberBySerial,
    subscriberByAccountNumber,
    subscriberLabelById,
    newlyIdentifiedKeys,
    packIdByProviderKey: {
      ...base.packIdByProviderKey,
      ...decisions.packOverrides,
    },
  };


  return { ...resolveEvents(events, ctx), ctx };
}

/**
 * Inclusive day count between two ISO dates. Jun 30 → Jul 29 is 30 days,
 * which is how the provider bills a "30 day" plan.
 */
export function inclusiveDays(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export interface ChargePlan {
  /** Number of pack periods the reported window spans. Always >= 1. */
  duration: number;
  /** What `create_subscription` will post: pack price × duration. */
  amount: number;
  /** Days the reported window covers, or null when a date is missing. */
  windowDays: number | null;
}

/**
 * What the commit will actually charge. Deliberately mirrors the server:
 * the amount is the pack's own price × periods, never a free-typed number,
 * because the charge is a side effect of `create_subscription` (§4.3).
 */
export function chargePlan(
  pack: PackInfo | undefined,
  start: string | null,
  end: string | null,
): ChargePlan | null {
  if (!pack) return null;
  const validity = Math.max(1, pack.validity_days ?? 30);
  const windowDays = inclusiveDays(start, end);
  const duration = Math.max(1, Math.round((windowDays ?? validity) / validity));
  return { duration, amount: pack.price * duration, windowDays };
}

/**
 * Item 13 — renewal sanity signal, non-blocking.
 *
 * Detection of a renewal is unchanged (a later end date). This only asks a
 * second question: does the extension the provider granted line up with the
 * validity of the pack we mapped? A 30-day pack that renews by 45 days is
 * either the wrong mapping or an upstream anomaly — worth a human's eye,
 * never worth blocking the import.
 */
export function renewalValidityMismatch(
  pack: PackInfo | undefined,
  previousEnd: string | null | undefined,
  currentEnd: string | null | undefined,
): { gapDays: number; validityDays: number } | null {
  if (!pack) return null;
  const gapDays = inclusiveDays(previousEnd ?? null, currentEnd ?? null);
  if (gapDays === null) return null;
  const validityDays = Math.max(1, pack.validity_days ?? 30);
  if (gapDays % validityDays === 0) return null;
  return { gapDays, validityDays };
}
