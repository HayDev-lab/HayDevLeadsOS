// SLA engine unit tests — run with: bun test
// Covers: state model, qualifying types, settings validation, sorting,
// humanization and edge cases from the SLA requirements.

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SLA_THRESHOLDS,
  QUALIFYING_ACTIVITY_TYPES,
  SLA_STATUS,
  compareLeadsBySlaPriority,
  computeFirstResponseSla,
  humanizeDuration,
  isQualifyingActivity,
  parseSlaThresholds,
  validateSlaThresholds,
  type SlaThresholds,
} from "../src/lib/sla";

const TH: SlaThresholds = { target: 1, warning: 4, breach: 24 };
const ago = (minutes: number, from = new Date("2026-09-17T12:00:00Z")) =>
  new Date(from.getTime() - minutes * 60_000);
const NOW = new Date("2026-09-17T12:00:00Z");

// ---------------------------------------------------------------------------
// STATES
// ---------------------------------------------------------------------------

describe("SLA state model (1/4/24)", () => {
  test("created 30m ago → TARGET", () => {
    const r = computeFirstResponseSla({ createdAt: ago(30) }, TH, NOW);
    expect(r.status).toBe(SLA_STATUS.TARGET);
    expect(r.elapsedMinutes).toBe(30);
    expect(r.isBreached).toBe(false);
  });

  test("created 2h ago → WARNING (matches finalized semantic model)", () => {
    const r = computeFirstResponseSla({ createdAt: ago(120) }, TH, NOW);
    expect(r.status).toBe(SLA_STATUS.WARNING);
    expect(r.escalated).toBe(false);
  });

  test("created 6h ago → WARNING escalated (past warning threshold)", () => {
    const r = computeFirstResponseSla({ createdAt: ago(360) }, TH, NOW);
    expect(r.status).toBe(SLA_STATUS.WARNING);
    expect(r.escalated).toBe(true);
  });

  test("created 25h ago, no response → BREACH", () => {
    const r = computeFirstResponseSla({ createdAt: ago(25 * 60) }, TH, NOW);
    expect(r.status).toBe(SLA_STATUS.BREACH);
    expect(r.isBreached).toBe(true);
  });

  test("created 5h ago, first qualifying response 45m after → RESPONDED, first response 45m", () => {
    const created = ago(5 * 60);
    const r = computeFirstResponseSla({ createdAt: created, firstResponseAt: new Date(created.getTime() + 45 * 60_000) }, TH, NOW);
    expect(r.status).toBe(SLA_STATUS.RESPONDED);
    expect(r.isResponded).toBe(true);
    expect(r.responseMinutes).toBe(45);
    // elapsed freezes at the response time — never keeps growing
    expect(r.elapsedMinutes).toBe(45);
  });

  test("responded lead never goes back to BREACH after more time passes", () => {
    const created = ago(30 * 60); // 30h ago
    const r = computeFirstResponseSla(
      { createdAt: created, firstResponseAt: new Date(created.getTime() + 2 * 60_000) },
      TH,
      NOW
    );
    expect(r.status).toBe(SLA_STATUS.RESPONDED);
  });
});

// ---------------------------------------------------------------------------
// QUALIFYING ACTIVITIES
// ---------------------------------------------------------------------------

describe("qualifying activity types", () => {
  test("CALL / MESSAGE / EMAIL / MEETING close the SLA", () => {
    for (const type of ["CALL", "MESSAGE", "EMAIL", "MEETING"]) {
      expect(isQualifyingActivity(type)).toBe(true);
    }
    expect(QUALIFYING_ACTIVITY_TYPES).toEqual(["CALL", "MESSAGE", "EMAIL", "MEETING"]);
  });

  test("SYSTEM_EVENT / AUDIT_IMPORT / ASSIGNMENT / STAGE_CHANGE / NOTE never close the SLA", () => {
    for (const type of ["SYSTEM_EVENT", "AUDIT_IMPORT", "ASSIGNMENT", "STAGE_CHANGE", "STATUS_CHANGE", "NOTE", "FOLLOW_UP"]) {
      expect(isQualifyingActivity(type)).toBe(false);
    }
  });

  test("SYSTEM_EVENT at +5m on a 10h-old lead → SLA remains active (WARNING escalated)", () => {
    // The engine only sees firstResponseAt — the API builds it exclusively
    // from qualifying types. Simulating: system event is NOT passed through.
    const created = ago(10 * 60);
    const r = computeFirstResponseSla({ createdAt: created, firstResponseAt: null }, TH, NOW);
    expect(r.status).toBe(SLA_STATUS.WARNING);
    expect(r.escalated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SETTINGS VALIDATION
// ---------------------------------------------------------------------------

describe("thresholds validation", () => {
  test("valid: 1 < 4 < 24 PASS", () => {
    const v = validateSlaThresholds({ target: 1, warning: 4, breach: 24 });
    expect(v.ok).toBe(true);
    expect(v.thresholds).toEqual({ target: 1, warning: 4, breach: 24 });
  });

  test("invalid: 4 < 1 < 24 FAIL (target >= warning)", () => {
    expect(validateSlaThresholds({ target: 4, warning: 1, breach: 24 }).ok).toBe(false);
  });

  test("invalid: 1 < 24 < 4 FAIL (warning >= breach)", () => {
    expect(validateSlaThresholds({ target: 1, warning: 24, breach: 4 }).ok).toBe(false);
  });

  test("invalid: 1 == 1 FAIL (equal values)", () => {
    expect(validateSlaThresholds({ target: 1, warning: 1, breach: 24 }).ok).toBe(false);
    expect(validateSlaThresholds({ target: 1, warning: 4, breach: 4 }).ok).toBe(false);
  });

  test("invalid: negative or non-finite values FAIL", () => {
    expect(validateSlaThresholds({ target: -1, warning: 4, breach: 24 }).ok).toBe(false);
    expect(validateSlaThresholds({ target: 0, warning: 4, breach: 24 }).ok).toBe(false);
    expect(validateSlaThresholds({ target: NaN, warning: 4, breach: 24 }).ok).toBe(false);
    expect(validateSlaThresholds({ target: Infinity, warning: 4, breach: 24 }).ok).toBe(false);
  });

  test("non-object input FAIL", () => {
    expect(validateSlaThresholds(null).ok).toBe(false);
    expect(validateSlaThresholds("nope").ok).toBe(false);
    expect(validateSlaThresholds(42).ok).toBe(false);
  });

  test("numeric strings are accepted (form inputs)", () => {
    const v = validateSlaThresholds({ target: "1", warning: "4", breach: "24" });
    expect(v.ok).toBe(true);
    expect(v.thresholds).toEqual({ target: 1, warning: 4, breach: 24 });
  });

  test("error messages are human-readable", () => {
    const v = validateSlaThresholds({ target: 5, warning: 2, breach: 1 });
    expect(v.errors.some((e) => e.includes("Target must be lower than Warning"))).toBe(true);
    expect(v.errors.some((e) => e.includes("Warning must be lower than Breach"))).toBe(true);
  });

  test("parseSlaThresholds: stored JSON string parses; garbage returns null (fallback)", () => {
    expect(parseSlaThresholds(JSON.stringify({ target: 2, warning: 8, breach: 48 }))).toEqual({
      target: 2,
      warning: 8,
      breach: 48,
    });
    expect(parseSlaThresholds("{broken")).toBe(null);
    expect(parseSlaThresholds({ target: 9, warning: 2, breach: 1 })).toBe(null);
    expect(parseSlaThresholds(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// SETTINGS CHANGES RECOMPUTE STATES (no hardcoded thresholds anywhere)
// ---------------------------------------------------------------------------

describe("thresholds drive the states", () => {
  test("same 10h-old lead: WARNING with 1/4/24 but TARGET with 12/24/48", () => {
    const created = ago(10 * 60);
    expect(computeFirstResponseSla({ createdAt: created }, { target: 1, warning: 4, breach: 24 }, NOW).status).toBe(SLA_STATUS.WARNING);
    expect(computeFirstResponseSla({ createdAt: created }, { target: 12, warning: 24, breach: 48 }, NOW).status).toBe(SLA_STATUS.TARGET);
  });

  test("same 30h-old lead: BREACH with 24h, WARNING with 48h breach", () => {
    const created = ago(30 * 60);
    expect(computeFirstResponseSla({ createdAt: created }, TH, NOW).status).toBe(SLA_STATUS.BREACH);
    expect(computeFirstResponseSla({ createdAt: created }, { target: 1, warning: 4, breach: 48 }, NOW).status).toBe(SLA_STATUS.WARNING);
  });
});

// ---------------------------------------------------------------------------
// SORT
// ---------------------------------------------------------------------------

describe("SLA priority sort", () => {
  const t0 = NOW;
  const mk = (id: string, minutesAgo: number, firstResponseAt?: Date) => ({
    id,
    createdAt: ago(minutesAgo, t0),
    sla: computeFirstResponseSla(
      { createdAt: ago(minutesAgo, t0), firstResponseAt: firstResponseAt ?? null },
      TH,
      t0
    ),
  });

  test("BREACH → WARNING → TARGET → RESPONDED; most overdue breach first", () => {
    // Dataset from the requirements:
    // A → TARGET(35m) · B → BREACH 2h ago breached(26h) · C → WARNING(2h)
    // D → BREACH 8h ago breached(32h) · E → RESPONDED
    const A = mk("A", 35);
    const B = mk("B", 26 * 60); // breached by 2h
    const C = mk("C", 120);
    const D = mk("D", 32 * 60); // breached by 8h
    const createdE = ago(5 * 60, t0);
    const E = {
      id: "E",
      createdAt: createdE,
      sla: computeFirstResponseSla(
        { createdAt: createdE, firstResponseAt: new Date(createdE.getTime() + 43 * 60_000) },
        TH,
        t0
      ),
    };

    const sorted = [A, B, C, D, E].sort(compareLeadsBySlaPriority);
    // D (breach 8h) before B (breach 2h); C warning; A target; E responded (newest first among responded)
    expect(sorted.map((x) => x.id)).toEqual(["D", "B", "C", "A", "E"]);
  });

  test("RESPONDED group keeps default order (newest first)", () => {
    const r1 = mk("old", 48 * 60, new Date(t0.getTime() - 47 * 60 * 60_000));
    const r2 = mk("new", 2 * 60, new Date(t0.getTime() - 30 * 60_000));
    const sorted = [r1, r2].sort(compareLeadsBySlaPriority);
    expect(sorted.map((x) => x.id)).toEqual(["new", "old"]);
  });
});

// ---------------------------------------------------------------------------
// HUMANIZATION
// ---------------------------------------------------------------------------

describe("humanizeDuration", () => {
  test("compact human-readable output (days only past 48h)", () => {
    expect(humanizeDuration(42)).toBe("42m");
    expect(humanizeDuration(78)).toBe("1h 18m");
    expect(humanizeDuration(360)).toBe("6h");
    expect(humanizeDuration(28 * 60)).toBe("28h"); // < 48h stays in hours
    expect(humanizeDuration(54 * 60)).toBe("2d 6h"); // > 48h switches to days
  });

  test("never negative output", () => {
    expect(humanizeDuration(-15)).toBe("0m");
  });
});

// ---------------------------------------------------------------------------
// EDGE CASES
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("future createdAt (bad data) → elapsed clamped to 0, no negative SLA", () => {
    const r = computeFirstResponseSla({ createdAt: new Date(NOW.getTime() + 2 * 3_600_000) }, TH, NOW);
    expect(r.elapsedMinutes).toBe(0);
    expect(r.status).toBe(SLA_STATUS.TARGET);
  });

  test("firstResponseAt before createdAt (merge artifact) → elapsed clamped to 0, still RESPONDED", () => {
    const created = ago(60);
    const r = computeFirstResponseSla(
      { createdAt: created, firstResponseAt: new Date(created.getTime() - 30 * 60_000) },
      TH,
      NOW
    );
    expect(r.status).toBe(SLA_STATUS.RESPONDED);
    expect(r.elapsedMinutes).toBe(0);
    expect(r.responseMinutes).toBe(0);
  });

  test("missing settings → engine falls back to DEFAULT_SLA_THRESHOLDS (no crash)", () => {
    const r = computeFirstResponseSla({ createdAt: ago(120) }, undefined, NOW);
    expect(r.status).toBe(SLA_STATUS.WARNING);
    expect(DEFAULT_SLA_THRESHOLDS).toEqual({ target: 1, warning: 4, breach: 24 });
  });

  test("deadline dates derive from createdAt + thresholds", () => {
    const created = ago(30);
    const r = computeFirstResponseSla({ createdAt: created }, TH, NOW);
    expect(r.targetAt.getTime()).toBe(created.getTime() + 1 * 3_600_000);
    expect(r.warningAt.getTime()).toBe(created.getTime() + 4 * 3_600_000);
    expect(r.breachAt.getTime()).toBe(created.getTime() + 24 * 3_600_000);
  });
});
