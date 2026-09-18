// HAYDEV LEADOS — TENANT GUARD TESTS (v0.19.2 hardening §10–17, §44–45).
//
// REQUIRED TENANT PROOFS (§44): Org A can NEVER use Org B's
//   source / stage / owner / pipeline / task assignee —
// and ZERO cross-org relations may be persisted.
//
// MEMBERSHIP SOURCE OF TRUTH (§45/§14): authorization comes from
// OrganizationMember (status=ACTIVE), NEVER from the legacy
// User.organizationId / User.role cache columns.

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import {
  TenantGuardError,
  requireOrgMember,
  requireOrgSource,
  requireOrgStage,
  requireOrgPipeline,
  requireOrgTag,
  requireOrgCustomField,
  isOrgMember,
  resolveOrgFallbackRecipient,
} from "../src/lib/leados/tenant-guard";
import {
  createLead,
  updateLead,
  changeStage,
  assignLead,
} from "../src/lib/leados/lead-service";
import { createTask } from "../src/lib/leados/task-service";
import { getOrgFallbackRecipient } from "../src/lib/leados/domain-event-service";

const db = new PrismaClient();

const SLUG_A = `tenant-guard-a-${Date.now()}`;
const SLUG_B = `tenant-guard-b-${Date.now()}`;

let orgA = "";
let orgB = "";
let userA1 = ""; // Org A OWNER
let userA2 = ""; // Org A MEMBER
let userB1 = ""; // Org B OWNER (foreign)
let sourceA = "";
let sourceB = "";
let pipelineA = "";
let pipelineB = "";
let stageA = "";
let stageB = "";
let tagA = "";
let customFieldA = "";

beforeAll(async () => {
  const a = await db.organization.create({
    data: { name: "Tenant Guard A", slug: SLUG_A, locale: "en", timezone: "UTC", currency: "USD" },
  });
  orgA = a.id;
  const b = await db.organization.create({
    data: { name: "Tenant Guard B", slug: SLUG_B, locale: "en", timezone: "UTC", currency: "USD" },
  });
  orgB = b.id;

  const uA1 = await db.user.create({
    data: { organizationId: orgA, name: "A Owner", email: `a-owner-${Date.now()}@tg.test`, role: "OWNER", status: "ACTIVE" },
  });
  userA1 = uA1.id;
  const uA2 = await db.user.create({
    data: { organizationId: orgA, name: "A Member", email: `a-member-${Date.now()}@tg.test`, role: "MEMBER", status: "ACTIVE" },
  });
  userA2 = uA2.id;
  const uB1 = await db.user.create({
    data: { organizationId: orgB, name: "B Owner", email: `b-owner-${Date.now()}@tg.test`, role: "OWNER", status: "ACTIVE" },
  });
  userB1 = uB1.id;
  await db.organizationMember.createMany({
    data: [
      { organizationId: orgA, userId: userA1, role: "OWNER" },
      { organizationId: orgA, userId: userA2, role: "MEMBER" },
      { organizationId: orgB, userId: userB1, role: "OWNER" },
    ],
  });

  sourceA = (await db.leadSource.create({ data: { organizationId: orgA, name: "A Website", type: "website" } })).id;
  sourceB = (await db.leadSource.create({ data: { organizationId: orgB, name: "B Website", type: "website" } })).id;
  pipelineA = (await db.pipeline.create({ data: { organizationId: orgA, name: "PA", isDefault: true } })).id;
  pipelineB = (await db.pipeline.create({ data: { organizationId: orgB, name: "PB", isDefault: true } })).id;
  stageA = (await db.pipelineStage.create({ data: { pipelineId: pipelineA, name: "New", type: "open", position: 0 } })).id;
  stageB = (await db.pipelineStage.create({ data: { pipelineId: pipelineB, name: "New", type: "open", position: 0 } })).id;
  tagA = (await db.tag.create({ data: { organizationId: orgA, name: `tg-a-${Date.now()}` } })).id;
  customFieldA = (await db.customField.create({
    data: { organizationId: orgA, key: `tgf${Date.now()}`, name: "TG Field", type: "text" },
  })).id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.$disconnect();
});

/** Awaits `fn` and requires it to reject with TenantGuardError (404-equivalent). */
async function expectTenantBlocked(fn: Promise<unknown>) {
  try {
    await fn;
    throw new Error("expected TenantGuardError, but the call SUCCEEDED");
  } catch (e) {
    if (!(e instanceof TenantGuardError)) throw e;
    expect(e.httpStatus).toBe(404);
    expect(e.name).toBe("TenantGuardError");
  }
}

// ---------------------------------------------------------------------------
// §10 — central guards reject foreign IDs (404-equivalent)
// ---------------------------------------------------------------------------

describe("tenant guards (§10)", () => {
  test("requireOrgMember: foreign user rejected; removed member rejected; legacy User.role cache cannot grant access", async () => {
    await expectTenantBlocked(requireOrgMember(orgA, userB1)); // Org B owner
    // user with NO membership at all but a forged User.organizationId cache
    const ghost = await db.user.create({
      data: { organizationId: orgA, name: "Ghost", email: `ghost-${Date.now()}@tg.test`, role: "OWNER", status: "ACTIVE" },
    });
    await expectTenantBlocked(requireOrgMember(orgA, ghost.id)); // no membership row
    // removed membership → blocked IMMEDIATELY (§45)
    const leaver = await db.user.create({
      data: { organizationId: orgA, name: "Leaver", email: `leaver-${Date.now()}@tg.test`, role: "MEMBER", status: "ACTIVE" },
    });
    await db.organizationMember.create({
      data: { organizationId: orgA, userId: leaver.id, role: "MEMBER", status: "REMOVED" },
    });
    await expectTenantBlocked(requireOrgMember(orgA, leaver.id));
    // suspended user (member row ACTIVE but user suspended) → blocked
    const sleeper = await db.user.create({
      data: { organizationId: orgA, name: "Sleeper", email: `sleeper-${Date.now()}@tg.test`, role: "MEMBER", status: "SUSPENDED" },
    });
    await db.organizationMember.create({ data: { organizationId: orgA, userId: sleeper.id, role: "MEMBER" } });
    await expectTenantBlocked(requireOrgMember(orgA, sleeper.id));
    // happy path
    const m = await requireOrgMember(orgA, userA2);
    expect(m.role).toBe("MEMBER");
    expect(await isOrgMember(orgA, userA1)).toBe(true);
    expect(await isOrgMember(orgA, userB1)).toBe(false);
  });

  test("§10 v0.20: same user with DIFFERENT roles in two orgs → per-org role from the MEMBERSHIP row (never the User.role cache)", async () => {
    // Dual member: MEMBER in Org A, OWNER in Org B. The User.role cache can
    // only hold ONE value — authorization must read the per-org membership.
    const dual = await db.user.create({
      // cache deliberately says OWNER (would wrongly grant Org A owner power)
      data: { organizationId: orgA, name: "Dual", email: `dual-${Date.now()}@tg.test`, role: "OWNER", status: "ACTIVE" },
    });
    await db.organizationMember.createMany({
      data: [
        { organizationId: orgA, userId: dual.id, role: "MEMBER" },
        { organizationId: orgB, userId: dual.id, role: "OWNER" },
      ],
    });
    const inA = await requireOrgMember(orgA, dual.id);
    expect(inA.role).toBe("MEMBER"); // membership row wins over the OWNER cache
    const inB = await requireOrgMember(orgB, dual.id);
    expect(inB.role).toBe("OWNER");
    // Both orgs grant access; the ROLE differs per org — correct permissions.
    expect(await isOrgMember(orgA, dual.id)).toBe(true);
    expect(await isOrgMember(orgB, dual.id)).toBe(true);
    // The B-membership OWNER role does NOT leak into A's guard…
    expect((await requireOrgMember(orgA, dual.id)).role).not.toBe("OWNER");
    // …and removing ONLY the A-membership blocks A immediately while B still works.
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgA, userId: dual.id } },
      data: { status: "REMOVED" },
    });
    await expectTenantBlocked(requireOrgMember(orgA, dual.id));
    const stillB = await requireOrgMember(orgB, dual.id);
    expect(stillB.role).toBe("OWNER");
    await db.user.delete({ where: { id: dual.id } });
  });

  test("requireOrgSource: foreign source rejected", async () => {
    await expectTenantBlocked(requireOrgSource(orgA, sourceB));
    expect((await requireOrgSource(orgA, sourceA)).id).toBe(sourceA);
  });

  test("requireOrgStage: foreign stage rejected THROUGH its pipeline (§13)", async () => {
    await expectTenantBlocked(requireOrgStage(orgA, stageB));
    expect((await requireOrgStage(orgA, stageA)).pipelineId).toBe(pipelineA);
  });

  test("requireOrgPipeline / requireOrgTag / requireOrgCustomField: foreign IDs rejected", async () => {
    await expectTenantBlocked(requireOrgPipeline(orgA, pipelineB));
    const tagB = await db.tag.create({ data: { organizationId: orgB, name: `tg-b-${Date.now()}` } });
    await expectTenantBlocked(requireOrgTag(orgA, tagB.id));
    const cfB = await db.customField.create({
      data: { organizationId: orgB, key: `tgb${Date.now()}`, name: "B Field", type: "text" },
    });
    await expectTenantBlocked(requireOrgCustomField(orgA, cfB.id));
    expect((await requireOrgPipeline(orgA, pipelineA)).id).toBe(pipelineA);
    expect((await requireOrgTag(orgA, tagA)).id).toBe(tagA);
    expect((await requireOrgCustomField(orgA, customFieldA)).id).toBe(customFieldA);
  });
});

// ---------------------------------------------------------------------------
// §11–13 — service-level hardening (createLead / updateLead / changeStage)
// ---------------------------------------------------------------------------

describe("createLead hardening (§11)", () => {
  test("foreign sourceId → typed error, ZERO leads created", async () => {
    const before = await db.lead.count({ where: { organizationId: orgA } });
    await expectTenantBlocked(
      createLead(orgA, null, { firstName: "Evil", lastName: "Source", sourceId: sourceB })
    );
    expect(await db.lead.count({ where: { organizationId: orgA } })).toBe(before);
  });

  test("foreign stageId → typed error, ZERO leads created", async () => {
    const before = await db.lead.count({ where: { organizationId: orgA } });
    await expectTenantBlocked(
      createLead(orgA, null, { firstName: "Evil", lastName: "Stage", stageId: stageB })
    );
    expect(await db.lead.count({ where: { organizationId: orgA } })).toBe(before);
  });

  test("foreign ownerId → typed error, ZERO leads created", async () => {
    const before = await db.lead.count({ where: { organizationId: orgA } });
    await expectTenantBlocked(
      createLead(orgA, null, { firstName: "Evil", lastName: "Owner", ownerId: userB1 })
    );
    expect(await db.lead.count({ where: { organizationId: orgA } })).toBe(before);
  });

  test("valid create works and stays inside the org", async () => {
    const res = await createLead(orgA, userA1, {
      firstName: "Good", lastName: "Lead", sourceId: sourceA, stageId: stageA, ownerId: userA2,
      email: `good-${Date.now()}@tg.test`,
    });
    expect(res.created).toBe(true);
    expect(res.lead.organizationId).toBe(orgA);
    expect(res.lead.ownerId).toBe(userA2);
    expect(res.lead.stageId).toBe(stageA);
    expect(res.lead.pipelineId).toBe(pipelineA); // derived from the VALIDATED stage
  });
});

describe("updateLead hardening (§12)", () => {
  test("foreign ownerId in update → typed error; lead relation UNCHANGED", async () => {
    const lead = await createLead(orgA, userA1, { firstName: "Keep", lastName: "Me", email: `keep-${Date.now()}@tg.test` });
    await expectTenantBlocked(
      updateLead(orgA, lead.lead.id, userA1, { ownerId: userB1 })
    );
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    expect(after.ownerId).toBe(lead.lead.ownerId); // never connected to Org B user
  });

  test("foreign sourceId in update → typed error; relation UNCHANGED", async () => {
    const lead = await createLead(orgA, userA1, { firstName: "Keep2", lastName: "Me", email: `keep2-${Date.now()}@tg.test` });
    await expectTenantBlocked(
      updateLead(orgA, lead.lead.id, userA1, { sourceId: sourceB })
    );
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    expect(after.sourceId).toBe(lead.lead.sourceId);
  });
});

describe("changeStage hardening (§13)", () => {
  test("foreign stage → typed error (stage.pipeline.organizationId check), lead stays", async () => {
    const lead = await createLead(orgA, userA1, { firstName: "Stay", lastName: "Put", email: `stay-${Date.now()}@tg.test` });
    await expectTenantBlocked(changeStage(orgA, lead.lead.id, userA1, stageB));
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    expect(after.stageId).toBe(lead.lead.stageId);
    expect(after.pipelineId).toBe(pipelineA);
  });
});

describe("assignLead membership source of truth (§14)", () => {
  test("foreign owner (Org B OWNER) → typed error, no assignment", async () => {
    const lead = await createLead(orgA, userA1, { firstName: "No", lastName: "Hijack", email: `nh-${Date.now()}@tg.test` });
    await expectTenantBlocked(assignLead(orgA, lead.lead.id, userA1, userB1));
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    expect(after.ownerId).not.toBe(userB1);
  });

  test("legacy User.organizationId cache CANNOT grant assignment (member row REMOVED)", async () => {
    // user's cache still points at org A + role OWNER, but membership was removed
    const leaver = await db.user.create({
      data: { organizationId: orgA, name: "Cache Ghost", email: `cg-${Date.now()}@tg.test`, role: "OWNER", status: "ACTIVE" },
    });
    await db.organizationMember.create({
      data: { organizationId: orgA, userId: leaver.id, role: "OWNER", status: "REMOVED" },
    });
    const lead = await createLead(orgA, userA1, { firstName: "No", lastName: "Cache", email: `nc-${Date.now()}@tg.test` });
    await expectTenantBlocked(assignLead(orgA, lead.lead.id, userA1, leaver.id));
  });
});

describe("createTask assignee hardening (§15)", () => {
  test("foreign assignee → typed error, ZERO tasks created", async () => {
    const lead = await createLead(orgA, userA1, { firstName: "Task", lastName: "Guard", email: `tk-${Date.now()}@tg.test` });
    const before = await db.task.count({ where: { organizationId: orgA } });
    await expectTenantBlocked(
      createTask(orgA, { title: "Foreign assignee task", leadId: lead.lead.id, assignedTo: userB1 })
    );
    expect(await db.task.count({ where: { organizationId: orgA } })).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// §16 — fallback recipient from OrganizationMember
// ---------------------------------------------------------------------------

describe("domain-event fallback recipient (§16)", () => {
  test("resolves the ACTIVE OWNER member (not User.role cache)", async () => {
    // userA1 is the Org A OWNER member
    expect(await resolveOrgFallbackRecipient(orgA)).toBe(userA1);
    expect(await getOrgFallbackRecipient(orgA)).toBe(userA1);
  });

  test("OWNER membership removed → falls to ADMIN member, then any ACTIVE member (§45)", async () => {
    await db.organizationMember.updateMany({
      where: { organizationId: orgA, userId: userA1 },
      data: { status: "REMOVED" },
    });
    const admin = await db.user.create({
      data: { organizationId: orgA, name: "A Admin", email: `a-admin-${Date.now()}@tg.test`, role: "MEMBER", status: "ACTIVE" },
    });
    await db.organizationMember.create({ data: { organizationId: orgA, userId: admin.id, role: "ADMIN" } });
    expect(await resolveOrgFallbackRecipient(orgA)).toBe(admin.id);
    await db.organizationMember.updateMany({
      where: { organizationId: orgA, userId: admin.id },
      data: { status: "REMOVED" },
    });
    // no OWNER/ADMIN left → first ACTIVE member (userA2 is MEMBER ACTIVE)
    expect(await resolveOrgFallbackRecipient(orgA)).toBe(userA2);
  });

  test("org with zero ACTIVE members → null (never guesses)", async () => {
    const empty = await db.organization.create({
      data: { name: "Empty Org", slug: `tenant-guard-e-${Date.now()}`, locale: "en", timezone: "UTC", currency: "USD" },
    });
    expect(await resolveOrgFallbackRecipient(empty.id)).toBeNull();
    await db.organization.delete({ where: { id: empty.id } });
  });
});

// ---------------------------------------------------------------------------
// §44 — zero cross-org relations persisted (final sweep)
// ---------------------------------------------------------------------------

describe("zero cross-org relations persisted (§44)", () => {
  test("no Org A lead references Org B source/stage/pipeline/owner; no Org A task references Org B user", async () => {
    const orgALeads = await db.lead.findMany({ where: { organizationId: orgA } });
    for (const l of orgALeads) {
      expect(l.sourceId ?? "").not.toBe(sourceB);
      expect(l.stageId ?? "").not.toBe(stageB);
      expect(l.pipelineId ?? "").not.toBe(pipelineB);
      expect(l.ownerId ?? "").not.toBe(userB1);
    }
    const orgATasks = await db.task.findMany({ where: { organizationId: orgA } });
    for (const t of orgATasks) {
      expect(t.assignedTo ?? "").not.toBe(userB1);
    }
  });
});
