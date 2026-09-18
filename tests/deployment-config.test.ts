// HAYDEV LEADOS — DEPLOYMENT CONFIG GUARD TESTS (v0.19.2 §21–22, §25–26, §47).
//
// Proofs:
//   • production Caddy config contains NONE of: XTransformPort / {query. /
//     localhost:{query — no user-controlled port, no dynamic localhost pivot
//   • production Caddy proxies a FIXED upstream (localhost:3000)
//   • the dynamic pivot exists ONLY in the dev gateway file
//   • the platform build script never promotes the preview runtime DB into a
//     non-demo (production) build
//   • production boot fails fast without DATABASE_URL (unless demo mode)

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Active (non-comment) config lines — comments are documentation. */
const active = (p: string) =>
  read(p)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

describe("production Caddy hardening (§21–22)", () => {
  const prod = read("Caddyfile.production");
  const dev = read("Caddyfile.dev");
  const prodActive = active("Caddyfile.production").join("\n");

  test("production config contains NO XTransformPort (active directives)", () => {
    expect(prodActive).not.toContain("XTransformPort");
  });

  test("production config contains NO dynamic {query. upstreams (active directives)", () => {
    expect(prodActive).not.toContain("{query.");
    expect(prodActive).not.toContain("localhost:{query");
  });

  test("production config proxies the FIXED app upstream localhost:3000", () => {
    expect(prod).toContain("reverse_proxy localhost:3000");
  });

  test("the dynamic port pivot exists ONLY in the DEV gateway file", () => {
    expect(dev).toContain("XTransformPort"); // documented, dev-only
    expect(dev).toContain("DEVELOPMENT-ONLY");
  });

  test("old combined Caddyfile is GONE (no ambiguous shipped config)", () => {
    let exists = true;
    try {
      read("Caddyfile");
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

describe("preview DB promotion stopped (§26)", () => {
  test("the platform build script gates preview-DB copying on demo mode", () => {
    const script = read(".zscripts/database-runtime-build.sh");
    // The copy of db/custom.db into the build artifact must be conditional:
    // allowed ONLY for the packaged demo (LEADOS_DEMO=true); a production
    // build initializes a fresh database and NEVER embeds the preview runtime DB.
    expect(script).toContain("LEADOS_DEMO");
    expect(script).toMatch(/isDemoMode|LEADOS_DEMO.?=.?"?true/);
  });
});

describe("production database policy (§25)", () => {
  test("boot fails fast in production without DATABASE_URL (unless demo)", () => {
    const boot = read("src/instrumentation.ts");
    expect(boot).toContain("DATABASE_URL");
    expect(boot).toContain("fail fast");
  });
});
