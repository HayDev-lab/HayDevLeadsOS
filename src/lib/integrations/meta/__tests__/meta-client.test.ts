// META — error taxonomy + Graph error classification (v0.19). Required
// cases: auth/permission/rate-limit/temp-5xx/not-found/invalid/token-expiry
// classification and retryability flags.
import { describe, test, expect } from "bun:test";
import { classifyGraphError, MetaError, META_ERROR_CODE } from "../errors";

describe("meta error classification", () => {
  test("401 / OAuthException → META_AUTH_ERROR (not retryable)", () => {
    const e = classifyGraphError(401, { error: { type: "OAuthException", message: "x" } });
    expect(e.code).toBe(META_ERROR_CODE.META_AUTH_ERROR);
    expect(e.retryable).toBe(false);
  });
  test("code 190 subcode 463 → META_TOKEN_EXPIRED (reauth)", () => {
    const e = classifyGraphError(400, { error: { code: 190, error_subcode: 463 } });
    expect(e.code).toBe(META_ERROR_CODE.META_TOKEN_EXPIRED);
  });
  test("code 190 generic → META_AUTH_ERROR", () => {
    const e = classifyGraphError(400, { error: { code: 190 } });
    expect(e.code).toBe(META_ERROR_CODE.META_AUTH_ERROR);
  });
  test("403 / code 200 → META_PERMISSION_ERROR", () => {
    expect(classifyGraphError(403, { error: { code: 200 } }).code).toBe(META_ERROR_CODE.META_PERMISSION_ERROR);
    expect(classifyGraphError(200, { error: { code: 200 } }).code).toBe(META_ERROR_CODE.META_PERMISSION_ERROR);
  });
  test("429 / code 4 → META_RATE_LIMIT (retryable)", () => {
    const e = classifyGraphError(429, { error: { code: 4 } });
    expect(e.code).toBe(META_ERROR_CODE.META_RATE_LIMIT);
    expect(e.retryable).toBe(true);
  });
  test("5xx → META_TEMPORARY_ERROR (retryable)", () => {
    const e = classifyGraphError(502, { error: { code: 2 } });
    expect(e.code).toBe(META_ERROR_CODE.META_TEMPORARY_ERROR);
    expect(e.retryable).toBe(true);
  });
  test("404 → META_NOT_FOUND", () => {
    expect(classifyGraphError(404, {}).code).toBe(META_ERROR_CODE.META_NOT_FOUND);
  });
  test("unexpected → META_INVALID_RESPONSE, no PII in message", () => {
    const e = classifyGraphError(418, { error: { message: "user@email.am  EAAGSECRET" } });
    expect(e.code).toBe(META_ERROR_CODE.META_INVALID_RESPONSE);
    // The message only carries the code + neutral text, never the raw Graph message.
    expect(e.message).not.toContain("user@email.am");
    expect(e.message).not.toContain("EAAGSECRET");
  });
  test("MetaError message format is code-prefixed", () => {
    const e = new MetaError(META_ERROR_CODE.UNMAPPED_PAGE, "no lead");
    expect(e.message.startsWith("[UNMAPPED_PAGE]")).toBe(true);
    expect(e.retryable).toBe(false);
  });
});
