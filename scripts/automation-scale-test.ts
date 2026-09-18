// AUTOMATION SCALE TEST (spec 107–108) — 500 leads + events + rules.
// Run: bunx tsx scripts/automation-scale-test.ts
//
// Measures: candidate events, rules, executions, duration. Then runs the
// processor 4 more times and asserts ZERO duplicate executions / tasks.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const SLUG = `auto-scale-${Date.now()}`;

async function main() {
  const t0 = Date.now();
  const org = await db.organization.create({
    data: { name: "Scale Test", slug: SLUG, locale: "en", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  const orgId = org.id;

  const user = await db.user.create({
    data: { organizationId: orgId, name: "Scale Owner", email: "scale@test.local", role: "OWNER", status: "ACTIVE" },
  });
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } });
  const stageNew = await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } });
  const stageProposal = await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "Proposal", type: "open", position: 1 } });

  // 3 rules: (a) stale + HIGH → task, (b) stale any → note, (c) FR breach → task
  const mkRule = (name: string, triggerType: string, conditions: unknown, actions: unknown) =>
    db.automationRule.create({
      data: {
        organizationId: orgId,
        name,
        enabled: true,
        enabledAt: new Date(Date.now() - 90 * 24 * 3_600_000),
        triggerType,
        conditions: conditions as never,
        actions: actions as never,
      },
    });

  const ruleA = await mkRule(
    "Scale A",
    "STAGE_BECAME_STALE",
    { all: [{ field: "lead.priority", operator: "in", value: ["HIGH", "URGENT"] }] },
    [{ type: "CREATE_TASK", params: { title: "scale A", assignTo: "LEAD_OWNER" } }]
  );
  await mkRule(
    "Scale B",
    "STAGE_BECAME_STALE",
    null,
    [{ type: "ADD_NOTE", params: { content: "scale B note" } }]
  );
  await mkRule(
    "Scale C",
    "FIRST_RESPONSE_BREACHED",
    { all: [{ field: "lead.leadScore", operator: "greater_than", value: -1 }] },
    [{ type: "CREATE_TASK", params: { title: "scale C", assignTo: "LEAD_OWNER" } }]
  );

  // 500 leads — a realistic priority mix, all stale (300 Proposal / 200 New).
  console.log("[scale] creating 500 leads + 500 events…");
  const BATCH = 100;
  for (let i = 0; i < 500; i += BATCH) {
    const rows: { organizationId: string; firstName: string; company: string; status: string; pipelineId: string; stageId: string; ownerId: string | null; priority: string; leadScore: number; stageEnteredAt: Date; createdAt: Date }[] = [];
    for (let j = 0; j < BATCH && i + j < 500; j++) {
      const idx = i + j;
      const priority = idx % 10 < 4 ? "HIGH" : idx % 10 < 5 ? "URGENT" : "MEDIUM";
      const useProposal = idx % 5 < 3;
      rows.push({
        organizationId: orgId,
        firstName: `Scale ${idx}`,
        company: `Scale Co ${idx}`,
        status: "OPEN",
        pipelineId: pipeline.id,
        stageId: useProposal ? stageProposal.id : stageNew.id,
        ownerId: idx % 20 === 0 ? null : user.id,
        priority,
        leadScore: 50,
        stageEnteredAt: new Date(Date.now() - 200 * 3_600_000),
        createdAt: new Date(Date.now() - 210 * 3_600_000),
      });
    }
    await db.lead.createMany({ data: rows });

    // one STAGE_BECAME_STALE event per lead + FR breach for the unresponded half
    const leadRows = await db.lead.findMany({
      where: { organizationId: orgId },
      select: { id: true, stageId: true, stageEnteredAt: true, ownerId: true, createdAt: true, firstName: true },
      skip: i,
      take: BATCH,
    });
    const events = leadRows.map((l) => ({
      organizationId: orgId,
      type: "STAGE_BECAME_STALE",
      entityType: "lead",
      entityId: l.id,
      occurredAt: new Date(),
      deduplicationKey: `scale-stale:${l.id}`,
      payload: {
        leadId: l.id,
        leadName: l.firstName,
        stageId: l.stageId,
        stageName: "Proposal",
        stageEnteredAt: l.stageEnteredAt!.toISOString(),
        thresholdMinutes: 2880,
        overdueMinutes: 600,
        ownerId: l.ownerId,
      },
    }));
    // every third lead also breached first response
    leadRows.filter((_, k) => (i + k) % 3 === 0).forEach((l, k) => {
      events.push({
        organizationId: orgId,
        type: "FIRST_RESPONSE_BREACHED",
        entityType: "lead",
        entityId: l.id,
        occurredAt: new Date(),
        deduplicationKey: `scale-fr:${l.id}:${k}`,
        payload: { leadId: l.id, leadName: l.firstName, overdueMinutes: 600, ownerId: l.ownerId },
      } as never);
    });
    await db.domainEvent.createMany({ data: events });
  }

  const leads = await db.lead.count({ where: { organizationId: orgId } });
  const events = await db.domainEvent.count({ where: { organizationId: orgId } });
  console.log(`[scale] prepared in ${Date.now() - t0}ms: leads=${leads} events=${events} rules=3`);

  // ---- Processor run 1 (the batch) ----
  const { runAutomationProcessor } = await import("../src/lib/leados/automation-processor");
  const s1 = await runAutomationProcessor(orgId);
  console.log(
    `[scale] RUN1 rules=${s1.rulesConsidered} candidates=${s1.candidateEvents} pairs=${s1.processedPairs} ` +
      `executions=${s1.executionsCreated} duration=${s1.durationMs}ms`
  );

  // ---- Stress: 4 more runs must create ZERO duplicates (spec 108) ----
  let dupCreated = 0;
  for (let i = 0; i < 4; i++) {
    const s = await runAutomationProcessor(orgId);
    dupCreated += s.executionsCreated;
  }
  console.log(`[scale] RUNS 2-5 created ${dupCreated} executions (must be 0)`);

  // ---- Final integrity ----
  const [execCount, taskCount, notes, highTasks, medTasks] = await Promise.all([
    db.automationExecution.count({ where: { organizationId: orgId } }),
    db.task.count({ where: { organizationId: orgId, title: { in: ["scale A", "scale C"] } } }),
    db.note.count({ where: { organizationId: orgId } }),
    db.task.count({ where: { organizationId: orgId, title: "scale A", lead: { priority: { in: ["HIGH", "URGENT"] } } } }),
    db.task.count({ where: { organizationId: orgId, title: "scale A", lead: { priority: "MEDIUM" } } }),
  ]);
  const failedExecs = await db.automationExecution.count({ where: { organizationId: orgId, status: "FAILED" } });

  console.log(`[scale] final: executions=${execCount} tasks(A+C)=${taskCount} notes=${notes} highTasks=${highTasks} mediumTasks=${medTasks} failed=${failedExecs}`);

  // Cleanup
  await db.organization.delete({ where: { id: orgId } });
  console.log(`[scale] cleaned up. total wall time: ${Date.now() - t0}ms`);

  // INVARIANTS (not exact success counts — those depend on the priority mix):
  //  1. no duplicate executions across runs 2–5 (spec 108)
  //  2. total executions = stale×2 rules + FR events (deterministic)
  //  3. rule A respected its condition: ZERO tasks for MEDIUM leads
  //  4. rule B (no conditions) noted every lead
  //  5. every FAILED execution is an unassigned lead (25 leads = 500/20)
  const failedReasons = await db.automationExecution.findMany({
    where: { organizationId: orgId, status: "FAILED" },
    select: { error: true },
  });
  const allNoOwner = failedReasons.every((f) => (f.error ?? "").includes("no owner"));
  const ok =
    dupCreated === 0 &&
    execCount === 500 * 2 + Math.ceil(500 / 3) &&
    medTasks === 0 &&
    notes === 500 &&
    highTasks > 200 &&
    failedExecs > 0 &&
    failedExecs <= 50 &&
    allNoOwner;
  console.log(ok ? "[scale] PASS" : "[scale] CHECK NUMBERS ABOVE");
  if (!ok) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
