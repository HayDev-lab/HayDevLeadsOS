// SECURITY REGRESSION — internal error leakage (v0.19.3 hotfix, audit finding #1).
//
// Proof: a 500 response NEVER carries internal error data to the client —
// no Prisma class names, no SQL, no stack frames, no file paths, no raw
// Error messages. The body is exactly `{ error, requestId }`; the same
// requestId appears in the server-side log for correlation.

import { describe, expect, test } from "bun:test";
import { serverError, apiError } from "../../src/lib/leados/api";
import { AuthRequiredError } from "../../src/lib/leados/context";

/** A forged error that looks exactly like a Prisma engine failure. */
function fakePrismaError(): Error {
  const e = new Error(
    "Invalid `prisma.lead.findMany()` invocation in C:\\app\\src\\lib\\secret.ts:43:28 — " +
      "Raw query failed. Code: 'P2021'. Query: SELECT \"id\",\"email\" FROM \"User\" WHERE internal_key = 'sk_live_51Hxyz'"
  );
  e.name = "PrismaClientKnownRequestError";
  e.stack = "PrismaClientKnownRequestError: Raw query failed\n    at Array.map (<anonymous>)\n    at C:\\app\\node_modules\\@prisma\\client\\runtime\\library.js:1:2345";
  return e;
}

/** Catch console output so internals printed server-side don't leak into test logs. */
function captureConsoleError() {
  const lines: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args);
  return { lines, restore: () => (console.error = original) };
}

const LEAK_MARKERS = [
  "PrismaClientKnownRequestError",
  "P2021",
  "SELECT",
  "sk_live",
  "secret.ts",
  "C:\\app",
  "node_modules",
  "stack",
  "details",
  "at Array.map",
  "raw query",
];

async function resJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("serverError — internal redaction", () => {
  test("500 body is exactly { error, requestId } — no details, no internals", async () => {
    const cap = captureConsoleError();
    try {
      const res = serverError("leads-list-failed", fakePrismaError());
      const body = await resJson(res);
      expect(res.status).toBe(500);
      expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
      expect(body.error).toBe("leads-list-failed");
      expect(typeof body.requestId).toBe("string");
      expect((body.requestId as string).length).toBeGreaterThanOrEqual(32);
    } finally {
      cap.restore();
    }
  });

  test("no leak marker appears anywhere in the response", async () => {
    const cap = captureConsoleError();
    try {
      const res = serverError("leads-list-failed", fakePrismaError());
      const serialized = JSON.stringify({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: await res.json(),
      });
      for (const marker of LEAK_MARKERS) {
        expect(serialized.toLowerCase()).not.toContain(marker.toLowerCase());
      }
    } finally {
      cap.restore();
    }
  });

  test("requestId is logged server-side with the error code", async () => {
    const cap = captureConsoleError();
    try {
      const res = serverError("import-failed", fakePrismaError());
      const body = await resJson(res);
      const logged = JSON.stringify(cap.lines);
      expect(logged).toContain(body.requestId as string);
      expect(logged).toContain("import-failed");
    } finally {
      cap.restore();
    }
  });

  test("plain strings (legacy call shape) are also redacted from the body", async () => {
    const cap = captureConsoleError();
    try {
      const res = serverError("export-failed", "ECONNREFUSED 127.0.0.1:5432 at pg-client.ts:99");
      const body = await resJson(res);
      expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("ECONNREFUSED");
      expect(serialized).not.toContain("5432");
    } finally {
      cap.restore();
    }
  });
});

describe("apiError — mapping keeps redaction on the 500 fallthrough", () => {
  test("unknown error → 500 redacted shape", async () => {
    const cap = captureConsoleError();
    try {
      const res = apiError("webhook-delivery-failed", fakePrismaError());
      const body = await resJson(res);
      expect(res.status).toBe(500);
      expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("Prisma");
      expect(serialized).not.toContain("SELECT");
    } finally {
      cap.restore();
    }
  });

  test("auth errors still map to 401 with their own safe shape", async () => {
    const res = apiError("some-op-failed", new AuthRequiredError());
    const body = await resJson(res);
    expect(res.status).toBe(401);
    expect(Object.keys(body)).toEqual(["error"]);
  });
});
