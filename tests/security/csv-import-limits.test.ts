// SECURITY REGRESSION — bounded CSV import (v0.19.3 hotfix, audit finding #7).
//
// Proof: the leads import enforces explicit hard limits (bytes, rows,
// columns, field length) exported from the centralized csv module, and the
// import route maps CsvLimitError to 413 instead of buffering unbounded
// payloads into process memory.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseCsv,
  CsvLimitError,
  MAX_CSV_IMPORT_BYTES,
  MAX_CSV_IMPORT_ROWS,
  MAX_CSV_IMPORT_COLUMNS,
  MAX_CSV_FIELD_LENGTH,
} from "../../src/lib/leados/csv";

const root = join(import.meta.dir, "../..");
const importRoute = readFileSync(join(root, "src/app/api/v1/import/route.ts"), "utf8");

describe("csv limits — constants", () => {
  test("limits are explicit and sane for LeadOS scale", () => {
    expect(MAX_CSV_IMPORT_BYTES).toBe(2_000_000); // 2 MB text cap
    expect(MAX_CSV_IMPORT_ROWS).toBe(5_000); // export itself caps at 2000 rows
    expect(MAX_CSV_IMPORT_COLUMNS).toBe(64);
    expect(MAX_CSV_FIELD_LENGTH).toBe(4_096);
  });
});

describe("parseCsv — hard limits", () => {
  test("rejects text above the byte budget", () => {
    const big = "name\n" + "a".repeat(3_000_000);
    expect(() => parseCsv(big)).toThrow(CsvLimitError);
    try {
      parseCsv(big);
    } catch (e) {
      expect((e as CsvLimitError).code).toBe("csv-too-large");
      expect((e as CsvLimitError).limit).toBe(MAX_CSV_IMPORT_BYTES);
    }
  });

  test("rejects too many rows", () => {
    const rows = ["name", ...Array.from({ length: 5_001 }, (_, i) => `lead-${i}`)].join("\n");
    expect(() => parseCsv(rows)).toThrow(CsvLimitError);
    try {
      parseCsv(rows);
    } catch (e) {
      expect((e as CsvLimitError).code).toBe("csv-too-many-rows");
    }
  });

  test("rejects too many columns", () => {
    const header = Array.from({ length: 65 }, (_, i) => `c${i}`).join(",");
    expect(() => parseCsv(header + "\nv")).toThrow(CsvLimitError);
    try {
      parseCsv(header + "\nv");
    } catch (e) {
      expect((e as CsvLimitError).code).toBe("csv-too-many-columns");
    }
  });

  test("rejects oversized single fields", () => {
    const bigField = "x".repeat(5_000);
    expect(() => parseCsv(`name,note\nok,"${bigField}"`)).toThrow(CsvLimitError);
    try {
      parseCsv(`name,note\nok,"${bigField}"`);
    } catch (e) {
      expect((e as CsvLimitError).code).toBe("csv-field-too-long");
    }
  });

  test("a payload inside all limits still parses", () => {
    const out = parseCsv("name,company\nAlice,Acme\nԲոբ, biases Ltd");
    expect(out.rows.length).toBe(2);
    expect(out.rows[1].name).toBe("Բոբ");
  });
});

describe("import route wiring", () => {
  test("route checks content-length before buffering and maps CsvLimitError to 413", () => {
    expect(importRoute).toContain("content-length");
    expect(importRoute).toContain("CsvLimitError");
    expect(importRoute).toContain("413");
    expect(importRoute).toContain("MAX_CSV_IMPORT_BYTES");
  });
});
