/**
 * Import-run report model (read-only).
 *
 * `commit_provider_import` records one entry per decision in
 * `provider_import_runs.results.rows`:
 *
 *   { key, bucket, outcome: 'applied' | 'skipped' | 'error',
 *     subscriber_id, subscription_id, mode, transaction_id, reason,
 *     frozen: { pack_name, pack_price, validity_days, provider_plan_label, ... } }
 *
 * This module is the pure translation of that record — plus the run's own
 * `snapshot_data` and the joined subscriber/transaction rows — into grouped,
 * plain-language view rows. No I/O, no React: the page does the reads, this
 * decides what the operator is told.
 *
 * `frozen` is what the row was actually charged on (INV-51), so descriptions
 * are built from it and never from the pack's current values.
 */

import { rowKey } from "./diffEngine";
import type { ProviderReportRow } from "./hathway/types";

export type RunOutcome = "applied" | "skipped" | "error";

export interface RunResultRow {
  key: string;
  bucket?: string | null;
  outcome: RunOutcome;
  subscriber_id?: string | null;
  subscription_id?: string | null;
  mode?: string | null;
  transaction_id?: string | null;
  reason?: string | null;
  frozen?: {
    provider_plan_key?: string | null;
    provider_plan_label?: string | null;
    pack_id?: string | null;
    pack_name?: string | null;
    pack_price?: number | string | null;
    provider_cost?: number | string | null;
    validity_days?: number | null;
    parser_version?: string | null;
  } | null;
}

export interface RunResults {
  charges_created?: number;
  states_updated?: number;
  prospects_created?: number;
  errors?: number;
  total_charged?: number | string;
  parser_version?: string | null;
  by_bucket?: Record<string, number>;
  failed_keys?: string[];
  rows?: RunResultRow[];
}

export interface RunSubscriber {
  id: string;
  subscriber_id: string;
  name: string;
  created_at?: string | null;
}

export interface RunTransaction {
  id: string;
  amount: number | string;
  date?: string | null;
}

export type RunGroupId =
  | "failed"
  | "skipped"
  | "new_customer"
  | "renewal"
  | "plan_change"
  | "new_activation"
  | "state_only";

/** Display order — problems first, silent mirroring last. */
export const RUN_GROUP_ORDER: RunGroupId[] = [
  "failed",
  "skipped",
  "new_customer",
  "renewal",
  "plan_change",
  "new_activation",
  "state_only",
];

export const RUN_GROUP_LABELS: Record<RunGroupId, { title: string; blurb: string }> = {
  failed: {
    title: "Failed",
    blurb: "Nothing was written for these rows. They come back for review on the next import.",
  },
  skipped: {
    title: "Skipped",
    blurb: "The provider's sync policy blocked the change.",
  },
  new_customer: {
    title: "New customers",
    blurb: "Created from this report — pair a device to complete setup.",
  },
  renewal: {
    title: "Renewals",
    blurb: "An existing subscription was extended.",
  },
  plan_change: {
    title: "Plan changes",
    blurb: "The old subscription was closed and a new one started.",
  },
  new_activation: {
    title: "New activations",
    blurb: "A subscription was started for an existing customer.",
  },
  state_only: {
    title: "Provider data only",
    blurb: "No money moved — the upstream plan or status was mirrored onto the profile.",
  },
};

export interface RunReportRow {
  key: string;
  group: RunGroupId;
  /** Best available name: local customer, else the name in the report. */
  customerName: string;
  /** Human-readable customer id, used for profile links. */
  subscriberSlug: string | null;
  subscriberUuid: string | null;
  /** One plain-language sentence describing what happened. */
  description: string;
  /** Charge posted by this row, when there was one. */
  amount: number | null;
  transactionId: string | null;
  /** Verbatim failure/skip reason from the server. */
  reason: string | null;
  packName: string | null;
  planLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  identifiers: { vc_id: string | null; stb_no: string | null; account_number: string | null };
  /** Everything a search box should look at. */
  searchText: string;
}

export interface RunReportGroup {
  id: RunGroupId;
  title: string;
  blurb: string;
  rows: RunReportRow[];
  total: number;
}

export interface RunReport {
  groups: RunReportGroup[];
  rows: RunReportRow[];
  counts: Record<RunGroupId, number>;
  /** Sum of the charges actually recorded against rows of this run. */
  totalCharged: number;
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function periodLabel(validityDays: number | null | undefined): string {
  const v = validityDays ?? 30;
  if (v >= 28 && v <= 31) return "1 month";
  if (v === 1) return "1 day";
  return `${v} days`;
}

function describe(
  group: RunGroupId,
  packName: string | null,
  planLabel: string | null,
  endDate: string | null,
  validityDays: number | null,
  reason: string | null,
): string {
  const pack = packName ?? planLabel ?? "the reported plan";
  const until = fmtDate(endDate);
  switch (group) {
    case "failed":
      return reason ?? "The change could not be applied.";
    case "skipped":
      return reason ?? "No change was applied.";
    case "new_customer":
      return `Customer created from the report and started on ${pack}` +
        (until ? `, valid to ${until}.` : ".");
    case "renewal":
      return `Renewed ${pack} — ${periodLabel(validityDays)}` +
        (until ? `, extended to ${until}.` : ".");
    case "plan_change":
      return `Plan changed to ${pack}` + (until ? `, valid to ${until}.` : ".");
    case "new_activation":
      return `Started on ${pack}` + (until ? `, valid to ${until}.` : ".");
    case "state_only":
    default:
      return planLabel
        ? `Upstream plan recorded as ${planLabel}${until ? ` (to ${until})` : ""} — no charge posted.`
        : "Upstream provider details recorded — no charge posted.";
  }
}

export interface BuildRunReportInput {
  results: RunResults | null | undefined;
  /** Parsed rows stored with the run — the source of report-side identifiers. */
  snapshotRows: ProviderReportRow[] | null | undefined;
  subscribersById: Record<string, RunSubscriber>;
  transactionsById: Record<string, RunTransaction>;
  /**
   * When the run was committed. A subscriber created at/after this point was
   * created BY this run — that is how a prospect row is recognised, since the
   * server result does not carry a `create_prospect` flag.
   */
  committedAt?: string | null;
}

export function buildRunReport({
  results,
  snapshotRows,
  subscribersById,
  transactionsById,
  committedAt,
}: BuildRunReportInput): RunReport {
  const snapshotByKey = new Map<string, ProviderReportRow>();
  for (const r of snapshotRows ?? []) {
    const k = rowKey(r);
    if (k) snapshotByKey.set(k, r);
  }

  // 60s of slack: the customer insert and the run's committed_at timestamp
  // are written in the same transaction, but clock formatting/rounding of the
  // stored values should never decide whether a row reads as "new".
  const commitMs = committedAt ? new Date(committedAt).getTime() : NaN;
  const isNewCustomer = (s: RunSubscriber | undefined) => {
    if (!s?.created_at || Number.isNaN(commitMs)) return false;
    const created = new Date(s.created_at).getTime();
    return !Number.isNaN(created) && created >= commitMs - 60_000;
  };

  const rows: RunReportRow[] = (results?.rows ?? []).map((r) => {
    const snap = snapshotByKey.get(r.key) ?? null;
    const sub = r.subscriber_id ? subscribersById[r.subscriber_id] : undefined;
    const txn = r.transaction_id ? transactionsById[r.transaction_id] : undefined;
    const frozen = r.frozen ?? null;
    const charged = !!frozen;

    let group: RunGroupId;
    if (r.outcome === "error") group = "failed";
    else if (r.outcome === "skipped") group = "skipped";
    else if (isNewCustomer(sub)) group = "new_customer";
    else if (!charged) group = "state_only";
    else if (r.bucket === "renewal") group = "renewal";
    else if (r.bucket === "plan_change") group = "plan_change";
    else group = "new_activation";

    const packName = frozen?.pack_name ?? null;
    const planLabel = frozen?.provider_plan_label ?? snap?.base_plan ?? null;
    const endDate = snap?.end_date ?? null;
    const amount = txn ? num(txn.amount) : null;

    const customerName = sub?.name ?? snap?.customer_name ?? "Unknown customer";
    const identifiers = {
      vc_id: snap?.vc_id ?? null,
      stb_no: snap?.stb_no ?? null,
      account_number: snap?.account_number ?? null,
    };

    return {
      key: r.key,
      group,
      customerName,
      subscriberSlug: sub?.subscriber_id ?? null,
      subscriberUuid: r.subscriber_id ?? null,
      description: describe(group, packName, planLabel, endDate, frozen?.validity_days ?? null, r.reason ?? null),
      amount,
      transactionId: r.transaction_id ?? null,
      reason: r.reason ?? null,
      packName,
      planLabel,
      startDate: snap?.start_date ?? null,
      endDate,
      identifiers,
      searchText: [
        customerName,
        sub?.subscriber_id,
        identifiers.vc_id,
        identifiers.stb_no,
        identifiers.account_number,
        packName,
        planLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });

  const counts = RUN_GROUP_ORDER.reduce(
    (acc, g) => ({ ...acc, [g]: 0 }),
    {} as Record<RunGroupId, number>,
  );
  for (const r of rows) counts[r.group]++;

  const groups: RunReportGroup[] = RUN_GROUP_ORDER.map((id) => {
    const groupRows = rows.filter((r) => r.group === id);
    return {
      id,
      title: RUN_GROUP_LABELS[id].title,
      blurb: RUN_GROUP_LABELS[id].blurb,
      rows: groupRows,
      total: groupRows.reduce((s, r) => s + (r.amount ?? 0), 0),
    };
  }).filter((g) => g.rows.length > 0);

  return {
    groups,
    rows,
    counts,
    totalCharged: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
  };
}

/** Case-insensitive filter over the precomputed search text. */
export function filterRunReport(report: RunReport, query: string): RunReport {
  const q = query.trim().toLowerCase();
  if (!q) return report;
  const rows = report.rows.filter((r) => r.searchText.includes(q));
  const groups = report.groups
    .map((g) => {
      const kept = g.rows.filter((r) => r.searchText.includes(q));
      return { ...g, rows: kept, total: kept.reduce((s, r) => s + (r.amount ?? 0), 0) };
    })
    .filter((g) => g.rows.length > 0);
  return { ...report, rows, groups, totalCharged: rows.reduce((s, r) => s + (r.amount ?? 0), 0) };
}
