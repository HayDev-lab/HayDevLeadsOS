// SECURITY REGRESSION — demo mode safety invariant (v0.19.3 hotfix, audit
// finding #8, low severity).
//
// Proof:
//   • the isolation policy passes for a pure demo database (demo orgs only)
//     and fails CLOSED when any non-demo (real customer) organization exists;
//   • server boot with LEADOS_DEMO=true + a real organization present throws
//     a fatal configuration error — no silent unsafe startup;
//   • bootstrap (which mints a REAL organization) is forbidden in demo mode,
//     so the mixed state can never be produced through the API.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { checkDemoIsolation } from "../../src/lib/leados/demo-policy";
import { POST as bootstrapPOST } from "../../src/app/api/v1/auth/bootstrap/route";
import { register } from "../../src/instrumentation";

const db = new PrismaClient();
const RUN = Date.now().toString(36);

const savedEnv = {
  LEADOS_DEMO: process.env.LEADOS_DEMO,
  WORKER_SCHEDULER_ENABLED: process.env.WORKER_SCHEDULER_ENABLED,
  NEXT_RUNTIME: process.env.NEXT_RUNTIME,
};

beforeAll(() => {
  // bun test does not set the Next.js runtime guard — register() returns
  // early without it; enable so the boot invariant actually runs.
  process.env.NEXT_RUNTIME = "nodejs";
  // keep the boot check from starting the scheduler inside tests
  process.env.WORKER_SCHEDULER_ENABLED = "false";
});

afterEach(() => {
  process.env.LEADOS_DEMO = savedEnv.LEADOS_DEMO;
});

afterAll(async () => {
  Object.assign(process.env, savedEnv);
  await db.$disconnect();
});

async function mkOrg(name: string, isDemo: boolean) {
  return db.organization.create({
    data: { name, slug: `${name}-${RUN}-${Math.random().toString(36).slice(2, 7)}`, isDemo },
  });
}

describe("checkDemoIsolation — policy", () => {
  test("demo org only → PASS", () => {
    expect(checkDemoIsolation(0)).toEqual({ ok: true });
  });

  test("demo + real organization → FAIL CLOSED with an actionable reason", () => {
    const check = checkDemoIsolation(1);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("LEADOS_DEMO=true");
    expect(check.reason).toContain("non-demo organization");
  });

  test("many real organizations → still fails closed", () => {
    expect(checkDemoIsolation(12).ok).toBe(false);
  });

  test("garbage input fails closed", () => {
    expect(checkDemoIsolation(-1).ok).toBe(false);
    expect(checkDemoIsolation(Number.NaN).ok).toBe(false);
  });
});

describe("server boot — LEADOS_DEMO=true invariant", () => {
  // NOTE: the "boot succeeds on a demo-only database" case is proven at the
  // policy level above (count 0 → ok) — the shared runtime DB also holds
  // fixtures from other test files, so a DB-dependent success assertion
  // would be order-flaky. The failure branch below proves the full wiring:
  // env → DB count → fatal throw.

  test("boot FAILS (fatal) when a non-demo organization exists", async () => {
    process.env.LEADOS_DEMO = "true";
    const realOrg = await mkOrg(`real-org-boot-${RUN}`, false);
    try {
      let threw = false;
      try {
        await register();
      } catch (e) {
        threw = true;
        expect(String((e as Error).message)).toContain("[LEADOS-BOOT] fatal:");
        expect(String((e as Error).message)).toContain("non-demo organization");
      }
      expect(threw).toBe(true);
    } finally {
      await db.organization.delete({ where: { id: realOrg.id } });
    }
  });

  test("boot does not evaluate the invariant when demo mode is off", async () => {
    process.env.LEADOS_DEMO = "";
    const realOrg = await mkOrg(`real-org-nodemo-${RUN}`, false);
    try {
      await expect(register()).resolves.toBeUndefined();
    } finally {
      await db.organization.delete({ where: { id: realOrg.id } });
    }
  });
});

describe("bootstrap — cannot mint a real org in demo mode", () => {
  test("LEADOS_DEMO=true → 403 before any state is touched", async () => {
    process.env.LEADOS_DEMO = "true";
    const res = await bootstrapPOST(
      new Request("http://localhost:3000/api/v1/auth/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `boot-${RUN}@test.local`,
          password: "Correct-Horse-1",
          organizationName: "Sneaky Real Org",
        }),
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("demo mode");
    // nothing was created
    const found = await db.organization.findFirst({ where: { name: "Sneaky Real Org" } });
    expect(found).toBeNull();
  });
});
