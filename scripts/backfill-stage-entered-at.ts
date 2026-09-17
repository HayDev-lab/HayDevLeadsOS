// Backfill Lead.stageEnteredAt for pre-existing rows (run once after db push).
// Priority (spec Section 6): timestamp of the LAST STAGE_CHANGE activity for
// the lead; fallback createdAt. updatedAt is NEVER used as a fallback.
//
// Usage: bunx tsx scripts/backfill-stage-entered-at.ts  (or: bun run scripts/...)

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const leads = await db.lead.findMany({
    select: { id: true, createdAt: true, stageEnteredAt: true },
  });
  let fromActivity = 0;
  let fromCreatedAt = 0;
  let skipped = 0;

  for (const lead of leads) {
    if (lead.stageEnteredAt) {
      skipped++;
      continue;
    }
    const lastStageChange = await db.activity.findFirst({
      where: { leadId: lead.id, type: "STAGE_CHANGE" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const value = lastStageChange?.createdAt ?? lead.createdAt;
    if (lastStageChange) fromActivity++;
    else fromCreatedAt++;
    await db.lead.update({ where: { id: lead.id }, data: { stageEnteredAt: value } });
  }

  console.log(
    `[stage-inactivity backfill] total=${leads.length} from_stage_change=${fromActivity} from_createdAt=${fromCreatedAt} already_set=${skipped}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
