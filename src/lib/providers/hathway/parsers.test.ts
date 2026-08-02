import { describe, expect, it } from "vitest";
import { parseCustomerMaster } from "./parseCustomerMaster";
import { parseDashboardStatus } from "./parseDashboardStatus";
import { isProviderActive } from "./types";
import { toIsoDate, toNumber, cleanCell } from "./parseUtils";

const CM_HEADER = [
  "Sr. No.",
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
  "SCHEME NAME",
].join("\t");

const cmRow = (over: Partial<Record<string, string>> = {}) =>
  [
    over.sr ?? "'1",
    over.account ?? "'1000123456",
    over.name ?? "'VENKATESH NYAMGOUD",
    over.vc ?? "'0123456789",
    over.stb ?? "'0123456789",
    over.mobile ?? "'9448521221",
    over.plan ?? "'HW BASIC 130",
    over.start ?? "'01-JUL-2026",
    over.end ?? "'31-JUL-2026",
    over.dpo ?? "'130.00",
    over.total ?? "'153.40",
    over.scheme ?? "'PURE DPO",
  ].join("\t");

describe("parseUtils", () => {
  it("strips the Excel text-lock quote, wrapping quotes and BOM", () => {
    expect(cleanCell("\uFEFF'  ACTIVE ")).toBe("ACTIVE");
    expect(cleanCell('"\'12345"')).toBe("12345");
  });

  it("converts DD-MON-YYYY and other date shapes to ISO", () => {
    expect(toIsoDate("'01-JUL-2026")).toBe("2026-07-01");
    expect(toIsoDate("1-Jul-26")).toBe("2026-07-01");
    expect(toIsoDate("05/08/2026")).toBe("2026-08-05");
    expect(toIsoDate("2026-08-05")).toBe("2026-08-05");
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate("garbage")).toBeNull();
  });

  it("coerces numerics and rejects junk", () => {
    expect(toNumber("'1,530.40")).toBe(1530.4);
    expect(toNumber("₹130")).toBe(130);
    expect(toNumber("")).toBeNull();
    expect(toNumber("N/A")).toBeNull();
  });
});

describe("parseCustomerMaster", () => {
  it("parses a well-formed sample-shaped file", () => {
    const res = parseCustomerMaster([CM_HEADER, cmRow(), cmRow({ vc: "'0123456790" })].join("\n"));
    expect(res.report_type).toBe("customer_master");
    expect(res.errors).toHaveLength(0);
    expect(res.rows).toHaveLength(2);

    const r = res.rows[0];
    expect(r.account_number).toBe("1000123456");
    expect(r.vc_id).toBe("0123456789");
    expect(r.stb_no).toBe("0123456789");
    expect(r.mobile).toBe("9448521221");
    expect(r.base_plan).toBe("HW BASIC 130");
    expect(r.start_date).toBe("2026-07-01");
    expect(r.end_date).toBe("2026-07-31");
    expect(r.dpo_total_price).toBe(130);
    expect(r.total_base_price).toBe(153.4);
    expect(r.service_status).toBeNull();
    expect(r.extra["SCHEME NAME"]).toBe("PURE DPO");
  });

  it("does not overfit to repeated names — distinct identities parse independently", () => {
    const res = parseCustomerMaster(
      [
        CM_HEADER,
        cmRow({ name: "'ASHA K", vc: "'111", mobile: "'9000000001" }),
        cmRow({ name: "'RAVI M", vc: "'222", mobile: "'9000000002" }),
      ].join("\n"),
    );
    expect(res.rows.map((r) => r.customer_name)).toEqual(["ASHA K", "RAVI M"]);
    expect(res.rows.map((r) => r.vc_id)).toEqual(["111", "222"]);
  });

  it("records a per-row error when no device identifier exists, without dropping the file", () => {
    const res = parseCustomerMaster([CM_HEADER, cmRow({ vc: "'", stb: "'" }), cmRow()].join("\n"));
    expect(res.rows).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row_number).toBe(1);
  });

  it("keeps rows whose dates or prices are malformed, nulling only those fields", () => {
    const res = parseCustomerMaster(
      [CM_HEADER, cmRow({ start: "'--", end: "'not a date", total: "'abc" })].join("\n"),
    );
    expect(res.errors).toHaveLength(0);
    expect(res.rows[0].start_date).toBeNull();
    expect(res.rows[0].end_date).toBeNull();
    expect(res.rows[0].total_base_price).toBeNull();
    expect(res.rows[0].dpo_total_price).toBe(130);
  });

  it("tolerates CRLF, blank lines and quoted cells", () => {
    const res = parseCustomerMaster(`${CM_HEADER}\r\n\r\n${cmRow({ vc: '"\'999"' })}\r\n`);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].vc_id).toBe("999");
  });

  it("returns an empty result for an empty file", () => {
    const res = parseCustomerMaster("");
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(0);
    expect(res.headers).toHaveLength(0);
  });
});

const DS_HEADER = ["Sr.No.", "Service Status", "STB ID", "VC ID", "RMN", "Customer Name"].join("\t");

describe("parseDashboardStatus", () => {
  it("parses a well-formed sample-shaped file", () => {
    const text = [
      DS_HEADER,
      ["'1", "'ACTIVE", "'0123456789", "'0123456789", "'9448521221", "'VENKATESH NYAMGOUD"].join("\t"),
    ].join("\n");
    const res = parseDashboardStatus(text);
    expect(res.report_type).toBe("dashboard_status");
    expect(res.errors).toHaveLength(0);
    expect(res.rows[0]).toMatchObject({
      vc_id: "0123456789",
      stb_no: "0123456789",
      mobile: "9448521221",
      service_status: "ACTIVE",
      base_plan: null,
      account_number: null,
    });
  });

  it("preserves an unrecognised status verbatim (never normalised)", () => {
    const text = [
      DS_HEADER,
      ["'2", "'TEMP SUSPENDED-NP", "'555", "'555", "'9000000000", "'X"].join("\t"),
    ].join("\n");
    const res = parseDashboardStatus(text);
    expect(res.rows[0].service_status).toBe("TEMP SUSPENDED-NP");
    expect(isProviderActive(res.rows[0].service_status)).toBe(false);
    expect(isProviderActive("ACTIVE")).toBe(true);
    expect(isProviderActive("active")).toBe(false);
  });

  it("errors per row on a missing status or missing device id", () => {
    const text = [
      DS_HEADER,
      ["'1", "'", "'777", "'777", "'9", "'X"].join("\t"),
      ["'2", "'ACTIVE", "'", "'", "'9", "'X"].join("\t"),
      ["'3", "'ACTIVE", "'888", "'888", "'9", "'X"].join("\t"),
    ].join("\n");
    const res = parseDashboardStatus(text);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].vc_id).toBe("888");
    expect(res.errors.map((e) => e.row_number)).toEqual([1, 2]);
  });
});
