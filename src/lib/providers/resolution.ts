/**
 * Phase 4 — resolution layer (pure).
 *
 * Takes the events produced by the Phase 3 diff engine and answers three
 * questions per row, without touching the database:
 *
 *  1. **Which subscriber is this?** — canonical match order (§1.5-H):
 *     `vc_id` → `serial_number` → `hathway_customer_nbr` vs `account_number`
 *     → mobile (suggestion only, never automatic) → unmatched.
 *     A `vc_id` and a `serial_number` pointing at two different subscribers is
 *     a **conflict**, never a silent pick.
 *  2. **Which local pack is this plan?** — via `provider_pack_mappings`;
 *     an unknown plan key is `unmapped_pack`.
 *  3. **What may we write?** — every proposed write is filtered through
 *     `getSyncPolicy` first (INV-49/INV-50). A denied write is not dropped
 *     silently: it is recorded in `suppressed_by_policy` so the review screen
 *     can show "would have changed X, policy says no".
 *
 * Nothing here writes, and nothing here decides amounts — Phase 5 owns the
 * editable charge amount, Phase 6 owns the transaction.
 *
 * Bucketing decision (2026-08-03, explicit): a `no_change` event whose
 * `changed[]` is non-empty is bucketed as **`anomaly`**, NOT hidden with the
 * genuinely identical rows. An end/start date that regresses, or a field that
 * came through `null` because a parse failed, is exactly the kind of thing
 * INV-46/47 want a human to see. `no_change` in this layer means "byte-for-byte
 * the same as the committed baseline".
 *
 * Write circuit-breakers (2026-08-04): two conditions zero every proposed
 * write unconditionally — an unmatched/suggested/conflicting row (no linked
 * subscriber) and an `anomaly` row (data we do not trust). Policy cannot
 * re-enable either.
 */

import { SyncPolicy, SyncPolicyKey } from "./syncPolicy";
import { ProviderEvent } from "./diffEngine";

export type MatchMethod =
  | "vc_id"
  | "serial_number"
  | "account_number"
  | null;

export type MatchStatus =
  | "matched" // one subscriber, deterministic key
  | "conflict" // two deterministic keys disagree
  | "unmatched";

export interface SubscriberMatch {
  status: MatchStatus;
  method: MatchMethod;
  subscriber_id: string | null;
  /** The raw provider value that actually matched — shown on the review card. */
  matched_value: string | null;
  /** Every distinct subscriber any key pointed at (conflict detail). */
  candidates: { subscriber_id: string; method: Exclude<MatchMethod, null>; value: string | null }[];
  reason?: string;
}

export type PackStatus = "mapped" | "unmapped" | "not_applicable";

export interface PackResolution {
  status: PackStatus;
  /** Normalised provider plan key used for the lookup. */
  provider_pack_key: string | null;
  pack_id: string | null;
}

export type ResolutionBucket =
  | "new_activation"
  | "renewal"
  | "plan_change"
  | "status_change"
  | "needs_review"
  | "unmapped_pack"
  | "anomaly"
  | "no_change";

export interface ProposedWrites {
  /** A ledger charge is proposed for this row (amount decided in Phase 5). */
  charge: boolean;
  /** Upstream plan name / validity window → `subscriber_provider_state`. */
  plan_state: boolean;
  /** Raw upstream status string → `subscriber_provider_state`. */
  provider_status: boolean;
}

export interface SuppressedWrite {
  policy_key: SyncPolicyKey;
  what: string;
}

export interface ResolvedRow {
  key: string;
  event: ProviderEvent;
  match: SubscriberMatch;
  pack: PackResolution;
  bucket: ResolutionBucket;
  writes: ProposedWrites;
  /**
   * True when the operator identified this subscriber for the first time in
   * THIS review session and that subscriber has no active subscription on
   * file. Such a row proposes writes even when the report bytes are identical
   * to the last committed snapshot (see `resolveEvent`).
   */
  newly_identified: boolean;
  /** Writes the data supports but policy forbids. Shown, never applied. */
  suppressed_by_policy: SuppressedWrite[];
}

export interface ResolutionResult {
  rows: ResolvedRow[];
  counts: Record<ResolutionBucket, number>;
  /** Distinct provider plan keys with no local mapping. */
  unmapped_pack_keys: string[];
}

/** Lookup tables the caller builds from the DB. All keys pre-normalised here. */
export interface ResolutionContext {
  subscriberByVcId?: Record<string, string>;
  subscriberBySerial?: Record<string, string>;
  subscriberByAccountNumber?: Record<string, string>;
  /** `provider_pack_mappings.provider_pack_key` → local `packs.id`. */
  packIdByProviderKey?: Record<string, string>;
  /**
   * Row keys that errored during a previous commit. A failed row never wrote
   * anything, but the baseline snapshot recorded it as if it had — so a plain
   * diff would call it `no_change` and hide it forever. These keys are forced
   * into `needs_review` until they commit cleanly once.
   */
  forcedReviewKeys?: string[];
  /**
   * Row keys the operator linked or queued as a new customer in this session.
   * Learning who a row belongs to is itself a trigger for writes — see
   * `resolveEvent`.
   */
  newlyIdentifiedKeys?: string[];
  /** Subscriber ids that already have an active subscription for this service. */
  subscribersWithActiveSubscription?: string[];
  policy: SyncPolicy;
}


/** Event types that represent money moving upstream. */
const CHARGE_EVENTS = new Set(["new_activation", "renewal", "plan_change"]);

export function normKey(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toUpperCase();
  return s === "" ? null : s;
}

export function normPackKey(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

function lookup(
  table: Record<string, string> | undefined,
  key: string | null,
): string | null {
  if (!table || !key) return null;
  return table[key] ?? null;
}

/**
 * Deterministic identifiers only (2026-08-07 decision): vc_id → serial →
 * account number. Mobile-based matching is **gone** — a shared or stale
 * mobile is not evidence of identity, and a "suggested" state only ever
 * invited an operator to confirm a guess.
 */
export function resolveSubscriber(
  event: ProviderEvent,
  ctx: ResolutionContext,
): SubscriberMatch {
  const row = event.current;
  const byVc = lookup(ctx.subscriberByVcId, normKey(row.vc_id));
  const bySerial = lookup(ctx.subscriberBySerial, normKey(row.stb_no));
  const byAccount = lookup(
    ctx.subscriberByAccountNumber,
    normKey(row.account_number),
  );

  const candidates: SubscriberMatch["candidates"] = [];
  if (byVc) candidates.push({ subscriber_id: byVc, method: "vc_id", value: row.vc_id ?? null });
  if (bySerial)
    candidates.push({ subscriber_id: bySerial, method: "serial_number", value: row.stb_no ?? null });
  if (byAccount)
    candidates.push({
      subscriber_id: byAccount,
      method: "account_number",
      value: row.account_number ?? null,
    });

  const deterministic = [byVc, bySerial, byAccount].filter(Boolean) as string[];
  const distinct = [...new Set(deterministic)];

  if (distinct.length > 1) {
    return {
      status: "conflict",
      method: null,
      subscriber_id: null,
      matched_value: null,
      candidates,
      reason:
        "Provider identifiers on this row resolve to different customers — resolve manually",
    };
  }

  if (byVc)
    return {
      status: "matched",
      method: "vc_id",
      subscriber_id: byVc,
      matched_value: row.vc_id ?? null,
      candidates,
    };
  if (bySerial)
    return {
      status: "matched",
      method: "serial_number",
      subscriber_id: bySerial,
      matched_value: row.stb_no ?? null,
      candidates,
    };
  if (byAccount)
    return {
      status: "matched",
      method: "account_number",
      subscriber_id: byAccount,
      matched_value: row.account_number ?? null,
      candidates,
    };

  return {
    status: "unmatched",
    method: null,
    subscriber_id: null,
    matched_value: null,
    candidates: [],
    reason: "Unmatched — search to link a customer",
  };
}

export function resolvePack(
  event: ProviderEvent,
  ctx: ResolutionContext,
): PackResolution {
  const providerKey = normPackKey(event.current.base_plan);
  if (!providerKey) {
    // Dashboard-status rows carry no plan; nothing to map.
    return { status: "not_applicable", provider_pack_key: null, pack_id: null };
  }
  const packId = lookup(ctx.packIdByProviderKey, providerKey);
  return packId
    ? { status: "mapped", provider_pack_key: providerKey, pack_id: packId }
    : { status: "unmapped", provider_pack_key: providerKey, pack_id: null };
}

export function resolveEvent(
  event: ProviderEvent,
  ctx: ResolutionContext,
): ResolvedRow {
  const match = resolveSubscriber(event, ctx);
  const pack = resolvePack(event, ctx);
  const policy = ctx.policy;

  const wantsCharge = CHARGE_EVENTS.has(event.type);
  const linked = match.status === "matched";

  const suppressed: SuppressedWrite[] = [];

  let charge = wantsCharge && linked && pack.status === "mapped";
  if (charge && !policy.create_charges) {
    charge = false;
    suppressed.push({ policy_key: "create_charges", what: "Ledger charge for this event" });
  }

  const planChanged =
    event.previous === null ||
    event.changed.includes("base_plan") ||
    event.changed.includes("start_date") ||
    event.changed.includes("end_date");
  let plan_state = linked && planChanged;
  if (plan_state && !policy.update_plan_state) {
    plan_state = false;
    suppressed.push({ policy_key: "update_plan_state", what: "Upstream plan and validity window" });
  }

  const statusChanged = event.previous === null || event.changed.includes("service_status");
  let provider_status = linked && statusChanged;
  if (provider_status && !policy.update_provider_status) {
    provider_status = false;
    suppressed.push({ policy_key: "update_provider_status", what: "Upstream service status" });
  }

  // Identity is never proposed — denied by default (INV-49) and, even when
  // enabled, only ever applied through an explicit operator action.
  if (linked && event.current.customer_name && !policy.update_identity_name) {
    suppressed.push({ policy_key: "update_identity_name", what: "Customer name from provider" });
  }
  if (linked && event.current.mobile && !policy.update_identity_mobile) {
    suppressed.push({ policy_key: "update_identity_mobile", what: "Mobile from provider" });
  }

  // A key that errored during a previous commit wrote nothing, but the
  // baseline snapshot recorded it as if it had. Never let it diff away as
  // `no_change` — it is forced in front of a human until it commits cleanly.
  const previouslyFailed = !!ctx.forcedReviewKeys?.includes(event.key);

  let bucket: ResolutionBucket;
  if (match.status !== "matched") {
    bucket = "needs_review";
  } else if (wantsCharge && pack.status === "unmapped") {
    bucket = "unmapped_pack";
  } else if (event.type === "no_change" && event.changed.length > 0) {
    bucket = "anomaly";
  } else if (previouslyFailed && event.type === "no_change") {
    bucket = "needs_review";
  } else {
    bucket = event.type;
  }

  // Anomaly circuit-breaker (2026-08-04). An anomaly is data we do not trust:
  // a regressed date, or a field nulled by a parse failure. It gets the same
  // treatment as an unmatched row — every proposed write is forced off,
  // regardless of match status or policy. Phase 5 must require an explicit
  // per-row operator acknowledgement; an anomaly is never eligible for a bulk
  // "Approve all".
  if (bucket === "anomaly") {
    charge = false;
    plan_state = false;
    provider_status = false;
  }

  return { key: event.key, event, match, pack, bucket, writes: { charge, plan_state, provider_status }, suppressed_by_policy: suppressed };
}

export function resolveEvents(
  events: ProviderEvent[],
  ctx: ResolutionContext,
): ResolutionResult {
  const rows = events.map((e) => resolveEvent(e, ctx));

  const counts: Record<ResolutionBucket, number> = {
    new_activation: 0,
    renewal: 0,
    plan_change: 0,
    status_change: 0,
    needs_review: 0,
    unmapped_pack: 0,
    anomaly: 0,
    no_change: 0,
  };
  for (const r of rows) counts[r.bucket]++;

  const unmapped = new Set<string>();
  for (const r of rows) {
    if (r.pack.status === "unmapped" && r.pack.provider_pack_key) {
      unmapped.add(r.pack.provider_pack_key);
    }
  }

  return { rows, counts, unmapped_pack_keys: [...unmapped].sort() };
}
