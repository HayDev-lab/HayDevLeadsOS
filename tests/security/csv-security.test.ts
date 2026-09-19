// SECURITY REGRESSION — CSV formula injection (v0.19.3 hotfix, audit finding #2).
//
// Proof: every cell produced by the central exporter (toCsv) that starts with
// = + - @ TAB CR is neutralized ("'=..." → inert text in spreadsheet apps),
// while plain numeric values (including negatives) stay numeric, quoting
// stays correct, and i18n content (Armenian/Russian) is untouched.

import { describe, expect, test } from "bun:test";
import { sanitizeCsvCell, toCsv, parseCsv } from "../../src/lib/leados/csv";
import { toCsv as toCsvViaAttribution } from "../../src/lib/leados/attribution";

describe("sanitizeCsvCell", () => {
  const dangerous = [
    "=1+1",
    "=HYPERLINK(\"https://evil.example\",\"click\")",
    "=CMD(\"/c calc\")",
    "+SUM(A1:A2)",
    "+cmd|'/C calc'!A0",
    "-CMD(\"/c calc\")",
    "-2+3+cmd|'/C calc'!A0",
    "@SUM(1+1)",
    "@cmd",
    "\t=cmd",
    "\r=cmd",
    "   =HYPERLINK(1,2)",
    "  +SUM(A1)",
    " @SUM(A1)",
  ];

  test.each(dangerous)("neutralizes %j", (cell) => {
    const out = sanitizeCsvCell(cell);
    // after optional-whitespace trim the effective first char must be the guard quote
    expect(out.trimStart().startsWith("'")).toBe(true);
    // the payload itself is preserved (inert text, not deleted)
    expect(out).toContain(cell.trim());
  });

  const safe = [
    ["plain text", "plain text"],
    ["-5", "-5"], // negative number stays a number
    ["-5.25", "-5.25"],
    ["+3.14", "+3.14"],
    ["12345", "12345"],
    ["0", "0"],
    ["Հայաստան", "Հայաստան"],
    ["Привет мир", "Привет мир"],
    ["", ""],
    [null, ""],
    [42, "42"],
    [-7, "-7"],
  ] as const;

  test.each(safe as unknown as [unknown, string][])("keeps safe value %j", (input, expected) => {
    expect(sanitizeCsvCell(input)).toBe(expected);
  });
});

describe("toCsv — exported cells cannot execute as formulas", () => {
  test("formula payloads are neutralized in the serialized CSV", () => {
    const csv = toCsv([
      { name: "=HYPERLINK(\"https://evil.example\",\"pwn\")", note: "+SUM(A1:A2)" },
      { name: "@SUM(1)", note: "-CMD(\"/c calc\")" },
    ]);
    for (const line of csv.split("\n").slice(1)) {
      for (const cell of line.split(",")) {
        const t = cell.trim().replace(/^"|"$/g, "").trimStart();
        if (t.startsWith("'")) continue; // neutralized — good
        expect([">", "+", "-", "@"]).not.toContain(t[0]);
      }
    }
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM(A1:A2)");
  });

  test("numeric columns stay numeric — no guard quote", () => {
    const csv = toCsv([{ score: -12, value: 42.5, label: "ok" }]);
    const [dataRow] = csv.split("\n").slice(1);
    expect(dataRow).toBe("-12,42.5,ok");
  });

  test("header row is sanitized too (custom field keys are user input)", () => {
    const csv = toCsv([{ "=cmd": "x", normal: "y" }]);
    expect(csv.split("\n")[0]).toBe("'=cmd,normal");
  });

  test("round-trip: quoted text and i18n survive a parse cycle", () => {
    const rows = [
      { name: 'quoted,text', city: "Երևան", greeting: "Здравствуйте" },
    ];
    const csv = toCsv(rows);
    const back = parseCsv(csv);
    expect(back.headers).toEqual(["name", "city", "greeting"]);
    expect(back.rows[0].name).toBe("quoted,text");
    expect(back.rows[0].city).toBe("Երևան");
    expect(back.rows[0].greeting).toBe("Здравствуйте");
  });

  test("multiline cells are properly quoted in the export (valid RFC4180)", () => {
    // NOTE: the IMPORT parser splits on newlines before unquoting (pre-existing
    // limitation, out of hotfix scope) — the EXPORT side must still quote the
    // value so spreadsheet apps read it as one cell.
    const csv = toCsv([{ note: "line1\nline2" }]);
    expect(csv).toBe('note\n"line1\nline2"');
  });

  test("attribution re-export points at the sanitized implementation", () => {
    const csv = toCsvViaAttribution([{ name: "=1+1" }]);
    expect(csv).toContain("'=1+1");
  });
});
