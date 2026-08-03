/**
 * Phase 3 — pure diff engine.
 *
 * Compares the rows of a freshly parsed provider report against the snapshot of
 * the most recent **committed** import run for the same (provider, report_type)
 * and classifies each row into a business event.
 *
 * Hard rules carried from the plan (docs/PROVIDER_SYNC_IMPLEMENTATION_PLAN.md):
 *  - Baseline is the latest COMMITTED run only. A cancelled review leaves no
 *    baseline, so its rows must diff as `new_activation` again (INV-48).
 *  - Absence is NEVER termination (§1.4-1). A key missing from the current file
 *    produces no event at all — only staleness ageing.
 *  - `service_status` is preserved verbatim; activity is derived through
 *    `isProviderActive` (§1.5-G).
 *  - Nothing here touches the database, the ledger, or identity fields.
 */

import { ProviderReportRow, isProviderActive } from "./hathway/types";

export type ProviderEventType =
  | "new_activation"
  | "renewal"
  | "plan_change"
  | "status_change"
  | "no_change";

export type ProviderChangedField =
  | "base_plan"
  | "end_date"
  | "start_date"
  | "service_status";

export interface ProviderEvent {
  /** Stable identity for the row across snapshots (vc_id, else stb_no). */
  key: string;
  type: ProviderEventType;
  /** The row as it appears in the file being imported. */
  current: ProviderReportRow;
  /** The matching row from the baseline snapshot, when there is one. */
  previous: ProviderReportRow | null;
  /** Every field that differs, regardless of which type won precedence. */
  changed: ProviderChangedField[];
  /** Derived from the raw status; raw string is never rewritten. */
  is_active: boolean;
  /** Raw provider status, verbatim. */
  provider_status: string | null;
}

export interface UnkeyedRow {
  row_number: number;
  reason: string;
}

export interface DiffResult {
  events: ProviderEvent[];
  /** Rows with no usable device identifier — cannot be diffed or matched. */
  unkeyed: UnkeyedRow[];
  /** Baseline keys absent from this file. Informational only, never a termination. */
  missing_keys: string[];
  counts: Record<ProviderEventType, number>;
}

export interface StaleEntry {
  key: string;
  last_seen_at: string | null;
  days_stale: number | null;
}

/** vc_id is the canonical key; stb_no is the documented fallback. */
export function rowKey(row: ProviderReportRow): string | null {
  return row.vc_id ?? row.stb_no ?? null;
}

function isLater(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return a > b; // ISO YYYY-MM-DD sorts lexicographically
}

function statusDiffers(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) => (s ?? "").trim().toUpperCase();
  return norm(a) !== norm(b);
}

function planDiffers(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  return norm(a) !== norm(b);
}

/**
 * Classify every row of `currentRows` against `previousSnapshot`.
 *
 * `previousSnapshot` must be the rows of the latest committed run, or
 * `null`/`[]` when no committed baseline exists (⇒ everything is a new
 * activation).
 */
export function detectEvents(
  previousSnapshot: ProviderReportRow[] | null | undefined,
  currentRows: ProviderReportRow[],
): DiffResult {
  const previousByKey = new Map<string, ProviderReportRow>();
  for (const row of previousSnapshot ?? []) {
    const key = rowKey(row);
    if (key) previousByKey.set(key, row);
  }

  const events: ProviderEvent[] = [];
  const unkeyed: UnkeyedRow[] = [];
  const seen = new Set<string>();

  for (const current of currentRows) {
    const key = rowKey(current);
    if (!key) {
      unkeyed.push({
        row_number: current.row_number,
        reason: "Row has neither a VC Id nor an STB number — cannot be identified",
      });
      continue;
    }
    seen.add(key);

    const previous = previousByKey.get(key) ?? null;
    const changed: ProviderChangedField[] = [];
    let type: ProviderEventType;

    if (!previous) {
      type = "new_activation";
    } else {
      if (planDiffers(previous.base_plan, current.base_plan)) changed.push("base_plan");
      if (previous.start_date !== current.start_date) changed.push("start_date");
      if (previous.end_date !== current.end_date) changed.push("end_date");
      if (statusDiffers(previous.service_status, current.service_status)) {
        changed.push("service_status");
      }

      if (changed.includes("base_plan")) {
        type = "plan_change";
      } else if (isLater(current.end_date, previous.end_date)) {
        type = "renewal";
      } else if (changed.includes("service_status")) {
        type = "status_change";
      } else {
        type = "no_change";
      }
    }

    events.push({
      key,
      type,
      current,
      previous,
      changed,
      is_active: isProviderActive(current.service_status),
      provider_status: current.service_status,
    });
  }

  const missing_keys = [...previousByKey.keys()].filter((k) => !seen.has(k));

  const counts: Record<ProviderEventType, number> = {
    new_activation: 0,
    renewal: 0,
    plan_change: 0,
    status_change: 0,
    no_change: 0,
  };
  for (const e of events) counts[e.type]++;

  return { events, unkeyed, missing_keys, counts };
}

export const STALE_AFTER_DAYS = 14;

/**
 * Rows not seen in a snapshot for `thresholdDays` or more. Purely
 * informational — staleness never implies termination or any ledger write.
 */
export function findStaleEntries(
  lastSeenByKey: Record<string, string | null>,
  now: Date = new Date(),
  thresholdDays: number = STALE_AFTER_DAYS,
): StaleEntry[] {
  const out: StaleEntry[] = [];
  for (const [key, lastSeen] of Object.entries(lastSeenByKey)) {
    if (!lastSeen) {
      out.push({ key, last_seen_at: null, days_stale: null });
      continue;
    }
    const seenAt = new Date(lastSeen).getTime();
    if (Number.isNaN(seenAt)) {
      out.push({ key, last_seen_at: lastSeen, days_stale: null });
      continue;
    }
    const days = Math.floor((now.getTime() - seenAt) / 86_400_000);
    if (days >= thresholdDays) out.push({ key, last_seen_at: lastSeen, days_stale: days });
  }
  return out.sort((a, b) => (b.days_stale ?? Infinity) - (a.days_stale ?? Infinity));
}
