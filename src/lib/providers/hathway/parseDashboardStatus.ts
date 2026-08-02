/**
 * Hathway "Total Dashboard Data" report parser (pure, no DB).
 *
 * Lightweight per-STB status feed. `service_status` is preserved verbatim —
 * never normalised, bucketed, or discarded (§1.5-G).
 * Report type literal: `dashboard_status` (DB CHECK constraint, Phase 1).
 */

import type { ParseError, ParseResult, ProviderReportRow } from "./types";
import { cleanCell, pick, splitTsv } from "./parseUtils";

const KNOWN_HEADERS = ["Service Status", "STB ID", "VC ID", "RMN", "Customer Name"];

export function parseDashboardStatus(text: string): ParseResult {
  const { headers, lines } = splitTsv(text);
  const rows: ProviderReportRow[] = [];
  const errors: ParseError[] = [];

  lines.forEach((cells, i) => {
    const row_number = i + 1;
    const raw = cells.join("\t");

    const vc_id = pick(headers, cells, "VC ID", "VC Id", "VCId");
    const stb_no = pick(headers, cells, "STB ID", "STB No", "New STB No");

    if (!vc_id && !stb_no) {
      errors.push({
        row_number,
        message: "Row has neither VC ID nor STB ID — cannot identify a device",
        raw,
      });
      return;
    }

    const service_status = pick(headers, cells, "Service Status", "Status");
    if (!service_status) {
      errors.push({ row_number, message: "Row has no Service Status", raw });
      return;
    }

    const extra: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (KNOWN_HEADERS.some((k) => k.toLowerCase() === h.toLowerCase())) return;
      const v = cleanCell(cells[idx]);
      if (v !== "") extra[h] = v;
    });

    rows.push({
      row_number,
      account_number: null,
      customer_name: pick(headers, cells, "Customer Name"),
      vc_id,
      stb_no,
      mobile: pick(headers, cells, "RMN", "Mobile Number"),
      base_plan: null,
      start_date: null,
      end_date: null,
      total_base_price: null,
      dpo_total_price: null,
      service_status,
      extra,
    });
  });

  return { report_type: "dashboard_status", headers, rows, errors };
}
