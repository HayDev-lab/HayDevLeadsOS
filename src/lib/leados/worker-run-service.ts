// HAYDEV LEADOS — WORKER RUN SERVICE (v0.16, spec 7, 10, 27, 29).
//
// Durable audit trail for every orchestrator / delivery-worker run:
//   RUNNING → SUCCESS | PARTIAL | FAILED
//
//   SUCCESS  — every step finished inside the budget.
//   PARTIAL  — time budget exhausted (checkpoint) or a step errored while the
//              others succeeded: the NEXT scheduled run continues from DB
//              state — nothing depends on in-memory cursors (spec 27–28).
//   FAILED   — the run itself could not proceed (fatal error).
//
// Heartbeats: batch loops call heartbeatWorkerRun between batches, which also
// extends the worker lease (spec 10). Runs older than RETENTION_DAYS are
// trimmed at the start of each run (audit without unbounded growth).

import { db } from "@/lib/db";

export const WORKER_RUN_TYPE = {
  WORKERS: "LEADOS_WORKERS",
  DELIVERY: "NOTIFICATION_DELIVERY",
} as const;
export type WorkerRunType = (typeof WORKER_RUN_TYPE)[keyof typeof WORKER_RUN_TYPE];

export const WORKER_RUN_STATUS = {
  RUNNING: "RUNNING",
  SUCCESS: "SUCCESS",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
} as const;
export type WorkerRunStatus = (typeof WORKER_RUN_STATUS)[keyof typeof WORKER_RUN_STATUS];

export const WORKER_RUN_TRIGGER = {
  SCHEDULER: "scheduler",
  MANUAL_API: "manual-api",
  CLIENT_TICK: "client-tick",
  INTERNAL: "internal",
} as const;

/** Keep ~30 days of run history (288 runs/day at a 5-min cadence). */
const RETENTION_DAYS = 30;

export interface WorkerRunStats {
  [key: string]: unknown;
}

export async function startWorkerRun(
  type: WorkerRunType,
  trigger: string
): Promise<{ id: string }> {
  const run = await db.workerRun.create({
    data: { type, status: WORKER_RUN_STATUS.RUNNING, trigger, startedAt: new Date() },
  });
  // Opportunistic trim (never blocks the run on failure).
  void trimOldWorkerRuns().catch((e) => console.error("[WORKER-RUN] trim failed:", e));
  return { id: run.id };
}

export async function heartbeatWorkerRun(runId: string): Promise<void> {
  try {
    await db.workerRun.update({ where: { id: runId }, data: { heartbeatAt: new Date() } });
  } catch {
    /* heartbeat is best-effort; the lease carries the actual lock */
  }
}

export async function completeWorkerRun(
  runId: string,
  status: WorkerRunStatus,
  data: { stats?: WorkerRunStats; error?: string | null } = {}
): Promise<void> {
  try {
    await db.workerRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        stats: (data.stats ?? undefined) as never,
        error: data.error ?? null,
      },
    });
  } catch (e) {
    console.error(`[WORKER-RUN] complete failed run=${runId}:`, e);
  }
}

async function trimOldWorkerRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3_600_000);
  await db.workerRun.deleteMany({
    where: { OR: [{ createdAt: { lt: cutoff } }, { status: WORKER_RUN_STATUS.RUNNING, createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } }] },
  });
}

/** Worker Health payload (spec 30, 86): recent runs + current lease info. */
export async function getWorkerHealth(limit = 10) {
  const runs = await db.workerRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true, type: true, status: true, trigger: true,
      startedAt: true, heartbeatAt: true, finishedAt: true,
      stats: true, error: true,
    },
  });
  const stale = await db.workerRun.count({
    where: { status: WORKER_RUN_STATUS.RUNNING, startedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
  });
  return { runs, staleRunningRuns: stale };
}
