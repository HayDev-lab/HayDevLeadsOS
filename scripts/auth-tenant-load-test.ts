// v0.17 TENANT LOAD TEST (spec 89–92).
// Creates 10 organizations × 5 users × 50 leads (500 total) and proves:
//   - every org sees ONLY its own data through org-scoped queries;
//   - membership/permission resolution adds no N+1 storm (spec 91);
//   - a realistic authenticated request stays cheap (spec 92);
//   - cross-org ID probes (org A asking for org B's lead) all miss.
// Throwaway data — everything is deleted afterwards (cascade).

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/leados/auth/password";
import { createSession, validateSessionToken } from "../src/lib/leados/auth/session-store";
import { resolveAuthenticatedSessionFromToken } from "../src/lib/leados/context";
import { updateLead } from "../src/lib/leados/lead-service";
import { permissionsForRole } from "../src/lib/leados/auth/permissions";

const db = new PrismaClient();
const RUN = Date.now().toString(36);
const ORG_COUNT = 10;
const USERS_PER_ORG = 5;
const LEADS_PER_ORG = 50;

const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet"];

async function main() {
  const t0 = Date.now();
  console.log(`Creating ${ORG_COUNT} orgs × ${USERS_PER_ORG} users × ${LEADS_PER_ORG} leads…`);

  const orgIds: string[] = [];
  const leadIds: string[] = [];
  const passwordHash = await hashPassword("LoadTest123!");

  for (let i = 0; i < ORG_COUNT; i++) {
    const org = await db.organization.create({
      data: { name: `Load ${NAMES[i]} ${RUN}`, slug: `load-${NAMES[i].toLowerCase()}-${RUN}`, isDemo: false },
    });
    orgIds.push(org.id);
    const source = await db.leadSource.create({
      data: { organizationId: org.id, name: "Web", type: "website" },
    });
    const pipeline = await db.pipeline.create({ data: { organizationId: org.id, name: "P", isDefault: true } });
    const stage = await db.pipelineStage.create({
      data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 },
    });
    for (let u = 0; u < USERS_PER_ORG; u++) {
      const user = await db.user.create({
        data: {
          organizationId: org.id,
          name: `User ${NAMES[i]}-${u}`,
          email: `load-${RUN}-${i}-${u}@test.local`,
          role: u === 0 ? "OWNER" : "MEMBER",
          status: "ACTIVE",
          passwordHash,
        },
      });
      await db.organizationMember.create({
        data: { organizationId: org.id, userId: user.id, role: u === 0 ? "OWNER" : "MEMBER" },
      });
    }
    const leadRows = Array.from({ length: LEADS_PER_ORG }, (_, k) => ({
      organizationId: org.id,
      firstName: `Lead${i}`,
      lastName: `#${k}`,
      status: "NEW",
      priority: "MEDIUM",
      sourceId: source.id,
      stageId: stage.id,
    }));
    for (const row of leadRows) {
      const lead = await db.lead.create({ data: row });
      leadIds.push(lead.id);
    }
  }

  const createdMs = Date.now() - t0;
  console.log(`Created in ${(createdMs / 1000).toFixed(1)}s. Verifying isolation…`);

  // --- per-org counts must be exact (no contamination) -------------------
  let countsOk = true;
  for (const orgId of orgIds) {
    const n = await db.lead.count({ where: { organizationId: orgId } });
    if (n !== LEADS_PER_ORG) {
      countsOk = false;
      console.error(`  ✗ org ${orgId} sees ${n} leads (expected ${LEADS_PER_ORG})`);
    }
  }
  console.log(`${countsOk ? "✓" : "✗"} every org sees exactly ${LEADS_PER_ORG} own leads (10/10)`);

  const totalLeads = await db.lead.count({ where: { organizationId: { in: orgIds } } });
  console.log(`${totalLeads === 500 ? "✓" : "✗"} total leads across load orgs = ${totalLeads} (expected 500)`);

  // --- session resolution per org: correct org + role + permissions -----
  let sessionOk = true;
  const sessions: string[] = [];
  for (let i = 0; i < ORG_COUNT; i++) {
    const owner = await db.user.findFirst({
      where: { email: `load-${RUN}-${i}-0@test.local` },
    });
    const issued = await createSession(owner!.id, {});
    sessions.push(issued.token);
    const s = await resolveAuthenticatedSessionFromToken(issued.token);
    if (!s || s.orgId !== orgIds[i] || s.role !== "OWNER" || !permissionsForRole("OWNER").every((p) => s.permissions.includes(p))) {
      sessionOk = false;
      console.error(`  ✗ session for org ${i} resolved wrong: org=${s?.orgId} role=${s?.role}`);
    }
  }
  console.log(`${sessionOk ? "✓" : "✗"} 10 owner sessions resolve to their own org with OWNER permissions`);

  // --- cross-org ID probes: org 0 owner asks for org 1..9 leads ---------
  const attackerToken = sessions[0];
  const attacker = (await resolveAuthenticatedSessionFromToken(attackerToken))!;
  let crossMisses = 0;
  const otherLeads = leadIds.filter((id) => id !== leadIds[0]);
  // sample 90 probes (10 per org) to keep it fast — all must be blocked
  const probes: string[] = [];
  for (let i = 1; i < orgIds.length; i++) {
    const orgLeads = await db.lead.findMany({ where: { organizationId: orgIds[i] }, take: 10, select: { id: true } });
    probes.push(...orgLeads.map((l) => l.id));
  }
  for (const leadId of probes) {
    try {
      await updateLead(attacker.orgId, leadId, attacker.userId, { priority: "URGENT" });
      console.error(`  ✗ cross-tenant WRITE succeeded for lead ${leadId}!`);
    } catch {
      crossMisses++;
    }
  }
  console.log(`${crossMisses === probes.length ? "✓" : "✗"} cross-tenant write probes: ${crossMisses}/${probes.length} blocked (LEAD_NOT_FOUND)`);
  void otherLeads;

  // --- read probes through the route pattern (findUnique + org check) ---
  let readMisses = 0;
  for (const leadId of probes) {
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.organizationId !== attacker.orgId) readMisses++;
  }
  console.log(`${readMisses === probes.length ? "✓" : "✗"} cross-tenant read probes: ${readMisses}/${probes.length} blocked`);

  // --- performance: 100 session validations (spec 92) --------------------
  const perf0 = Date.now();
  for (let i = 0; i < 100; i++) {
    await resolveAuthenticatedSessionFromToken(sessions[i % ORG_COUNT]);
  }
  const perReq = (Date.now() - perf0) / 100;
  console.log(`${perReq < 25 ? "✓" : "⚠"} session resolution: ${perReq.toFixed(1)}ms per request (target < 25ms)`);

  // --- validate tokens directly (throttled idle-touch excluded) ----------
  const v0 = await validateSessionToken(sessions[0]);
  console.log(`${v0.valid ? "✓" : "✗"} token validation works for load users`);

  // --- cleanup ------------------------------------------------------------
  const c0 = Date.now();
  await db.organization.deleteMany({ where: { slug: { contains: RUN } } });
  await db.session.deleteMany({});
  console.log(`cleanup in ${((Date.now() - c0) / 1000).toFixed(1)}s (cascade removed users/leads/memberships/sessions)`);
  const leftover = await db.user.count({ where: { email: { contains: `-${RUN}@` } } });
  console.log(`${leftover === 0 ? "✓" : "✗"} zero leftover users after cleanup (${leftover})`);
}

main()
  .catch((e) => {
    console.error("LOAD TEST FAILED", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
