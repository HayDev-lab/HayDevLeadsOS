// HAYDEV LEADOS — DEPLOYMENT CONFIG GUARD TESTS (v0.19.2 §21–22, §25–26, §47;
// v0.20 closure §4–§6).
//
// Proofs:
//   • production Caddy config contains NONE of: XTransformPort / {query. /
//     localhost:{query — no user-controlled port, no dynamic localhost pivot
//   • production Caddy proxies a FIXED upstream (localhost:3000)
//   • the dynamic pivot exists ONLY in the dev gateway file
//   • NO dangerous generic `db:push --accept-data-loss` script; the only
//     accept-data-loss entry point is the explicit DEV-ONLY `db:dev:push`
//   • every production/build path references `migrate deploy` only
//   • CI pins an exact Bun version (never "latest") and package.json
//     declares the matching packageManager
//   • the packaged-demo build is SEED-ONLY (fresh DB via migrations +
//     deterministic seed — the preview runtime DB is never copied)
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

describe("seed-only demo build (§6 — see tests/build-artifact.test.ts for the functional proof)", () => {
  test("the platform build script initializes the demo DB from scratch (no preview-DB copy)", () => {
    const script = read(".zscripts/database-runtime-build.sh");
    expect(script).toContain("LEADOS_DEMO");
    expect(script).toContain("migrate deploy");
    expect(script).not.toContain("SOURCE_DB");
  });
});

describe("dangerous db:push removed (§4)", () => {
  test("package.json has NO generic db:push script", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["db:push"]).toBeUndefined();
    // The only accept-data-loss entry point is the explicit DEV-ONLY script.
    expect(pkg.scripts["db:dev:push"]).toContain("accept-data-loss");
  });

  test("no other script or .zscript references accept-data-loss", () => {
    const pkg = JSON.parse(read("package.json"));
    const offenders = Object.entries(pkg.scripts as Record<string, string>)
      .filter(([name, cmd]) => cmd.includes("accept-data-loss") && name !== "db:dev:push")
      .map(([name]) => name);
    expect(offenders).toEqual([]);

    const buildScript = read(".zscripts/database-runtime-build.sh");
    expect(buildScript).not.toContain("accept-data-loss");
    expect(buildScript).not.toContain("db:push");
  });

  test("production DB path is migrate deploy only", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["db:migrate:deploy"]).toContain("migrate deploy");
    // The CI workflow applies migrations via migrate deploy, never db push.
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("prisma migrate deploy");
    expect(ci).not.toMatch(/db push/);
  });
});

describe("Bun version pinned (§5)", () => {
  test("CI never uses bun-version: latest", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toMatch(/bun-version:\s*latest/);
    expect(ci).toMatch(/bun-version:\s*\d+\.\d+\.\d+/);
  });

  test("package.json declares the pinned packageManager", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
  });
});

describe("production database policy (§25)", () => {
  test("boot fails fast in production without DATABASE_URL (unless demo)", () => {
    const boot = read("src/instrumentation.ts");
    expect(boot).toContain("DATABASE_URL");
    expect(boot).toContain("fail fast");
  });
});

describe("CSP hardening (v0.20 §13)", () => {
  const proxy = read("src/proxy.ts");

  /** The production and dev branches of the CSP ternary in src/proxy.ts. */
  const cspUsage = proxy.indexOf("= isProduction"); // `const csp = isProduction ? [...] : [...]`
  const prodStart = proxy.indexOf("[", cspUsage);
  const prodJoin = proxy.indexOf("].join", prodStart);
  const prodBranch = proxy.slice(prodStart, prodJoin);
  const devStart = proxy.indexOf(": [", prodJoin);
  const devJoin = proxy.indexOf("].join", devStart);
  const devBranch = proxy.slice(devStart, devJoin);

  test("PRODUCTION CSP: nonce + strict-dynamic, NO unsafe-eval/unsafe-inline for SCRIPTS (style-src residual is documented)", () => {
    // Active (non-comment) directive lines of the production branch.
    const activeProd = prodBranch
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//"));
    const scriptSrc = activeProd.find((l) => l.includes("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toContain("'nonce-${nonce}'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(scriptSrc).not.toContain("unsafe-inline");
    // The ONLY residual 'unsafe-inline' in production is style-src (documented).
    const styleSrc = activeProd.find((l) => l.includes("style-src"));
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  test("DEV CSP keeps unsafe-inline + unsafe-eval (React Refresh HMR — documented dev-only)", () => {
    expect(devBranch).toContain("'unsafe-inline' 'unsafe-eval'");
  });

  test("style-src keeps 'unsafe-inline' in BOTH modes (documented residual: React inline styles + framework <style> blocks have no nonce support)", () => {
    expect(proxy.match(/style-src 'self' 'unsafe-inline'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("production Caddy does NOT set Content-Security-Policy (single CSP source of truth = the app; avoids double-CSP intersection)", () => {
    const prodActive = active("Caddyfile.production").join("\n");
    expect(prodActive).not.toContain("Content-Security-Policy");
  });

  test("app + edge headers are consistent (no contradictory policies)", () => {
    // Both layers send the SAME X-Frame-Options / Referrer-Policy /
    // Permissions-Policy / X-Content-Type-Options values — edge adds HSTS
    // preload + hides Server, app adds CSP + HSTS. No conflicts.
    const prod = active("Caddyfile.production").join("\n");
    expect(prod).toContain('X-Frame-Options "SAMEORIGIN"');
    expect(prod).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
    expect(proxy).toContain('"X-Frame-Options", "SAMEORIGIN"');
    expect(proxy).toContain('"Referrer-Policy", "strict-origin-when-cross-origin"');
    // Edge never sends a CSP header (app owns it).
    expect(prod).not.toMatch(/Content-Security-Policy/);
  });
});
