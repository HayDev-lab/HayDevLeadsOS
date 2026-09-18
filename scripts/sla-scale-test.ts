// Scale test: bulk-insert N synthetic unresponded/responded leads, then
// measure SLA list performance. Usage: bun scripts/sla-scale-test.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const N = 470; // + 30 existing = ~500

async function main() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("no org");
  const stage = await db.pipelineStage.findFirst({
    where: { pipeline: { organizationId: org.id } },
    orderBy: { position: "asc" },
  });
  const source = await db.leadSource.findFirst({ where: { organizationId: org.id } });
  const user = await db.user.findFirst({ where: { organizationId: org.id } });

  console.log(`creating ${N} synthetic leads...`);
  const now = Date.now();
  for (let i = 0; i < N; i++) {
    const created = new Date(now - (Math.random() * 72 + 0.5) * 3_600_000); // 0.5h..72h old
    const lead = await db.lead.create({
      data: {
        organizationId: org.id,
        sourceId: source?.id ?? null,
        firstName: "Scale",
        lastName: `Test ${i}`,
        company: `ScaleCo ${i}`,
        email: `scale${i}@test.local`,
        normalizedEmail: `scale${i}@test.local`,
        status: "OPEN",
        stageId: stage?.id ?? null,
        priority: "MEDIUM",
        createdAt: created,
        updatedAt: created,
      },
    });
    // ~60% responded (qualifying activity), 40% unanswered (potential breach)
    if (Math.random() < 0.6) {
      await db.activity.create({
        data: {
          organizationId: org.id,
          leadId: lead.id,
          userId: user?.id ?? null,
          type: ["CALL", "MESSAGE", "EMAIL", "MEETING"][i % 4],
          title: "First touch",
          createdAt: new Date(created.getTime() + Math.random() * 5 * 3_600_000),
        },
      });
    } else {
      // system events + notes — must NOT close SLA
      await db.activity.create({
        data: {
          organizationId: org.id,
          leadId: lead.id,
          type: i % 2 ? "SYSTEM_EVENT" : "NOTE",
          title: "Automated",
          createdAt: new Date(created.getTime() + 60_000),
        },
      });
    }
  }
  const total = await db.lead.count({ where: { organizationId: org.id } });
  console.log(`done. total leads: ${total}`);
}

main().finally(() => db.$disconnect());
