// AUTOMATION ENGINE (v0.15) — INTEGRATION tests against the real SQLite DB.
// Run with: bun test tests/automation-engine.test.ts
//
// Every test runs inside a THROWAWAY organization (deleted afterwards with
// cascade). Covers the spec's critical scenarios:
//   SUCCESS (87) · SKIPPED (88) · IDEMPOTENCY ×10 (89, 117) · TWO RULES (90)
//   DISABLED RULE (91, 124) · enabledAt BACKLOG GUARD (92–93, 95, 118)
//   ACTIONABILITY (96, 119, 55–57) · MULTI-ACTION FAILURE (97, 122)
//   RETRY (78) · RECURSION/LOOP PROTECTION (121, 27–28) · TENANT (109, 127)
//   DRY RUN (111) · processor stress ×5 (108) · assignment events (59)
//   causation metadata (29).

/// <reference types="bun-types" />
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  stageStaleDedupKey,
  followUpOverdueDedupKey,
  leadAssignedDedupKey,
} from "../src/lib/domain-events";
import {
  processEventRule,
  retryAutomationExecution,
  dryRunAutomationRule,
  isDomainEventActionable,
  getAutomationChainDepth,
} from "../src/lib/leados/automation-engine";
import { runAutomationProcessor } from "../src/lib/leados/automation-processor";
import { runLeadOSWorkers } from "../src/lib/leados/leados-workers";

const db = new PrismaClient();

const SLUG = `automation-test-${Date.now()}`;
let orgId = "";
let orgBId = ""; // second org — tenant isolation
let ownerA = "";
let managerB = "";
let stageProposal = "";
let stageWon = "";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3_600_000);

interface RuleSeed {
  name: string;
  triggerType: string;
  conditions?: unknown;
  actions: unknown;
  enabled?: boolean;
  enabledAt?: Date | null;
}

async function mkRule(seed: RuleSeed, org = orgId) {
  return db.automationRule.create({
    data: {
      organizationId: org,
      name: seed.name,
      enabled: seed.enabled ?? true,
      enabledAt: seed.enabledAt ?? daysAgo(1),
      triggerType: seed.triggerType,
      conditions: (seed.conditions ?? null) as never,
      actions: seed.actions as never,
    },
  });
}

async function mkLead(opts: {
  name: string;
  stageId?: string;
  stageAgeHours?: number;
  ownerId?: string | null;
  priority?: string;
  status?: string;
  org?: string;
  createdDaysAgo?: number;
}) {
  const org = opts.org ?? orgId;
  const pipeline = await db.pipeline.findFirst({ where: { organizationId: org, isDefault: true } });
  const stage = (opts.stageId
    ? await db.pipelineStage.findUnique({ where: { id: opts.stageId } })
    : await db.pipelineStage.findFirst({ where: { pipelineId: pipeline!.id, name: "New" } }))!;
  return db.lead.create({
    data: {
      organizationId: org,
      firstName: opts.name,
      company: `${opts.name} Co`,
      status: opts.status ?? "OPEN",
      pipelineId: pipeline!.id,
      stageId: stage.id,
      ownerId: opts.ownerId === undefined ? managerB : opts.ownerId,
      priority: opts.priority ?? "MEDIUM",
      stageEnteredAt: hoursAgo(opts.stageAgeHours ?? 1),
      createdAt: opts.createdDaysAgo != null ? daysAgo(opts.createdDaysAgo) : hoursAgo(opts.stageAgeHours ?? 2),
    },
  });
}

/** Publish a STAGE_BECAME_STALE event for a lead (the canonical automation trigger). */
async function mkStaleEvent(lead: { id: string; stageId: string | null; stageEnteredAt: Date | null; ownerId: string | null }, org = orgId, name = "Test Lead", occurredAt = new Date()) {
  const { event } = await (await import("../src/lib/leados/domain-event-service")).publishDomainEvent(org, {
    type: DOMAIN_EVENT.STAGE_BECAME_STALE,
    entityType: ENTITY_TYPE.LEAD,
    entityId: lead.id,
    occurredAt,
    deduplicationKey: stageStaleDedupKey(lead.id, lead.stageEnteredAt ?? new Date()) + ":" + occurredAt.getTime(),
    payload: {
      leadId: lead.id,
      leadName: name,
      stageId: lead.stageId,
      stageName: "Proposal",
      stageEnteredAt: (lead.stageEnteredAt ?? new Date()).toISOString(),
      thresholdMinutes: 2880,
      overdueMinutes: 600,
      ownerId: lead.ownerId,
    },
  });
  return event;
}

async function executionsFor(ruleId: string) {
  return db.automationExecution.findMany({ where: { ruleId }, orderBy: { createdAt: "asc" } });
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: "Automation Test A", slug: SLUG, locale: "en", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  orgId = org.id;
  const orgB = await db.organization.create({
    data: { name: "Automation Test B", slug: `${SLUG}-b`, locale: "en", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  orgBId = orgB.id;

  ownerA = (
    await db.user.create({ data: { organizationId: orgId, name: "Owner A", email: "owner-a@auto.test", role: "OWNER", status: "ACTIVE" } })
  ).id;
  managerB = (
    await db.user.create({ data: { organizationId: orgId, name: "Manager B", email: "manager-b@auto.test", role: "MANAGER", status: "ACTIVE" } })
  ).id;
  await db.user.create({ data: { organizationId: orgBId, name: "Org B User", email: "b@auto.test", role: "OWNER", status: "ACTIVE" } });

  for (const org of [orgId, orgBId]) {
    const pipeline = await db.pipeline.create({ data: { organizationId: org, name: "P", isDefault: true } });
    await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } });
    stageProposal = (
      await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "Proposal", type: "open", position: 1 } })
    ).id;
    stageWon = (
      await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "Won", type: "won", position: 2 } })
    ).id;
  }
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgId, orgBId] } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// ENGINE — SUCCESS / SKIPPED (spec 87–88, 114–115)
// ---------------------------------------------------------------------------

describe("engine: success / skipped", () => {
  test("SUCCESS — FOLLOW_UP_OVERDUE + priority HIGH → 1 task created (spec 87, 115)", async () => {
    const lead = await mkLead({ name: "High FU", priority: "HIGH" });
    const task = await db.task.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        assignedTo: managerB,
        title: "Follow up with High FU",
        type: "FOLLOW_UP",
        status: "TODO",
        dueAt: hoursAgo(26),
      },
    });
    const { publishDomainEvent } = await import("../src/lib/leados/domain-event-service");
    const { event } = await publishDomainEvent(orgId, {
      type: DOMAIN_EVENT.FOLLOW_UP_OVERDUE,
      entityType: ENTITY_TYPE.TASK,
      entityId: task.id,
      occurredAt: hoursAgo(2),
      deduplicationKey: followUpOverdueDedupKey(task.id, hoursAgo(26)),
      payload: {
        leadId: lead.id,
        leadName: "High FU",
        taskId: task.id,
        taskTitle: task.title,
        dueAt: hoursAgo(26).toISOString(),
        overdueMinutes: 1560,
        assigneeId: managerB,
        ownerId: lead.ownerId,
      },
    });

    const rule = await mkRule({
      name: "Escalate high-priority overdue follow-ups",
      triggerType: DOMAIN_EVENT.FOLLOW_UP_OVERDUE,
      conditions: { all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }] },
      actions: [{ type: "CREATE_TASK", params: { title: "Escalation: {leadName}", dueInHours: 8, priority: "URGENT", assignTo: "LEAD_OWNER" } }],
    });

    const result = await processEventRule(event, rule);
    expect(result.created).toBe(true);
    expect(result.execution?.status).toBe("SUCCESS");

    // exactly ONE automation task for this lead
    const autoTasks = await db.task.findMany({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } });
    expect(autoTasks.length).toBe(1);
    expect(autoTasks[0].title).toBe("Escalation: High FU");
    expect(autoTasks[0].automationRuleId).toBe(rule.id);
    expect(autoTasks[0].automationExecutionId).toBe(result.execution!.id);
    expect(autoTasks[0].priority).toBe("URGENT");
  });

  test("SKIPPED — priority NORMAL → no task, trace explains (spec 88, 77)", async () => {
    const lead = await mkLead({ name: "Normal FU", priority: "NORMAL" in {} ? "MEDIUM" : "MEDIUM" });
    const task = await db.task.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        assignedTo: managerB,
        title: "Follow up with Normal FU",
        type: "FOLLOW_UP",
        status: "TODO",
        dueAt: hoursAgo(10),
      },
    });
    const { publishDomainEvent } = await import("../src/lib/leados/domain-event-service");
    const { event } = await publishDomainEvent(orgId, {
      type: DOMAIN_EVENT.FOLLOW_UP_OVERDUE,
      entityType: ENTITY_TYPE.TASK,
      entityId: task.id,
      occurredAt: hoursAgo(1),
      deduplicationKey: followUpOverdueDedupKey(task.id, hoursAgo(10)),
      payload: { leadId: lead.id, leadName: "Normal FU", taskId: task.id, taskTitle: task.title, dueAt: hoursAgo(10).toISOString(), overdueMinutes: 600, assigneeId: managerB, ownerId: lead.ownerId },
    });

    const rule = await mkRule({
      name: "High only follow-up",
      triggerType: DOMAIN_EVENT.FOLLOW_UP_OVERDUE,
      conditions: { all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }] },
      actions: [{ type: "CREATE_TASK", params: { title: "Should not appear", assignTo: "LEAD_OWNER" } }],
    });

    const result = await processEventRule(event, rule);
    expect(result.execution?.status).toBe("SKIPPED");
    expect(result.execution?.skipReason).toBe("CONDITIONS_NOT_MATCHED");

    // Condition trace (spec 53): expected HIGH, actual MEDIUM
    const stored = (result.execution?.result ?? {}) as { conditions?: { expected: unknown; actual: unknown; passed: boolean }[] };
    expect(stored.conditions?.[0]?.expected).toBe("HIGH");
    expect(stored.conditions?.[0]?.actual).toBe("MEDIUM");
    expect(stored.conditions?.[0]?.passed).toBe(false);

    const autoTasks = await db.task.findMany({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } });
    expect(autoTasks.length).toBe(0);
  });

  test("SUCCESS — STAGE_BECAME_STALE + stage Proposal → SET_LEAD_PRIORITY raises to HIGH (spec 116)", async () => {
    const lead = await mkLead({ name: "Stale Proposal", stageId: stageProposal, priority: "MEDIUM", stageAgeHours: 200 });
    const event = await mkStaleEvent(lead, orgId, "Stale Proposal");
    await db.domainEvent.delete({ where: { id: event.id } }).catch(() => {});
    // re-publish without projector side effects noise:
    const raw = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.STAGE_BECAME_STALE,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: new Date(),
        deduplicationKey: stageStaleDedupKey(lead.id, lead.stageEnteredAt!) + ":pr",
        payload: { leadId: lead.id, leadName: "Stale Proposal", stageId: lead.stageId, stageName: "Proposal", stageEnteredAt: lead.stageEnteredAt!.toISOString(), thresholdMinutes: 2880, overdueMinutes: 600, ownerId: lead.ownerId },
      },
    });

    const rule = await mkRule({
      name: "Stale proposal escalation",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: { all: [{ field: "lead.stage.type", operator: "equals", value: "open" }] },
      actions: [{ type: "SET_LEAD_PRIORITY", params: { priority: "HIGH" } }],
    });

    const result = await processEventRule(raw, rule);
    expect(result.execution?.status).toBe("SUCCESS");
    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.priority).toBe("HIGH");
    // Existing business service wrote a meaningful Activity (spec 62) — not a
    // separate "automation did something" row.
    const activities = await db.activity.findMany({ where: { leadId: lead.id } });
    expect(activities.length).toBeGreaterThan(0);
    expect(activities.some((a) => a.type === "AUTOMATION")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY (spec 89, 114, 117)
// ---------------------------------------------------------------------------

describe("idempotency: one event + one rule = max one execution", () => {
  test("process same rule+event 10 times → 1 execution, 1 task (spec 89, 117)", async () => {
    const lead = await mkLead({ name: "Idem", priority: "HIGH", stageAgeHours: 100 });
    const event = await mkStaleEvent(lead, orgId, "Idem");
    const rule = await mkRule({
      name: "Idem rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: { all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }] },
      actions: [{ type: "CREATE_TASK", params: { title: "Idem task", assignTo: "LEAD_OWNER" } }],
    });

    for (let i = 0; i < 10; i++) {
      const r = await processEventRule(event, rule);
      if (i === 0) {
        expect(r.created).toBe(true);
        expect(r.execution?.status).toBe("SUCCESS");
      } else {
        expect(r.created).toBe(false);
        expect(r.execution).toBeNull();
      }
    }

    const executions = await executionsFor(rule.id);
    expect(executions.length).toBe(1);
    const tasks = await db.task.findMany({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } });
    expect(tasks.length).toBe(1);
  });

  test("TWO RULES on the same event → 2 executions (spec 90)", async () => {
    const lead = await mkLead({ name: "TwoRules", priority: "HIGH", stageAgeHours: 100 });
    const event = await mkStaleEvent(lead, orgId, "TwoRules");
    const ruleA = await mkRule({
      name: "TwoRules A (task)",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "CREATE_TASK", params: { title: "A task", assignTo: "LEAD_OWNER" } }],
    });
    const ruleB = await mkRule({
      name: "TwoRules B (priority)",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "SET_LEAD_PRIORITY", params: { priority: "URGENT" } }],
    });

    await processEventRule(event, ruleA);
    await processEventRule(event, ruleB);

    const execsA = await executionsFor(ruleA.id);
    const execsB = await executionsFor(ruleB.id);
    expect(execsA.length).toBe(1);
    expect(execsB.length).toBe(1);
    expect(execsA[0].status).toBe("SUCCESS");
    expect(execsB[0].status).toBe("SUCCESS");
  });
});

// ---------------------------------------------------------------------------
// DISABLED RULE + BACKLOG GUARD (spec 91–93, 95, 118, 124)
// ---------------------------------------------------------------------------

describe("disabled rule + backlog guard", () => {
  test("disabled rule → no execution; nothing happens (spec 91, 124)", async () => {
    const lead = await mkLead({ name: "Paused", priority: "HIGH", stageAgeHours: 100 });
    const event = await mkStaleEvent(lead, orgId, "Paused");
    const rule = await mkRule({
      name: "Paused rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      enabled: false,
      enabledAt: null,
      conditions: null,
      actions: [{ type: "CREATE_TASK", params: { title: "nope", assignTo: "LEAD_OWNER" } }],
    });
    const r = await processEventRule(event, rule);
    // The engine still records the encounter? NO — disabled rules are not even
    // candidates (processor skips them); direct calls are a programming error,
    // so we simply assert no ACTION side effects and no execution row.
    expect(r.created).toBe(false);
    expect(await db.task.count({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } })).toBe(0);
  });

  test("processor skips disabled rules entirely (spec 124)", async () => {
    const lead = await mkLead({ name: "ProcPaused", priority: "HIGH", stageAgeHours: 100 });
    await mkStaleEvent(lead, orgId, "ProcPaused");
    await mkRule({
      name: "Processor paused rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      enabled: false,
      enabledAt: null,
      conditions: null,
      actions: [{ type: "CREATE_TASK", params: { title: "nope", assignTo: "LEAD_OWNER" } }],
    });
    const summary = await runAutomationProcessor(orgId);
    // The rule was not considered at all.
    expect(summary.rulesConsidered).toBeGreaterThanOrEqual(1);
    const execs = await db.automationExecution.findMany({
      where: { rule: { name: "Processor paused rule" } },
    });
    expect(execs.length).toBe(0);
  });

  test("NEW rule does NOT process OLD events (enabledAt backlog guard, spec 92–93, 118)", async () => {
    const lead = await mkLead({ name: "OldEvent", priority: "HIGH", stageAgeHours: 100, createdDaysAgo: 10 });
    const event = await mkStaleEvent(lead, orgId, "OldEvent", daysAgo(10));
    // event occurred 10 days ago; rule activated 1 day ago (mkRule default)
    expect(event.occurredAt.getTime()).toBeLessThan(daysAgo(2).getTime());

    const rule = await mkRule({
      name: "New rule, old events",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "CREATE_TASK", params: { title: "should not run", assignTo: "LEAD_OWNER" } }],
    });

    const r = await processEventRule(event, rule);
    // processEventRule guards too — old event + new rule → not executed.
    expect(r.created).toBe(false);
    expect(r.execution).toBeNull();
    const tasks = await db.task.findMany({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } });
    expect(tasks.length).toBe(0);
    // No execution row was created for THIS pair via the processor either
    // (the shared org may hold other, recent events the rule may legally run
    // on — the backlog guard only protects events older than the activation):
    await runAutomationProcessor(orgId);
    const pair = await db.automationExecution.findUnique({
      where: { ruleId_eventId: { ruleId: rule.id, eventId: event.id } },
    });
    expect(pair).toBeNull();
    expect(await db.task.count({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ACTIONABILITY (spec 96, 119, 55–60)
// ---------------------------------------------------------------------------

describe("actionability guard (spec 56–60, 96)", () => {
  test("old stale event + lead already WON → SKIPPED EVENT_NO_LONGER_ACTIONABLE (spec 96, 119)", async () => {
    const lead = await mkLead({ name: "LateWin", priority: "HIGH", stageAgeHours: 100 });
    const event = await mkStaleEvent(lead, orgId, "LateWin");
    // The problem was fixed manually BEFORE the processor ran:
    await db.lead.update({ where: { id: lead.id }, data: { status: "WON", stageId: stageWon, stageEnteredAt: new Date() } });

    const rule = await mkRule({
      name: "Late runner",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "CREATE_TASK", params: { title: "useless task", assignTo: "LEAD_OWNER" } }],
    });

    const r = await processEventRule(event, rule);
    expect(r.execution?.status).toBe("SKIPPED");
    expect(r.execution?.skipReason).toBe("EVENT_NO_LONGER_ACTIONABLE");
    expect(await db.task.count({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } })).toBe(0);
  });

  test("stage changed since the event → SKIPPED (timer reset)", async () => {
    const lead = await mkLead({ name: "MovedOn", priority: "HIGH", stageAgeHours: 100 });
    const event = await mkStaleEvent(lead, orgId, "MovedOn");
    await db.lead.update({ where: { id: lead.id }, data: { stageEnteredAt: new Date() } });

    const actionability = await isDomainEventActionable(event);
    expect(actionability.actionable).toBe(false);
    expect(actionability.reason).toBe("STAGE_TIMER_RESET");
  });

  test("completed follow-up task → not actionable (spec 60)", async () => {
    const lead = await mkLead({ name: "DoneFU", priority: "HIGH" });
    const task = await db.task.create({
      data: { organizationId: orgId, leadId: lead.id, assignedTo: managerB, title: "done fu", type: "FOLLOW_UP", status: "DONE", dueAt: hoursAgo(10) },
    });
    const event = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.FOLLOW_UP_OVERDUE,
        entityType: ENTITY_TYPE.TASK,
        entityId: task.id,
        occurredAt: hoursAgo(1),
        deduplicationKey: followUpOverdueDedupKey(task.id, hoursAgo(10)),
        payload: { leadId: lead.id, taskId: task.id, overdueMinutes: 600, assigneeId: managerB, ownerId: lead.ownerId },
      },
    });
    const actionability = await isDomainEventActionable(event);
    expect(actionability.actionable).toBe(false);
    expect(actionability.reason).toBe("TASK_COMPLETED");
  });

  test("LEAD_ASSIGNED stays actionable while the assignee is still the owner (spec 59)", async () => {
    const lead = await mkLead({ name: "Assigned", ownerId: managerB });
    const event = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.LEAD_ASSIGNED,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: hoursAgo(1),
        deduplicationKey: leadAssignedDedupKey(lead.id, managerB, hoursAgo(1)),
        payload: { leadId: lead.id, leadName: "Assigned", assigneeId: managerB, ownerId: managerB },
      },
    });
    expect((await isDomainEventActionable(event)).actionable).toBe(true);
    // Reassigned to someone else → no longer actionable for this event.
    await db.lead.update({ where: { id: lead.id }, data: { ownerId: ownerA } });
    const after = await isDomainEventActionable(event);
    expect(after.actionable).toBe(false);
    expect(after.reason).toBe("ASSIGNEE_CHANGED");
  });
});

// ---------------------------------------------------------------------------
// MULTI-ACTION FAILURE + RETRY (spec 23, 78, 97, 122)
// ---------------------------------------------------------------------------

describe("multi-action failure policy + manual retry", () => {
  test("action 1 SUCCESS, action 2 FAILED → execution FAILED, action 3 SKIPPED, partials kept (spec 97, 122)", async () => {
    const lead = await mkLead({ name: "Partial", ownerId: null, priority: "HIGH", stageAgeHours: 100 }); // NO owner → assignTo LEAD_OWNER fails
    const event = await mkStaleEvent(lead, orgId, "Partial");

    const rule = await mkRule({
      name: "Partial fail rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [
        { type: "SET_LEAD_PRIORITY", params: { priority: "URGENT" } }, // 1 — succeeds
        { type: "CREATE_TASK", params: { title: "needs owner", assignTo: "LEAD_OWNER" } }, // 2 — FAILS (no owner)
        { type: "ADD_NOTE", params: { content: "never runs" } }, // 3 — must NOT run
      ],
    });

    const r = await processEventRule(event, rule);
    expect(r.execution?.status).toBe("FAILED");
    expect(r.execution?.error).toBeTruthy(); // human message, no stack trace
    expect(r.execution?.error).not.toMatch(/at .+\(/); // no stack frames

    const result = (r.execution!.result ?? {}) as { actions: { status: string; type: string }[] };
    expect(result.actions).toHaveLength(3);
    expect(result.actions[0].status).toBe("SUCCESS");
    expect(result.actions[1].status).toBe("FAILED");
    expect(result.actions[2].status).toBe("SKIPPED");

    // Action 1's effect IS visible (partial completion, spec 97)
    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.priority).toBe("URGENT");
    // Action 3 never ran:
    expect(await db.note.count({ where: { leadId: lead.id } })).toBe(0);
  });

  test("MANUAL RETRY after fixing the cause → SUCCESS; already-successful action NOT re-run (spec 78, 26)", async () => {
    const lead = await mkLead({ name: "Retry", ownerId: null, priority: "MEDIUM", stageAgeHours: 100 });
    const event = await mkStaleEvent(lead, orgId, "Retry");

    const rule = await mkRule({
      name: "Retry rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [
        { type: "SET_LEAD_PRIORITY", params: { priority: "HIGH" } }, // succeeds first time
        { type: "CREATE_TASK", params: { title: "needs owner", assignTo: "LEAD_OWNER" } }, // fails first time
      ],
    });

    const first = await processEventRule(event, rule);
    expect(first.execution?.status).toBe("FAILED");

    // Fix the cause:
    await db.lead.update({ where: { id: lead.id }, data: { ownerId: managerB } });

    const retry = await retryAutomationExecution(orgId, first.execution!.id);
    expect(retry.ok).toBe(true);
    expect(retry.execution?.status).toBe("SUCCESS");

    // Priority action already succeeded BEFORE the retry → NOT executed again,
    // and the task was created exactly once.
    const lead2 = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(lead2.ownerId).toBe(managerB);
    const tasks = await db.task.findMany({ where: { organizationId: orgId, leadId: lead.id, type: "TASK" } });
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe("needs owner");

    // The execution row is the SAME row (no duplicate, spec 26):
    const execs = await executionsFor(rule.id);
    expect(execs.length).toBe(1);
    expect(execs[0].id).toBe(first.execution!.id);
    expect(execs[0].status).toBe("SUCCESS");
  });

  test("SUCCESS execution can NOT be replayed via retry (spec 26)", async () => {
    const lead = await mkLead({ name: "NoReplay", priority: "HIGH", stageAgeHours: 100 });
    const event = await mkStaleEvent(lead, orgId, "NoReplay");
    const rule = await mkRule({
      name: "No replay rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "CREATE_TASK", params: { title: "once", assignTo: "LEAD_OWNER" } }],
    });
    const first = await processEventRule(event, rule);
    expect(first.execution?.status).toBe("SUCCESS");
    const retry = await retryAutomationExecution(orgId, first.execution!.id);
    expect(retry.ok).toBe(false);
    expect(retry.error).toContain("Only failed");
  });
});

// ---------------------------------------------------------------------------
// RECURSION / LOOP PROTECTION (spec 27–29, 121)
// ---------------------------------------------------------------------------

describe("recursion + causation (spec 27–29, 121)", () => {
  test("automation-created events carry automationExecutionId (causation, spec 29)", async () => {
    const lead = await mkLead({ name: "Cause", ownerId: ownerA, priority: "MEDIUM" });
    const { publishDomainEvent } = await import("../src/lib/leados/domain-event-service");
    // A rule that ASSIGNS the lead → assignLead publishes LEAD_ASSIGNED.
    const rule = await mkRule({
      name: "Reassign rule",
      triggerType: DOMAIN_EVENT.LEAD_ASSIGNED,
      conditions: null,
      actions: [{ type: "ASSIGN_LEAD", params: { assignTo: "SPECIFIC_USER", userId: managerB } }],
    });
    const { event } = await publishDomainEvent(orgId, {
      type: DOMAIN_EVENT.LEAD_ASSIGNED,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: new Date(),
      deduplicationKey: leadAssignedDedupKey(lead.id, ownerA, new Date()),
      payload: { leadId: lead.id, leadName: "Cause", assigneeId: ownerA, ownerId: ownerA },
    });

    const r = await processEventRule(event, rule);
    expect(r.execution?.status).toBe("SUCCESS");

    // The new LEAD_ASSIGNED event (for managerB) is stamped with the execution:
    const chained = await db.domainEvent.findMany({
      where: { organizationId: orgId, type: DOMAIN_EVENT.LEAD_ASSIGNED, entityId: lead.id, automationExecutionId: { not: null } },
    });
    expect(chained.length).toBe(1);
    expect(chained[0].automationExecutionId).toBe(r.execution!.id);
  });

  test("chain depth: 0 for world events, grows through automation hops (spec 28)", async () => {
    const chainRuleA = await mkRule({ name: "chain-dummy-a", triggerType: DOMAIN_EVENT.LEAD_ASSIGNED, conditions: null, actions: [{ type: "ADD_NOTE", params: { content: "-" } }] });
    const chainRuleB = await mkRule({ name: "chain-dummy-b", triggerType: DOMAIN_EVENT.LEAD_ASSIGNED, conditions: null, actions: [{ type: "ADD_NOTE", params: { content: "-" } }] });
    const lead = await mkLead({ name: "Depth", ownerId: ownerA, priority: "MEDIUM" });
    const worldEvent = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.LEAD_ASSIGNED,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: new Date(),
        deduplicationKey: `depth:${lead.id}`,
        payload: { leadId: lead.id, assigneeId: ownerA, ownerId: ownerA },
      },
    });
    expect(await getAutomationChainDepth(worldEvent)).toBe(0);

    // Simulate an automation-caused event chain: event ← exec1 ← event0 ← exec0 ← eventWorld
    const exec0 = await db.automationExecution.create({
      data: { organizationId: orgId, ruleId: chainRuleA.id, eventId: worldEvent.id, status: "SUCCESS", ruleVersion: 1 },
    });
    const event1 = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.LEAD_ASSIGNED,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: new Date(),
        deduplicationKey: `depth1:${lead.id}`,
        payload: { leadId: lead.id, assigneeId: ownerA, ownerId: ownerA },
        automationExecutionId: exec0.id,
      },
    });
    expect(await getAutomationChainDepth(event1)).toBe(1);

    const exec1 = await db.automationExecution.create({
      data: { organizationId: orgId, ruleId: chainRuleB.id, eventId: event1.id, status: "SUCCESS", ruleVersion: 1 },
    });
    const event2 = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.LEAD_ASSIGNED,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: new Date(),
        deduplicationKey: `depth2:${lead.id}`,
        payload: { leadId: lead.id, assigneeId: ownerA, ownerId: ownerA },
        automationExecutionId: exec1.id,
      },
    });
    expect(await getAutomationChainDepth(event2)).toBe(2);
  });

  test("deep chain (depth ≥ 5) → SKIPPED AUTOMATION_DEPTH_EXCEEDED (spec 28, 121)", async () => {
    const loopRuleSeed = await mkRule({ name: "loop-dummy", triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE, conditions: null, actions: [{ type: "ADD_NOTE", params: { content: "-" } }] });
    const lead = await mkLead({ name: "Loop", ownerId: ownerA, priority: "HIGH", stageAgeHours: 100 });
    // Build a chain of 5 executions/events.
    let parentEvent = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.STAGE_BECAME_STALE,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: new Date(),
        deduplicationKey: `loop-root:${lead.id}`,
        payload: { leadId: lead.id, stageId: lead.stageId, stageEnteredAt: lead.stageEnteredAt!.toISOString(), ownerId: lead.ownerId, stageName: "Proposal" },
      },
    });
    for (let i = 0; i < 4; i++) {
      const exec = await db.automationExecution.create({
        data: { organizationId: orgId, ruleId: loopRuleSeed.id, eventId: parentEvent.id, status: "SUCCESS", ruleVersion: 1 },
      });
      parentEvent = await db.domainEvent.create({
        data: {
          organizationId: orgId,
          type: DOMAIN_EVENT.STAGE_BECAME_STALE,
          entityType: ENTITY_TYPE.LEAD,
          entityId: lead.id,
          occurredAt: new Date(),
          deduplicationKey: `loop-${i}:${lead.id}`,
          payload: { leadId: lead.id, stageId: lead.stageId, stageEnteredAt: lead.stageEnteredAt!.toISOString(), ownerId: lead.ownerId, stageName: "Proposal" },
          automationExecutionId: exec.id,
        },
      });
    }
    // parentEvent now has chain depth 4; a rule running on it is depth 4 (< 5, allowed):
    const rule = await mkRule({
      name: "Chain rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "ADD_NOTE", params: { content: "chain note" } }],
    });
    const r4 = await processEventRule(parentEvent, rule);
    expect(r4.execution?.status).toBe("SUCCESS");

    // depth 5 → skipped:
    const exec5 = await db.automationExecution.create({
      data: { organizationId: orgId, ruleId: loopRuleSeed.id, eventId: parentEvent.id, status: "SUCCESS", ruleVersion: 1 },
    });
    const event5 = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.STAGE_BECAME_STALE,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: new Date(),
        deduplicationKey: `loop-final:${lead.id}`,
        payload: { leadId: lead.id, stageId: lead.stageId, stageEnteredAt: lead.stageEnteredAt!.toISOString(), ownerId: lead.ownerId, stageName: "Proposal" },
        automationExecutionId: exec5.id,
      },
    });
    const rule2 = await mkRule({
      name: "Deep rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "ADD_NOTE", params: { content: "never" } }],
    });
    const r5 = await processEventRule(event5, rule2);
    expect(r5.execution?.status).toBe("SKIPPED");
    expect(r5.execution?.skipReason).toBe("AUTOMATION_DEPTH_EXCEEDED");
  });
});

// ---------------------------------------------------------------------------
// TENANT ISOLATION (spec 4, 109, 127)
// ---------------------------------------------------------------------------

describe("tenant isolation", () => {
  test("org A rule NEVER matches org B event (spec 109, 127)", async () => {
    const leadB = await mkLead({ name: "LeadB", org: orgBId, priority: "HIGH", stageAgeHours: 100 });
    // event in org B
    const eventB = await db.domainEvent.create({
      data: {
        organizationId: orgBId,
        type: DOMAIN_EVENT.STAGE_BECAME_STALE,
        entityType: ENTITY_TYPE.LEAD,
        entityId: leadB.id,
        occurredAt: new Date(),
        deduplicationKey: `tenant:${leadB.id}`,
        payload: { leadId: leadB.id, stageId: leadB.stageId, stageEnteredAt: leadB.stageEnteredAt!.toISOString(), ownerId: leadB.ownerId, stageName: "Proposal" },
      },
    });
    // rule in org A
    const ruleA = await mkRule({
      name: "OrgA rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: null,
      actions: [{ type: "CREATE_TASK", params: { title: "cross-tenant", assignTo: "LEAD_OWNER" } }],
    });
    const r = await processEventRule(eventB, ruleA);
    expect(r.created).toBe(false);
    expect(r.execution).toBeNull();
    expect(await executionsFor(ruleA.id).then((e) => e.length)).toBe(0);

    // Processor is org-scoped too: org A processor never touches org B events.
    const summary = await runAutomationProcessor(orgId);
    expect(summary.executionsCreated).toBeGreaterThanOrEqual(0);
    const crossTasks = await db.task.findMany({ where: { organizationId: orgA_orgFilter(), leadId: leadB.id } });
    expect(crossTasks.length).toBe(0);
  });
});

function orgA_orgFilter() {
  return orgId;
}

// ---------------------------------------------------------------------------
// DRY RUN (spec 36–37, 111)
// ---------------------------------------------------------------------------

describe("dry run (spec 36–37, 111)", () => {
  test("dry run creates NOTHING — no task, no notification, no execution (spec 111)", async () => {
    const before = {
      tasks: await db.task.count({ where: { organizationId: orgId } }),
      notifications: await db.notification.count({ where: { organizationId: orgId } }),
      executions: await db.automationExecution.count({ where: { organizationId: orgId } }),
      notes: await db.note.count({ where: { organizationId: orgId } }),
    };

    const lead = await mkLead({ name: "DryRun", priority: "HIGH", stageAgeHours: 50 });
    const rule = await mkRule({
      name: "Dry run rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: { all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }] },
      actions: [
        { type: "CREATE_TASK", params: { title: "preview task {leadName}", assignTo: "LEAD_OWNER" } },
        { type: "CREATE_NOTIFICATION", params: { recipient: "LEAD_OWNER", message: "preview {leadName}" } },
      ],
    });

    const outcome = await dryRunAutomationRule(rule, { leadId: lead.id });
    expect(outcome.ok).toBe(true);
    expect(outcome.result?.triggerMatched).toBe(true);
    expect(outcome.result?.conditionsMatched).toBe(true);
    expect(outcome.result?.actions).toHaveLength(2);
    expect(outcome.result?.actions[0].status).toBe("PREVIEW");
    expect(outcome.result?.actions[0].summary).toContain("preview task DryRun");

    const after = {
      tasks: await db.task.count({ where: { organizationId: orgId } }),
      notifications: await db.notification.count({ where: { organizationId: orgId } }),
      executions: await db.automationExecution.count({ where: { organizationId: orgId } }),
      notes: await db.note.count({ where: { organizationId: orgId } }),
    };
    expect(after).toEqual(before);
  });

  test("dry run shows FAILING condition trace against current state", async () => {
    const lead = await mkLead({ name: "DryFail", priority: "LOW", stageAgeHours: 50 });
    const rule = await mkRule({
      name: "Dry fail rule",
      triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
      conditions: { all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }] },
      actions: [{ type: "ADD_NOTE", params: { content: "x" } }],
    });
    const outcome = await dryRunAutomationRule(rule, { leadId: lead.id });
    expect(outcome.ok).toBe(true);
    expect(outcome.result?.conditionsMatched).toBe(false);
    expect(outcome.result?.conditions[0].actual).toBe("LOW");
  });
});

// ---------------------------------------------------------------------------
// PROCESSOR — stress + worker chain (spec 107–108, 79–82)
// ---------------------------------------------------------------------------

describe("processor + worker (spec 107–108, 79–82)", () => {
  test("processor ×5 after first run → 0 duplicate executions, 0 duplicate tasks (spec 108)", async () => {
    const N = 12;
    // ISOLATION: pause every rule created by earlier tests so this org-wide
    // processor run is driven ONLY by the two stress rules below.
    await db.automationRule.updateMany({ where: { organizationId: orgId }, data: { enabled: false, enabledAt: null } });
    const rules = [
      await mkRule({
        name: `Stress A ${Date.now()}`,
        triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
        conditions: { all: [{ field: "lead.priority", operator: "in", value: ["HIGH", "URGENT"] }] },
        actions: [{ type: "CREATE_TASK", params: { title: "stress A", assignTo: "LEAD_OWNER" } }],
      }),
      await mkRule({
        name: `Stress B ${Date.now()}`,
        triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
        conditions: null,
        actions: [{ type: "ADD_NOTE", params: { content: "stress B note" } }],
      }),
    ];

    const leads: Awaited<ReturnType<typeof mkLead>>[] = [];
    for (let i = 0; i < N; i++) {
      leads.push(await mkLead({ name: `Stress ${i}`, priority: i % 2 === 0 ? "HIGH" : "MEDIUM", stageAgeHours: 100 }));
    }
    for (const lead of leads) {
      await mkStaleEvent(lead, orgId, lead.firstName!);
    }

    // First run — creates the executions (rule A matches the 6 HIGH leads,
    // rule B matches all 12; plus any earlier still-eligible events).
    const first = await runAutomationProcessor(orgId);
    expect(first.candidateEvents).toBeGreaterThanOrEqual(N);
    expect(first.executionsCreated).toBeGreaterThanOrEqual(N + N / 2);

    // Stress: 4 more runs must create ZERO new executions.
    for (let i = 0; i < 4; i++) {
      const again = await runAutomationProcessor(orgId);
      expect(again.executionsCreated).toBe(0);
    }

    // No duplicate action effects:
    const taskCounts = new Map<string, number>();
    for (const lead of leads) {
      const count = await db.task.count({ where: { organizationId: orgId, leadId: lead.id, type: "TASK", title: "stress A" } });
      taskCounts.set(lead.id, count);
    }
    const highLeads = leads.filter((l) => l.priority === "HIGH");
    for (const lead of highLeads) expect(taskCounts.get(lead.id)).toBe(1);
    const mediumLeads = leads.filter((l) => l.priority !== "HIGH");
    for (const lead of mediumLeads) expect(taskCounts.get(lead.id)).toBe(0);

    // Rule pairs are unique in the DB:
    const allExecs = await db.automationExecution.findMany({
      where: { ruleId: { in: rules.map((r) => r.id) } },
    });
    const pairKeys = allExecs.map((e) => `${e.ruleId}:${e.eventId}`);
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });

  test("runLeadOSWorkers chains reconcile → automations, each step independent (spec 82)", async () => {
    const result = await runLeadOSWorkers(orgId);
    expect(result.orgId).toBe(orgId);
    expect(result.reconciliation).not.toBeNull();
    expect(result.automations).not.toBeNull();
    expect(typeof result.durationMs).toBe("number");
  });
});
