// FOLLOW-UP SLA scale test — verify no N+1 and flat latency at 500 leads.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const org = await db.organization.findFirst({ where: { slug: "haydev-demo" } });
  if (!org) throw new Error("no org");
  const stage = await db.pipelineStage.findFirst({ where: { pipeline: { organizationId: org.id, isDefault: true }, type: "open" } });
  const source = await db.leadSource.findFirst({ where: { organizationId: org.id } });
  const now = Date.now();
  const ids: string[] = [];
  for (let i = 0; i < 500; i++) {
    const lead = await db.lead.create({
      data: {
        organizationId: org.id, sourceId: source?.id ?? null,
        firstName: "Scale", lastName: `FU-${i}`,
        company: `Scale FU Co ${i}`, status: "OPEN", stageId: stage?.id ?? null,
        createdAt: new Date(now - (i % 7 + 1) * 86_400_000),
      },
    });
    ids.push(lead.id);
    if (i % 2 === 0) { // 250 with follow-up tasks
      await db.task.create({
        data: {
          organizationId: org.id, leadId: lead.id, title: "Follow up", type: "FOLLOW_UP", status: "TODO",
          dueAt: new Date(now + (i % 3 === 0 ? -7200_000 : (i % 3 === 1 ? 10800_000 : 90000_000))),
        },
      });
    }
    if (i % 4 === 0) { // half of those get a qualifying first response
      await db.activity.create({
        data: { organizationId: org.id, leadId: lead.id, type: "CALL", title: "Called", createdAt: new Date(now - 3600_000) },
      });
    }
  }
  console.log(`created 500 leads (${ids.length} ids)`);

  const t0 = Date.now();
  const r1 = await fetch("http://localhost:3000/api/v1/leads?sort=followup:urgency&limit=25");
  const b1 = await r1.json();
  console.log(`followup:urgency sort @500: ${Date.now() - t0}ms, total=${b1.total}`);

  const t1 = Date.now();
  const r2 = await fetch("http://localhost:3000/api/v1/leads?followUp=OVERDUE&limit=25");
  const b2 = await r2.json();
  console.log(`followUp=OVERDUE filter @500: ${Date.now() - t1}ms, total=${b2.total}`);

  const t2 = Date.now();
  const r3 = await fetch("http://localhost:3000/api/v1/leads?sla=BREACH&followUp=OVERDUE&sort=followup:urgency&limit=25");
  await r3.json();
  console.log(`combined sla+followUp+sort @500: ${Date.now() - t2}ms`);

  const t3 = Date.now();
  const r4 = await fetch("http://localhost:3000/api/v1/pipeline/kanban?limit=50");
  await r4.json();
  console.log(`kanban @500+: ${Date.now() - t3}ms`);

  const t4 = Date.now();
  const r5 = await fetch("http://localhost:3000/api/v1/dashboard");
  await r5.json();
  console.log(`dashboard @500+: ${Date.now() - t4}ms`);

  // cleanup
  await db.task.deleteMany({ where: { leadId: { in: ids } } });
  await db.activity.deleteMany({ where: { leadId: { in: ids } } });
  await db.lead.deleteMany({ where: { id: { in: ids } } });
  console.log("cleanup done");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
