/**
 * Hathway "Customer Master Summary" report parser (pure, no DB).
 *
 * Tab-separated, `.xls` extension, one row per active plan on an STB.
 * Report type literal: `customer_master` (DB CHECK constraint, Phase 1).
 */

import type { ParseError, ParseResult, ProviderReportRow } from "./types";
import { cleanCell, pick, rowShapeError, splitTsv, toIsoDate, toNumber } from "./parseUtils";

const KNOWN_HEADERS = [
  "Account Number",
  "Customer Name",
  "VC Id",
  "New STB No",
  "Mobile Number",
  "Base Plan",
  "Start Date",
  "End Date",
  "DPO Total Price",
  "Total Base Price",
];

export function parseCustomerMaster(text: string): ParseResult {
  const { headers, lines } = splitTsv(text);
  const rows: ProviderReportRow[] = [];
  const errors: ParseError[] = [];

  lines.forEach((cells, i) => {
    const row_number = i + 1;
    const raw = cells.join("\t");

    const shape = rowShapeError(headers, cells);
    if (shape) {
      errors.push({ row_number, message: shape, raw });
      return;
    }


    const vc_id = pick(headers, cells, "VC Id", "VC ID", "VCId");
    const stb_no = pick(headers, cells, "New STB No", "STB No", "STB ID");

    if (!vc_id && !stb_no) {
      errors.push({
        row_number,
        message: "Row has neither VC Id nor STB No — cannot identify a device",
        raw,
      });
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
      account_number: pick(headers, cells, "Account Number", "AccountNumber"),
      customer_name: pick(headers, cells, "Customer Name"),
      vc_id,
      stb_no,
      mobile: pick(headers, cells, "Mobile Number", "RMN"),
      base_plan: pick(headers, cells, "Base Plan", "Plan"),
      start_date: toIsoDate(pick(headers, cells, "Start Date")),
      end_date: toIsoDate(pick(headers, cells, "End Date")),
      total_base_price: toNumber(pick(headers, cells, "Total Base Price")),
      dpo_total_price: toNumber(pick(headers, cells, "DPO Total Price")),
      service_status: null,
      extra,
    });
  });

  return { report_type: "customer_master", headers, rows, errors };
}
