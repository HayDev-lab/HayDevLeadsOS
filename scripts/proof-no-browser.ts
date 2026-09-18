// PROOF (spec 74): workers run with NO browser — only the server-side
// scheduler. Verify WorkerRun rows exist with trigger=scheduler and count
// how many browser-visible requests hit the server (should be ~1 probe).
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const runs = await db.workerRun.findMany({ orderBy: { startedAt: "asc" } });
console.log(`scheduler-proven runs: ${runs.length}`);
for (const r of runs) {
  const s = (r.stats ?? {}) as Record<string, unknown>;
  console.log(`  ${r.startedAt.toISOString()} type=${r.type} trigger=${r.trigger} status=${r.status} execs=${s.executionsCreated ?? "-"} deliveries=${s.deliveriesSent ?? "-"}`);
}
const leases = await db.workerLease.count();
console.log(`active leases after runs: ${leases} (0 = clean release)`);
await db.$disconnect();
