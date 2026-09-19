// SECURITY REGRESSION — Meta webhook basic DoS guard (v0.19.3 hotfix, audit
// finding #6).
//
// Proof:
//   • an oversized body is rejected 413 BEFORE buffering (content-length)
//     and again after reading (chunked/missing-length bypass);
//   • even a CORRECTLY SIGNED oversized payload is rejected — the size guard
//     precedes signature work;
//   • a small body with a bad signature is 401 — signature verification
//     still precedes any expensive processing;
//   • the endpoint keeps fast-ACK semantics for legitimate small traffic.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { POST } from "../../src/app/api/v1/integrations/meta/webhook/route";
import { META_WEBHOOK_MAX_BODY_BYTES } from "../../src/lib/integrations/meta/config";

const APP_SECRET = `test-meta-secret-${Date.now()}`;
const savedEnv = { META_APP_SECRET: process.env.META_APP_SECRET };

/** Handler-facing fake: lets us set content-length / body independently. */
function fakeReq(opts: { headers?: Record<string, string>; text?: () => Promise<string> } = {}): Request {
  const h = new Headers(opts.headers ?? {});
  return {
    headers: h,
    text: opts.text ?? (async () => ""),
  } as unknown as Request;
}

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
}

beforeAll(() => {
  process.env.META_APP_SECRET = APP_SECRET;
});

afterEach(() => {
  process.env.META_APP_SECRET = APP_SECRET;
});

afterAll(() => {
  if (savedEnv.META_APP_SECRET === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = savedEnv.META_APP_SECRET;
});

describe("meta webhook — body size guard", () => {
  test("constant is exported and sane", () => {
    expect(META_WEBHOOK_MAX_BODY_BYTES).toBe(1_000_000);
  });

  test("content-length above the limit → 413 before the body is read", async () => {
    let bodyRead = false;
    const res = await POST(
      fakeReq({
        headers: { "content-length": String(META_WEBHOOK_MAX_BODY_BYTES + 1) },
        text: async () => {
          bodyRead = true;
          return "x";
        },
      })
    );
    expect(res.status).toBe(413);
    expect(bodyRead).toBe(false); // early reject — nothing buffered
  });

  test("oversized chunked body (no content-length) → 413 after read", async () => {
    const huge = "x".repeat(META_WEBHOOK_MAX_BODY_BYTES + 1);
    const res = await POST(fakeReq({ text: async () => huge }));
    expect(res.status).toBe(413);
  });

  test("even a correctly signed oversized payload is rejected 413", async () => {
    const huge = JSON.stringify({ object: "page", padding: "y".repeat(META_WEBHOOK_MAX_BODY_BYTES) });
    const res = await POST(
      fakeReq({
        headers: { "x-hub-signature-256": sign(huge) },
        text: async () => huge,
      })
    );
    expect(res.status).toBe(413);
  });
});

describe("meta webhook — signature still precedes processing", () => {
  test("small body with a bad signature → 401, nothing persisted", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/v1/integrations/meta/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
        body: JSON.stringify({ object: "page", entry: [] }),
      })
    );
    expect(res.status).toBe(401);
  });

  test("small body with a VALID signature fast-ACKs", async () => {
    const body = JSON.stringify({ object: "page", entry: [] });
    const res = await POST(
      new Request("http://localhost:3000/api/v1/integrations/meta/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
        body,
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });
});
