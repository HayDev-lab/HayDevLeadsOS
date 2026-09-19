// SECURITY REGRESSION — trusted proxy IP boundary (v0.19.3 hotfix, audit
// finding #4).
//
// Proof:
//   • clientIp() never returns the first (client-controlled) XFF hop when a
//     trusted value exists — a forged `X-Forwarded-For: 1.1.1.1` cannot
//     rotate a client's rate-limit identity;
//   • `x-real-ip` (overwritten by the production proxy) wins over XFF;
//   • requestMeta() (audit identity) uses the same strategy;
//   • Caddyfile.production OVERWRITES both identity headers with
//     {remote_host} — client-supplied values never survive the proxy.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { clientIp } from "../../src/lib/leados/auth/rate-limit";
import { requestMeta } from "../../src/lib/leados/auth/audit";

const root = join(import.meta.dir, "../..");

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://leados.example/api/v1/auth/login", { headers });
}

describe("clientIp — spoof resistance", () => {
  test("forged first XFF hop does not win when x-real-ip is set (proxy case)", () => {
    const req = reqWith({
      "x-forwarded-for": "1.1.1.1",
      "x-real-ip": "203.0.113.7",
    });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  test("multi-hop XFF: the LAST hop (added by the trusted proxy) wins, not the first", () => {
    const req = reqWith({
      // attacker sends "1.1.1.1"; trusted proxy appends the real client addr
      "x-forwarded-for": "1.1.1.1, 198.51.100.23",
    });
    expect(clientIp(req)).toBe("198.51.100.23");
  });

  test("single-entry XFF is returned (nothing to distrust behind one proxy)", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "198.51.100.23" }))).toBe("198.51.100.23");
  });

  test("no identity headers → 'unknown'", () => {
    expect(clientIp(reqWith({}))).toBe("unknown");
  });

  test("whitespace-padded hops are trimmed", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": " 1.1.1.1 , 198.51.100.23 " }))).toBe("198.51.100.23");
  });

  test("x-real-ip takes precedence even when XFF has many hops", () => {
    const req = reqWith({
      "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3",
      "x-real-ip": "198.51.100.23",
    });
    expect(clientIp(req)).toBe("198.51.100.23");
  });
});

describe("requestMeta — audit identity matches clientIp", () => {
  test("audit ip ignores forged first XFF hop", () => {
    const meta = requestMeta(
      reqWith({ "x-forwarded-for": "1.1.1.1, 198.51.100.23", "user-agent": "Test/1" })
    );
    expect(meta.ip).toBe("198.51.100.23");
    expect(meta.userAgent).toBe("Test/1");
  });
});

describe("Caddyfile.production — proxy overwrites identity headers", () => {
  const prod = readFileSync(join(root, "Caddyfile.production"), "utf8");

  test("X-Forwarded-For is overwritten with the real remote host", () => {
    expect(prod).toContain("header_up X-Forwarded-For {remote_host}");
  });

  test("X-Real-IP is overwritten with the real remote host", () => {
    expect(prod).toContain("header_up X-Real-IP {remote_host}");
  });

  test("neither header is passed through from the client ({header}", () => {
    expect(prod).not.toContain("header_up X-Forwarded-For {header");
    expect(prod).not.toContain("header_up X-Real-IP {header");
  });
});
