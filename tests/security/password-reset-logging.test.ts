// SECURITY REGRESSION — password reset token logging (v0.19.3 hotfix, audit
// finding #5).
//
// Proof: the one-time reset link (which carries the raw token in its URL)
// reaches the console ONLY in demo/development mode — the documented
// self-hosted recovery path when no email provider exists. In production the
// log contains a token-free pointer (scripts/set-password.ts) instead.
//
// Integration-style: real SQLite (same DATABASE_URL as the dev server),
// route handler invoked directly, console.log spied.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { POST } from "../../src/app/api/v1/auth/forgot-password/route";
import { hashPassword } from "../../src/lib/leados/auth/password";

const db = new PrismaClient();
const RUN = Date.now().toString(36);
const EMAIL = `reset-log-${RUN}@test.local`;

let orgId: string;
let userId: string;

const savedEnv = {
  NODE_ENV: process.env.NODE_ENV,
  LEADOS_DEMO: process.env.LEADOS_DEMO,
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
};

function spyConsoleLog() {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  return { lines, restore: () => (console.log = original) };
}

async function callForgotPassword(ip: string): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({ email: EMAIL }),
    })
  );
}

beforeAll(async () => {
  // never let a REAL provider intercept the flow under test
  delete process.env.EMAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;

  const org = await db.organization.create({
    data: { name: `reset-log-org-${RUN}`, slug: `reset-log-org-${RUN}`, isDemo: false },
  });
  orgId = org.id;
  const user = await db.user.create({
    data: {
      organizationId: orgId,
      name: "reset-log-user",
      email: EMAIL,
      passwordHash: await hashPassword("Correct-Horse-1"),
      status: "ACTIVE",
    },
  });
  userId = user.id;
});

afterEach(() => {
  process.env.NODE_ENV = savedEnv.NODE_ENV;
  process.env.LEADOS_DEMO = savedEnv.LEADOS_DEMO;
});

afterAll(async () => {
  await db.user.delete({ where: { id: userId } });
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
  Object.assign(process.env, savedEnv);
});

describe("forgot-password — reset link logging policy", () => {
  test("demo/dev: the recovery link IS printed (documented self-hosted path)", async () => {
    process.env.LEADOS_DEMO = "true";
    const spy = spyConsoleLog();
    try {
      const res = await callForgotPassword(`198.51.100.${Math.floor(Math.random() * 200)}`);
      expect(res.status).toBe(200);
      expect((await res.json() as { ok: boolean }).ok).toBe(true);
      const printed = spy.lines.join("\n");
      expect(printed).toContain("/#/reset-password?token=");
      expect(printed).toContain(EMAIL);
    } finally {
      spy.restore();
    }
  });

  test("production: the token NEVER reaches the log — a safe pointer does", async () => {
    process.env.NODE_ENV = "production";
    process.env.LEADOS_DEMO = "";
    const spy = spyConsoleLog();
    try {
      const res = await callForgotPassword(`198.51.100.${Math.floor(Math.random() * 200)}`);
      expect(res.status).toBe(200);
      const printed = spy.lines.join("\n");
      expect(printed).not.toContain("/#/reset-password?token=");
      expect(printed).not.toContain("token=");
      expect(printed).toContain("scripts/set-password.ts");
    } finally {
      spy.restore();
    }
  });

  test("a fresh hashed token row exists either way (flow unaffected)", async () => {
    process.env.NODE_ENV = "production";
    process.env.LEADOS_DEMO = "";
    await callForgotPassword("198.51.100.77");
    const rows = await db.passwordResetToken.findMany({
      where: { user: { email: EMAIL } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].tokenHash).toBeTruthy();
    expect(rows[0].usedAt).toBeNull();
  });
});
