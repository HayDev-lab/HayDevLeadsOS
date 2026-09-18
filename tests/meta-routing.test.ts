// HAYDEV LEADOS — META PAGE ROUTING INVARIANT TESTS (v0.19.2 §18–20).
//
// REQUIRED PROOFS:
//   duplicate pageId across orgs BLOCKED (DB unique — one page → one org)
//   unknown page → UNMAPPED_PAGE (parked, no org leak)
//   known page → EXACT org (deterministic resolveMetaPageRoute)
//   payload org hints IGNORED (routing from pageId only)
//   foreign form/source/owner/stage blocked (mapping stays org-scoped)

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { resolveMetaPageRoute, persistLeadgenEvents } from "../src/lib/leados/meta-service";
import type { LeadgenChange } from "../src/lib/integrations/meta/webhook";

const db = new PrismaClient();

const SLUG_A = `meta-route-a-${Date.now()}`;
const SLUG_B = `meta-route-b-${Date.now()}`;

let orgA = "";
let orgB = "";
let pageA = ""; // MetaPageConnection row id
const PAGE_ID_A = `900100200300${Date.now() % 100000}`; // numeric page id
const PAGE_ID_UNKNOWN = `900100200399${Date.now() % 100000}`;

beforeAll(async () => {
  const a = await db.organization.create({
    data: { name: "Meta Route A", slug: SLUG_A, locale: "en", timezone: "UTC", currency: "USD" },
  });
  orgA = a.id;
  const b = await db.organization.create({
    data: { name: "Meta Route B", slug: SLUG_B, locale: "en", timezone: "UTC", currency: "USD" },
  });
  orgB = b.id;

  // Org A has a Meta connection + page connection.
  const conn = await db.metaConnection.create({
    data: { organizationId: orgA, status: "CONNECTED", appMode: "DEMO", displayName: "Route Test" },
  });
  pageA = (
    await db.metaPageConnection.create({
      data: { organizationId: orgA, connectionId: conn.id, pageId: PAGE_ID_A, pageName: "Route Page" },
    })
  ).id;
});

afterAll(async () => {
  await db.metaWebhookEvent.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.$disconnect();
});

const change = (pageId: string, n: number): LeadgenChange => ({
  pageId,
  formId: `60010020030040${n}`,
  leadgenId: `70010020030040${n}${Date.now() % 100000}`,
  createdTime: null,
});

describe("routing invariant: one Meta page → one org (§18)", () => {
  test("duplicate pageId across organizations is BLOCKED by the DB unique", async () => {
    const connB = await db.metaConnection.create({
      data: { organizationId: orgB, status: "CONNECTED", appMode: "DEMO", displayName: "Route Test B" },
    });
    let p2002 = false;
    try {
      await db.metaPageConnection.create({
        data: { organizationId: orgB, connectionId: connB.id, pageId: PAGE_ID_A, pageName: "Evil Duplicate" },
      });
    } catch (e) {
      p2002 = (e as { code?: string })?.code === "P2002";
    }
    expect(p2002).toBe(true); // invariant enforced at the storage layer
    // and the count across orgs stays exactly one
    expect(await db.metaPageConnection.count({ where: { pageId: PAGE_ID_A } })).toBe(1);
  });

  test("same-org upsert of the SAME page still works (idempotent reconnect)", async () => {
    const updated = await db.metaPageConnection.update({
      where: { pageId: PAGE_ID_A },
      data: { pageName: "Route Page v2" },
    });
    expect(updated.organizationId).toBe(orgA);
  });
});

describe("resolveMetaPageRoute (§19)", () => {
  test("known page → EXACT org + connection row", async () => {
    const route = await resolveMetaPageRoute(PAGE_ID_A);
    expect(route?.organizationId).toBe(orgA);
    expect(route?.pageConnectionId).toBe(pageA);
  });

  test("unknown page → null (never a guess)", async () => {
    expect(await resolveMetaPageRoute(PAGE_ID_UNKNOWN)).toBeNull();
  });
});

describe("webhook persistence routing (§20)", () => {
  test("known page → event persisted with the page's org; forged org hints in the payload IGNORED", async () => {
    const n = Date.now() % 100000;
    // malicious extra field in the raw body must never influence routing
    const rawPayload = {
      object: "page",
      entry: [{ id: PAGE_ID_A, changes: [{ field: "leadgen", value: { leadgen_id: 1, form_id: 2, page_id: PAGE_ID_A } }] }],
      organizationId: orgB, // FORGED — must be ignored
    };
    const res = await persistLeadgenEvents([change(PAGE_ID_A, n)], rawPayload);
    expect(res.persisted).toBe(1);
    const ev = await db.metaWebhookEvent.findFirst({
      where: { pageId: PAGE_ID_A },
      orderBy: { receivedAt: "desc" },
    });
    expect(ev?.organizationId).toBe(orgA); // from ROUTING, never from payload
    expect(ev?.status).toBe("PENDING");
  });

  test("unknown page → parked UNMAPPED_PAGE with NO organization (no org leak)", async () => {
    const n = (Date.now() + 1) % 100000;
    const res = await persistLeadgenEvents([change(PAGE_ID_UNKNOWN, n)], { object: "page", entry: [] });
    expect(res.unmappedPages).toBe(1);
    const ev = await db.metaWebhookEvent.findFirst({
      where: { pageId: PAGE_ID_UNKNOWN },
      orderBy: { receivedAt: "desc" },
    });
    expect(ev?.organizationId).toBeNull();
    expect(ev?.status).toBe("UNMAPPED_PAGE");
  });

  test("same leadgenId delivered twice → exactly ONE event (idempotency intact)", async () => {
    const n = (Date.now() + 2) % 100000;
    const ch = change(PAGE_ID_A, n);
    const first = await persistLeadgenEvents([ch], { object: "page" });
    const second = await persistLeadgenEvents([ch], { object: "page" });
    expect(first.persisted).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(second.persisted).toBe(0);
    expect(await db.metaWebhookEvent.count({ where: { leadgenId: ch.leadgenId } })).toBe(1);
  });
});
