// WORKER INFRASTRUCTURE (v0.16) — INTEGRATION tests against the real SQLite DB.
// Run with: bun test tests/worker-infrastructure.test.ts
//
// CRITICAL TESTS (spec 75–78):
//   A — CRASH RECOVERY: RUNNING execution with an expired lease is recovered
//       to FAILED_RETRYABLE with errorCode WORKER_CRASHED (a TRACE, never a
//       silent flip), then retried by the processor → SUCCESS, no duplicates.
//   B — CREATED TASK BEFORE CRASH: retry after crash REUSES the existing task
//       (effect=REUSED) — never a duplicate.
//   D — PARALLEL WORKERS: the DB lease makes exactly one run win; the other
//       gets LEASE_BUSY (409 semantics) with zero duplicate executions.
//
// Plus: lease takeover after expiry (spec 9 — never a permanent lock),
// heartbeats, bounded retry policy (attemptCount/backoff/max), error
// classification (spec 22–23) and the ACTION effect idempotency contract.

/// <reference types="bun-types" />
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT, ENTITY_TYPE, stageStaleDedupKey } from "../src/lib/domain-events";
import { publishDomainEvent } from "../src/lib/leados/domain-event-service";
import {
  processEventRule,
  retryAutomationExecution,
  recoverStaleAutomationExecutions,
} from "../src/lib/leados/automation-engine";
import { runAutomationProcessor } from "../src/lib/leados/automation-processor";
import { runAllLeadOSWorkers } from "../src/lib/leados/leados-workers";
import {
  acquireWorkerLease,
  extendWorkerLease,
  releaseWorkerLease,
  getWorkerLease,
  WORKER_LEASE_TYPE,
} from "../src/lib/leados/worker-lease";
import {
  classifyAutomationError,
  retryBackoffMs,
  nextRetryAt,
  canAutoRetry,
  MAX_AUTOMATION_ATTEMPTS,
  AUTO_ERROR,
} from "../src/lib/leados/automation-errors";

const db = new PrismaClient();
const SLUG = `worker-test-${Date.now()}`;
let orgId = "";
let ownerId = "";
let stageId = "";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function mkRule(triggerType: string, actions: unknown, conditions: unknown = null) {
  return db.automationRule.create({
    data: {
      organizationId: orgId,
      name: `w-${Math.random().toString(36).slice(2, 7)}`,
      enabled: true,
      enabledAt: new Date(), // fresh: earlier test events are out of scope (backlog guard)
      triggerType,
      conditions: conditions as never,
      actions: actions as never,
    },
  });
}

async function mkLead(name: string, priority = "HIGH") {
  const pipeline = await db.pipeline.findFirstOrThrow({ where: { organizationId: orgId, isDefault: true } });
  const stage = await db.pipelineStage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });
  return db.lead.create({
    data: {
      organizationId: orgId,
      firstName: name,
      company: `${name} Co`,
      status: "OPEN",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId,
      priority,
      stageEnteredAt: hoursAgo(72),
      createdAt: hoursAgo(73),
    },
  });
}

async function mkStaleEvent(lead: { id: string; stageId: string | null; stageEnteredAt: Date | null; ownerId: string | null }) {
  const { event } = await publishDomainEvent(orgId, {
    type: DOMAIN_EVENT.STAGE_BECAME_STALE,
    entityType: ENTITY_TYPE.LEAD,
    entityId: lead.id,
    occurredAt: new Date(),
    deduplicationKey: stageStaleDedupKey(lead.id, lead.stageEnteredAt ?? new Date()) + ":" + Math.random().toString(36).slice(2),
    payload: {
      leadId: lead.id,
      leadName: "Test",
      stageId: lead.stageId,
      stageName: "New",
      stageEnteredAt: (lead.stageEnteredAt ?? new Date()).toISOString(),
      thresholdMinutes: 2880,
      overdueMinutes: 600,
      ownerId: lead.ownerId,
    },
  });
  return event;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: "Worker Test", slug: SLUG, locale: "en", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  orgId = org.id;
  const owner = await db.user.create({
    data: { organizationId: orgId, name: "W Owner", email: `w-owner-${Date.now()}@test.dev`, role: "OWNER", status: "ACTIVE" },
  });
  ownerId = owner.id;
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } });
  stageId = (await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } })).id;
});

afterAll(async () => {
  await db.workerLease.deleteMany({});
  // The tests own this DB moment: dev runs restart fresh afterwards.
  await db.workerRun.deleteMany({});
  await db.organization.delete({ where: { id: orgId } }).catch(() => {});
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// ERROR MODEL (spec 20–23, 68–70)
// ---------------------------------------------------------------------------

describe("error classification (spec 22)", () => {
  test("known non-retryable codes", () => {
    for (const code of ["NO_LEAD_OWNER", "INVALID_RECIPIENT", "CHANNEL_NOT_CONNECTED", "LEAD_NOT_FOUND"]) {
      expect(classifyAutomationError({ code }).retryable).toBe(false);
    }
  });
  test("known retryable codes", () => {
    for (const code of ["PROVIDER_TIMEOUT", "RATE_LIMITED", "NETWORK_ERROR", "DB_TEMPORARY_ERROR", "WORKER_CRASHED"]) {
      expect(classifyAutomationError({ code }).retryable).toBe(true);
    }
  });
  test("HTTP 429 → RATE_LIMITED retryable; 5xx → PROVIDER_UNAVAILABLE retryable", () => {
    expect(classifyAutomationError({ message: "boom", status: 429 })).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(classifyAutomationError({ message: "boom", status: 502 })).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });
  test("timeout-ish exceptions → retryable; unknown → conservative non-retryable", () => {
    expect(classifyAutomationError({ message: "Fetch failed: ETIMEDOUT after 10s" }).retryable).toBe(true);
    expect(classifyAutomationError({ message: "SQLITE_BUSY: database is locked" }).retryable).toBe(true);
    expect(classifyAutomationError({ message: "Cannot read properties of undefined" }).retryable).toBe(false);
  });
});

describe("retry policy (spec 20–21)", () => {
  test("backoff schedule 1m / 5m / 15m", () => {
    expect(retryBackoffMs(1)).toBe(60_000);
    expect(retryBackoffMs(2)).toBe(5 * 60_000);
    expect(retryBackoffMs(3)).toBe(15 * 60_000);
    expect(retryBackoffMs(99)).toBe(15 * 60_000); // clamped
  });
  test("maxAttempts = 3, bounded auto-retry", () => {
    expect(MAX_AUTOMATION_ATTEMPTS).toBe(3);
    expect(canAutoRetry(1, true)).toBe(true);
    expect(canAutoRetry(2, true)).toBe(true);
    expect(canAutoRetry(3, true)).toBe(false);
    expect(canAutoRetry(1, false)).toBe(false);
  });
  test("nextRetryAt is backoff away from `from`", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(nextRetryAt(1, from).getTime()).toBe(from.getTime() + 60_000);
  });
});

// ---------------------------------------------------------------------------
// WORKER LEASE (spec 8–10) — CRITICAL TEST D foundation
// ---------------------------------------------------------------------------

describe("worker lease (spec 8-10)", () => {
  test("acquire → second acquire is LEASE_BUSY (TEST D core)", async () => {
    const a = await acquireWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-a", 60_000);
    expect(a.ok).toBe(true);
    const b = await acquireWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-b", 60_000);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("LEASE_BUSY");
    await releaseWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-a");
  });

  test("expired lease is taken over — never a permanent lock (spec 9)", async () => {
    const a = await acquireWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-old", 50); // 50ms
    expect(a.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    const b = await acquireWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-new", 60_000);
    expect(b.ok).toBe(true);
    const info = await getWorkerLease(WORKER_LEASE_TYPE.WORKERS);
    expect(info.active).toBe(true);
    if (info.active) expect(info.holderRunId).toBe("run-new");
    await releaseWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-new");
  });

  test("extend keeps the lease alive and only for its holder (spec 10)", async () => {
    await acquireWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-x", 60_000);
    expect(await extendWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-x", 120_000)).toBe(true);
    expect(await extendWorkerLease(WORKER_LEASE_TYPE.WORKERS, "intruder", 120_000)).toBe(false);
    const info = await getWorkerLease(WORKER_LEASE_TYPE.WORKERS);
    expect(info.active).toBe(true); // intruder did not steal it
    await releaseWorkerLease(WORKER_LEASE_TYPE.WORKERS, "run-x");
    expect((await getWorkerLease(WORKER_LEASE_TYPE.WORKERS)).active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL TEST D — parallel worker runs
// ---------------------------------------------------------------------------

describe("CRITICAL TEST D — parallel workers (spec 78)", () => {
  test("two concurrent orchestrator runs: exactly one wins, other = LEASE_BUSY", async () => {
    // Two orgs exist (test org + possibly others); scope both runs to orgId.
    const [r1, r2] = await Promise.allSettled([
      runAllLeadOSWorkers({ orgIds: [orgId], trigger: "internal" }),
      runAllLeadOSWorkers({ orgIds: [orgId], trigger: "internal" }),
    ]);
    const results = [r1, r2].map((r) => (r.status === "fulfilled" ? r.value.status : "ERROR"));
    const busy = results.filter((s) => s === "LEASE_BUSY").length;
    const ran = results.filter((s) => s === "SUCCESS" || s === "PARTIAL").length;
    expect(busy + ran).toBe(2);
    // The DB lease serializes: at most ONE run actually processed.
    expect(ran).toBe(1);
    expect(busy).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL TEST A — crash recovery (spec 75)
// ---------------------------------------------------------------------------

describe("CRITICAL TEST A — crash recovery (spec 75, 11-13)", () => {
  test("RUNNING with expired lease → FAILED_RETRYABLE (WORKER_CRASHED trace) → processor retries → SUCCESS, one task", async () => {
    const lead = await mkLead("CrashLead");
    const event = await mkStaleEvent(lead);
    const rule = await mkRule("STAGE_BECAME_STALE", [
      { type: "CREATE_TASK", params: { title: "Recover {leadName}", assignTo: "LEAD_OWNER", priority: "HIGH" } },
    ]);

    // Simulate: worker claimed the pair, crashed mid-run.
    const execution = await db.automationExecution.create({
      data: {
        organizationId: orgId,
        ruleId: rule.id,
        eventId: event.id,
        status: "RUNNING",
        ruleVersion: rule.version,
        startedAt: hoursAgo(1),
        lockedAt: hoursAgo(1),
        lockExpiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
        attemptCount: 1,
      },
    });

    // Recovery (spec 13): not a silent flip — a traceable transition.
    const recovery = await recoverStaleAutomationExecutions(orgId);
    expect(recovery.recovered).toBe(1);
    expect(recovery.recoveredIds).toContain(execution.id);
    const recovered = await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(recovered.status).toBe("FAILED_RETRYABLE");
    expect(recovered.errorCode).toBe(AUTO_ERROR.WORKER_CRASHED);
    expect((recovered.result as Record<string, unknown>)?.recoveredAfterCrash).toBe(true);

    // The processor retries due FAILED_RETRYABLE rows automatically.
    await runAutomationProcessor(orgId, { maxRunMs: 30_000 });
    const after = await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(after.status).toBe("SUCCESS");

    // No duplicate side effects: exactly one automation task for the lead.
    const tasks = await db.task.findMany({ where: { organizationId: orgId, leadId: lead.id } });
    expect(tasks.length).toBe(1);
    // And exactly one execution for the pair (idempotency never broken).
    expect(await db.automationExecution.count({ where: { ruleId: rule.id, eventId: event.id } })).toBe(1);
  });

  test("a LIVE (unexpired) RUNNING execution is never recovered", async () => {
    const lead = await mkLead("LiveLead");
    const event = await mkStaleEvent(lead);
    await db.automationExecution.create({
      data: {
        organizationId: orgId,
        ruleId: (await mkRule("STAGE_BECAME_STALE", [{ type: "ADD_NOTE", params: { content: "x" } }])).id,
        eventId: event.id,
        status: "RUNNING",
        ruleVersion: 1,
        startedAt: new Date(),
        lockedAt: new Date(),
        lockExpiresAt: new Date(Date.now() + 60_000), // still alive
      },
    });
    const recovery = await recoverStaleAutomationExecutions(orgId);
    expect(recovery.recovered).toBe(0);
  });

  test("legacy RUNNING rows (no lock) recover after the grace window (spec 11)", async () => {
    const lead = await mkLead("LegacyLead");
    const event = await mkStaleEvent(lead);
    await db.automationExecution.create({
      data: {
        organizationId: orgId,
        ruleId: (await mkRule("STAGE_BECAME_STALE", [{ type: "ADD_NOTE", params: { content: "x" } }])).id,
        eventId: event.id,
        status: "RUNNING",
        ruleVersion: 1,
        startedAt: hoursAgo(5), // way past the 10-minute legacy grace
        // lockExpiresAt: null (pre-v0.16 row)
      },
    });
    const recovery = await recoverStaleAutomationExecutions(orgId);
    expect(recovery.recovered).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL TEST B — side effect created before the crash (spec 76)
// ---------------------------------------------------------------------------

describe("CRITICAL TEST B — task created before crash, retry reuses it (spec 76, 15–16)", () => {
  test("retry after crash: effect=REUSED on the SAME task, zero duplicates", async () => {
    const lead = await mkLead("ReuseLead");
    const event = await mkStaleEvent(lead);
    const rule = await mkRule("STAGE_BECAME_STALE", [
      { type: "CREATE_TASK", params: { title: "Crash task {leadName}", assignTo: "LEAD_OWNER", priority: "URGENT" } },
      { type: "CREATE_TASK", params: { title: "Second {leadName}", assignTo: "LEAD_OWNER", priority: "HIGH" } },
    ]);

    // Simulate: action 0 created the task, then the worker crashed BEFORE the
    // result was persisted — the execution is FAILED_RETRYABLE with no trace.
    const execution = await db.automationExecution.create({
      data: {
        organizationId: orgId,
        ruleId: rule.id,
        eventId: event.id,
        status: "FAILED_RETRYABLE",
        ruleVersion: rule.version,
        attemptCount: 1,
        nextAttemptAt: new Date(), // due now
      },
    });
    const preExistingTask = await db.task.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        title: "Crash task ReuseLead",
        assignedTo: ownerId,
        priority: "URGENT",
        type: "TASK",
        status: "TODO",
        automationRuleId: rule.id,
        automationExecutionId: execution.id,
        automationActionIndex: 0, // ← action-level idempotency key
      },
    });

    const res = await retryAutomationExecution(orgId, execution.id);
    expect(res.ok).toBe(true);
    expect(res.execution?.status).toBe("SUCCESS");

    // EXACTLY ONE task per action: action 0 REUSED, action 1 CREATED.
    const tasks = await db.task.findMany({
      where: { organizationId: orgId, leadId: lead.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks.length).toBe(2);
    expect(tasks[0].id).toBe(preExistingTask.id); // same row, not a duplicate
    const result = (res.execution!.result ?? {}) as {
      actions: { effect?: string; entityId?: string }[];
    };
    expect(result.actions[0].effect).toBe("REUSED");
    expect(result.actions[0].entityId).toBe(preExistingTask.id);
    expect(result.actions[1].effect).toBe("CREATED");
  });
});

// ---------------------------------------------------------------------------
// Effect idempotency — notifications and notes (spec 17, 15)
// ---------------------------------------------------------------------------

describe("action-effect idempotency (spec 15–19)", () => {
  test("CREATE_NOTIFICATION retry reuses the notification (automationActionKey)", async () => {
    const lead = await mkLead("NoteLead");
    const event = await mkStaleEvent(lead);
    const rule = await mkRule("STAGE_BECAME_STALE", [
      { type: "CREATE_NOTIFICATION", params: { message: "hi {leadName}", recipient: "LEAD_OWNER" } },
    ]);
    const execution = await db.automationExecution.create({
      data: {
        organizationId: orgId, ruleId: rule.id, eventId: event.id,
        status: "FAILED_RETRYABLE", ruleVersion: 1, attemptCount: 1, nextAttemptAt: new Date(),
      },
    });
    const existing = await db.notification.create({
      data: {
        organizationId: orgId,
        userId: ownerId,
        eventId: null,
        type: "automation",
        templateKey: "automation.message",
        payload: {},
        severity: "WARNING",
        title: "Automation",
        message: "hi NoteLead",
        automationActionKey: `${execution.id}:0`,
      },
    });
    const res = await retryAutomationExecution(orgId, execution.id);
    expect(res.execution?.status).toBe("SUCCESS");
    expect(
      ((res.execution!.result ?? {}) as { actions: { effect?: string }[] }).actions[0].effect
    ).toBe("REUSED");
    expect(await db.notification.count({ where: { organizationId: orgId, automationActionKey: `${execution.id}:0` } })).toBe(1);
    void existing;
  });

  test("SET_LEAD_PRIORITY and ASSIGN_LEAD report NO_CHANGE when already applied (spec 18)", async () => {
    const lead = await mkLead("NoChange", "URGENT");
    const rule = await mkRule("STAGE_BECAME_STALE", [
      { type: "SET_LEAD_PRIORITY", params: { priority: "URGENT" } }, // already URGENT
      { type: "ASSIGN_LEAD", params: { assignTo: "SPECIFIC_USER", userId: ownerId } }, // already owner
    ]);
    const event = await mkStaleEvent(lead);
    const res = await processEventRule(event, rule);
    expect(res.execution?.status).toBe("SUCCESS");
    const result = (res.execution!.result ?? {}) as { actions: { effect?: string }[] };
    expect(result.actions[0].effect).toBe("NO_CHANGE");
    expect(result.actions[1].effect).toBe("NO_CHANGE");
  });
});

// ---------------------------------------------------------------------------
// Retry lifecycle through the processor (spec 20–21)
// ---------------------------------------------------------------------------

describe("bounded retry lifecycle via processor (spec 20–21)", () => {
  test("recovery at attemptCount=3 → permanent FAILED, no infinite retries", async () => {
    const lead = await mkLead("Exhaust");
    const event = await mkStaleEvent(lead);
    // A crashed execution that already burned its 3 attempts.
    const execution = await db.automationExecution.create({
      data: {
        organizationId: orgId,
        ruleId: (await mkRule("STAGE_BECAME_STALE", [{ type: "ADD_NOTE", params: { content: "x" } }])).id,
        eventId: event.id,
        status: "RUNNING",
        ruleVersion: 1,
        startedAt: hoursAgo(1),
        lockedAt: hoursAgo(1),
        lockExpiresAt: new Date(Date.now() - 60_000),
        attemptCount: MAX_AUTOMATION_ATTEMPTS, // ← budget exhausted
      },
    });
    const recovery = await recoverStaleAutomationExecutions(orgId);
    expect(recovery.recoveredIds).toContain(execution.id);
    const after = await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } });
    // NOT FAILED_RETRYABLE — the retry budget is gone (spec 21: manual action).
    expect(after.status).toBe("FAILED");
    expect(after.nextAttemptAt).toBeNull();
  });

  test("processor retries due FAILED_RETRYABLE rows automatically (spec 20)", async () => {
    const lead = await mkLead("AutoRetry");
    const event = await mkStaleEvent(lead);
    const rule = await mkRule("STAGE_BECAME_STALE", [
      { type: "CREATE_TASK", params: { title: "Auto {leadName}", assignTo: "LEAD_OWNER", priority: "HIGH" } },
    ]);
    // A "crashed" execution (expired lease) the processor must recover+retry.
    // NOTE: rules from earlier tests in this file also legitimately react to
    // this event (real system behavior) — the idempotency assertion is scoped
    // to THIS execution's own side effects.
    const crashed = await db.automationExecution.create({
      data: {
        organizationId: orgId,
        ruleId: rule.id,
        eventId: event.id,
        status: "RUNNING",
        ruleVersion: 1,
        startedAt: hoursAgo(1),
        lockedAt: hoursAgo(1),
        lockExpiresAt: new Date(Date.now() - 60_000),
        attemptCount: 1,
      },
    });
    const summary = await runAutomationProcessor(orgId, { maxRunMs: 30_000 });
    expect(summary.recoveredStale).toBeGreaterThanOrEqual(1);
    expect(summary.retriesExecuted).toBeGreaterThanOrEqual(1);
    expect(summary.retriesSucceeded).toBeGreaterThanOrEqual(1);
    // The retried execution created exactly ONE task (idempotent effects) —
    // and the pair still has exactly ONE execution.
    expect(await db.task.count({ where: { automationExecutionId: crashed.id } })).toBe(1);
    expect(await db.automationExecution.count({ where: { ruleId: rule.id, eventId: event.id } })).toBe(1);
  });
});
