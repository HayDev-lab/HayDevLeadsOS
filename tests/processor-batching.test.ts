// AUTOMATION PROCESSOR BATCHING (v0.16) — CRITICAL TEST C (spec 77).
// Run with: bun test tests/processor-batching.test.ts
//
//   C — >1000 CANDIDATE EVENTS: the old `take: 1000` meant "process the first
//       1000 and stop forever" — events beyond the cursor were NEVER picked
//       up again. The cursor batch loop (250/batch, spec 25) must eventually
//       process EVERY candidate across batches/runs, with zero loss and zero
//       duplicate executions, and a PARTIAL run (time budget) must continue
//       exactly where it stopped on the next run (spec 26–28).
//
// 1200 events here keep the suite fast; the full 2500-event / 500-lead load
// test is scripts/load-test-v016.ts (spec 85).

/// <reference types="bun-types" />
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT, ENTITY_TYPE } from "../src/lib/domain-events";
import { publishDomainEvent } from "../src/lib/leados/domain-event-service";
import { runAutomationProcessor } from "../src/lib/leados/automation-processor";

const db = new PrismaClient();
const SLUG = `batch-test-${Date.now()}`;
let orgId = "";
let ownerId = "";
let pipelineId = "";
let stageIdRef = "";

const EVENT_COUNT = 1200; // > 1000 — beyond the old hard ceiling

beforeAll(async () => { // 1200 events need more than the 5s bun default
  const org = await db.organization.create({
    data: { name: "Batch Test", slug: SLUG, locale: "en", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  orgId = org.id;
  const user = await db.user.create({
    data: { organizationId: orgId, name: "B Owner", email: `b-owner-${Date.now()}@test.dev`, role: "OWNER", status: "ACTIVE" },
  });
  ownerId = user.id;
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } });
  const stage = await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } });
  pipelineId = pipeline.id;
  stageIdRef = stage.id;

  // ONE rule eligible from the very start (before every event).
  await db.automationRule.create({
    data: {
      organizationId: orgId,
      name: "batch-rule",
      enabled: true,
      enabledAt: new Date(Date.now() - 3_600_000),
      triggerType: DOMAIN_EVENT.STAGE_AGING,
      conditions: undefined,
      actions: [{ type: "ADD_NOTE", params: { content: "aging {leadName}" } }] as never,
    },
  });

});

let seeded = false;
async function seedEvents() {
  if (seeded) return;
  seeded = true;
  // A pile of leads for the events to point at (10 leads, events share them).
  const leads: { id: string; stageId: string; stageEnteredAt: Date }[] = [];
  for (let i = 0; i < 10; i++) {
    const row = await db.lead.create({
        data: {
          organizationId: orgId,
          firstName: `L${i}`,
          company: `L${i} Co`,
          status: "OPEN",
          pipelineId,
          stageId: stageIdRef,
          ownerId,
          priority: "MEDIUM",
          stageEnteredAt: new Date(Date.now() - 7_200_000),
          createdAt: new Date(Date.now() - 7_300_000),
        },
      });
    leads.push({ id: row.id, stageId: row.stageId as string, stageEnteredAt: row.stageEnteredAt as Date });
  }

  // 1200 unique STAGE_AGING events (dedup keys unique → all persist).
  for (let i = 0; i < EVENT_COUNT; i++) {
    const lead = leads[i % leads.length];
    await publishDomainEvent(orgId, {
      type: DOMAIN_EVENT.STAGE_AGING,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: new Date(Date.now() - 3_600_000 + i), // strictly ASC-ordered
      deduplicationKey: `STAGE_AGING:batch:${SLUG}:${i}`,
      payload: { leadId: lead.id, leadName: `L${i % 10}`, stageId: lead.stageId, stageName: "New", ownerId, thresholdMinutes: 2880 },
    });
  }
}

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => {});
  await db.$disconnect();
});

describe("CRITICAL TEST C — >1000 events processed via cursor batches (spec 77, 24-28)", () => {
  test("run 1 processes the first budget; runs 2-3 finish the tail — NOTHING is lost, NOTHING duplicated", async () => {
    await seedEvents(); // 1200 events (~15s) — needs the test timeout below
    // Run 1: enough budget to chew through a big chunk (but capped).
    const run1 = await runAutomationProcessor(orgId, { maxRunMs: 20_000 });
    expect(run1.candidateEvents).toBeGreaterThan(0);
    const afterRun1 = await db.automationExecution.count({ where: { organizationId: orgId } });
    expect(afterRun1).toBeGreaterThan(0);
    expect(run1.batches).toBeGreaterThanOrEqual(1);
    // 250/batch: a full pass takes at least 5 batches for 1200 events.
    expect(run1.batches).toBeGreaterThanOrEqual(Math.floor(afterRun1 / 250));

    // Runs 2+: continue from DB state until the queue is empty (spec 27-28).
    let total = afterRun1;
    for (let i = 0; i < 6 && total < EVENT_COUNT; i++) {
      const run = await runAutomationProcessor(orgId, { maxRunMs: 30_000 });
      total += run.executionsCreated;
    }

    // EVERY candidate event got its execution — none stuck beyond the old 1000
    // ceiling (the exact bug this test guards against).
    expect(total).toBe(EVENT_COUNT);
    expect(
      await db.automationExecution.count({ where: { organizationId: orgId } })
    ).toBe(EVENT_COUNT);
    // Each (event × rule) pair exists EXACTLY ONCE — the unique constraint
    // held across all batches and runs.
    const dupes = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM (SELECT ruleId, eventId, COUNT(*) AS c FROM AutomationExecution GROUP BY ruleId, eventId HAVING c > 1)`
    );
    expect(Number(dupes[0]?.n ?? 0)).toBe(0);
    // A steady-state run finds nothing left.
    const finalRun = await runAutomationProcessor(orgId, { maxRunMs: 10_000 });
    expect(finalRun.processedPairs).toBe(0);
    expect(finalRun.remainingEvents).toBe(0);
  }, 300_000);

  test("time budget → PARTIAL with remaining > 0; the next run finishes the tail", async () => {
    // A FRESH backlog (test 1 drained the first one).
    const lead = await db.lead.findFirstOrThrow({ where: { organizationId: orgId } });
    for (let i = 0; i < 300; i++) {
      await publishDomainEvent(orgId, {
        type: DOMAIN_EVENT.STAGE_AGING,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: new Date(Date.now() + 3_600_000 + i), // after the first batch
        deduplicationKey: `STAGE_AGING:batch2:${SLUG}:${i}`,
        payload: { leadId: lead.id, leadName: "L0", stageId: lead.stageId, stageName: "New", ownerId, thresholdMinutes: 2880 },
      });
    }
    // A deliberately tiny budget stops mid-queue (spec 26 → PARTIAL, spec 27).
    const tiny = await runAutomationProcessor(orgId, { maxRunMs: 1 });
    expect(tiny.budgetExceeded).toBe(true);
    expect(tiny.remainingEvents).toBeGreaterThan(0);
    // The next run drains it — nothing depends on in-memory cursors (spec 28).
    const drain = await runAutomationProcessor(orgId, { maxRunMs: 60_000 });
    expect(drain.remainingEvents).toBe(0);
  }, 300_000);
});
