// SECURITY REGRESSION — legacy webhook API removal + canonical hardening
// (v0.19.3 hotfix, audit finding #3).
//
// Proof:
//   • the legacy /api/v1/webhooks/endpoints API (which returned plaintext
//     secrets in GET and skipped SSRF checks) is DELETED — route files are
//     gone and nothing references the path anymore;
//   • the canonical /api/v1/integrations/webhooks GET never returns the
//     secret (only the boolean secretConfigured);
//   • forbidden webhook destinations (localhost, loopback, link-local /
//     cloud metadata, RFC1918, CGNAT, userinfo URLs, non-http(s), DNS that
//     resolves to a private IP) are all rejected by validateWebhookUrl —
//     the same guard the canonical create/PATCH/test paths run through;
//   • the canonical test-delivery route keeps org scoping + canManage.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { validateWebhookUrl } from "../../src/lib/leados/delivery/ssrf";
import { realWebhookProvider } from "../../src/lib/leados/delivery/providers";

const root = join(import.meta.dir, "../..");
const canonical = join(root, "src/app/api/v1/integrations/webhooks");
const canonicalTest = join(canonical, "[id]/test/route.ts");

describe("legacy webhook API is fully removed", () => {
  test("legacy route files no longer exist", () => {
    expect(existsSync(join(root, "src/app/api/v1/webhooks/endpoints/route.ts"))).toBe(false);
    expect(existsSync(join(root, "src/app/api/v1/webhooks/endpoints/[id]/route.ts"))).toBe(false);
  });

  test("no source file references the legacy path anymore", () => {
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true }) as import("fs").Dirent[]) {
        const p = join(dir, e.name);
        if (e.isDirectory()) scan(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          if (readFileSync(p, "utf8").includes("webhooks/endpoints")) offenders.push(p);
        }
      }
    };
    scan(join(root, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("canonical webhook API — secret never leaves the server", () => {
  test("GET handler maps the secret to a secretConfigured boolean", () => {
    const route = readFileSync(join(canonical, "route.ts"), "utf8");
    expect(route).toContain("const { secret, ...rest } = r;");
    expect(route).toContain("secretConfigured: Boolean(secret)");
  });

  test("create/PATCH routes validate URLs through SSRF protection", () => {
    expect(readFileSync(join(canonical, "route.ts"), "utf8")).toContain("validateWebhookUrl");
    expect(readFileSync(join(canonical, "[id]/route.ts"), "utf8")).toContain("validateWebhookUrl");
  });

  test("test-delivery route keeps the canonical permission model", () => {
    const t = readFileSync(canonicalTest, "utf8");
    expect(t).toContain("canManage");
    expect(t).toContain("organizationId: session.orgId");
    expect(t).not.toContain("ok({ ...endpoint"); // never echoes the stored row
  });
});

describe("SSRF — forbidden destinations", () => {
  const forbidden = [
    ["localhost", "http://localhost/hook"],
    ["localhost (uppercase)", "http://LOCALHOST/hook"],
    ["*.localhost", "http://api.localhost/hook"],
    ["*.local", "http://printer.local/hook"],
    ["*.internal", "http://vault.internal/hook"],
    ["IPv4 loopback", "http://127.0.0.1/hook"],
    ["IPv6 loopback", "http://[::1]/hook"],
    ["IPv6 unspecified", "http://[::]/hook"],
    ["link-local (cloud metadata)", "http://169.254.169.254/latest/meta-data/"],
    ["RFC1918 10/8", "http://10.0.0.5/hook"],
    ["RFC1918 172.16/12", "http://172.16.0.9/hook"],
    ["RFC1918 192.168/16", "http://192.168.1.1/hook"],
    ["CGNAT 100.64/10", "http://100.64.0.1/hook"],
    ["this-network 0/8", "http://0.0.0.0/hook"],
    ["userinfo URL", "http://user:pass@example.com/hook"],
    ["non-http(s) scheme", "gopher://example.com/x"],
    ["file scheme", "file:///etc/passwd"],
  ] as const;

  test.each(forbidden as unknown as [string, string][])("%s is rejected", async (_label, url) => {
    const res = await validateWebhookUrl(url);
    expect(res.ok).toBe(false);
  });

  test("DNS that resolves to a private IP is rejected", async () => {
    const res = await validateWebhookUrl("https://evil.example.com/hook", {
      resolve: async () => [{ address: "192.168.0.10" }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("PRIVATE_ADDRESS_BLOCKED");
  });

  test("DNS resolving to ANY private address among several is rejected", async () => {
    const res = await validateWebhookUrl("https://mixed.example.com/hook", {
      resolve: async () => [{ address: "93.184.216.34" }, { address: "10.1.2.3" }],
    });
    expect(res.ok).toBe(false);
  });

  test("public IP literals and public DNS answers pass", async () => {
    expect((await validateWebhookUrl("https://93.184.216.34/hook")).ok).toBe(true);
    expect(
      (
        await validateWebhookUrl("https://hooks.example.com/x", {
          resolve: async () => [{ address: "93.184.216.34" }],
        })
      ).ok
    ).toBe(true);
  });
});

describe("delivery provider — send-time re-validation (defense in depth)", () => {
  test("a private URL is blocked before any fetch, no secret exposure", async () => {
    const res = await realWebhookProvider.send({
      url: "http://127.0.0.1:9/steal",
      secret: "super-secret-hmac-key",
      eventId: "evt-test",
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBeDefined();
    // the failure message must not echo the secret or the internal URL target
    expect(res.errorMessage ?? "").not.toContain("super-secret-hmac-key");
  });
});
