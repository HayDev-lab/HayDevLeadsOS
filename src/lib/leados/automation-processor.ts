// HAYDEV LEADOS — AUTOMATION PROCESSOR (v0.15 + v0.16 hardening).
//
// Finds DomainEvents that enabled rules have NOT been checked against yet
// (spec 30–31) and runs them through the engine. It NEVER uses
// DomainEvent.processedAt — that flag belongs to the Notification Projector.
//
// v0.16 CHANGES (spec 11–13, 20–28):
//   • CRASH RECOVERY first: stale RUNNING executions (expired lease) are
//     recovered to FAILED_RETRYABLE with a trace, then retried this run.
//   • BOUNDED RETRIES: FAILED_RETRYABLE rows whose backoff elapsed are retried
//     automatically (max 3 attempts — after that they stay FAILED permanently).
//   • CURSOR BATCHING (spec 24–26): the old `take: 1000` meant "process the
//     first 1000 and stop forever" — events beyond the cursor were NEVER
//     re-queried. The processor now loops 250-event batches with a DB-derived
//     cursor until candidates are exhausted or the TIME BUDGET (spec 26) runs
//     out — then it reports PARTIAL and the next scheduled run continues
//     (spec 27–28: nothing depends on in-memory state).
//   • EVENTS PUBLISHED BY AUTOMATIONS during this run are deferred to the
//     NEXT run (v0.15 spec 80) via an occurredAt <= runStart snapshot bound.
//
// Discovery (v0.15 spec 31–32, unchanged): batch-first, not rule-first:
//   1. load enabled rules once, index them by triggerType;
//   2. fetch candidate events for those trigger types (occurredAt ASC)
//      — bounded by the earliest rule activation (backlog guard, spec 93);
//   3. load existing executions for (rules × events) ONE query per batch;
//   4. process each pair via processEventRule (which owns idempotency,
//      actionability, loop protection, conditions and actions).

import { db } from "@/lib/db";
import { processEventRule, recoverStaleAutomationExecutions, retryAutomationExecution } from "./automation-engine";

const BATCH_SIZE = 250;

export interface AutomationProcessorSummary {
  rulesConsidered: number;
  candidateEvents: number;
  executionsCreated: number;
  processedPairs: number;
  durationMs: number;
  // v0.16 stats (spec 29):
  eventsScanned: number;
  batches: number;
  recoveredStale: number;
  retriesExecuted: number;
  retriesSucceeded: number;
  remainingEvents: number;
  budgetExceeded: boolean;
  errors: string[];
}

/** Process pending (event × rule) pairs + recovery + retries for ONE org. */
export async function runAutomationProcessor(
  orgId: string,
  opts: { maxRunMs?: number; now?: Date } = {}
): Promise<AutomationProcessorSummary> {
  const startedAt = Date.now();
  const runStart = opts.now ?? new Date();
  const maxRunMs = opts.maxRunMs ?? 15_000;
  const summary: AutomationProcessorSummary = {
    rulesConsidered: 0,
    candidateEvents: 0,
    executionsCreated: 0,
    processedPairs: 0,
    durationMs: 0,
    eventsScanned: 0,
    batches: 0,
    recoveredStale: 0,
    retriesExecuted: 0,
    retriesSucceeded: 0,
    remainingEvents: 0,
    budgetExceeded: false,
    errors: [],
  };

  const budgetLeft = () => maxRunMs - (Date.now() - startedAt);

  // 0. CRASH RECOVERY (spec 11–13): stale RUNNING → FAILED_RETRYABLE.
  try {
    const recovery = await recoverStaleAutomationExecutions(orgId);
    summary.recoveredStale = recovery.recovered;
  } catch (e) {
    summary.errors.push(`recovery: ${(e as Error)?.message ?? String(e)}`);
  }

  // 0b. BOUNDED RETRIES (spec 20–21): due FAILED_RETRYABLE executions.
  try {
    const due = await db.automationExecution.findMany({
      where: {
        organizationId: orgId,
        status: "FAILED_RETRYABLE",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    for (const row of due) {
      if (budgetLeft() <= 0) {
        summary.budgetExceeded = true;
        break;
      }
      const res = await retryAutomationExecution(orgId, row.id);
      summary.retriesExecuted++;
      if (res.ok && res.execution?.status === "SUCCESS") summary.retriesSucceeded++;
    }
  } catch (e) {
    summary.errors.push(`retries: ${(e as Error)?.message ?? String(e)}`);
  }

  // 1. Enabled, not-deleted rules of THIS org (tenant scope, spec 4).
  const rules = await db.automationRule.findMany({
    where: { organizationId: orgId, enabled: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  summary.rulesConsidered = rules.length;
  if (!rules.length) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const rulesByTrigger = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = rulesByTrigger.get(rule.triggerType) ?? [];
    list.push(rule);
    rulesByTrigger.set(rule.triggerType, list);
  }

  // 2. Batch loop with a DB-derived cursor (spec 24–28). The cursor is NEVER
  //    persisted — it is derived from event state each run, so a crashed run
  //    loses nothing: the next run re-derives it from the DB (spec 28).
  const earliestActivation = rules.reduce<number>(
    (min, r) => Math.min(min, new Date(r.enabledAt ?? r.createdAt).getTime()),
    Number.POSITIVE_INFINITY
  );

  let cursor: { occurredAt: Date; id: string } | null = null;
  for (;;) {
    if (budgetLeft() <= 0) {
      summary.budgetExceeded = true;
      break;
    }
    const candidateEvents = await db.domainEvent.findMany({
      where: {
        organizationId: orgId,
        type: { in: Array.from(rulesByTrigger.keys()) },
        occurredAt: { gte: new Date(earliestActivation), lte: runStart },
        ...(cursor
          ? { OR: [{ occurredAt: { gt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { gt: cursor.id } }] }
          : {}),
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });
    if (!candidateEvents.length) break;

    summary.batches++;
    summary.candidateEvents += candidateEvents.length;
    summary.eventsScanned += candidateEvents.length;

    // 3. Existing executions for these (rules × events) — ONE query per batch.
    const ruleIds = rules.map((r) => r.id);
    const eventIds = candidateEvents.map((e) => e.id);
    const existing = await db.automationExecution.findMany({
      where: { ruleId: { in: ruleIds }, eventId: { in: eventIds } },
      select: { ruleId: true, eventId: true },
    });
    const donePairs = new Set(existing.map((e) => `${e.ruleId}:${e.eventId}`));

    // 4. Process pairs in occurredAt ASC order (spec 33).
    for (const event of candidateEvents) {
      for (const rule of rulesByTrigger.get(event.type) ?? []) {
        if (donePairs.has(`${rule.id}:${event.id}`)) continue;
        // Per-rule backlog guard: the event must have occurred at/after THIS
        // rule's activation (a newer rule never processes older events).
        if (event.occurredAt.getTime() < new Date(rule.enabledAt ?? rule.createdAt).getTime()) continue;
        summary.processedPairs++;
        const result = await processEventRule(event, rule);
        if (result.created) summary.executionsCreated++;
      }
    }

    const last = candidateEvents[candidateEvents.length - 1];
    cursor = { occurredAt: last.occurredAt, id: last.id };
  }

  // Remaining candidates after the last cursor — the honest "queue depth"
  // (spec 27–29): what the next scheduled run will pick up. Computed even
  // when the budget ran out BEFORE the first batch (cursor = null → the full
  // backlog is still waiting, spec 26-27).
  summary.remainingEvents = await db.domainEvent.count({
    where: {
      organizationId: orgId,
      type: { in: Array.from(rulesByTrigger.keys()) },
      occurredAt: { gte: new Date(earliestActivation), lte: runStart },
      ...(cursor
        ? { OR: [{ occurredAt: { gt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { gt: cursor.id } }] }
        : {}),
    },
  });

  summary.durationMs = Date.now() - startedAt;
  console.log(
    `[AUTOMATION-PROCESSOR] org=${orgId} rules=${rules.length} scanned=${summary.eventsScanned} ` +
      `batches=${summary.batches} pairs=${summary.processedPairs} executions=${summary.executionsCreated} ` +
      `recovered=${summary.recoveredStale} retries=${summary.retriesExecuted} ` +
      `remaining=${summary.remainingEvents} duration=${summary.durationMs}ms${summary.budgetExceeded ? " BUDGET_EXCEEDED" : ""}`
  );
  return summary;
}
