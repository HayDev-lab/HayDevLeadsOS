// HAYDEV LEADOS — STAGE SEMANTICS REGRESSION (v0.19.2 §41, documented P2).
//
// CURRENT BEHAVIOR (deliberately captured as regression tests): Lead.status
// derivation on stage transitions reads DISPLAY NAMES ("New" / "Contacted" /
// "Qualified") plus stage.type (won/lost). This is FRAGILE for renamed or
// localized stages — tracked as P2 debt. The safe v0.19.2 decision per the
// hardening spec: DO NOT redesign the pipeline; pin current behavior with
// tests + document. A future version should add a stable semantic code
// column (separate from the display name) and migrate this mapping.

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { createLead, changeStage } from "../src/lib/leados/lead-service";

const db = new PrismaClient();

const SLUG = `stage-sem-${Date.now()}`;
let orgId = "";
let userId = "";
let pipelineId = "";
let stageNew = "";
let stageContacted = "";
let stageQualified = "";
let stageWon = "";
let stageCustom = "";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: "Stage Semantics", slug: SLUG, locale: "en", timezone: "UTC", currency: "USD" },
  });
  orgId = org.id;
  const u = await db.user.create({
    data: { organizationId: orgId, name: "SS Owner", email: `ss-${Date.now()}@test.dev`, role: "OWNER", status: "ACTIVE" },
  });
  userId = u.id;
  await db.organizationMember.create({ data: { organizationId: orgId, userId, role: "OWNER" } });
  pipelineId = (await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } })).id;
  const mk = (name: string, position: number, type = "open") =>
    db.pipelineStage.create({ data: { pipelineId, name, position, type } });
  stageNew = (await mk("New", 0)).id;
  stageContacted = (await mk("Contacted", 1)).id;
  stageQualified = (await mk("Qualified", 2)).id;
  stageWon = (await mk("Won", 3, "won")).id;
  stageCustom = (await mk("Renamed Custom Stage", 4)).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
});

describe("stage → Lead.status derivation (current behavior — §41 P2 documented)", () => {
  test("display-name stages map to their statuses", async () => {
    const lead = await createLead(orgId, userId, { firstName: "Sem", email: `sem-${Date.now()}@t.dev` });
    // initial stage = first stage ("New") → status NEW
    expect(lead.lead.status).toBe("NEW");
    await changeStage(orgId, lead.lead.id, userId, stageContacted);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("CONTACTED");
    await changeStage(orgId, lead.lead.id, userId, stageQualified);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("QUALIFIED");
  });

  test("stage.type won/lost drives WON/LOST regardless of display name", async () => {
    const lead = await createLead(orgId, userId, { firstName: "WonL", email: `wonl-${Date.now()}@t.dev` });
    await changeStage(orgId, lead.lead.id, userId, stageWon);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("WON");
  });

  test("P2 DEBT DOCUMENTED: custom/renamed stage falls back to OPEN (display-name coupling)", async () => {
    const lead = await createLead(orgId, userId, { firstName: "Cust", email: `cust-${Date.now()}@t.dev` });
    await changeStage(orgId, lead.lead.id, userId, stageCustom);
    // A renamed "Contacted" stage would derive OPEN, not CONTACTED — this is
    // the documented P2 fragility (stable semantic code is the future fix).
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("OPEN");
  });

  test("same-stage transition is a no-op (timer not reset)", async () => {
    const lead = await createLead(orgId, userId, { firstName: "Noop", email: `noop-${Date.now()}@t.dev` });
    const before = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    await new Promise((r) => setTimeout(r, 20));
    await changeStage(orgId, lead.lead.id, userId, before.stageId!);
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    expect(after.stageEnteredAt.getTime()).toBe(before.stageEnteredAt.getTime());
  });
});
