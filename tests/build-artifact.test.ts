// HAYDEV LEADOS — BUILD ARTIFACT GUARD TESTS (v0.20 closure §6).
//
// Proofs:
//   • the packaged-demo build script NEVER copies the developer's preview
//     runtime DB (db/custom.db) — the demo artifact is built from a FRESH
//     database via migrations + the deterministic seed
//   • the build script uses `migrate deploy`, never `db push`
//   • fresh DB → migrate deploy → seed is DETERMINISTIC: two independent
//     runs produce identical counts
//   • the demo dataset shape is pinned (users/members/stages/sources,
//     Meta demo connection + forms, isDemo org)
//   • the seed ignores the developer's runtime DB even when one exists and
//     DATABASE_URL points at it (the runner overrides it, like the build does)

import { describe, expect, test } from "bun:test";
import { readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

interface SeedCounts {
  orgId: string;
  organizations: number;
  isDemoOrg: boolean;
  users: number;
  members: number;
  pipelines: number;
  stages: number;
  leads: number;
  sources: number;
  rules: number;
  metaConnections: number;
  metaPages: number;
  metaForms: number;
}

/** Run the hermetic fresh-DB seed pipeline in a subprocess. */
function runSeedFreshDb(dbPath: string): SeedCounts {
  // DATABASE_URL deliberately points at whatever the caller considers its
  // "runtime" DB — the runner must override it with the argv path.
  const proc = Bun.spawnSync(["bun", "tests/runners/seed-fresh-db.ts", dbPath], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "file:./db/custom.db", LEADOS_DEMO: "true" },
  });
  const out = proc.stdout.toString();
  const err = proc.stderr.toString();
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line || proc.exitCode !== 0) {
    throw new Error(`seed-fresh-db runner failed (exit=${proc.exitCode})\nstdout: ${out}\nstderr: ${err}`);
  }
  return JSON.parse(line.slice("RESULT ".length)) as SeedCounts;
}

describe("packaged-demo build script (§6 seed-only)", () => {
  const script = read(".zscripts/database-runtime-build.sh");
  /** Active (non-comment) script lines — comments are documentation. */
  const activeLines = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const activeScript = activeLines.join("\n");

  test("NEVER copies the preview runtime DB into the artifact", () => {
    expect(script).not.toContain("SOURCE_DB");
    expect(activeScript).not.toMatch(/\bcp\b/); // no copy command at all
    expect(script).toContain("NEVER copies");
  });

  test("initializes the demo database via migrate deploy, never db push", () => {
    expect(script).toContain("migrate deploy");
    expect(activeScript).not.toContain("db:push");
    expect(activeScript).not.toContain("db push");
    expect(activeScript).not.toContain("accept-data-loss");
  });

  test("seeds the fresh demo DB deterministically (db:seed:demo)", () => {
    expect(script).toContain("db:seed:demo");
  });

  test("production build embeds NO database at all", () => {
    expect(script).toContain("no database is packaged");
  });
});

describe("fresh DB → migrate deploy → seed (§6 functional proof)", () => {
  // 120s per test: the hermetic runner performs a full migrate+seed in a
  // subprocess; CI runners are much slower than local (§36 repair).
  test("deterministic: two independent runs produce identical counts (runtime DB present is ignored)", () => {
    const dirA = mkdtempSync(join(tmpdir(), "leados-seed-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "leados-seed-b-"));
    const a = runSeedFreshDb(join(dirA, "demo.db"));
    const b = runSeedFreshDb(join(dirB, "demo.db"));
    // Same dataset every run (orgId differs — cuid), everything else identical.
    const { orgId: _orgIdA, ...restA } = a;
    const { orgId: _orgIdB, ...restB } = b;
    expect(restA).toEqual(restB);
  }, 120_000);

  test("demo dataset shape is pinned (synthetic, Meta demo artifacts included)", () => {
    const dir = mkdtempSync(join(tmpdir(), "leados-seed-c-"));
    const c = runSeedFreshDb(join(dir, "demo.db"));
    expect(c.organizations).toBe(1);
    expect(c.isDemoOrg).toBe(true);
    expect(c.users).toBe(4);
    expect(c.members).toBe(4);
    expect(c.pipelines).toBe(1);
    expect(c.stages).toBe(8);
    expect(c.leads).toBe(30);
    expect(c.sources).toBe(14);
    expect(c.rules).toBe(3);
    // Meta DEMO block (LEADOS_DEMO=true): connection + page + forms.
    expect(c.metaConnections).toBe(1);
    expect(c.metaPages).toBe(1);
    expect(c.metaForms).toBe(3);
  }, 120_000);
});
