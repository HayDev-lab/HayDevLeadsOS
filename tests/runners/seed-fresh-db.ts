// HERMETIC SUBPROCESS RUNNER (v0.20 closure §6) — fresh-DB seed proof.
//
// Invoked by tests/build-artifact.test.ts (NOT collected by `bun test` —
// this is not a *.test.ts file). Proves the demo artifact pipeline:
//
//   fresh SQLite → prisma migrate deploy → seed() → counts
//
// The parent test passes a temp DB path as argv[2] and may point
// DATABASE_URL at the developer's runtime preview DB — the runner OVERRIDES
// it with the argv path, which is exactly what the packaged-demo build does
// (the preview runtime DB is never read, never copied).
//
// Prints exactly one "RESULT <json>" line on success.

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: bun tests/runners/seed-fresh-db.ts <absolute-db-file>");
  process.exit(1);
}

const databaseUrl = `file:${dbPath}`;
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-journal`, { force: true });

// 1. Fresh schema via migrations (NEVER `db push`).
execSync("bunx prisma migrate deploy", {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: "pipe",
});

// 2. Bind the Prisma client to the fresh DB BEFORE importing any module that
//    constructs it (src/lib/db reads DATABASE_URL at module load).
process.env.DATABASE_URL = databaseUrl;
process.env.LEADOS_DEMO = "true";

const { seed } = await import("@/lib/leados/seed");
const { db } = await import("@/lib/db");

const result = await seed();

const counts = {
  orgId: result.orgId,
  organizations: await db.organization.count(),
  isDemoOrg: (await db.organization.findUnique({ where: { id: result.orgId } }))?.isDemo ?? false,
  users: await db.user.count(),
  members: await db.organizationMember.count(),
  pipelines: await db.pipeline.count(),
  stages: await db.pipelineStage.count(),
  leads: await db.lead.count(),
  sources: await db.leadSource.count(),
  rules: await db.automationRule.count(),
  metaConnections: await db.metaConnection.count(),
  metaPages: await db.metaPageConnection.count(),
  metaForms: await db.metaLeadForm.count(),
};

console.log(`RESULT ${JSON.stringify(counts)}`);

await db.$disconnect();
process.exit(0);
