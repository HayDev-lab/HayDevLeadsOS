// HAYDEV LEADOS — WORKER ORCHESTRATOR (v0.16).
//
//   runAllLeadOSWorkers()            — production entry point, ALL orgs
//     per org (each step INDEPENDENTLY retryable, spec 82):
//       1. runEventReconciliation()  — detect time-based facts + project
//       2. runAutomationProcessor()   — recovery + retries + batched pairs
//       3. fanoutNotificationDeliveries() — external-channel delivery rows
//     then (own lease, spec 59 — a delivery failure never blocks the rest):
//       4. runNotificationDeliveryWorker() — send + bounded retries
//
// DURABILITY (v0.16 spec 7–10, 27–29):
//   • the whole run is guarded by a DB WorkerLease — a second concurrent run
//     gets LEASE_BUSY instead of double-processing (spec 8, TEST D);
//   • a WorkerRun row records RUNNING → SUCCESS/PARTIAL/FAILED with stats;
//   • heartbeats between steps keep the lease alive on long runs;
//   • a TIME BUDGET (spec 26) turns into PARTIAL — the next scheduled run
//     continues from DB state (spec 27–28), nothing is lost;
//   • a step error marks PARTIAL, never blocks the other steps (spec 59).
//
// SCHEDULER: the in-process scheduler (src/instrumentation.ts +
// lib/leados/scheduler.ts) calls this on a timer at server boot — LeadOS keeps
// processing events and automations with NO browser open (spec 74). The
// client tick remains a dev/demo fallback only (NEXT_PUBLIC_DEMO_WORKER_TICK).

import { db } from "@/lib/db";
import { runEventReconciliation, type ReconciliationSummary } from "./event-reconciler";
import { runAutomationProcessor, type AutomationProcessorSummary } from "./automation-processor";
import { fanoutNotificationDeliveries, type FanoutSummary } from "./delivery/fanout";
import { runNotificationDeliveryWorker, type DeliveryWorkerResult } from "./delivery/delivery-worker";
import {
  acquireWorkerLease,
  releaseWorkerLease,
  extendWorkerLease,
  WORKER_LEASE_TYPE,
} from "./worker-lease";
import {
  startWorkerRun,
  heartbeatWorkerRun,
  completeWorkerRun,
  WORKER_RUN_TYPE,
  WORKER_RUN_STATUS,
} from "./worker-run-service";

export type { ReconciliationSummary, AutomationProcessorSummary, FanoutSummary, DeliveryWorkerResult };

export interface OrgRunResult {
  orgId: string;
  reconciliation: (ReconciliationSummary & { error?: string }) | null;
  automations: (AutomationProcessorSummary & { error?: string }) | null;
  fanout: (FanoutSummary & { error?: string }) | null;
}

export interface LeadOSWorkersResult {
  orgId: string; // first org (backward-compatible shape)
  reconciliation: (ReconciliationSummary & { error?: string }) | null;
  automations: (AutomationProcessorSummary & { error?: string }) | null;
  fanout: (FanoutSummary & { error?: string }) | null;
  delivery: (DeliveryWorkerResult["stats"] & { error?: string; leaseBusy?: boolean }) | null;
  durationMs: number;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "LEASE_BUSY";
  runId: string | null;
  orgs: OrgRunResult[];
  stats: {
    orgsProcessed: number;
    eventsScanned: number;
    eventsProjected: number;
    executionsCreated: number;
    deliveriesCreated: number;
    deliveriesSent: number;
    stepErrors: string[];
  };
}

/** Backward-compatible single-org entry (per-org steps, no global lease). */
export async function runLeadOSWorkers(orgId: string): Promise<LeadOSWorkersResult> {
  const result = await runAllLeadOSWorkers({ orgIds: [orgId], trigger: "manual-api" });
  return result;
}

/**
 * Full production run: ALL orgs under ONE lease + ONE durable WorkerRun.
 * Time budget (spec 26) defaults to 30s — export WORKER_MAX_RUN_MS to adapt.
 */
export async function runAllLeadOSWorkers(
  opts: { orgIds?: string[]; trigger?: string; maxRunMs?: number } = {}
): Promise<LeadOSWorkersResult> {
  const startedAt = Date.now();
  const maxRunMs = opts.maxRunMs ?? Number(process.env.WORKER_MAX_RUN_MS ?? 30_000);
  const trigger = opts.trigger ?? "manual-api";

  const runStart = await startWorkerRun(WORKER_RUN_TYPE.WORKERS, trigger);
  const lease = await acquireWorkerLease(WORKER_LEASE_TYPE.WORKERS, runStart.id, Math.max(90_000, maxRunMs + 60_000));

  const empty: LeadOSWorkersResult = {
    orgId: "",
    reconciliation: null,
    automations: null,
    fanout: null,
    delivery: null,
    durationMs: Date.now() - startedAt,
    status: "LEASE_BUSY",
    runId: runStart.id,
    orgs: [],
    stats: { orgsProcessed: 0, eventsScanned: 0, eventsProjected: 0, executionsCreated: 0, deliveriesCreated: 0, deliveriesSent: 0, stepErrors: ["LEASE_BUSY"] },
  };

  if (!lease.ok) {
    // Spec 8 (TEST D): the second concurrent run backs off cleanly.
    await completeWorkerRun(runStart.id, WORKER_RUN_STATUS.FAILED, {
      error: "LEASE_BUSY",
      stats: { note: "Another worker holds the lease.", holderRunId: lease.holderRunId },
    });
    return empty;
  }

  const budgetLeft = () => maxRunMs - (Date.now() - startedAt);
  const stepErrors: string[] = [];
  const orgs: OrgRunResult[] = [];

  try {
    const orgIds =
      opts.orgIds ??
      (await db.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } })).map((o) => o.id);

    for (const orgId of orgIds) {
      const orgRun: OrgRunResult = { orgId, reconciliation: null, automations: null, fanout: null };

      // Step 1 — reconcile + project (existing engine, unchanged).
      if (budgetLeft() > 0) {
        try {
          orgRun.reconciliation = await runEventReconciliation(orgId);
        } catch (e) {
          console.error("[LEADOS-WORKERS] reconciliation failed:", e);
          orgRun.reconciliation = { error: (e as Error)?.message ?? String(e) } as ReconciliationSummary & { error?: string };
          stepErrors.push(`reconciliation:${orgId}`);
        }
      } else {
        stepErrors.push("budget:reconciliation");
      }

      await heartbeatWorkerRun(runStart.id);
      await extendWorkerLease(WORKER_LEASE_TYPE.WORKERS, runStart.id);

      // Step 2 — automation processing (recovery + retries + batched pairs).
      if (budgetLeft() > 0) {
        try {
          orgRun.automations = await runAutomationProcessor(orgId, { maxRunMs: Math.max(1_000, budgetLeft()) });
          if (orgRun.automations.budgetExceeded) stepErrors.push("budget:automations");
        } catch (e) {
          console.error("[LEADOS-WORKERS] automation processing failed:", e);
          orgRun.automations = { error: (e as Error)?.message ?? String(e) } as AutomationProcessorSummary & { error?: string };
          stepErrors.push(`automations:${orgId}`);
        }
      } else {
        stepErrors.push("budget:automations");
      }

      await heartbeatWorkerRun(runStart.id);
      await extendWorkerLease(WORKER_LEASE_TYPE.WORKERS, runStart.id);

      // Step 3 — external delivery fan-out (prefs → delivery rows).
      if (budgetLeft() > 0) {
        try {
          orgRun.fanout = await fanoutNotificationDeliveries(orgId, { maxRunMs: Math.max(1_000, budgetLeft()) });
          if (orgRun.fanout.budgetExceeded) stepErrors.push("budget:fanout");
        } catch (e) {
          console.error("[LEADOS-WORKERS] delivery fan-out failed:", e);
          orgRun.fanout = { error: (e as Error)?.message ?? String(e) } as FanoutSummary & { error?: string };
          stepErrors.push(`fanout:${orgId}`);
        }
      } else {
        stepErrors.push("budget:fanout");
      }

      orgs.push(orgRun);
    }

    // Step 4 — external delivery processing (OWN lease → an email failure can
    // never block in-app/automation consumers, spec 59; LEASE_BUSY is OK).
    let delivery: LeadOSWorkersResult["delivery"] = null;
    if (budgetLeft() > 0) {
      try {
        const res = await runNotificationDeliveryWorker({
          maxRunMs: Math.max(1_000, budgetLeft()),
          trigger: `${trigger}:delivery`,
        });
        delivery = res.leaseBusy ? { ...res.stats, leaseBusy: true } : res.stats;
        if (res.leaseBusy) stepErrors.push("delivery:LEASE_BUSY");
      } catch (e) {
        console.error("[LEADOS-WORKERS] delivery worker failed:", e);
        delivery = { error: (e as Error)?.message ?? String(e) } as DeliveryWorkerResult["stats"] & { error?: string };
        stepErrors.push("delivery");
      }
    } else {
      stepErrors.push("budget:delivery");
    }

    const durationMs = Date.now() - startedAt;
    const stats = {
      orgsProcessed: orgs.length,
      eventsScanned: orgs.reduce((n, o) => n + (o.reconciliation?.scannedLeads ?? 0) + (o.reconciliation?.scannedTasks ?? 0), 0),
      eventsProjected: orgs.reduce((n, o) => n + (o.reconciliation?.eventsCreated ?? 0) + (o.reconciliation?.reprocessed ?? 0), 0),
      executionsCreated: orgs.reduce((n, o) => n + (o.automations?.executionsCreated ?? 0), 0),
      deliveriesCreated: orgs.reduce((n, o) => n + (o.fanout?.deliveriesCreated ?? 0), 0),
      deliveriesSent: delivery?.sent ?? 0,
      stepErrors,
    };
    const status: LeadOSWorkersResult["status"] = stepErrors.length ? WORKER_RUN_STATUS.PARTIAL : WORKER_RUN_STATUS.SUCCESS;

    await completeWorkerRun(runStart.id, status, { stats: { ...stats, durationMs } as never });
    await releaseWorkerLease(WORKER_LEASE_TYPE.WORKERS, runStart.id);

    const first = orgs[0] ?? null;
    return {
      orgId: first?.orgId ?? "",
      reconciliation: first?.reconciliation ?? null,
      automations: first?.automations ?? null,
      fanout: first?.fanout ?? null,
      delivery,
      durationMs,
      status,
      runId: runStart.id,
      orgs,
      stats,
    };
  } catch (e) {
    // Fatal: mark FAILED, release the lease — the next scheduled run recovers
    // from DB state (every step is idempotent).
    console.error("[LEADOS-WORKERS] fatal:", e);
    const durationMs = Date.now() - startedAt;
    await completeWorkerRun(runStart.id, WORKER_RUN_STATUS.FAILED, {
      error: (e as Error)?.message ?? String(e),
      stats: { orgs: orgs.length, durationMs } as never,
    });
    await releaseWorkerLease(WORKER_LEASE_TYPE.WORKERS, runStart.id);
    return {
      orgId: orgs[0]?.orgId ?? "",
      reconciliation: orgs[0]?.reconciliation ?? null,
      automations: orgs[0]?.automations ?? null,
      fanout: orgs[0]?.fanout ?? null,
      delivery: null,
      durationMs,
      status: "FAILED",
      runId: runStart.id,
      orgs,
      stats: { orgsProcessed: orgs.length, eventsScanned: 0, eventsProjected: 0, executionsCreated: 0, deliveriesCreated: 0, deliveriesSent: 0, stepErrors: [String((e as Error)?.message ?? e)] },
    };
  }
}
