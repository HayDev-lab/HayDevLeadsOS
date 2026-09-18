// HAYDEV LEADOS — PUBLIC INGESTION SECURITY TESTS (v0.19.2 §6–9, §43).
//
// REQUIRED PROOFS:
//   public force/ownerId/stageId/sourceId/meta rejected (strict narrow schema)
//   invalid credential rejected · disabled credential rejected
//   wrong org/source blocked (org resolved ONLY from the credential)
//   rate limit works (durable, DB-backed) · duplicate/idempotency works
//   logs are REDACTED (field names only — no PII values)

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { POST as ingest } from "../src/app/api/v1/leads/ingest/route";
import {
  generateSourceToken,
  storeSourceToken,
  disableSourceToken,
  hashSourceToken,
} from "../src/lib/leados/source-token";

const db = new PrismaClient();

const SLUG = `public-ingest-test-${Date.now()}`;
const SLUG_B = `public-ingest-b-${Date.now()}`;

let orgId = "";
let orgBId = "";
let sourceA = "";
let sourceB = "";
let tokenA = "";
let tokenB = "";

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/leads/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

// evaluated lazily — tokenA is created in beforeAll
const authA = () => ({ authorization: `Bearer ${tokenA}` });
const json = async (res: Response) => ({ status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> });

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: "Public Ingest A", slug: SLUG, locale: "en", timezone: "UTC", currency: "USD" },
  });
  orgId = org.id;
  const orgB = await db.organization.create({
    data: { name: "Public Ingest B", slug: SLUG_B, locale: "en", timezone: "UTC", currency: "USD" },
  });
  orgBId = orgB.id;

  const user = await db.user.create({
    data: { organizationId: orgId, name: "PI Owner", email: `pi-owner-${Date.now()}@test.dev`, role: "OWNER", status: "ACTIVE" },
  });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "OWNER" } });
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } });
  await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } });

  sourceA = (await db.leadSource.create({ data: { organizationId: orgId, name: "A Form", type: "website" } })).id;
  sourceB = (await db.leadSource.create({ data: { organizationId: orgBId, name: "B Form", type: "website" } })).id;

  const genA = generateSourceToken();
  await storeSourceToken(sourceA, genA);
  tokenA = genA.token;
  const genB = generateSourceToken();
  await storeSourceToken(sourceB, genB);
  tokenB = genB.token;
});

afterAll(async () => {
  await db.webhookLog.deleteMany({ where: { organizationId: { in: [orgId, orgBId] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgId, orgBId] } } });
  await db.$disconnect();
});

describe("public ingestion authentication (§7)", () => {
  test("missing credential → 401 source-token-missing", async () => {
    const { status, body } = await json(await ingest(req({ firstName: "X" })));
    expect(status).toBe(401);
    expect(body.error).toBe("source-token-missing");
  });

  test("invalid credential (unknown prefix / wrong secret) → 401, identical outcome", async () => {
    const r1 = await json(await ingest(req({ firstName: "X" }, { authorization: "Bearer lsrc_zzzzzzzz_notarealsecret000000000" })));
    expect(r1.status).toBe(401);
    expect(r1.body.error).toBe("source-token-invalid");
    // tampered secret of a KNOWN prefix → same error (no enumeration)
    const tampered = tokenA.slice(0, -2) + "xx";
    const r2 = await json(await ingest(req({ firstName: "X" }, { authorization: `Bearer ${tampered}` })));
    expect(r2.status).toBe(401);
    expect(r2.body.error).toBe("source-token-invalid");
  });

  test("DISABLED credential → 401 source-token-disabled (fails closed)", async () => {
    const gen = generateSourceToken();
    const src = await db.leadSource.create({ data: { organizationId: orgId, name: "Disabled Form", type: "website" } });
    await storeSourceToken(src.id, gen);
    await disableSourceToken(src.id);
    const { status, body } = await json(await ingest(req({ firstName: "X" }, { authorization: `Bearer ${gen.token}` })));
    expect(status).toBe(401);
    expect(body.error).toBe("source-token-disabled");
  });

  test("hash-only storage: tokenHash equals SHA-256 of the token; plaintext never stored", async () => {
    const row = await db.leadSource.findUniqueOrThrow({ where: { id: sourceA } });
    expect(row.tokenHash).toBe(hashSourceToken(tokenA));
    expect(JSON.stringify(row)).not.toContain(tokenA);
  });
});

describe("public ingestion payload lockdown (§6)", () => {
  test("public force → rejected (duplicate protection cannot be bypassed)", async () => {
    const { status, body } = await json(await ingest(req({ firstName: "X", force: true } as never, authA())));
    expect(status).toBe(400);
    expect((body.details as Array<{ code: string }>)[0]?.code).toBe("unrecognized_keys");
  });

  test("public ownerId → rejected", async () => {
    const { status } = await json(await ingest(req({ firstName: "X", ownerId: "cmu0000000000000000000000" } as never, authA())));
    expect(status).toBe(400);
  });

  test("public stageId → rejected", async () => {
    const { status } = await json(await ingest(req({ firstName: "X", stageId: "cmu0000000000000000000000" } as never, authA())));
    expect(status).toBe(400);
  });

  test("public sourceId → rejected (server-side truth only)", async () => {
    const { status } = await json(await ingest(req({ firstName: "X", sourceId: sourceB } as never, authA())));
    expect(status).toBe(400);
  });

  test("public meta / unknown control fields → rejected (strict schema)", async () => {
    const { status } = await json(await ingest(req({ firstName: "X", meta: { anything: true } } as never, authA())));
    expect(status).toBe(400);
    const r2 = await json(await ingest(req({ firstName: "X", status: "WON" } as never, authA())));
    expect(r2.status).toBe(400);
  });

  test("VALID payload → 201 created, lead lands in the token's org with the token's source", async () => {
    const email = `valid-${Date.now()}@ingest.test`;
    const { status, body } = await json(await ingest(req({ firstName: "Valid", lastName: "Ingest", email }, authA())));
    expect(status).toBe(201);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: body.leadId as string } });
    expect(lead.organizationId).toBe(orgId);
    expect(lead.sourceId).toBe(sourceA);
    expect(lead.email).toBe(email);
  });
});

describe("org isolation (wrong org/source blocked)", () => {
  test("forged x-org-slug header is IGNORED — org comes only from the credential", async () => {
    const email = `forge-${Date.now()}@ingest.test`;
    // org-B slug forged on an org-A token:
    const { status, body } = await json(await ingest(req({ firstName: "Forge", email }, { ...authA(), "x-org-slug": SLUG_B })));
    expect(status).toBe(201);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: body.leadId as string } });
    expect(lead.organizationId).toBe(orgId); // NOT orgB
  });

  test("org-B token writes to org B only (and never touches org A)", async () => {
    const email = `isob-${Date.now()}@ingest.test`;
    const { status, body } = await json(await ingest(req({ firstName: "IsoB", email }, { authorization: `Bearer ${tokenB}` })));
    expect(status).toBe(201);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: body.leadId as string } });
    expect(lead.organizationId).toBe(orgBId);
    expect(lead.sourceId).toBe(sourceB);
  });
});

describe("duplicate / idempotency (public cannot bypass)", () => {
  test("same email twice → 201 then duplicate:true, exactly ONE lead", async () => {
    const email = `dup-${Date.now()}@ingest.test`;
    const first = await json(await ingest(req({ firstName: "Dup", email }, authA())));
    expect(first.status).toBe(201);
    const second = await json(await ingest(req({ firstName: "Dup", email }, authA())));
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBeTruthy();
    expect(await db.lead.count({ where: { organizationId: orgId, email } })).toBe(1);
  });

  test("same externalId twice (source-scoped idempotency) → ONE lead", async () => {
    const extId = `web-${Date.now()}`;
    const email = `ext1-${Date.now()}@ingest.test`;
    const email2 = `ext2-${Date.now()}@ingest.test`;
    const first = await json(await ingest(req({ firstName: "Ext1", email, externalId: extId }, authA())));
    expect(first.status).toBe(201);
    // channel retry with the SAME externalId but different contact info →
    // duplicate detected (no second lead created).
    const second = await json(await ingest(req({ firstName: "Ext2", email: email2, externalId: extId }, authA())));
    expect(second.body.duplicate).toBeTruthy();
    expect(await db.lead.count({ where: { organizationId: orgId, externalId: extId } })).toBe(1);
  });
});

describe("rate limit (§9 — durable, DB-backed)", () => {
  test("pre-seeded window full → 429 + FAILED log row; window expiry allows again", async () => {
    // deterministic setup: fill the 60s window for sourceA
    await db.webhookLog.deleteMany({ where: { source: `public_ingest:${sourceA}` } });
    await db.webhookLog.createMany({
      data: Array.from({ length: 60 }, () => ({
        organizationId: orgId,
        source: `public_ingest:${sourceA}`,
        endpoint: "/api/v1/leads/ingest",
        status: "OK",
        payload: { seeded: true, redacted: true } as never,
      })),
    });
    const { status, body } = await json(await ingest(req({ firstName: "Flood", email: `flood-${Date.now()}@ingest.test` }, authA())));
    expect(status).toBe(429);
    expect(body.error).toContain("Too many");
    // the rate-limited attempt itself is logged as FAILED
    const failed = await db.webhookLog.findFirst({
      where: { source: `public_ingest:${sourceA}`, status: "FAILED" },
      orderBy: { createdAt: "desc" },
    });
    expect(failed?.error).toBe("rate-limited");
    // expiry: old rows outside the window don't count
    await db.webhookLog.updateMany({
      where: { source: `public_ingest:${sourceA}` },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    const after = await json(await ingest(req({ firstName: "Recover", email: `recover-${Date.now()}@ingest.test` }, authA())));
    expect(after.status).toBe(201);
  });

  test("§9 v0.20 concurrency: PARALLEL requests are ALL counted — no lost window entries", async () => {
    // Clean window, then fire 6 genuinely concurrent ingests. The limiter is
    // DB-backed (WebhookLog rows = shared state): every completed request
    // must leave exactly one log row, and none may be falsely 429'd
    // (6 << 60). This pins the multi-instance-ready property: window state
    // lives in the shared database, not in process memory.
    await db.webhookLog.deleteMany({ where: { source: `public_ingest:${sourceA}` } });
    const stamp = Date.now();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        ingest(req({ firstName: `Par${i}`, email: `par-${stamp}-${i}@ingest.test` }, authA())).then((r) => json(r))
      )
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const counted = await db.webhookLog.count({
      where: { source: `public_ingest:${sourceA}`, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    expect(counted).toBe(6); // every concurrent request left its durable entry
  });
});

describe("payload logging redaction (§8)", () => {
  test("WebhookLog stores field NAMES ONLY — no email/phone values, no token", async () => {
    await db.webhookLog.deleteMany({ where: { source: `public_ingest:${sourceA}` } });
    const email = `redact-${Date.now()}@ingest.test`;
    const phone = "+37499111222";
    await json(await ingest(req({ firstName: "Redact", email, phone, summary: "secret business details" }, authA())));
    const log = await db.webhookLog.findFirstOrThrow({
      where: { source: `public_ingest:${sourceA}`, status: "OK" },
      orderBy: { createdAt: "desc" },
    });
    const payloadStr = JSON.stringify(log.payload);
    expect(payloadStr).toContain("fields"); // field names present
    expect(payloadStr).not.toContain(email); // values ABSENT
    expect(payloadStr).not.toContain(phone);
    expect(payloadStr).not.toContain("secret business details");
    expect(payloadStr).not.toContain(tokenA); // never the credential
    expect(payloadStr).toContain("redacted");
  });
});
