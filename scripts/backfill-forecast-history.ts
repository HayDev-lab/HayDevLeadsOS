// Backfill stage-transition history for the REVENUE FORECAST (v0.18).
//
// Two repairs on existing data (the seed now generates both for fresh DBs):
//   1. RESOLVED leads (WON/LOST) seeded directly at their terminal stage have
//      no STAGE_CHANGE history → the forecast has no empirical samples.
//      Synthesize the funnel path the seed would create today:
//        entry stage (business_audit → Qualified, else New)
//          → furthest open stage (lostAtStageIdx for LOST, else Negotiation)
//          → terminal stage (Won/Lost).
//   2. STAGE_CHANGE activities created by the old seed have no metadata.to →
//      set metadata from the stage named in the activity title.
//
// Idempotent: re-running detects existing history / metadata and skips.
// Usage: bunx tsx scripts/backfill-forecast-history.ts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Furthest open stage a LOST lead reached (matches seed LEADS rows).
const LOST_AT: Record<string, number> = {
  "QuickFix Services": 5, // Pavel — lost at Negotiation
  "Sunset Restaurant Group": 4, // Anahit — lost at Proposal
};

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, isDemo: true } });
  let synthesizedLeads = 0;
  let repairedMetadata = 0;
  let skippedResolved = 0;

  for (const org of orgs) {
    const stages = await db.pipelineStage.findMany({
      where: { pipeline: { organizationId: org.id, isDefault: true } },
      orderBy: { position: "asc" },
      select: { id: true, name: true, type: true },
    });
    if (stages.length === 0) continue;
    const stageByName = new Map(stages.map((s) => [s.name, s]));
    const lastOpenIdx = stages.filter((s) => s.type === "open").length - 1;

    // 1. Synthesize history for resolved leads without any.
    const resolved = await db.lead.findMany({
      where: { organizationId: org.id, status: { in: ["WON", "LOST"] } },
      include: { source: { select: { type: true } }, stage: { select: { name: true, type: true } } },
    });
    for (const lead of resolved) {
      const existing = await db.activity.count({ where: { leadId: lead.id, type: "STAGE_CHANGE" } });
      if (existing > 0) {
        skippedResolved++;
        continue;
      }
      const entryIdx = lead.source?.type === "business_audit" ? Math.min(2, lastOpenIdx) : 0;
      const furthestOpen =
        lead.status === "LOST" ? Math.min(LOST_AT[lead.company ?? ""] ?? lastOpenIdx, lastOpenIdx) : lastOpenIdx;
      const terminalIdx = stages.findIndex((s) => s.id === lead.stageId);
      const path: number[] = [];
      for (let i = entryIdx; i <= furthestOpen; i++) path.push(i);
      if (terminalIdx >= 0 && !path.includes(terminalIdx)) path.push(terminalIdx);

      const start = lead.createdAt.getTime() + 7_200_000;
      const end = lead.createdAt.getTime() + Math.max(86_400_000, (Date.now() - lead.createdAt.getTime()) * 0.6);
      for (let pi = 0; pi < path.length; pi++) {
        const hop = stages[path[pi]];
        if (!hop) continue;
        await db.activity.create({
          data: {
            organizationId: org.id,
            leadId: lead.id,
            userId: lead.ownerId ?? null,
            type: "STAGE_CHANGE",
            title: `Stage changed to ${hop.name}`,
            metadata: { to: hop.id, stageName: hop.name },
            createdAt: new Date(start + ((end - start) / path.length) * pi),
          },
        });
      }
      synthesizedLeads++;
    }

    // 2. Repair missing metadata.to on existing activities (old seed rows).
    const acts = await db.activity.findMany({
      where: { organizationId: org.id, type: "STAGE_CHANGE" },
      select: { id: true, title: true, leadId: true, metadata: true },
    });
    for (const a of acts) {
      if (a.metadata && (a.metadata as { to?: string }).to) continue; // already has metadata
      const m = a.title.match(/(?:Moved to|Stage changed to) (.+)$/);
      const st = m ? stageByName.get(m[1]) : null;
      if (!st) continue;
      await db.activity.update({
        where: { id: a.id },
        data: { metadata: { to: st.id, stageName: st.name } as object },
      });
      repairedMetadata++;
    }
  }

  console.log(
    JSON.stringify({ synthesizedLeads, repairedMetadata, skippedResolved: skippedResolved }, null, 1)
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
