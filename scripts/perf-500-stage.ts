// 500-lead performance QA (Section 47/100) for STAGE INACTIVITY.
// Creates 500 synthetic leads (random stages + stage ages), then times:
// default list · stale filter · stage+stale combined · stage-inactivity sort ·
// dashboard (attention) · kanban. Verifies cross-surface count consistency.
// Cleans up afterwards. Usage: bunx tsx scripts/perf-500-stage.ts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const B = "http://localhost:3000";
const TAG = "PERF500";

async function main() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("no org");
  const stages = await db.pipelineStage.findMany({
    where: { pipeline: { organizationId: org.id } },
    orderBy: { position: "asc" },
  });
  const users = await db.user.findMany({ where: { organizationId: org.id } });

  // Existing PERF rows (idempotent reruns)
  await db.lead.deleteMany({ where: { organizationId: org.id, sourceDetail: TAG } });

  const now = Date.now();
  const rows: {
    organizationId: string;
    firstName: string;
    lastName: string;
    company: string;
    email: string;
    normalizedEmail: string;
    sourceDetail: string;
    status: string;
    pipelineId: string;
    stageId: string;
    ownerId: string | null;
    stageEnteredAt: Date;
    createdAt: Date;
  }[] = [];
  for (let i = 0; i < 500; i++) {
    // Distribution: ~55% on-track, ~20% aging, ~15% stale, 10% final
    const roll = Math.random();
    const open = stages.filter((s) => s.type === "open");
    const stage = open[Math.floor(Math.random() * open.length)];
    const thresholds: Record<string, number> = {
      New: 24, Contacted: 48, Qualified: 72, Meeting: 72, Proposal: 120, Negotiation: 120,
    };
    const th = thresholds[stage.name] ?? 72;
    let ageHours: number;
    if (roll < 0.55) ageHours = Math.random() * (th - 12); // on track
    else if (roll < 0.75) ageHours = th - 12 + Math.random() * 11.9; // aging
    else if (roll < 0.9) ageHours = th + Math.random() * 96; // stale
    else {
      // final stages
      const fin = stages.filter((s) => s.type !== "open");
      const fs = fin[Math.floor(Math.random() * fin.length)];
      rows.push({
        organizationId: org.id,
        firstName: `Perf${i}`,
        lastName: "FiveHundred",
        company: `Perf Company ${i} ${TAG}`,
        email: `perf${i}@perf.test`,
        normalizedEmail: `perf${i}@perf.test`,
        sourceDetail: TAG,
        status: fs.type === "won" ? "WON" : "LOST",
        pipelineId: fs.pipelineId,
        stageId: fs.id,
        ownerId: users[i % users.length]?.id ?? null,
        stageEnteredAt: new Date(now - Math.random() * 50 * 3_600_000),
        createdAt: new Date(now - (50 + Math.random() * 100) * 3_600_000),
      });
      continue;
    }
    rows.push({
      organizationId: org.id,
      firstName: `Perf${i}`,
      lastName: "FiveHundred",
      company: `Perf Company ${i} ${TAG}`,
      email: `perf${i}@perf.test`,
      normalizedEmail: `perf${i}@perf.test`,
      sourceDetail: TAG,
      status: "OPEN",
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      ownerId: users[i % users.length]?.id ?? null,
      stageEnteredAt: new Date(now - ageHours * 3_600_000),
      createdAt: new Date(now - (ageHours + 24) * 3_600_000),
    });
  }
  await db.lead.createMany({ data: rows });
  console.log(`[perf] created ${rows.length} synthetic leads`);

  const time = async (label: string, url: string, pick?: (d: any) => string) => {
    const t0 = performance.now();
    const res = await fetch(url);
    const d = await res.json();
    const ms = Math.round(performance.now() - t0);
    const info = pick ? pick(d) : "";
    console.log(`[perf] ${label}: ${ms}ms ${info}`);
    return d;
  };

  const staleByFilter = await time("leads default (sort=stageinactivity, p1)", `${B}/api/v1/leads?sort=stageinactivity:urgency&limit=25`, (d) => `total=${d.total}`);
  await time("stageHealth=STALE filter", `${B}/api/v1/leads?stageHealth=STALE&limit=25`, (d) => `total=${d.total}`);
  const proposal = stages.find((s) => s.name === "Proposal")!;
  await time(`stage=Proposal + STALE combined`, `${B}/api/v1/leads?stageId=${proposal.id}&stageHealth=STALE`, (d) => `total=${d.total}`);
  await time("stageHealth=STALE + sla=BREACH", `${B}/api/v1/leads?stageHealth=STALE&sla=BREACH`, (d) => `total=${d.total}`);
  await time("stageHealth=STALE + followUp=OVERDUE", `${B}/api/v1/leads?stageHealth=STALE&followUp=OVERDUE`, (d) => `total=${d.total}`);
  const dash = await time("dashboard (incl. attention)", `${B}/api/v1/dashboard`, (d) => `staleDeals=${d.metrics.staleDeals} attention.issues=${d.slaAttention.counts.totalIssues}`);
  await time("kanban", `${B}/api/v1/pipeline/kanban?limit=50`, (d) => `cards=${d.totals.leads}`);
  const csv0 = performance.now();
  const csvRes = await fetch(`${B}/api/v1/export?stageHealth=STALE`);
  const csvText = await csvRes.text();
  const csvRows = csvText.trim().split("\n").length - 1;
  console.log(`[perf] export stageHealth=STALE: ${Math.round(performance.now() - csv0)}ms rows=${csvRows}`);

  // CROSS-SURFACE CONSISTENCY (Section 136)
  const filterTotal = staleByFilter.total;
  const filterStale = await fetch(`${B}/api/v1/leads?stageHealth=STALE&limit=1`).then((r) => r.json());
  const listStale = filterStale.total;
  const dashStale = dash.metrics.staleDeals;
  console.log(`[consistency] list=${listStale} dashboard=${dashStale} export=${csvRows} → ${listStale === dashStale && listStale === csvRows ? "MATCH ✓" : "MISMATCH ✗"}`);

  // Cleanup
  const del = await db.lead.deleteMany({ where: { organizationId: org.id, sourceDetail: TAG } });
  console.log(`[perf] cleaned up ${del.count} synthetic leads`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
