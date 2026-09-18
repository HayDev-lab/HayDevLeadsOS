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
  if (process.env.WORKER_SCHEDULER_ENABLED === "false") {
    console.log("[LEADOS-BOOT] scheduler disabled via WORKER_SCHEDULER_ENABLED=false");
    return;
  }
  const { startLeadOSScheduler } = await import("./lib/leados/scheduler");
  startLeadOSScheduler();
}
