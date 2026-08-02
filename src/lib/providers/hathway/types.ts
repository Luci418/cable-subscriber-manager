/**
 * Phase 2 — canonical parsed model for Hathway provider reports.
 *
 * Both reports normalise into `ProviderReportRow`. Fields absent from a given
 * report stay `null` — never invented. `report_type` uses the DB CHECK
 * literals from Phase 1 (`customer_master` / `dashboard_status`); no other
 * spelling is valid.
 */

export type ProviderReportType = "customer_master" | "dashboard_status";

export interface ProviderReportRow {
  /** 1-based row number in the source file (excluding the header). */
  row_number: number;
  /** Upstream account id (customer_master only). */
  account_number: string | null;
  /** Upstream display name. LCO placeholder in bulk-provisioned accounts. */
  customer_name: string | null;
  /** Viewing-card id — primary device match key. */
  vc_id: string | null;
  /** STB serial — secondary device match key. */
  stb_no: string | null;
  /** Registered mobile. Suggested-candidate matching only, never automatic. */
  mobile: string | null;
  /** Marketed plan name (customer_master only). */
  base_plan: string | null;
  /** ISO `YYYY-MM-DD`, or null. */
  start_date: string | null;
  /** ISO `YYYY-MM-DD`, or null. */
  end_date: string | null;
  /** Provider-side total price for the plan instance. Informational. */
  total_base_price: number | null;
  /** Pure-DPO price component. Unverified suggestion only. */
  dpo_total_price: number | null;
  /** Raw upstream status string, verbatim (INV: never normalised). */
  service_status: string | null;
  /** Everything else from the source row, keyed by original header. */
  extra: Record<string, string>;
}

export interface ParseError {
  row_number: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  report_type: ProviderReportType;
  headers: string[];
  rows: ProviderReportRow[];
  errors: ParseError[];
}

/**
 * True when the raw provider status counts as active. Only `ACTIVE` qualifies.
 * The comparison is case/whitespace-insensitive on purpose: storage stays
 * verbatim (INV §1.5-G), but a future export that lowercases the status must
 * not silently flip every subscriber to "not active".
 */
export function isProviderActive(rawStatus: string | null): boolean {
  return (rawStatus ?? "").trim().toUpperCase() === "ACTIVE";
}

