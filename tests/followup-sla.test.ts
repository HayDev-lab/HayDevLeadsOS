// FOLLOW-UP SLA engine unit tests — run with: bun test
// Covers: state model, gating (responded / final stages), multiple cycles,
// config validation, sorting, reschedule/completion semantics and the
// filter dataset from the requirements. First-response regression lives in
// tests/sla.test.ts and MUST stay green.

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FOLLOWUP_SLA_CONFIG,
  FOLLOWUP_SLA_STATUS,
  computeFollowUpSla,
  compareLeadsByFollowUpUrgency,
  followUpQuickDate,
  parseFollowUpConfig,
  validateFollowUpConfig,
  type FollowUpSlaConfig,
  type FollowUpTaskInput,
} from "../src/lib/sla-followup";
import { computeFirstResponseSla, SLA_STATUS } from "../src/lib/sla";

const CFG: FollowUpSlaConfig = { warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false };
const NOW = new Date("2026-09-17T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const RESPONDED = ago(120); // first response 2h before NOW

const task = (id: string, dueInMinutes: number | null, extra: Partial<FollowUpTaskInput> = {}): FollowUpTaskInput => ({
  id,
  dueAt: dueInMinutes == null ? null : ahead(dueInMinutes),
  title: "Follow up",
  createdAt: ago(360),
  ...extra,
});

// ---------------------------------------------------------------------------
// STATES (requirements 47)
// ---------------------------------------------------------------------------

describe("follow-up state model (warning=4h)", () => {
  test("due in 24h → SCHEDULED", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t1", 24 * 60) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.SCHEDULED);
    expect(r.isOverdue).toBe(false);
    expect(r.hasOpenFollowUp).toBe(true);
    expect(r.remainingMinutes).toBe(24 * 60);
  });

  test("due in 2h (warning window 4h) → DUE_SOON", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t1", 120) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.DUE_SOON);
    expect(r.remainingMinutes).toBe(120);
  });

  test("due 5h ago → OVERDUE with overdueMinutes", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t1", -300) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.OVERDUE);
    expect(r.isOverdue).toBe(true);
    expect(r.overdueMinutes).toBe(300);
    expect(r.remainingMinutes).toBe(0); // clamped — never negative
  });

  test("task completed, nothing new scheduled → COMPLETED with completedAt", () => {
    const r = computeFollowUpSla(
      {
        leadStatus: "OPEN",
        firstResponseAt: RESPONDED,
        openTask: null,
        lastCompleted: { id: "done1", dueAt: ago(600), completedAt: ago(480) },
      },
      CFG,
      NOW
    );
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.COMPLETED);
    expect(r.completedAt).toEqual(ago(480));
    expect(r.hasOpenFollowUp).toBe(false);
  });

  test("no task at all → NOT_REQUIRED", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: null, lastCompleted: null }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.NOT_REQUIRED);
  });

  test("open task WITHOUT dueAt → SCHEDULED with null deadline (never escalates)", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t1", null) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.SCHEDULED);
    expect(r.dueAt).toBeNull();
    expect(r.remainingMinutes).toBeNull();
    expect(r.overdueMinutes).toBeNull();
  });

  test("boundary: due exactly now → OVERDUE (deadline passed)", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t1", 0) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.OVERDUE);
    expect(r.overdueMinutes).toBe(0);
  });

  test("boundary: due exactly at warning edge → DUE_SOON", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t1", 240) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.DUE_SOON);
  });
});

// ---------------------------------------------------------------------------
// GATING — never starts before the first response; no false overdue on finals
// ---------------------------------------------------------------------------

describe("gating semantics", () => {
  test("unresponded lead with an open follow-up task → NOT_REQUIRED (SLA never starts)", () => {
    const r = computeFollowUpSla({ leadStatus: "NEW", firstResponseAt: null, openTask: task("t1", -300) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.NOT_REQUIRED);
    expect(r.isResponded).toBe(false);
    expect(r.hasOpenFollowUp).toBe(false);
  });

  test("WON lead with an overdue open task → NOT_REQUIRED (no false overdue, defensive layer)", () => {
    const r = computeFollowUpSla({ leadStatus: "WON", firstResponseAt: RESPONDED, openTask: task("t1", -300) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.NOT_REQUIRED);
  });

  test("LOST lead → NOT_REQUIRED even with completed history", () => {
    const r = computeFollowUpSla(
      { leadStatus: "LOST", firstResponseAt: RESPONDED, openTask: null, lastCompleted: { id: "d", completedAt: ago(60) } },
      CFG,
      NOW
    );
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.NOT_REQUIRED);
  });

  test("ARCHIVED lead → NOT_REQUIRED", () => {
    const r = computeFollowUpSla({ leadStatus: "ARCHIVED", firstResponseAt: RESPONDED, openTask: task("t1", 60) }, CFG, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.NOT_REQUIRED);
  });
});

// ---------------------------------------------------------------------------
// MULTIPLE FOLLOW-UPS / CYCLES (requirements 48)
// ---------------------------------------------------------------------------

describe("multiple follow-up cycles", () => {
  test("current cycle = earliest OPEN task, ignoring completed and later tasks", () => {
    // Task A completed · Task B due tomorrow · Task C due next week → current = B
    const r = computeFollowUpSla(
      {
        leadStatus: "OPEN",
        firstResponseAt: RESPONDED,
        openTask: task("B", 24 * 60),
        lastCompleted: { id: "A", dueAt: ago(2000), completedAt: ago(1000) },
      },
      CFG,
      NOW
    );
    expect(r.taskId).toBe("B");
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.SCHEDULED);
  });

  test("after completing a cycle, scheduling a new one starts an independent cycle", () => {
    // Cycle 1 closed → COMPLETED; then a new task is scheduled → SCHEDULED again.
    const closed = computeFollowUpSla(
      { leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: null, lastCompleted: { id: "A", completedAt: ago(100) } },
      CFG,
      NOW
    );
    expect(closed.status).toBe(FOLLOWUP_SLA_STATUS.COMPLETED);
    const reopened = computeFollowUpSla(
      {
        leadStatus: "OPEN",
        firstResponseAt: RESPONDED,
        openTask: task("B2", 48 * 60),
        lastCompleted: { id: "A", completedAt: ago(100) },
      },
      CFG,
      NOW
    );
    expect(reopened.status).toBe(FOLLOWUP_SLA_STATUS.SCHEDULED);
    expect(reopened.taskId).toBe("B2");
    // the completed history stays visible on the result
    expect(closed.completedAt).not.toBeNull();
  });

  test("two open tasks: the earliest dueAt wins (service groups earliest open)", () => {
    const r = computeFollowUpSla(
      {
        leadStatus: "OPEN",
        firstResponseAt: RESPONDED,
        openTask: task("early", 60),
        lastCompleted: null,
      },
      CFG,
      NOW
    );
    expect(r.taskId).toBe("early");
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.DUE_SOON);
  });
});

// ---------------------------------------------------------------------------
// CONFIG VALIDATION (requirements 46)
// ---------------------------------------------------------------------------

describe("follow-up config validation", () => {
  test("valid: warning 4 < default 24 PASS", () => {
    const v = validateFollowUpConfig({ warningBeforeHours: 4, defaultFollowUpHours: 24 });
    expect(v.ok).toBe(true);
    expect(v.config).toEqual({ warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false });
  });

  test("invalid: warning 0 FAIL (must be > 0)", () => {
    expect(validateFollowUpConfig({ warningBeforeHours: 0, defaultFollowUpHours: 24 }).ok).toBe(false);
    expect(validateFollowUpConfig({ warningBeforeHours: 4, defaultFollowUpHours: 0 }).ok).toBe(false);
  });

  test("invalid: warning >= default FAIL (window must fit the period)", () => {
    expect(validateFollowUpConfig({ warningBeforeHours: 24, defaultFollowUpHours: 24 }).ok).toBe(false);
    expect(validateFollowUpConfig({ warningBeforeHours: 48, defaultFollowUpHours: 24 }).ok).toBe(false);
  });

  test("invalid: negative / non-numeric FAIL", () => {
    expect(validateFollowUpConfig({ warningBeforeHours: -4, defaultFollowUpHours: 24 }).ok).toBe(false);
    expect(validateFollowUpConfig({ warningBeforeHours: NaN, defaultFollowUpHours: 24 }).ok).toBe(false);
    expect(validateFollowUpConfig({ warningBeforeHours: Infinity, defaultFollowUpHours: 24 }).ok).toBe(false);
    expect(validateFollowUpConfig(null).ok).toBe(false);
    expect(validateFollowUpConfig("nope").ok).toBe(false);
  });

  test("numeric strings accepted (form inputs)", () => {
    const v = validateFollowUpConfig({ warningBeforeHours: "4", defaultFollowUpHours: "24" });
    expect(v.ok).toBe(true);
    expect(v.config!.defaultFollowUpHours).toBe(24);
  });

  test("parseFollowUpConfig: stored JSON parses, garbage → null, autoCreate backfilled", () => {
    expect(parseFollowUpConfig(JSON.stringify({ warningBeforeHours: 2, defaultFollowUpHours: 48 }))).toEqual({
      warningBeforeHours: 2,
      defaultFollowUpHours: 48,
      autoCreateAfterFirstResponse: false,
    });
    expect(parseFollowUpConfig("{broken")).toBeNull();
    expect(parseFollowUpConfig({ warningBeforeHours: 9, defaultFollowUpHours: 2 })).toBeNull();
    expect(parseFollowUpConfig(null)).toBeNull();
    // legacy row without autoCreate flag still parses (backfill)
    expect(parseFollowUpConfig({ warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: true })!.autoCreateAfterFirstResponse).toBe(true);
  });

  test("missing config → engine falls back to DEFAULT_FOLLOWUP_SLA_CONFIG (no crash)", () => {
    const r = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t", 120) }, undefined, NOW);
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.DUE_SOON);
    expect(DEFAULT_FOLLOWUP_SLA_CONFIG).toEqual({ warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false });
  });

  test("config changes drive the states (4h → 8h warning flips DUE_SOON to SCHEDULED)", () => {
    const t = task("t", 300); // due in 5h
    expect(computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: t }, CFG, NOW).status).toBe(FOLLOWUP_SLA_STATUS.SCHEDULED);
    const wide: FollowUpSlaConfig = { warningBeforeHours: 8, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false };
    expect(computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: t }, wide, NOW).status).toBe(FOLLOWUP_SLA_STATUS.DUE_SOON);
  });
});

// ---------------------------------------------------------------------------
// QUICK OPTIONS (schedule/reschedule presets)
// ---------------------------------------------------------------------------

describe("quick options", () => {
  test("standard uses defaultFollowUpHours; tomorrow/3days/1week use fixed offsets", () => {
    expect(followUpQuickDate("standard", CFG, NOW).getTime()).toBe(NOW.getTime() + 24 * 3_600_000);
    expect(followUpQuickDate("tomorrow", CFG, NOW).getTime()).toBe(NOW.getTime() + 24 * 3_600_000);
    expect(followUpQuickDate("3days", CFG, NOW).getTime()).toBe(NOW.getTime() + 72 * 3_600_000);
    expect(followUpQuickDate("1week", CFG, NOW).getTime()).toBe(NOW.getTime() + 168 * 3_600_000);
    const other: FollowUpSlaConfig = { warningBeforeHours: 2, defaultFollowUpHours: 48, autoCreateAfterFirstResponse: false };
    expect(followUpQuickDate("standard", other, NOW).getTime()).toBe(NOW.getTime() + 48 * 3_600_000);
  });
});

// ---------------------------------------------------------------------------
// SORT (follow-up urgency — explicit option, never the default)
// ---------------------------------------------------------------------------

describe("follow-up urgency sort", () => {
  const mk = (id: string, status: ReturnType<typeof computeFollowUpSla>["status"], dueOffsetMin: number | null, createdAgoMin = 600) => ({
    id,
    createdAt: ago(createdAgoMin),
    followUp: {
      status,
      dueAt: dueOffsetMin == null ? null : dueOffsetMin > 0 ? ahead(dueOffsetMin) : ago(-dueOffsetMin),
    } as never,
  });

  test("OVERDUE (most overdue first) → DUE_SOON → SCHEDULED → COMPLETED → NOT_REQUIRED", () => {
    const A = mk("A", FOLLOWUP_SLA_STATUS.SCHEDULED, 24 * 60);
    const B = mk("B", FOLLOWUP_SLA_STATUS.OVERDUE, -120); // overdue 2h
    const C = mk("C", FOLLOWUP_SLA_STATUS.DUE_SOON, 90);
    const D = mk("D", FOLLOWUP_SLA_STATUS.COMPLETED, null);
    const E = mk("E", FOLLOWUP_SLA_STATUS.OVERDUE, -480); // overdue 8h
    const F = mk("F", FOLLOWUP_SLA_STATUS.NOT_REQUIRED, null);
    const sorted = [A, B, C, D, E, F].sort(compareLeadsByFollowUpUrgency);
    expect(sorted.map((x) => x.id)).toEqual(["E", "B", "C", "A", "D", "F"]);
  });

  test("within SCHEDULED: soonest deadline first", () => {
    const X = mk("X", FOLLOWUP_SLA_STATUS.SCHEDULED, 48 * 60);
    const Y = mk("Y", FOLLOWUP_SLA_STATUS.SCHEDULED, 10 * 60);
    expect([X, Y].sort(compareLeadsByFollowUpUrgency).map((x) => x.id)).toEqual(["Y", "X"]);
  });
});

// ---------------------------------------------------------------------------
// COMPLETION / RESCHEDULE SEMANTICS (requirements 51-52, engine level)
// ---------------------------------------------------------------------------

describe("completion and reschedule semantics", () => {
  test("OVERDUE lead after completion → COMPLETED (leaves the overdue set)", () => {
    const before = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t", -180) }, CFG, NOW);
    expect(before.status).toBe(FOLLOWUP_SLA_STATUS.OVERDUE);
    const after = computeFollowUpSla(
      { leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: null, lastCompleted: { id: "t", dueAt: ago(180), completedAt: NOW } },
      CFG,
      NOW
    );
    expect(after.status).toBe(FOLLOWUP_SLA_STATUS.COMPLETED);
    expect(after.isOverdue).toBe(false);
  });

  test("rescheduled overdue task dueAt=tomorrow → SCHEDULED (history retained by timeline)", () => {
    const before = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t", -180) }, CFG, NOW);
    expect(before.status).toBe(FOLLOWUP_SLA_STATUS.OVERDUE);
    const after = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("t", 24 * 60) }, CFG, NOW);
    expect(after.status).toBe(FOLLOWUP_SLA_STATUS.SCHEDULED);
    expect(after.taskId).toBe("t"); // same task — dueAt moved, cycle continues
  });
});

// ---------------------------------------------------------------------------
// FILTER DATASET (requirement 50 — engine parity for the server-side filter)
// ---------------------------------------------------------------------------

describe("filter dataset (followUp=OVERDUE matches exactly B and E)", () => {
  test("A SCHEDULED · B OVERDUE · C DUE_SOON · D COMPLETED · E OVERDUE → only B and E are overdue", () => {
    const A = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("a", 24 * 60) }, CFG, NOW);
    const B = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("b", -120) }, CFG, NOW);
    const C = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("c", 90) }, CFG, NOW);
    const D = computeFollowUpSla(
      { leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: null, lastCompleted: { id: "d", completedAt: ago(60) } },
      CFG,
      NOW
    );
    const E = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: RESPONDED, openTask: task("e", -60) }, CFG, NOW);
    const matched = [A, B, C, D, E].filter((x) => x.status === FOLLOWUP_SLA_STATUS.OVERDUE);
    expect(matched.map((x) => x.taskId)).toEqual(["b", "e"]);
  });
});

// ---------------------------------------------------------------------------
// FIRST RESPONSE MUST NOT REGRESS (requirement 53 — engine-level guard)
// ---------------------------------------------------------------------------

describe("first response engine untouched by the follow-up layer", () => {
  test("same 25h-old unanswered lead still BREACHes; responded still RESPONDED", () => {
    expect(computeFirstResponseSla({ createdAt: ago(25 * 60) }, { target: 1, warning: 4, breach: 24 }, NOW).status).toBe(SLA_STATUS.BREACH);
    expect(
      computeFirstResponseSla({ createdAt: ago(30 * 60), firstResponseAt: ago(29 * 60) }, { target: 1, warning: 4, breach: 24 }, NOW).status
    ).toBe(SLA_STATUS.RESPONDED);
  });

  test("responded lead carries BOTH layers independently (SLA RESPONDED + follow-up OVERDUE)", () => {
    const first = computeFirstResponseSla({ createdAt: ago(3000), firstResponseAt: ago(2900) }, { target: 1, warning: 4, breach: 24 }, NOW);
    const fu = computeFollowUpSla({ leadStatus: "OPEN", firstResponseAt: ago(2900), openTask: task("t", -300) }, CFG, NOW);
    expect(first.status).toBe(SLA_STATUS.RESPONDED);
    expect(fu.status).toBe(FOLLOWUP_SLA_STATUS.OVERDUE);
  });
});
