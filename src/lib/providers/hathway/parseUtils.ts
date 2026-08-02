/**
 * Pure helpers shared by the Hathway report parsers.
 *
 * Hathway exports are tab-separated text served with an `.xls` extension.
 * Every cell is prefixed with a `'` (Excel text-lock) and may be wrapped in
 * double quotes.
 */

const MONTHS: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

/** Strip BOM, surrounding quotes, the Excel text-lock quote, and whitespace. */
export function cleanCell(value: string | undefined | null): string {
  if (value == null) return "";
  let v = value.replace(/^\uFEFF/, "").trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1).trim();
  }
  while (v.startsWith("'")) v = v.slice(1);
  return v.trim();
}

/** Empty string / `-` / `NA` all mean "no value". */
export function toNullable(value: string | undefined | null): string | null {
  const v = cleanCell(value);
  if (v === "" || v === "-" || v.toUpperCase() === "NA" || v.toUpperCase() === "NULL") {
    return null;
  }
  return v;
}

/** `DD-MON-YYYY` (or `DD/MM/YYYY`, `YYYY-MM-DD`) → ISO `YYYY-MM-DD`. */
export function toIsoDate(value: string | undefined | null): string | null {
  const v = toNullable(value);
  if (!v) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mon = /^(\d{1,2})[-/\s]([A-Za-z]{3})[A-Za-z]*[-/\s](\d{2,4})/.exec(v);
  if (mon) {
    const month = MONTHS[mon[2].toUpperCase()];
    if (!month) return null;
    const year = mon[3].length === 2 ? `20${mon[3]}` : mon[3];
    return `${year}-${month}-${mon[1].padStart(2, "0")}`;
  }

  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(v);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  return null;
}

/** Numeric coercion tolerating currency symbols, commas and blanks. */
export function toNumber(value: string | undefined | null): number | null {
  const v = toNullable(value);
  if (v === null) return null;
  const stripped = v.replace(/[₹,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(stripped)) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

/** Split TSV text into a header array and data lines, skipping blank lines. */
export function splitTsv(text: string): { headers: string[]; lines: string[][] } {
  const rawLines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");

  if (rawLines.length === 0) return { headers: [], lines: [] };

  const headers = rawLines[0].split("\t").map((h) => cleanCell(h));
  const lines = rawLines.slice(1).map((l) => l.split("\t"));
  return { headers, lines };
}

/** Case/space-insensitive header lookup returning the cell value. */
export function pick(
  headers: string[],
  cells: string[],
  ...candidates: string[]
): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => norm(h) === norm(candidate));
    if (idx >= 0) return toNullable(cells[idx]);
  }
  return null;
}
