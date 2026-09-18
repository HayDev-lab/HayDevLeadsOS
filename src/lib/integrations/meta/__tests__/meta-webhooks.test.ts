// META — webhook verification & parsing (v0.19). Required cases: GET
// challenge ok/wrong token; signature valid/invalid/malformed; multiple
// entries; non-leadgen ignored; page_id mismatch rejected; malformed ids.
import { describe, test, expect } from "bun:test";
import { createHmac } from "crypto";
import { verifyWebhookChallenge, verifyWebhookSignature, parseLeadgenChanges } from "../webhook";
import { MetaError, META_ERROR_CODE } from "../errors";

const SECRET = "test-app-secret";

function signed(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("meta webhook GET challenge", () => {
  test("valid verify token echoes challenge", () => {
    const qs = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok123", "hub.challenge": "1158201444" });
    expect(verifyWebhookChallenge(qs, "tok123")).toBe("1158201444");
  });
  test("wrong token → null", () => {
    const qs = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "123" });
    expect(verifyWebhookChallenge(qs, "tok123")).toBeNull();
  });
  test("wrong mode → null", () => {
    const qs = new URLSearchParams({ "hub.mode": "other", "hub.verify_token": "tok123", "hub.challenge": "123" });
    expect(verifyWebhookChallenge(qs, "tok123")).toBeNull();
  });
  test("unconfigured verify token → null (never echo blindly)", () => {
    const qs = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok123", "hub.challenge": "123" });
    expect(verifyWebhookChallenge(qs, null)).toBeNull();
  });
});

describe("meta webhook POST signature", () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  test("valid signature passes", () => {
    expect(() => verifyWebhookSignature(body, signed(body), SECRET)).not.toThrow();
  });
  test("wrong secret fails", () => {
    expect(() => verifyWebhookSignature(body, signed(body, "other"), SECRET)).toThrow(MetaError);
  });
  test("missing header fails", () => {
    expect(() => verifyWebhookSignature(body, null, SECRET)).toThrow();
  });
  test("malformed header fails", () => {
    expect(() => verifyWebhookSignature(body, "notsha256=zz", SECRET)).toThrow();
  });
  test("body mutation fails (signature covers RAW body)", () => {
    const sig = signed(body);
    expect(() => verifyWebhookSignature(body + " ", sig, SECRET)).toThrow();
  });
  test("unconfigured app secret → typed config error", () => {
    try {
      verifyWebhookSignature(body, signed(body), null);
      expect.unreachable();
    } catch (e) {
      expect((e as MetaError).code).toBe(META_ERROR_CODE.META_CONFIG_ERROR);
    }
  });
});

describe("meta webhook payload parsing", () => {
  test("multiple entries × changes extracted", () => {
    const payload = {
      object: "page",
      entry: [
        { id: "111", changes: [
          { field: "leadgen", value: { leadgen_id: "111111111111111", form_id: "900000000000001", page_id: "111", created_time: 1 } },
          { field: "leadgen", value: { leadgen_id: "111111111111112", form_id: "900000000000001", page_id: "111" } },
        ] },
        { id: "222", changes: [
          { field: "leadgen", value: { leadgen_id: "222222222222221", form_id: "900000000000002", page_id: "222" } },
        ] },
      ],
    };
    const changes = parseLeadgenChanges(payload);
    expect(changes.length).toBe(3);
    expect(changes[0]).toEqual({ pageId: "111", formId: "900000000000001", leadgenId: "111111111111111", createdTime: 1 });
  });
  test("non-leadgen changes ignored", () => {
    const payload = { object: "page", entry: [{ id: "111", changes: [{ field: "feed", value: {} }] }] };
    expect(parseLeadgenChanges(payload)).toEqual([]);
  });
  test("page_id disagreeing with entry id rejected", () => {
    const payload = { object: "page", entry: [{ id: "111", changes: [{ field: "leadgen", value: { leadgen_id: "333", form_id: "900", page_id: "999" } }] }] };
    expect(parseLeadgenChanges(payload)).toEqual([]);
  });
  test("non-numeric / missing ids rejected", () => {
    const payload = { object: "page", entry: [{ id: "abc", changes: [{ field: "leadgen", value: { leadgen_id: "1", form_id: "2" } }] }] };
    expect(parseLeadgenChanges(payload)).toEqual([]);
  });
  test("non-page objects ignored", () => {
    expect(parseLeadgenChanges({ object: "instagram", entry: [] })).toEqual([]);
    expect(parseLeadgenChanges(null)).toEqual([]);
  });
});
