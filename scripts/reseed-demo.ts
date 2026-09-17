// Reset the DEMO database and re-run the seed (dev only — wipes all data).
// Used after schema/config changes so the demo dataset reflects the current
// seed (stage inactivity thresholds, stage ages, SLA demo states).
// Usage: bunx tsx scripts/reseed-demo.ts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // Wipe tenant data (order irrelevant — cascade handles it, but be explicit).
  await db.webhookLog.deleteMany();
  await db.integrationEvent.deleteMany();
  await db.integrationSync.deleteMany();
  await db.incomingMessage.deleteMany();
  await db.businessAudit.deleteMany();
  await db.lostLeadFlag.deleteMany();
  await db.sourceAttribution.deleteMany();
  await db.leadScoreComponent.deleteMany();
  await db.leadTag.deleteMany();
  await db.activity.deleteMany();
  await db.task.deleteMany();
  await db.note.deleteMany();
  await db.leadEvent.deleteMany();
  await db.customFieldValue.deleteMany();
  await db.lead.deleteMany();
  await db.savedFilter.deleteMany();
  await db.assignmentRule.deleteMany();
  await db.webhookEndpoint.deleteMany();
  await db.notification.deleteMany();
  await db.domainEvent.deleteMany();
  await db.automationExecution.deleteMany();
  await db.automationRule.deleteMany();
  await db.setting.deleteMany();
  await db.scoringConfig.deleteMany();
  await db.customField.deleteMany();
  await db.lostReason.deleteMany();
  await db.tag.deleteMany();
  await db.pipelineStage.deleteMany();
  await db.pipeline.deleteMany();
  await db.leadSource.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
  console.log("[reseed] wiped");

  const { seed } = await import("../src/lib/leados/seed");
  const { orgId } = await seed();
  console.log(`[reseed] seeded org ${orgId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
