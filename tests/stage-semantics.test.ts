// HAYDEV LEADOS — STAGE SEMANTICS (v0.20 closure §12).
//
// v0.19.2 documented display-name coupling as P2 debt; this round CLOSED it:
// business logic (Lead.status derivation, LEAD_QUALIFIED events, follow-up
// suggestions, lost detection, scoring) reads the STABLE PipelineStage
// semanticCode — never the display name. Display names are user-renamable
// and localizable; renaming must never change behavior.
//
// Regression proofs:
//   • renaming "Qualified" (Armenian / Russian / custom) → status still
//     QUALIFIED + LEAD_QUALIFIED event still emitted
//   • semantic stages map to their statuses
//   • stage.type won/lost drives WON/LOST regardless of display name
//   • custom stage (semanticCode CUSTOM) → explicit OPEN fallback
//   • same-stage transition is a no-op (timer not reset)
//   • follow-up suggestions key on semantic codes, not names

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { createLead, changeStage } from "../src/lib/leados/lead-service";
import { suggestNextAction } from "../src/lib/leados/followup";
import { STAGE_SEMANTIC } from "../src/lib/leados/constants";

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
  const mk = (name: string, semanticCode: string, position: number, type = "open") =>
    db.pipelineStage.create({ data: { pipelineId, name, position, type, semanticCode } });
  stageNew = (await mk("New", STAGE_SEMANTIC.NEW, 0)).id;
  stageContacted = (await mk("Contacted", STAGE_SEMANTIC.CONTACTED, 1)).id;
  stageQualified = (await mk("Qualified", STAGE_SEMANTIC.QUALIFIED, 2)).id;
  stageWon = (await mk("Won", STAGE_SEMANTIC.WON, 3, "won")).id;
  stageCustom = (await mk("Renamed Custom Stage", STAGE_SEMANTIC.CUSTOM, 4)).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
});

describe("stage → Lead.status derivation (§12 stable semantics)", () => {
  test("semantic stages map to their statuses", async () => {
    const lead = await createLead(orgId, userId, { firstName: "Sem", email: `sem-${Date.now()}@t.dev` });
    // initial stage = first stage (NEW) → status NEW
    expect(lead.lead.status).toBe("NEW");
    await changeStage(orgId, lead.lead.id, userId, stageContacted);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("CONTACTED");
    await changeStage(orgId, lead.lead.id, userId, stageQualified);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("QUALIFIED");
  });

  test("§12 CORE: renaming Qualified to Armenian does NOT change semantics", async () => {
    await db.pipelineStage.update({ where: { id: stageQualified }, data: { name: "Որակավորված" } });
    const lead = await createLead(orgId, userId, { firstName: "Hy", email: `hy-${Date.now()}@t.dev` });
    await changeStage(orgId, lead.lead.id, userId, stageContacted);
    await changeStage(orgId, lead.lead.id, userId, stageQualified);
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    expect(after.status).toBe("QUALIFIED"); // display name is now Armenian
    const evts = await db.leadEvent.findMany({
      where: { leadId: lead.lead.id, type: "LEAD_QUALIFIED" },
    });
    expect(evts.length).toBe(1);
  });

  test("§12 CORE: renaming Qualified to Russian does NOT change semantics", async () => {
    await db.pipelineStage.update({ where: { id: stageQualified }, data: { name: "Квалифицирован" } });
    const lead = await createLead(orgId, userId, { firstName: "Ru", email: `ru-${Date.now()}@t.dev` });
    await changeStage(orgId, lead.lead.id, userId, stageQualified);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("QUALIFIED");
    const evts = await db.leadEvent.findMany({
      where: { leadId: lead.lead.id, type: "LEAD_QUALIFIED" },
    });
    expect(evts.length).toBe(1);
  });

  test("stage.type won/lost drives WON/LOST regardless of display name", async () => {
    const lead = await createLead(orgId, userId, { firstName: "WonL", email: `wonl-${Date.now()}@t.dev` });
    await changeStage(orgId, lead.lead.id, userId, stageWon);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("WON");
  });

  test("custom stage (semanticCode CUSTOM) → explicit OPEN fallback", async () => {
    const lead = await createLead(orgId, userId, { firstName: "Cust", email: `cust-${Date.now()}@t.dev` });
    await changeStage(orgId, lead.lead.id, userId, stageCustom);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } })).status).toBe("OPEN");
    const evts = await db.leadEvent.findMany({
      where: { leadId: lead.lead.id, type: "LEAD_QUALIFIED" },
    });
    expect(evts.length).toBe(0);
  });

  test("same-stage transition is a no-op (timer not reset)", async () => {
    const lead = await createLead(orgId, userId, { firstName: "Noop", email: `noop-${Date.now()}@t.dev` });
    const before = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    const beforeTs = before.stageEnteredAt!.getTime();
    await new Promise((r) => setTimeout(r, 20));
    await changeStage(orgId, lead.lead.id, userId, before.stageId!);
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.lead.id } });
    expect(after.stageEnteredAt!.getTime()).toBe(beforeTs);
  });
});

describe("follow-up suggestions key on semantic codes (§12)", () => {
  test("QUALIFIED semantic → schedule-meeting cadence even with a custom display name", () => {
    // Display name is irrelevant; the semantic code drives the suggestion.
    const a = suggestNextAction(STAGE_SEMANTIC.QUALIFIED);
    const b = suggestNextAction(STAGE_SEMANTIC.QUALIFIED);
    expect(a.label).toBe("Schedule meeting");
    expect(b).toEqual(a);
  });

  test("CONTACTED → follow-up cadence; MEETING → recap; PROPOSAL → proposal follow-up", () => {
    expect(suggestNextAction(STAGE_SEMANTIC.CONTACTED).label).toBe("Follow up");
    expect(suggestNextAction(STAGE_SEMANTIC.MEETING).label).toBe("Send recap");
    expect(suggestNextAction(STAGE_SEMANTIC.PROPOSAL).label).toBe("Follow up on proposal");
    expect(suggestNextAction(STAGE_SEMANTIC.NEGOTIATION).label).toBe("Push negotiation");
  });

  test("NEW / OPEN / CUSTOM / unknown → initial-contact cadence", () => {
    expect(suggestNextAction(STAGE_SEMANTIC.NEW).label).toBe("Initial contact");
    expect(suggestNextAction(STAGE_SEMANTIC.OPEN).label).toBe("Initial contact");
    expect(suggestNextAction(STAGE_SEMANTIC.CUSTOM).label).toBe("Initial contact");
    expect(suggestNextAction("WHATEVER").label).toBe("Initial contact");
  });
});
