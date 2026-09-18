// DOMAIN EVENT ENGINE (v0.14) — pure unit tests. Run with: bun test
// Covers: dedup keys, severity map, event planning through the REAL engines
// (no SLA logic is reimplemented here — the planners consume engine results),
// task event rules (FOLLOW_UP tasks never double-notify), preferences
// parsing/validation, config validation, templates and snapshots.
//
// DB-backed integration tests live in tests/event-engine.test.ts.

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DOMAIN_EVENT,
  DOMAIN_EVENT_TYPES,
  EVENT_SEVERITY,
  NOTIFICATION_TEMPLATES,
  EVENT_LABEL_KEYS,
  SEVERITY,
  firstResponseBreachedDedupKey,
  followUpDueSoonDedupKey,
  followUpOverdueDedupKey,
  leadAssignedDedupKey,
  parseNotificationPreferences,
  parseTaskEventConfig,
  planLeadEvents,
  planTaskEvents,
  renderEnglishSnapshot,
  stageAgingDedupKey,
  stageStaleDedupKey,
  taskAssignedDedupKey,
  taskDueSoonDedupKey,
  taskOverdueDedupKey,
  validateNotificationPreferences,
  validateTaskEventConfig,
  displayName,
  type LeadEventInput,
  type TaskEventInput,
} from "../src/lib/domain-events";
import { computeFirstResponseSla, SLA_STATUS } from "../src/lib/sla";
import { computeFollowUpSla, FOLLOWUP_SLA_STATUS } from "../src/lib/sla-followup";
import {
  computeStageInactivity,
  STAGE_INACTIVITY_STATUS,
} from "../src/lib/sla-stage-inactivity";

const NOW = new Date("2026-09-17T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const FR_THRESHOLDS = { target: 1, warning: 4, breach: 24 };
const FU_CONFIG = { warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false };
const SI_CONFIG = { warningBeforeHours: 12, stages: {} as Record<string, { thresholdHours: number }> };

// A canonical lead input for the planner.
function leadInput(over: Partial<LeadEventInput> = {}): LeadEventInput {
  return {
    id: "lead-1",
    createdAt: ago(60),
    status: "OPEN",
    stageId: "stage-3",
    stageType: "open",
    stageName: "Proposal",
    stageEnteredAt: ago(30),
    ownerId: "user-owner",
    leadName: "AquaService",
    firstResponseAt: ago(50),
    ...over,
  };
}

function enginesFor(lead: LeadEventInput, now = NOW) {
  return {
    firstResponse: computeFirstResponseSla(
      { createdAt: lead.createdAt, firstResponseAt: lead.firstResponseAt ?? null },
      FR_THRESHOLDS,
      now
    ),
    followUp: computeFollowUpSla(
      {
        leadStatus: lead.status,
        firstResponseAt: lead.firstResponseAt ?? null,
        openTask: null,
        lastCompleted: null,
      },
      FU_CONFIG,
      now
    ),
    stageInactivity: computeStageInactivity(
      {
        leadStatus: lead.status,
        stageId: lead.stageId,
        stageType: lead.stageType,
        stageEnteredAt: lead.stageEnteredAt,
        createdAt: lead.createdAt,
      },
      SI_CONFIG,
      now
    ),
  };
}

// ---------------------------------------------------------------------------
// Dedup keys
// ---------------------------------------------------------------------------

describe("dedup keys (Sections 12, 26–28)", () => {
  test("stage stale key anchors to stageEnteredAt (new cycle → new key)", () => {
    const a = stageStaleDedupKey("lead1", ago(6000));
    const b = stageStaleDedupKey("lead1", ago(10));
    expect(a).not.toBe(b);
    expect(a.startsWith("STAGE_BECAME_STALE:lead1:")).toBe(true);
  });

  test("follow-up keys anchor to taskId + dueAt (reschedule → new key)", () => {
    const due1 = ahead(120);
    const due2 = ahead(24 * 60);
    expect(followUpOverdueDedupKey("task1", due1)).not.toBe(followUpOverdueDedupKey("task1", due2));
    expect(followUpDueSoonDedupKey("task1", due1)).not.toBe(followUpDueSoonDedupKey("task2", due1));
    expect(followUpDueSoonDedupKey("task1", null)).toBe("FOLLOW_UP_DUE_SOON:task1:none");
  });

  test("first response key anchors to leadId + createdAt", () => {
    const key = firstResponseBreachedDedupKey("lead1", ago(1440));
    expect(key).toBe(`FIRST_RESPONSE_BREACHED:lead1:${ago(1440).toISOString()}`);
  });

  test("assignment keys anchor to the action instant", () => {
    const t = ago(5);
    expect(leadAssignedDedupKey("lead1", "userB", t)).toBe(`LEAD_ASSIGNED:lead1:userB:${t.toISOString()}`);
    expect(taskAssignedDedupKey("task1", "userB", t)).toBe(`TASK_ASSIGNED:task1:userB:${t.toISOString()}`);
  });

  test("task keys anchor to taskId + dueAt", () => {
    const d = ahead(60);
    expect(taskOverdueDedupKey("t1", d)).toBe(`TASK_OVERDUE:t1:${d.toISOString()}`);
    expect(taskDueSoonDedupKey("t1", d)).toBe(`TASK_DUE_SOON:t1:${d.toISOString()}`);
  });
});

// ---------------------------------------------------------------------------
// Severity + templates (Sections 19, 43–47)
// ---------------------------------------------------------------------------

describe("severity map (Section 19)", () => {
  test("every event type has a severity", () => {
    for (const type of DOMAIN_EVENT_TYPES) {
      expect(EVENT_SEVERITY[type]).toBeDefined();
    }
  });

  test("recommended severities", () => {
    expect(EVENT_SEVERITY[DOMAIN_EVENT.LEAD_ASSIGNED]).toBe(SEVERITY.INFO);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.TASK_ASSIGNED]).toBe(SEVERITY.INFO);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.FOLLOW_UP_DUE_SOON]).toBe(SEVERITY.WARNING);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.STAGE_AGING]).toBe(SEVERITY.WARNING);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.TASK_DUE_SOON]).toBe(SEVERITY.WARNING);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.FIRST_RESPONSE_BREACHED]).toBe(SEVERITY.CRITICAL);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.FOLLOW_UP_OVERDUE]).toBe(SEVERITY.CRITICAL);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.STAGE_BECAME_STALE]).toBe(SEVERITY.CRITICAL);
    expect(EVENT_SEVERITY[DOMAIN_EVENT.TASK_OVERDUE]).toBe(SEVERITY.CRITICAL);
  });

  test("every type has a template and a settings label", () => {
    for (const type of DOMAIN_EVENT_TYPES) {
      expect(NOTIFICATION_TEMPLATES[type].titleKey).toMatch(/^notif\./);
      expect(NOTIFICATION_TEMPLATES[type].messageKey).toMatch(/^notif\./);
      expect(EVENT_LABEL_KEYS[type]).toMatch(/^notif\.prefs\./);
    }
  });

  test("English snapshots are concrete, not SLA jargon (Section 44)", () => {
    const stale = renderEnglishSnapshot(DOMAIN_EVENT.STAGE_BECAME_STALE, {
      leadName: "AquaService",
      stageName: "Proposal",
      thresholdMinutes: 7200,
      overdueMinutes: 2880,
    });
    expect(stale.title).toContain("stalled");
    expect(stale.message).toContain("AquaService");
    expect(stale.message).not.toContain("SLA");

    const fr = renderEnglishSnapshot(DOMAIN_EVENT.FIRST_RESPONSE_BREACHED, {
      leadName: "AquaService",
      overdueMinutes: 300,
    });
    expect(fr.title).toBe("First response overdue");
    expect(fr.message).toContain("AquaService");
  });
});

// ---------------------------------------------------------------------------
// Lead event planning (Sections 25–28) — through the REAL engines
// ---------------------------------------------------------------------------

describe("planLeadEvents (spec conditions)", () => {
  test("FIRST RESPONSE: BREACH → event anchored to leadId+createdAt, occurredAt = breachAt", () => {
    const created = ago(30 * 60); // 30h ago > 24h breach
    const lead = leadInput({ createdAt: created, firstResponseAt: null });
    const events = planLeadEvents(lead, enginesFor(lead));
    const fr = events.find((e) => e.type === DOMAIN_EVENT.FIRST_RESPONSE_BREACHED);
    expect(fr).toBeDefined();
    expect(fr!.deduplicationKey).toBe(firstResponseBreachedDedupKey(lead.id, created));
    // breachAt = createdAt + 24h
    expect(fr!.occurredAt.getTime()).toBe(created.getTime() + 24 * 3_600_000);
  });

  test("FIRST RESPONSE: RESPONDED → no event", () => {
    const lead = leadInput({ createdAt: ago(30 * 60), firstResponseAt: ago(29 * 60) });
    const events = planLeadEvents(lead, enginesFor(lead));
    expect(events.find((e) => e.type === DOMAIN_EVENT.FIRST_RESPONSE_BREACHED)).toBeUndefined();
  });

  test("FIRST RESPONSE: WARNING (not yet breach) → no event", () => {
    const lead = leadInput({ createdAt: ago(5 * 60), firstResponseAt: null }); // 5h < 24h
    const events = planLeadEvents(lead, enginesFor(lead));
    expect(events.find((e) => e.type === DOMAIN_EVENT.FIRST_RESPONSE_BREACHED)).toBeUndefined();
  });

  test("FOLLOW-UP: OVERDUE → event with taskId+dueAt key, occurredAt = dueAt", () => {
    const lead = leadInput({ firstResponseAt: ago(50) });
    const engines = enginesFor(lead);
    engines.followUp = computeFollowUpSla(
      {
        leadStatus: "OPEN",
        firstResponseAt: ago(50),
        openTask: { id: "task-9", title: "Follow up", dueAt: ago(120), status: "TODO" },
        lastCompleted: null,
      },
      FU_CONFIG,
      NOW
    );
    expect(engines.followUp.status).toBe(FOLLOWUP_SLA_STATUS.OVERDUE);
    const events = planLeadEvents(lead, engines, { followUpAssigneeId: "user-2" });
    const ev = events.find((e) => e.type === DOMAIN_EVENT.FOLLOW_UP_OVERDUE);
    expect(ev).toBeDefined();
    expect(ev!.entityId).toBe("task-9");
    expect(ev!.deduplicationKey).toBe(followUpOverdueDedupKey("task-9", ago(120)));
    expect(ev!.occurredAt.getTime()).toBe(ago(120).getTime());
    expect(ev!.payload.assigneeId).toBe("user-2");
    expect(ev!.ownerId).toBe("user-owner");
  });

  test("FOLLOW-UP: DUE_SOON → warning event (distinct from overdue)", () => {
    const lead = leadInput({ firstResponseAt: ago(50) });
    const engines = enginesFor(lead);
    engines.followUp = computeFollowUpSla(
      {
        leadStatus: "OPEN",
        firstResponseAt: ago(50),
        openTask: { id: "task-9", title: "Follow up", dueAt: ahead(120), status: "TODO" }, // 2h → inside 4h window
        lastCompleted: null,
      },
      FU_CONFIG,
      NOW
    );
    expect(engines.followUp.status).toBe(FOLLOWUP_SLA_STATUS.DUE_SOON);
    const events = planLeadEvents(lead, engines);
    const dueSoon = events.find((e) => e.type === DOMAIN_EVENT.FOLLOW_UP_DUE_SOON);
    expect(dueSoon).toBeDefined();
    expect(events.find((e) => e.type === DOMAIN_EVENT.FOLLOW_UP_OVERDUE)).toBeUndefined();
    // occurredAt = dueAt - warning window
    expect(dueSoon!.occurredAt.getTime()).toBe(ahead(120).getTime() - 4 * 3_600_000);
  });

  test("STAGE: AGING → STAGE_AGING anchored to stageEnteredAt", () => {
    const lead = leadInput({ stageEnteredAt: ago(65 * 60) }); // 65h: inside 72-12=60h..72h
    const engines = enginesFor(lead);
    expect(engines.stageInactivity.status).toBe(STAGE_INACTIVITY_STATUS.AGING);
    const events = planLeadEvents(lead, engines);
    const ev = events.find((e) => e.type === DOMAIN_EVENT.STAGE_AGING);
    expect(ev).toBeDefined();
    expect(ev!.deduplicationKey).toBe(stageAgingDedupKey(lead.id, ago(65 * 60)));
    expect(events.find((e) => e.type === DOMAIN_EVENT.STAGE_BECAME_STALE)).toBeUndefined();
  });

  test("STAGE: STALE → STAGE_BECAME_STALE, and AGING + STALE never coexist", () => {
    const lead = leadInput({ stageEnteredAt: ago(100 * 60) }); // 100h > 72h
    const engines = enginesFor(lead);
    expect(engines.stageInactivity.status).toBe(STAGE_INACTIVITY_STATUS.STALE);
    const events = planLeadEvents(lead, engines);
    expect(events.find((e) => e.type === DOMAIN_EVENT.STAGE_BECAME_STALE)).toBeDefined();
    expect(events.find((e) => e.type === DOMAIN_EVENT.STAGE_AGING)).toBeUndefined();
  });

  test("STAGE: ON_TRACK → no stage events", () => {
    const lead = leadInput({ stageEnteredAt: ago(10 * 60) }); // 10h < 60h window start
    const engines = enginesFor(lead);
    expect(engines.stageInactivity.status).toBe(STAGE_INACTIVITY_STATUS.ON_TRACK);
    const events = planLeadEvents(lead, engines);
    expect(events.filter((e) => e.type === DOMAIN_EVENT.STAGE_AGING || e.type === DOMAIN_EVENT.STAGE_BECAME_STALE)).toHaveLength(0);
  });

  test("final stage / archived / no-owner leads still plan correctly (owner fallback is the projector's job)", () => {
    const lead = leadInput({ status: "WON", stageType: "won", ownerId: null, stageId: "stage-won" });
    const engines = enginesFor(lead);
    expect(engines.stageInactivity.status).toBe(STAGE_INACTIVITY_STATUS.NOT_APPLICABLE);
    const events = planLeadEvents(lead, engines);
    expect(events.filter((e) => e.type === DOMAIN_EVENT.STAGE_AGING || e.type === DOMAIN_EVENT.STAGE_BECAME_STALE)).toHaveLength(0);
    // ownerless lead still carries ownerId: null in the payload
    for (const ev of events) expect(ev.ownerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task event planning (Sections 6, 52)
// ---------------------------------------------------------------------------

function taskInput(over: Partial<TaskEventInput> = {}): TaskEventInput {
  return {
    id: "task-generic",
    title: "Prepare proposal",
    dueAt: ahead(60),
    status: "TODO",
    type: "TASK",
    assignedTo: "user-2",
    leadId: "lead-1",
    leadName: "AquaService",
    leadOwnerId: "user-owner",
    ...over,
  };
}

describe("planTaskEvents (generic tasks only)", () => {
  test("FOLLOW_UP-typed tasks NEVER produce TASK_* events (no double notification)", () => {
    const events = planTaskEvents(taskInput({ type: "FOLLOW_UP", dueAt: ago(30) }), { warningBeforeHours: 4 }, NOW);
    expect(events).toHaveLength(0);
  });

  test("overdue → TASK_OVERDUE with occurredAt = dueAt", () => {
    const events = planTaskEvents(taskInput({ dueAt: ago(30) }), { warningBeforeHours: 4 }, NOW);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(DOMAIN_EVENT.TASK_OVERDUE);
    expect(events[0].occurredAt.getTime()).toBe(ago(30).getTime());
    expect(events[0].payload.overdueMinutes).toBe(30);
  });

  test("inside the warning window → TASK_DUE_SOON", () => {
    const events = planTaskEvents(taskInput({ dueAt: ahead(120) }), { warningBeforeHours: 4 }, NOW);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(DOMAIN_EVENT.TASK_DUE_SOON);
    expect(events[0].payload.remainingMinutes).toBe(120);
  });

  test("beyond the window → nothing; no dueAt → nothing; closed → nothing", () => {
    expect(planTaskEvents(taskInput({ dueAt: ahead(24 * 60) }), { warningBeforeHours: 4 }, NOW)).toHaveLength(0);
    expect(planTaskEvents(taskInput({ dueAt: null }), { warningBeforeHours: 4 }, NOW)).toHaveLength(0);
    expect(planTaskEvents(taskInput({ status: "DONE" }), { warningBeforeHours: 4 }, NOW)).toHaveLength(0);
    expect(planTaskEvents(taskInput({ status: "CANCELLED" }), { warningBeforeHours: 4 }, NOW)).toHaveLength(0);
  });

  test("rescheduled dueAt → a different dedup key (new legitimate cycle, Section 28)", () => {
    const a = planTaskEvents(taskInput({ dueAt: ago(30) }), { warningBeforeHours: 4 }, NOW)[0];
    const b = planTaskEvents(taskInput({ dueAt: ahead(30) }), { warningBeforeHours: 4 }, NOW)[0];
    expect(a.deduplicationKey).not.toBe(b.deduplicationKey);
  });

  test("task events carry the recipient chain hints (assignee → lead owner)", () => {
    const ev = planTaskEvents(taskInput({ dueAt: ago(30) }), { warningBeforeHours: 4 }, NOW)[0];
    expect(ev.assigneeId).toBe("user-2");
    expect(ev.ownerId).toBe("user-owner");
    expect(ev.payload.taskId).toBe("task-generic");
  });
});

// ---------------------------------------------------------------------------
// Preferences (Sections 54–56, 99)
// ---------------------------------------------------------------------------

describe("notification preferences", () => {
  test("defaults: everything ON", () => {
    for (const type of DOMAIN_EVENT_TYPES) {
      expect(DEFAULT_NOTIFICATION_PREFERENCES[type]).toBe(true);
    }
  });

  test("parse backfills unknown/new types with ON", () => {
    const prefs = parseNotificationPreferences({ types: { STAGE_AGING: false } });
    expect(prefs.STAGE_AGING).toBe(false);
    expect(prefs.STAGE_BECAME_STALE).toBe(true);
  });

  test("parse tolerates strings, nulls and garbage", () => {
    expect(parseNotificationPreferences(null).LEAD_ASSIGNED).toBe(true);
    expect(parseNotificationPreferences("not json").LEAD_ASSIGNED).toBe(true);
    expect(parseNotificationPreferences({ types: { LEAD_ASSIGNED: false } }).LEAD_ASSIGNED).toBe(false);
  });

  test("validate rejects unknown keys and non-boolean values", () => {
    expect(validateNotificationPreferences({ NOPE: true }).ok).toBe(false);
    expect(validateNotificationPreferences({ STAGE_AGING: "yes" }).ok).toBe(false);
    const ok = validateNotificationPreferences({ STAGE_AGING: false });
    expect(ok.ok).toBe(true);
    expect(ok.prefs!.STAGE_AGING).toBe(false);
    expect(ok.prefs!.TASK_OVERDUE).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task event config (Section 53)
// ---------------------------------------------------------------------------

describe("task event config", () => {
  test("default warning window is 4h", () => {
    expect(parseTaskEventConfig(null).warningBeforeHours).toBe(4);
  });

  test("parse accepts object or JSON string, falls back on garbage", () => {
    expect(parseTaskEventConfig({ warningBeforeHours: 12 }).warningBeforeHours).toBe(12);
    expect(parseTaskEventConfig('{"warningBeforeHours": 6}').warningBeforeHours).toBe(6);
    expect(parseTaskEventConfig({ warningBeforeHours: -1 }).warningBeforeHours).toBe(4);
  });

  test("validate rejects non-positive / non-numeric windows", () => {
    expect(validateTaskEventConfig({ warningBeforeHours: 0 }).ok).toBe(false);
    expect(validateTaskEventConfig({ warningBeforeHours: "abc" }).ok).toBe(false);
    expect(validateTaskEventConfig({ warningBeforeHours: 8 }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

describe("displayName", () => {
  test("prefers the person name, falls back to company, then 'Lead'", () => {
    expect(displayName({ firstName: "Anna", lastName: "Petrosyan", company: "X" })).toBe("Anna Petrosyan");
    expect(displayName({ company: "AquaService" })).toBe("AquaService");
    expect(displayName({})).toBe("Lead");
  });
});
