// HAYDEV LEADOS — IN-PROCESS PRODUCTION SCHEDULER (v0.16, spec 4, 72, 74).
//
// Production correctness must NOT depend on a browser being open:
//
//     SCHEDULER (this module, started at server boot via instrumentation.ts)
//         ↓
//     runAllLeadOSWorkers()  (DB lease + durable WorkerRun)
//
// This deployment is a SELF-HOSTED standalone Next.js server
// (`bun .next/standalone/server.js`) — a long-lived process, so the
// provider-native scheduler IS an in-process interval timer registered in
// instrumentation.ts's register() hook (runs once per server instance).
//
// Guards:
//   • NEXT_RUNTIME=nodejs only (never edge);
//   • WORKER_SCHEDULER_ENABLED=false disables it (spec 72 — explicit config);
//   • a globalThis guard prevents double timers across dev HMR restarts;
//   • every tick is fully idempotent + lease-protected, so a slow tick that
//     overlaps the next interval just gets LEASE_BUSY and exits;
//   • the timer is unref'd so it never keeps a CLI/build process alive.
//
// Client tick remains a DEV/DEMO FALLBACK only (NEXT_PUBLIC_DEMO_WORKER_TICK,
// spec 32) — with the scheduler present it is redundant and stays off in
// production.

import { runAllLeadOSWorkers } from "./leados-workers";

const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 minutes
const MIN_INTERVAL_MS = 30_000;
const BOOT_DELAY_MS = 15_000; // let the DB + first requests settle

type SchedulerState = {
  started: boolean;
  timer?: ReturnType<typeof setInterval>;
  bootTimer?: ReturnType<typeof setTimeout>;
};

const g = globalThis as typeof globalThis & { __leadosScheduler?: SchedulerState };

export function startLeadOSScheduler(): void {
  if (process.env.WORKER_SCHEDULER_ENABLED === "false") {
    console.log("[LEADOS-SCHEDULER] disabled via WORKER_SCHEDULER_ENABLED=false");
    return;
  }
  if (g.__leadosScheduler?.started) {
    console.log("[LEADOS-SCHEDULER] already started — skipping duplicate boot");
    return;
  }
  const state: SchedulerState = { started: true };
  g.__leadosScheduler = state;

  const raw = Number(process.env.WORKER_SCHEDULER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const interval = Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;

  const tick = async () => {
    try {
      const result = await runAllLeadOSWorkers({ trigger: "scheduler" });
      if (result.status === "LEASE_BUSY") {
        console.log("[LEADOS-SCHEDULER] previous run still holds the lease — skipping tick");
        return;
      }
      console.log(
        `[LEADOS-SCHEDULER] run=${result.runId} status=${result.status} orgs=${result.stats.orgsProcessed} ` +
          `executions=${result.stats.executionsCreated} deliveriesSent=${result.stats.deliveriesSent} ` +
          `duration=${result.durationMs}ms`
      );
    } catch (e) {
      // A failed tick NEVER kills the scheduler — the next interval retries.
      console.error("[LEADOS-SCHEDULER] tick failed:", e);
    }
  };

  state.bootTimer = setTimeout(() => {
    void tick();
    state.timer = setInterval(() => void tick(), interval);
    state.timer.unref?.();
  }, BOOT_DELAY_MS);
  state.bootTimer.unref?.();

  console.log(
    `[LEADOS-SCHEDULER] started — interval=${Math.round(interval / 1000)}s (WORKER_SCHEDULER_ENABLED, ` +
      `WORKER_SCHEDULER_INTERVAL_MS to tune). Workers now run with NO browser open.`
  );
}

export function stopLeadOSScheduler(): void {
  const state = g.__leadosScheduler;
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  if (state.bootTimer) clearTimeout(state.bootTimer);
  state.started = false;
  g.__leadosScheduler = undefined;
}
