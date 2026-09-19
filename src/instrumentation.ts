// HAYDEV LEADOS — SERVER BOOTSTRAP (v0.16).
//
// Next.js instrumentation hook: register() runs ONCE when a server instance
// boots (dev server or the standalone production server). This is where the
// PRODUCTION SCHEDULER starts — LeadOS keeps processing events, automations
// and deliveries with NO browser open (v0.16 spec 4, 74).
//
// Guards:
//   • nodejs runtime only (never edge);
//   • WORKER_SCHEDULER_ENABLED=false → no scheduler (explicit deployment
//     choice, e.g. when an external cron calls POST /workers/run instead);
//   • the scheduler module itself is HMR-safe (globalThis guard).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // v0.19.2 §25 — PRODUCTION DATABASE POLICY (fail fast):
  // Real production (NODE_ENV=production, LEADOS_DEMO unset) MUST provide an
  // external DATABASE_URL. The packaged-demo mode (LEADOS_DEMO=true) is the
  // ONLY production shape allowed to run on a local SQLite file — and it is
  // a public demo, never a customer deployment. A missing config crashes the
  // boot with a clear reason instead of lazily failing on first query.
  if (process.env.NODE_ENV === "production" && process.env.LEADOS_DEMO !== "true" && !process.env.DATABASE_URL) {
    throw new Error(
      "[LEADOS-BOOT] DATABASE_URL is required in production (external database). " +
        "Set DATABASE_URL, or set LEADOS_DEMO=true ONLY for the packaged public demo."
    );
  }

  // v0.19.3 — DEMO ISOLATION INVARIANT (fail fast, never silently unsafe):
  // demo mode issues anonymous OWNER sessions scoped to isDemo orgs. It must
  // never boot against a database that also holds real (non-demo)
  // organizations — that would mix a public demo with customer data.
  if (process.env.LEADOS_DEMO === "true") {
    const { checkDemoIsolation } = await import("./lib/leados/demo-policy");
    const { db } = await import("./lib/db");
    const nonDemoOrgs = await db.organization.count({ where: { isDemo: false } });
    const check = checkDemoIsolation(nonDemoOrgs);
    if (!check.ok) {
      throw new Error(`[LEADOS-BOOT] fatal: ${check.reason}`);
    }
  }

  if (process.env.WORKER_SCHEDULER_ENABLED === "false") {
    console.log("[LEADOS-BOOT] scheduler disabled via WORKER_SCHEDULER_ENABLED=false");
    return;
  }
  const { startLeadOSScheduler } = await import("./lib/leados/scheduler");
  startLeadOSScheduler();
}
