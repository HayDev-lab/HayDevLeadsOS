// LOAD TEST (v0.16, spec 85): 500 leads · 2500 events · several rules ·
// delivery fan-out — proves the batched worker handles production-shaped load.
//
//   bunx tsx scripts/load-test-v016.ts
//
// Reports: batches, worker duration, executions, retries, duplicates,
// remaining queue. Creates a THROWAWAY org and removes it afterwards.

import { PrismaClient } from "@prisma/client";
import { publishDomainEvent } from "../src/lib/leados/domain-event-service";
import { runAutomationProcessor } from "../src/lib/leados/automation-processor";
import { fanoutNotificationDeliveries } from "../src/lib/leados/delivery/fanout";
import { runNotificationDeliveryWorker } from "../src/lib/leados/delivery/delivery-worker";

const db = new PrismaClient();
const LEADS = 500;
const EVENTS = 2500;

async function main() {
  const t0 = Date.now();
  const org = await db.organization.create({
    data: { name: "Load Test", slug: `load-${Date.now()}`, locale: "en", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  const orgId = org.id;
  try {
    const user = await db.user.create({
      data: { organizationId: orgId, name: "Load Owner", email: `load-${Date.now()}@test.dev`, role: "OWNER", status: "ACTIVE", telegramChatId: "998877665", telegramConnectedAt: new Date() },
    });
    const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } });
    const stage = await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } });

    // Channel prefs: email+telegram ON for the two critical types.
    await db.setting.create({
      data: {
        organizationId: orgId,
        key: `notification_preferences:${user.id}`,
        value: {
          FIRST_RESPONSE_BREACHED: true, FOLLOW_UP_DUE_SOON: true, FOLLOW_UP_OVERDUE: true,
          STAGE_AGING: true, STAGE_BECAME_STALE: true, LEAD_ASSIGNED: true,
          TASK_ASSIGNED: true, TASK_DUE_SOON: true, TASK_OVERDUE: true,
          channels: {
            FOLLOW_UP_OVERDUE: { email: true, telegram: true },
            FIRST_RESPONSE_BREACHED: { email: true, telegram: false },
          },
        } as never,
      },
    });
    await db.webhookEndpoint.create({
      data: { organizationId: orgId, name: "load-hook", url: "https://example.com/load", secret: "s", events: "FOLLOW_UP_OVERDUE", enabled: true },
    });

    // 3 rules (several, spec 85).
    const rules = await Promise.all([
      db.automationRule.create({ data: { organizationId: orgId, name: "R-stale-task", enabled: true, enabledAt: new Date(Date.now() - 7_200_000), triggerType: "STAGE_BECAME_STALE", conditions: undefined, actions: [{ type: "CREATE_TASK", params: { title: "Review {leadName}", assignTo: "LEAD_OWNER", priority: "HIGH" } }] as never } }),
      db.automationRule.create({ data: { organizationId: orgId, name: "R-fu-notify", enabled: true, enabledAt: new Date(Date.now() - 7_200_000), triggerType: "FOLLOW_UP_OVERDUE", conditions: undefined, actions: [{ type: "SEND_EMAIL", params: { subject: "Overdue {leadName}", body: "Follow up on {leadName}", recipient: "LEAD_OWNER" } }] as never } }),
      db.automationRule.create({ data: { organizationId: orgId, name: "R-aging-note", enabled: true, enabledAt: new Date(Date.now() - 7_200_000), triggerType: "STAGE_AGING", conditions: undefined, actions: [{ type: "ADD_NOTE", params: { content: "aging {leadName}" } }] as never } }),
    ]);

    // 500 leads.
    const leadIds: string[] = [];
    for (let i = 0; i < LEADS; i++) {
      const lead = await db.lead.create({
        data: {
          organizationId: orgId,
          firstName: `Load${i}`,
          company: `Load${i} Co`,
          status: "OPEN",
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerId: user.id,
          priority: i % 3 === 0 ? "HIGH" : "MEDIUM",
          stageEnteredAt: new Date(Date.now() - 7_200_000),
          createdAt: new Date(Date.now() - 7_300_000),
        },
      });
      leadIds.push(lead.id);
    }
    const leadsMs = Date.now() - t0;

    // 2500 events: mix of STAGE_AGING (1500), FOLLOW_UP_OVERDUE (500),
    // STAGE_BECAME_STALE (500) — all fan out to the delivery layer.
    const publishStart = Date.now();
    for (let i = 0; i < EVENTS; i++) {
      const leadId = leadIds[i % LEADS];
      const mod = i % 5;
      const type = mod === 4 ? "FOLLOW_UP_OVERDUE" : mod === 3 ? "STAGE_BECAME_STALE" : "STAGE_AGING";
      await publishDomainEvent(orgId, {
        type: type as never,
        entityType: "lead",
        entityId: leadId,
        occurredAt: new Date(Date.now() - 3_600_000 + i),
        deduplicationKey: `LOAD:${type}:${i}`,
        payload: { leadId, leadName: `Load${i % LEADS}`, stageId: stage.id, stageName: "New", ownerId: user.id, overdueMinutes: 300, thresholdMinutes: 2880 },
      });
    }
    const publishMs = Date.now() - publishStart;

    // ---- WORKER PASSES (budgeted like production) ----
    const procStart = Date.now();
    let summary;
    let pass = 0;
    do {
      summary = await runAutomationProcessor(orgId, { maxRunMs: 30_000 });
      pass++;
      process.stdout.write(`  pass ${pass}: batches=${summary.batches} scanned=${summary.eventsScanned} execs=${summary.executionsCreated} remaining=${summary.remainingEvents} budget=${summary.budgetExceeded}\n`);
    } while (summary.remainingEvents > 0 && pass < 20);
    const procMs = Date.now() - procStart;

    const fanoutStart = Date.now();
    const fanout = await fanoutNotificationDeliveries(orgId, { maxRunMs: 60_000 });
    const fanoutMs = Date.now() - fanoutStart;

    const deliveryStart = Date.now();
    const delivery = await runNotificationDeliveryWorker({ maxRunMs: 60_000, trigger: "load-test" });
    const deliveryMs = Date.now() - deliveryStart;

    // ---- VERIFICATION ----
    const [executions, dupePairs, deliveries, dupes] = await Promise.all([
      db.automationExecution.count({ where: { organizationId: orgId } }),
      db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM (SELECT ruleId, eventId FROM AutomationExecution GROUP BY ruleId, eventId HAVING COUNT(*) > 1)`),
      db.notificationDelivery.groupBy({ by: ["channel", "status"], where: { organizationId: orgId }, _count: { _all: true } }),
      db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM (SELECT notificationId, channel, recipient FROM NotificationDelivery WHERE notificationId IS NOT NULL GROUP BY notificationId, channel, recipient HAVING COUNT(*) > 1)`),
    ]);

    console.log("\n===== LOAD TEST REPORT (spec 85) =====");
    console.log(`leads: ${LEADS} (${leadsMs}ms) · events published: ${EVENTS} (${publishMs}ms)`);
    console.log(`rules: ${rules.length} · processor passes: ${pass} (${procMs}ms total)`);
    console.log(`executions: ${executions} (expected: one rule per event type × its events = ${EVENTS})`);
    console.log(`duplicate (rule,event) pairs: ${Number(dupePairs[0]?.n ?? 0)} — MUST be 0`);
    console.log(`fan-out: ${fanout.deliveriesCreated} rows (${fanoutMs}ms) — email=${fanout.emailCreated} telegram=${fanout.telegramCreated} webhook=${fanout.webhookCreated}`);
    console.log(`delivery worker: scanned=${delivery.stats.scanned} sent=${delivery.stats.sent} failed=${delivery.stats.failed} skipped=${delivery.stats.skipped} (${deliveryMs}ms)`);
    console.log(`delivery rows by channel/status:`, deliveries.map((d) => `${d.channel}/${d.status}=${d._count._all}`).join(" "));
    console.log(`duplicate (notification,channel,recipient) rows: ${Number(dupes[0]?.n ?? 0)} — MUST be 0`);
    console.log(`remaining queue: ${summary.remainingEvents} automations, ${delivery.stats.remaining} deliveries — MUST be 0`);
    const verdict =
      Number(dupePairs[0]?.n ?? 0) === 0 &&
      Number(dupes[0]?.n ?? 0) === 0 &&
      summary.remainingEvents === 0 &&
      executions === EVENTS;
    console.log(`VERDICT: ${verdict ? "PASS" : "FAIL"}`);
  } finally {
    await db.organization.delete({ where: { id: orgId } }).catch(() => {});
    await db.workerLease.deleteMany({});
    await db.workerRun.deleteMany({ where: { trigger: { in: ["load-test", "internal"] } } });
    await db.$disconnect();
  }
}

main();
