// Centralized CSV serialization/parsing (v0.19.3 security hotfix).
//
//   • sanitizeCsvCell() — formula-injection defense: a cell that starts
//     (after optional whitespace) with `=` `+` `-` `@` TAB or CR is a
//     spreadsheet formula/DDE payload when opened in Excel/LibreOffice/Sheets
//     (e.g. `=HYPERLINK(...)`, `+SUM(A1:A2)`, `@SUM(...)`, `-CMD(...)`).
//     Such cells are neutralized with a leading `'`. Plain numeric literals
//     (`-5`, `+3.14`) are NOT touched — negative numbers must stay numeric.
//   • toCsv() — quotes/commas/newlines escaped, EVERY cell (and the header
//     row) passed through sanitizeCsvCell. Both export routes funnel here.
//   • parseCsv() — used by the leads import; bounded by explicit limits so
//     an oversized payload can never balloon process memory (413 upstream).
//
// This module is PURE (no DB, no React) so tests exercise it directly.

export const MAX_CSV_IMPORT_BYTES = 2_000_000; // 2 MB raw CSV text
export const MAX_CSV_IMPORT_ROWS = 5_000; // data rows (excluding header)
export const MAX_CSV_IMPORT_COLUMNS = 64; // columns per row
export const MAX_CSV_FIELD_LENGTH = 4_096; // characters per parsed cell

export type CsvLimitCode =
  | "csv-too-large"
  | "csv-too-many-rows"
  | "csv-too-many-columns"
  | "csv-field-too-long";

export class CsvLimitError extends Error {
  constructor(
    public readonly code: CsvLimitCode,
    public readonly limit: number
  ) {
    super(`CSV limit exceeded: ${code} (limit ${limit})`);
    this.name = "CsvLimitError";
  }
}

export interface CsvLimits {
  maxBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  maxFieldLength?: number;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/** A plain numeric literal — kept as-is so real numbers stay numbers. */
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

/** Neutralize spreadsheet formula injection in a single cell value. */
export function sanitizeCsvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  const trimmed = s.trimStart();
  if (!trimmed || !FORMULA_PREFIX.test(trimmed)) return s;
  if (PLAIN_NUMBER.test(trimmed)) return s; // `-5` / `+3.14` — a number, safe
  return "'" + s; // `=HYPERLINK(...)` → `'=HYPERLINK(...)` — inert text
}

function csvEscape(v: unknown): string {
  const s = sanitizeCsvCell(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Array.from(
    rows.reduce((s, r) => {
      Object.keys(r).forEach((k) => s.add(k));
      return s;
    }, new Set<string>())
  );
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n");
}

/** Parse CSV text with hard limits. Throws CsvLimitError when a limit is hit. */
export function parseCsv(
  text: string,
  limits: CsvLimits = {}
): { headers: string[]; rows: Record<string, string>[] } {
  const maxBytes = limits.maxBytes ?? MAX_CSV_IMPORT_BYTES;
  const maxRows = limits.maxRows ?? MAX_CSV_IMPORT_ROWS;
  const maxColumns = limits.maxColumns ?? MAX_CSV_IMPORT_COLUMNS;
  const maxFieldLength = limits.maxFieldLength ?? MAX_CSV_FIELD_LENGTH;

  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new CsvLimitError("csv-too-large", maxBytes);

  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  if (lines.length - 1 > maxRows) throw new CsvLimitError("csv-too-many-rows", maxRows);

  const headers = splitCsvLine(lines[0]);
  if (headers.length > maxColumns) throw new CsvLimitError("csv-too-many-columns", maxColumns);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length > maxColumns) throw new CsvLimitError("csv-too-many-columns", maxColumns);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const cell = (cells[idx] ?? "").trim();
      if (cell.length > maxFieldLength) throw new CsvLimitError("csv-field-too-long", maxFieldLength);
      row[h] = cell;
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
