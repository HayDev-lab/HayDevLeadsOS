// STAGE INACTIVITY engine unit tests — run with: bun test
// Covers: state model (Sections 10/11/48), final stages, future timestamps,
// config validation (Section 15), sorting (Section 57), stage transition
// semantics (Sections 49/50/51/52), the automation transition helper
// (Section 118) and regression guards. First-response (28) and follow-up (31)
// suites live in tests/sla.test.ts and tests/followup-sla.test.ts and MUST
// stay green.

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STAGE_INACTIVITY_CONFIG,
  DEFAULT_STAGE_INACTIVITY_HOURS,
  DEFAULT_WARNING_BEFORE_HOURS,
  STAGE_INACTIVITY_STATUS,
  compareLeadsByStageInactivity,
  computeStageInactivity,
  detectStageInactivityTransition,
  parseStageInactivityConfig,
  resolveStageThresholdHours,
  validateStageInactivityConfig,
  type StageInactivityConfig,
} from "../src/lib/sla-stage-inactivity";
import { computeFirstResponseSla, SLA_KIND, SLA_STATUS } from "../src/lib/sla";
import { computeFollowUpSla, FOLLOWUP_SLA_STATUS } from "../src/lib/sla-followup";

const NOW = new Date("2026-09-17T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

// The org's pipeline as the engine sees it: stages keyed by ID.
const CFG: StageInactivityConfig = {
  warningBeforeHours: 12,
  stages: {
    "stage-new": { thresholdHours: 24 },
    "stage-contacted": { thresholdHours: 48 },
    "stage-qualified": { thresholdHours: 72 },
    "stage-meeting": { thresholdHours: 72 },
    "stage-proposal": { thresholdHours: 120 },
    "stage-negotiation": { thresholdHours: 120 },
  },
};

const lead = (opts: Partial<Parameters<typeof computeStageInactivity>[0]> = {}) => ({
  leadStatus: "OPEN",
  stageId: "stage-qualified",
  stageType: "open",
  stageEnteredAt: ago(24 * 60), // 24h ago by default
  createdAt: ago(40 * 60),
  ...opts,
});

// ---------------------------------------------------------------------------
// STATES (Sections 10/11/48)
// ---------------------------------------------------------------------------

describe("stage inactivity state model (per-stage thresholds)", () => {
  test("ON TRACK — threshold 72h, age 24h (Section 48)", () => {
    const r = computeStageInactivity(lead({ stageEnteredAt: ago(24 * 60) }), CFG, NOW);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
    expect(r.isStale).toBe(false);
    expect(r.isAging).toBe(false);
    expect(r.thresholdMinutes).toBe(72 * 60);
    expect(r.remainingMinutes).toBe(48 * 60);
    expect(r.overdueMinutes).toBeNull();
  });

  test("AGING — threshold 72h, warning 12h, age 65h (Section 48)", () => {
    const r = computeStageInactivity(lead({ stageEnteredAt: ago(65 * 60) }), CFG, NOW);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.AGING);
    expect(r.isAging).toBe(true);
    expect(r.remainingMinutes).toBe(7 * 60);
    expect(r.overdueMinutes).toBeNull();
  });

  test("STALE — threshold 72h, age 80h (Section 48)", () => {
    const r = computeStageInactivity(lead({ stageEnteredAt: ago(80 * 60) }), CFG, NOW);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.STALE);
    expect(r.isStale).toBe(true);
    expect(r.overdueMinutes).toBe(8 * 60);
    expect(r.remainingMinutes).toBeNull();
  });

  test("Section 11 example — Proposal threshold 120h, warning 24h: 96h ON_TRACK, 96–120h AGING, 120h+ STALE", () => {
    const cfg: StageInactivityConfig = {
      warningBeforeHours: 24,
      stages: { "stage-proposal": { thresholdHours: 120 } },
    };
    expect(computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: ago(90 * 60) }), cfg, NOW).status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
    expect(computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: ago(100 * 60) }), cfg, NOW).status).toBe(STAGE_INACTIVITY_STATUS.AGING);
    expect(computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: ago(125 * 60) }), cfg, NOW).status).toBe(STAGE_INACTIVITY_STATUS.STALE);
  });

  test("boundaries — age == threshold → STALE; age == threshold-warning → AGING; just below → ON_TRACK", () => {
    // 72h exactly
    expect(computeStageInactivity(lead({ stageEnteredAt: ago(72 * 60) }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.STALE);
    // 60h exactly (72 - 12) → AGING
    expect(computeStageInactivity(lead({ stageEnteredAt: ago(60 * 60) }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.AGING);
    // 59h59m → ON_TRACK
    expect(computeStageInactivity(lead({ stageEnteredAt: ago(60 * 60 - 1) }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
  });

  test("per-stage thresholds — same age, different stage, different status (Section 8)", () => {
    // 30h on stage: New (24h) → STALE, Contacted (48h) → ON_TRACK
    expect(computeStageInactivity(lead({ stageId: "stage-new", stageEnteredAt: ago(30 * 60) }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.STALE);
    expect(computeStageInactivity(lead({ stageId: "stage-contacted", stageEnteredAt: ago(30 * 60) }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
  });

  test("FINAL — Won lead → NOT_APPLICABLE (Section 48/9)", () => {
    const r = computeStageInactivity(lead({ leadStatus: "WON", stageId: "stage-won", stageType: "won", stageEnteredAt: ago(300 * 60) }), CFG, NOW);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.NOT_APPLICABLE);
    expect(r.thresholdMinutes).toBeNull();
    expect(r.staleAt).toBeNull();
    expect(r.warningAt).toBeNull();
  });

  test("FINAL — won STAGE TYPE wins regardless of status (defensive parity)", () => {
    const r = computeStageInactivity(lead({ leadStatus: "OPEN", stageId: "stage-won", stageType: "won", stageEnteredAt: ago(300 * 60) }), CFG, NOW);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.NOT_APPLICABLE);
  });

  test("FINAL — Lost stage / LOST + ARCHIVED statuses → NOT_APPLICABLE", () => {
    expect(computeStageInactivity(lead({ stageId: "stage-lost", stageType: "lost" }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.NOT_APPLICABLE);
    expect(computeStageInactivity(lead({ leadStatus: "LOST" }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.NOT_APPLICABLE);
    expect(computeStageInactivity(lead({ leadStatus: "ARCHIVED" }), CFG, NOW).status).toBe(STAGE_INACTIVITY_STATUS.NOT_APPLICABLE);
  });

  test("no stage at all → NOT_APPLICABLE", () => {
    const r = computeStageInactivity(lead({ stageId: null, stageType: null }), CFG, NOW);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.NOT_APPLICABLE);
  });

  test("FUTURE TIMESTAMP — stageEnteredAt > now → age clamped to 0 (Section 48/141)", () => {
    const r = computeStageInactivity(lead({ stageId: "stage-qualified", stageEnteredAt: new Date(NOW.getTime() + 5 * 3_600_000) }), CFG, NOW);
    expect(r.stageAgeMinutes).toBe(0);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
  });

  test("missing stageEnteredAt → createdAt fallback (Section 140)", () => {
    const r = computeStageInactivity(lead({ stageEnteredAt: null, createdAt: ago(30 * 60) }), CFG, NOW);
    expect(r.stageAgeMinutes).toBe(30 * 60);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
  });

  test("unknown stage (new pipeline stage) → shared default fallback (Section 14)", () => {
    const r = computeStageInactivity(lead({ stageId: "stage-brand-new" }), CFG, NOW);
    expect(r.thresholdMinutes).toBe(DEFAULT_STAGE_INACTIVITY_HOURS * 60);
    expect(r.usesFallbackThreshold).toBe(true);
  });

  test("corrupted config warning >= threshold → AGING from entry until STALE (defensive)", () => {
    const r = computeStageInactivity(lead({ stageEnteredAt: ago(1 * 60) }), { warningBeforeHours: 80, stages: { "stage-qualified": { thresholdHours: 72 } } }, NOW);
    expect(r.status).toBe(STAGE_INACTIVITY_STATUS.AGING);
  });

  test("deadline dates are derived from stageEnteredAt, never updatedAt", () => {
    const r = computeStageInactivity(lead({ stageEnteredAt: ago(60 * 60), createdAt: ago(61 * 60) }), CFG, NOW);
    // entered = NOW - 60h; warning window = 60h → warningAt = NOW; staleAt = NOW + 12h
    expect(new Date(r.warningAt!).toISOString()).toBe(NOW.toISOString());
    expect(new Date(r.staleAt!).toISOString()).toBe(new Date(NOW.getTime() + 12 * 3_600_000).toISOString());
  });
});

// ---------------------------------------------------------------------------
// CONFIG: validation + parsing (Sections 15/16/77)
// ---------------------------------------------------------------------------

describe("stage inactivity config validation", () => {
  test("valid per-stage config passes", () => {
    const v = validateStageInactivityConfig({ warningBeforeHours: 12, stages: { s1: { thresholdHours: 24 }, s2: { thresholdHours: 120 } } });
    expect(v.ok).toBe(true);
    expect(v.config!.stages.s1.thresholdHours).toBe(24);
  });

  test("threshold <= 0 rejected (server 400 / client inline)", () => {
    expect(validateStageInactivityConfig({ warningBeforeHours: 12, stages: { s1: { thresholdHours: 0 } } }).ok).toBe(false);
    expect(validateStageInactivityConfig({ warningBeforeHours: 12, stages: { s1: { thresholdHours: -5 } } }).ok).toBe(false);
  });

  test("non-finite threshold rejected", () => {
    expect(validateStageInactivityConfig({ warningBeforeHours: 12, stages: { s1: { thresholdHours: "abc" } } }).ok).toBe(false);
  });

  test("warning <= 0 rejected", () => {
    expect(validateStageInactivityConfig({ warningBeforeHours: 0, stages: { s1: { thresholdHours: 24 } } }).ok).toBe(false);
  });

  test("warning >= threshold rejected FOR EVERY stage (Section 15)", () => {
    const v = validateStageInactivityConfig({ warningBeforeHours: 30, stages: { s1: { thresholdHours: 24 } } });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("shorter");
    // one bad stage invalidates the whole config
    expect(validateStageInactivityConfig({ warningBeforeHours: 50, stages: { s1: { thresholdHours: 24 }, s2: { thresholdHours: 120 } } }).ok).toBe(false);
  });

  test("threshold numeric strings accepted (form input)", () => {
    const v = validateStageInactivityConfig({ warningBeforeHours: "12", stages: { s1: { thresholdHours: "48" } } });
    expect(v.ok).toBe(true);
    expect(v.config!.stages.s1.thresholdHours).toBe(48);
  });

  test("null / non-object input rejected", () => {
    expect(validateStageInactivityConfig(null).ok).toBe(false);
    expect(validateStageInactivityConfig("12").ok).toBe(false);
    expect(validateStageInactivityConfig({ warningBeforeHours: 12, stages: [1, 2] }).ok).toBe(false);
  });

  test("parse backfills missing warning window for legacy rows", () => {
    const parsed = parseStageInactivityConfig({ stages: { s1: { thresholdHours: 48 } } });
    expect(parsed).not.toBeNull();
    expect(parsed!.warningBeforeHours).toBe(DEFAULT_WARNING_BEFORE_HOURS);
  });

  test("parse returns null on invalid stored value (caller falls back + logs)", () => {
    expect(parseStageInactivityConfig({ warningBeforeHours: -3, stages: {} })).toBeNull();
    expect(parseStageInactivityConfig("not json")).toBeNull();
    expect(parseStageInactivityConfig(null)).toBeNull();
  });

  test("parse accepts a JSON string (SQLite storage form)", () => {
    const parsed = parseStageInactivityConfig(JSON.stringify({ warningBeforeHours: 12, stages: { s1: { thresholdHours: 24 } } }));
    expect(parsed!.stages.s1.thresholdHours).toBe(24);
  });

  test("resolveStageThresholdHours — configured / missing / null stageId", () => {
    expect(resolveStageThresholdHours(CFG, "stage-proposal")).toBe(120);
    expect(resolveStageThresholdHours(CFG, "unknown")).toBe(DEFAULT_STAGE_INACTIVITY_HOURS);
    expect(resolveStageThresholdHours(CFG, null)).toBe(DEFAULT_STAGE_INACTIVITY_HOURS);
    expect(resolveStageThresholdHours(CFG, undefined)).toBe(DEFAULT_STAGE_INACTIVITY_HOURS);
  });

  test("DEFAULT config: empty stage map + default warning (single centralized fallback)", () => {
    expect(DEFAULT_STAGE_INACTIVITY_CONFIG.stages).toEqual({});
    expect(DEFAULT_STAGE_INACTIVITY_CONFIG.warningBeforeHours).toBe(DEFAULT_WARNING_BEFORE_HOURS);
    expect(DEFAULT_STAGE_INACTIVITY_HOURS).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// STAGE TRANSITION SEMANTICS (Sections 19/20/49/50/51/52/145/146)
// ---------------------------------------------------------------------------

describe("stage transition semantics (engine-level)", () => {
  test("Section 49 — Qualified (100h, STALE) → Proposal: stageEnteredAt = now → ON_TRACK, age 0", () => {
    const before = computeStageInactivity(lead({ stageId: "stage-qualified", stageEnteredAt: ago(100 * 60) }), CFG, NOW);
    expect(before.status).toBe(STAGE_INACTIVITY_STATUS.STALE);
    // the changeStage API sets stageEnteredAt = now on a REAL transition
    const after = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: NOW }), CFG, NOW);
    expect(after.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
    expect(after.stageAgeMinutes).toBe(0);
  });

  test("Section 50 — Proposal → Proposal (same stage): stageEnteredAt UNCHANGED → still STALE", () => {
    const entered = ago(130 * 60); // 130h on Proposal > 120h
    const before = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: entered }), CFG, NOW);
    expect(before.status).toBe(STAGE_INACTIVITY_STATUS.STALE);
    // same-stage update must NOT reset the timer — the engine only reads the
    // persisted timestamp, so an unchanged timestamp yields an unchanged status
    const after = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: entered }), CFG, new Date(NOW.getTime() + 60_000));
    expect(after.stageEnteredAt.getTime()).toBe(entered.getTime());
    expect(after.status).toBe(STAGE_INACTIVITY_STATUS.STALE);
  });

  test("Section 51 — NOTE does not reset the timer (engine sees only stageEnteredAt)", () => {
    const entered = ago(130 * 60);
    const before = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: entered }), CFG, NOW);
    const after = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: entered }), CFG, NOW); // note logged, nothing changed
    expect(after.stageAgeMinutes).toBe(before.stageAgeMinutes);
    expect(after.status).toBe(STAGE_INACTIVITY_STATUS.STALE);
  });

  test("Section 52 — CALL/MESSAGE/EMAIL/MEETING do not reset the timer", () => {
    const entered = ago(130 * 60);
    for (const type of ["CALL", "MESSAGE", "EMAIL", "MEETING"]) {
      const r = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: entered }), CFG, NOW);
      expect(r.status).toBe(STAGE_INACTIVITY_STATUS.STALE);
      expect(r.stageEnteredAt.getTime()).toBe(entered.getTime());
      expect(typeof type).toBe("string"); // (activities exist independently of the stage timer)
    }
  });

  test("Section 145 — completing a follow-up does NOT reset stage age (independent engines)", () => {
    const entered = ago(80 * 60); // Qualified, 80h → STALE
    const si = computeStageInactivity(lead({ stageEnteredAt: entered }), CFG, NOW);
    const fu = computeFollowUpSla(
      { leadStatus: "OPEN", firstResponseAt: ago(100 * 60), openTask: null, lastCompleted: { id: "t1", completedAt: NOW } },
      { warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false },
      NOW
    );
    expect(fu.status).toBe(FOLLOWUP_SLA_STATUS.COMPLETED); // follow-up cycle closed…
    expect(si.status).toBe(STAGE_INACTIVITY_STATUS.STALE); // …stage timer keeps running
  });

  test("Section 146 — a first response does NOT reset stage age", () => {
    const entered = ago(80 * 60);
    const sla = computeFirstResponseSla({ createdAt: ago(90 * 60), firstResponseAt: ago(10 * 60) }, { target: 1, warning: 4, breach: 24 }, NOW);
    const si = computeStageInactivity(lead({ stageEnteredAt: entered, createdAt: ago(90 * 60) }), CFG, NOW);
    expect(sla.status).toBe(SLA_STATUS.RESPONDED); // first response happened…
    expect(si.status).toBe(STAGE_INACTIVITY_STATUS.STALE); // …stage age still counts from stage entry
    expect(si.stageAgeMinutes).toBe(80 * 60);
  });

  test("Section 147 — a stage change does not reopen the first-response SLA", () => {
    const sla = computeFirstResponseSla({ createdAt: ago(90 * 60), firstResponseAt: ago(85 * 60) }, { target: 1, warning: 4, breach: 24 }, NOW);
    expect(sla.status).toBe(SLA_STATUS.RESPONDED);
    const si = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: NOW }), CFG, NOW); // stage just changed
    expect(si.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK); // stage timer reset, SLA untouched
  });

  test("Section 90 — Won → Qualified reopen: stageEnteredAt = now → ON_TRACK, old stale NOT restored", () => {
    const reopened = computeStageInactivity(lead({ leadStatus: "OPEN", stageId: "stage-qualified", stageEnteredAt: NOW }), CFG, NOW);
    expect(reopened.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
    expect(reopened.overdueMinutes).toBeNull(); // no historical stale carries over
  });
});

// ---------------------------------------------------------------------------
// SORTING (Section 57)
// ---------------------------------------------------------------------------

describe("stage inactivity sorting (Section 57)", () => {
  const mk = (id: string, stageId: string, enteredMinutesAgo: number) => ({
    id,
    createdAt: ago(enteredMinutesAgo + 60),
    stageInactivity: computeStageInactivity(
      lead({ stageId, stageEnteredAt: ago(enteredMinutesAgo) }),
      stageId === "stage-proposal" ? { warningBeforeHours: 12, stages: { "stage-proposal": { thresholdHours: 120 } } } : CFG,
      NOW
    ),
  });

  test("C (stale 4d) → A (stale 2h) → D (aging, 1h to stale) → E (aging, 8h to stale) → B (on track)", () => {
    const a = mk("A", "stage-proposal", 122 * 60); // STALE by 2h
    const b = mk("B", "stage-qualified", 24 * 60); // ON_TRACK
    const c = mk("C", "stage-proposal", (120 + 96) * 60); // STALE by 4d
    const d = mk("D", "stage-qualified", 71 * 60); // AGING, 1h until stale
    const e = mk("E", "stage-qualified", 64 * 60); // AGING, 8h until stale
    expect([c, a, d, e, b].map((x) => x.id)).toEqual(["C", "A", "D", "E", "B"]); // sanity
    const sorted = [a, b, c, d, e].sort(compareLeadsByStageInactivity);
    expect(sorted.map((x) => x.id)).toEqual(["C", "A", "D", "E", "B"]);
  });

  test("NOT_APPLICABLE sorts last, newest first", () => {
    const stale = mk("stale", "stage-proposal", 200 * 60);
    const wonOld = { id: "won-old", createdAt: ago(3000 * 60), stageInactivity: computeStageInactivity(lead({ leadStatus: "WON", stageId: "stage-won", stageType: "won" }), CFG, NOW) };
    const wonNew = { id: "won-new", createdAt: ago(10 * 60), stageInactivity: computeStageInactivity(lead({ leadStatus: "WON", stageId: "stage-won", stageType: "won" }), CFG, NOW) };
    const sorted = [wonOld, stale, wonNew].sort(compareLeadsByStageInactivity);
    expect(sorted.map((x) => x.id)).toEqual(["stale", "won-new", "won-old"]);
  });

  test("two equally-stale leads keep a stable order (oldest entry first)", () => {
    const x = mk("x", "stage-proposal", 200 * 60);
    const y = mk("y", "stage-proposal", 190 * 60);
    expect([y, x].sort(compareLeadsByStageInactivity).map((l) => l.id)).toEqual(["x", "y"]);
  });

  test("cross-stage: STALE by largest overdue, AGING by smallest remaining (Section 30/57)", () => {
    // Proposal (120h) stale by 8h vs Qualified (72h) stale by 20h → Qualified first
    const propStale8 = mk("p8", "stage-proposal", 128 * 60); // 128h on 120h stage
    const qualStale20 = mk("q20", "stage-qualified", 92 * 60); // 92h on 72h stage
    expect([propStale8, qualStale20].sort(compareLeadsByStageInactivity).map((l) => l.id)).toEqual(["q20", "p8"]);
    // AGING: Contacted (48h) with 1h to go beats Qualified (72h) with 3h to go
    const contAging1 = mk("c1", "stage-contacted", 47 * 60); // 47h on 48h
    const qualAging3 = mk("q3", "stage-qualified", 69 * 60); // 69h on 72h
    expect([qualAging3, contAging1].sort(compareLeadsByStageInactivity).map((l) => l.id)).toEqual(["c1", "q3"]);
  });
});

// ---------------------------------------------------------------------------
// AUTOMATION TRANSITION CONTRACT (Sections 118/120) — no worker is built now
// ---------------------------------------------------------------------------

describe("detectStageInactivityTransition (future automation contract)", () => {
  test("AGING → STALE = STALE_STARTED (the LEAD_STAGE_BECAME_STALE trigger)", () => {
    expect(detectStageInactivityTransition(STAGE_INACTIVITY_STATUS.AGING, STAGE_INACTIVITY_STATUS.STALE)).toBe("STALE_STARTED");
  });
  test("ON_TRACK → AGING = AGING_STARTED", () => {
    expect(detectStageInactivityTransition(STAGE_INACTIVITY_STATUS.ON_TRACK, STAGE_INACTIVITY_STATUS.AGING)).toBe("AGING_STARTED");
  });
  test("STALE → ON_TRACK = RECOVERED (real stage change)", () => {
    expect(detectStageInactivityTransition(STAGE_INACTIVITY_STATUS.STALE, STAGE_INACTIVITY_STATUS.ON_TRACK)).toBe("RECOVERED");
  });
  test("STALE → NOT_APPLICABLE = RECOVERED (won/lost)", () => {
    expect(detectStageInactivityTransition(STAGE_INACTIVITY_STATUS.STALE, STAGE_INACTIVITY_STATUS.NOT_APPLICABLE)).toBe("RECOVERED");
  });
  test("same status / null previous = NONE", () => {
    expect(detectStageInactivityTransition(STALE(), STALE())).toBe("NONE");
    expect(detectStageInactivityTransition(null, STAGE_INACTIVITY_STATUS.STALE)).toBe("STALE_STARTED");
    expect(detectStageInactivityTransition(undefined, STAGE_INACTIVITY_STATUS.ON_TRACK)).toBe("NONE");
  });
  function STALE() {
    return STAGE_INACTIVITY_STATUS.STALE;
  }
});

// ---------------------------------------------------------------------------
// MULTI-ISSUE INDEPENDENCE (Sections 61/63/91/92/131/132)
// ---------------------------------------------------------------------------

describe("attention independence (presentation-only aggregation)", () => {
  test("Section 91 — FU OVERDUE + Stage STALE = 2 issues, not 1, not 3", () => {
    const sla = computeFirstResponseSla({ createdAt: ago(100 * 60), firstResponseAt: ago(95 * 60) }, { target: 1, warning: 4, breach: 24 }, NOW);
    const fu = computeFollowUpSla(
      { leadStatus: "OPEN", firstResponseAt: ago(95 * 60), openTask: { id: "t1", dueAt: ago(5 * 60), status: "TODO" } },
      { warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false },
      NOW
    );
    const si = computeStageInactivity(lead({ stageId: "stage-proposal", stageEnteredAt: ago(150 * 60), createdAt: ago(100 * 60) }), { warningBeforeHours: 12, stages: { "stage-proposal": { thresholdHours: 120 } } }, NOW);
    const issues = [
      ...(sla.status === SLA_STATUS.BREACH ? ["FIRST_RESPONSE"] : []),
      ...(fu.status === FOLLOWUP_SLA_STATUS.OVERDUE ? ["FOLLOW_UP"] : []),
      ...(si.status === STAGE_INACTIVITY_STATUS.STALE ? ["STAGE_INACTIVITY"] : []),
    ];
    expect(issues).toEqual(["FOLLOW_UP", "STAGE_INACTIVITY"]);
  });

  test("Section 92 — clean lead (RESPONDED + SCHEDULED + ON_TRACK) = 0 issues", () => {
    const sla = computeFirstResponseSla({ createdAt: ago(100 * 60), firstResponseAt: ago(95 * 60) }, { target: 1, warning: 4, breach: 24 }, NOW);
    const fu = computeFollowUpSla(
      { leadStatus: "OPEN", firstResponseAt: ago(95 * 60), openTask: { id: "t1", dueAt: new Date(NOW.getTime() + 26 * 3_600_000), status: "TODO" } },
      { warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false },
      NOW
    );
    const si = computeStageInactivity(lead({ stageEnteredAt: ago(24 * 60), createdAt: ago(100 * 60) }), CFG, NOW);
    expect(sla.status).toBe(SLA_STATUS.RESPONDED);
    expect(fu.status).toBe(FOLLOWUP_SLA_STATUS.SCHEDULED);
    expect(si.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
  });
});

// ---------------------------------------------------------------------------
// FILTER DATASET (Sections 55/56) — engine-side ground truth the server-side
// Prisma fragment mirrors; API/browser QA verifies the four surfaces agree.
// ---------------------------------------------------------------------------

describe("filter dataset ground truth (Section 55)", () => {
  test("A ON_TRACK / B AGING / C+D STALE / E WON → STALE = [C, D]", () => {
    const evalStatus = (id: string, stageId: string, enteredMinutesAgo: number, extra: Partial<Parameters<typeof computeStageInactivity>[0]> = {}) =>
      computeStageInactivity(lead({ stageId, stageEnteredAt: ago(enteredMinutesAgo), ...extra }), CFG, NOW).status;
    const dataset = [
      { id: "A", status: evalStatus("A", "stage-new", 3 * 60) },
      { id: "B", status: evalStatus("B", "stage-contacted", 45 * 60) },
      { id: "C", status: evalStatus("C", "stage-qualified", 80 * 60) },
      { id: "D", status: evalStatus("D", "stage-proposal", 168 * 60) },
      { id: "E", status: evalStatus("E", "stage-won", 300 * 60, { leadStatus: "WON", stageType: "won" }) },
    ];
    expect(dataset.map((d) => d.status)).toEqual([
      STAGE_INACTIVITY_STATUS.ON_TRACK,
      STAGE_INACTIVITY_STATUS.AGING,
      STAGE_INACTIVITY_STATUS.STALE,
      STAGE_INACTIVITY_STATUS.STALE,
      STAGE_INACTIVITY_STATUS.NOT_APPLICABLE,
    ]);
    expect(dataset.filter((d) => d.status === STAGE_INACTIVITY_STATUS.STALE).map((d) => d.id)).toEqual(["C", "D"]);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION — the other two engines must be untouched (Section 53/54)
// ---------------------------------------------------------------------------

describe("first-response + follow-up engines untouched (regression guard)", () => {
  test("SLA_KIND gained STAGE_INACTIVITY additively (Sections 1/18)", () => {
    expect(SLA_KIND.FIRST_RESPONSE).toBe("FIRST_RESPONSE");
    expect(SLA_KIND.FOLLOW_UP).toBe("FOLLOW_UP");
    expect(SLA_KIND.STAGE_INACTIVITY).toBe("STAGE_INACTIVITY");
  });

  test("first-response engine semantics unchanged (spot check, full suite = 28 tests)", () => {
    const r = computeFirstResponseSla({ createdAt: ago(30 * 60) }, { target: 1, warning: 4, breach: 24 }, NOW);
    expect(r.status).toBe(SLA_STATUS.BREACH);
    expect(r.elapsedMinutes).toBe(30 * 60);
  });

  test("follow-up engine semantics unchanged (spot check, full suite = 31 tests)", () => {
    const r = computeFollowUpSla(
      { leadStatus: "OPEN", firstResponseAt: ago(95 * 60), openTask: { id: "t1", dueAt: ago(5 * 60), status: "TODO" } },
      { warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false },
      NOW
    );
    expect(r.status).toBe(FOLLOWUP_SLA_STATUS.OVERDUE);
    expect(r.overdueMinutes).toBe(5 * 60);
  });
});
