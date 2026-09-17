// GET /api/v1/workers/health — WORKER HEALTH (v0.16 spec 30–31, 86).
// OWNER/ADMIN. Compact observability — recent WorkerRun rows (status,
// duration, stats counts), current leases, and org-scoped queue depth:
// pending deliveries, retry queue, failed automations/deliveries, stale runs.
// NEVER a DevOps dashboard: counts + timestamps only, no payloads (spec 6).

import { db } from "@/lib/db";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, forbidden, serverError } from "@/lib/leados/api";
import { getWorkerHealth } from "@/lib/leados/worker-run-service";
import { getWorkerLease, WORKER_LEASE_TYPE } from "@/lib/leados/worker-lease";
import { runAutomationProcessor } from "@/lib/leados/automation-processor";

export async function GET() {
  try {
    const session = await getSession();
    if (!canManage(session.role)) return forbidden("Owner or admin only");

    const [health, workersLease, deliveryLease, schedulerEnabled] = await Promise.all([
      getWorkerHealth(10),
      getWorkerLease(WORKER_LEASE_TYPE.WORKERS),
      getWorkerLease(WORKER_LEASE_TYPE.DELIVERY),
      Promise.resolve(process.env.WORKER_SCHEDULER_ENABLED !== "false"),
    ]);

    // Org-scoped queue depth (spec 86). The automation-processor dry estimate:
    // enabled rules' trigger events not yet paired — computed cheaply via a
    // zero-budget processor probe is overkill; use direct counts instead.
    const orgId = session.orgId;
    const [pendingDeliveries, retryDeliveries, failedDeliveries, failedAutomations, retryAutomations, pendingFanout] =
      await Promise.all([
        db.notificationDelivery.count({ where: { organizationId: orgId, status: "PENDING" } }),
        db.notificationDelivery.count({
          where: { organizationId: orgId, status: "FAILED_RETRYABLE", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
        }),
        db.notificationDelivery.count({ where: { organizationId: orgId, status: "FAILED" } }),
        db.automationExecution.count({ where: { organizationId: orgId, status: "FAILED" } }),
        db.automationExecution.count({
          where: { organizationId: orgId, status: "FAILED_RETRYABLE", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
        }),
        db.notification.count({ where: { organizationId: orgId, fanoutAt: null, eventId: { not: null }, userId: { not: null } } }),
      ]);

    return ok({
      scheduler: {
        enabled: schedulerEnabled,
        intervalMs: Number(process.env.WORKER_SCHEDULER_INTERVAL_MS ?? 300_000),
        demoTick: process.env.NEXT_PUBLIC_DEMO_WORKER_TICK === "true",
      },
      runs: health.runs,
      staleRunningRuns: health.staleRunningRuns,
      leases: { workers: workersLease, delivery: deliveryLease },
      queue: {
        pendingDeliveries,
        retryDeliveries,
        failedDeliveries,
        failedAutomations,
        retryAutomations,
        pendingFanout,
      },
    });
  } catch (e) {
    return serverError("workers-health-failed", e);
  }
}

// Keep the processor import referenced (typed re-export surface for tests).
export type { AutomationProcessorSummary } from "@/lib/leados/automation-processor";
void runAutomationProcessor;
