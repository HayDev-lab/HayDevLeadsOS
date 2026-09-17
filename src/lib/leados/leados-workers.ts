// HAYDEV LEADOS — WORKER ORCHESTRATOR (v0.15, spec 79–84).
//
//   runLeadOSWorkers(orgId)
//     1. runEventReconciliation()   — detect time-based facts, store events,
//                                     project notifications (crash recovery
//                                     included)
//     2. runAutomationProcessor()  — process automations for unpaired events
//
// Every step is INDEPENDENTLY retryable (spec 82): if automations fail, the
// Notification Center keeps working — no transaction spans the pipeline
// (spec 80). Durable events give eventual consistency.
//
// SCHEDULER LIMITATION (spec 81/84 — honest): this deployment has NO
// production cron. The workers are triggered by (a) the client tick every
// 5 minutes while the app is open (demo fallback) and (b) the protected
// POST /api/v1/workers/run endpoint, ready for a real external scheduler
// (secret-header auth). Automation correctness does not depend on the
// browser being open: the processor is idempotent, so a late run catches up
// exactly once per (event × rule) pair.

import { runEventReconciliation, type ReconciliationSummary } from "./event-reconciler";
import { runAutomationProcessor, type AutomationProcessorSummary } from "./automation-processor";

export interface LeadOSWorkersResult {
  orgId: string;
  reconciliation: (ReconciliationSummary & { error?: string }) | null;
  automations: (AutomationProcessorSummary & { error?: string }) | null;
  durationMs: number;
}

export async function runLeadOSWorkers(orgId: string): Promise<LeadOSWorkersResult> {
  const startedAt = Date.now();

  let reconciliation: LeadOSWorkersResult["reconciliation"] = null;
  let automations: LeadOSWorkersResult["automations"] = null;

  // Step 1 — reconcile + project (existing engine, unchanged).
  try {
    reconciliation = await runEventReconciliation(orgId);
  } catch (e) {
    console.error("[LEADOS-WORKERS] reconciliation failed:", e);
    reconciliation = { error: (e as Error)?.message ?? String(e) } as ReconciliationSummary & { error?: string };
  }

  // Step 2 — automation processor (independent retryability).
  try {
    automations = await runAutomationProcessor(orgId);
  } catch (e) {
    console.error("[LEADOS-WORKERS] automation processing failed:", e);
    automations = { error: (e as Error)?.message ?? String(e) } as AutomationProcessorSummary & { error?: string };
  }

  return { orgId, reconciliation, automations, durationMs: Date.now() - startedAt };
}
