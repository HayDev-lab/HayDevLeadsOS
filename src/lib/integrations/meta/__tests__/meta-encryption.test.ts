// META — encryption at rest (v0.19). Required cases: roundtrip, wrong key,
// tampered ciphertext, no token leak through the mask helper.
import { describe, test, expect } from "bun:test";
import { encryptToken, decryptToken, maskToken, safeEqual } from "../encryption";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("meta encryption", () => {
  test("encrypt/decrypt roundtrip", () => {
    const token = "EAAG" + Math.random().toString(36).slice(2) + "x9z2";
    const ct = encryptToken(token, KEY_A);
    expect(ct).not.toContain(token);
    expect(ct.startsWith("v1.")).toBe(true);
    expect(decryptToken(ct, KEY_A)).toBe(token);
  });

  test("wrong key fails (GCM auth)", () => {
    const ct = encryptToken("secret-token-value", KEY_A);
    expect(() => decryptToken(ct, KEY_B)).toThrow();
  });

  test("tampered ciphertext fails", () => {
    const ct = encryptToken("secret-token-value", KEY_A);
    const parts = ct.split(".");
    // flip one byte in the ciphertext segment
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], Buffer.from(bytes).toString("base64url")].join(".");
    expect(() => decryptToken(tampered, KEY_A)).toThrow();
  });

  test("bad format rejected", () => {
    expect(() => decryptToken("not-a-token")).toThrow();
    expect(() => decryptToken("v2.a.b.c")).toThrow();
  });

  test("maskToken never leaks the token body", () => {
    const token = "EAAGVERYSECRETBODY1234567890xyz";
    const masked = maskToken(token);
    expect(masked).not.toContain("VERYSECRET");
    expect(masked.length).toBeLessThan(10);
    expect(masked).toContain("…");
  });

  test("safeEqual constant-time-ish compare", () => {
    expect(safeEqual("abcd", "abcd")).toBe(true);
    expect(safeEqual("abcd", "abce")).toBe(false);
    expect(safeEqual("abcd", "abcde")).toBe(false);
  });
});
