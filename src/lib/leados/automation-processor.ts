// HAYDEV LEADOS — AUTOMATION PROCESSOR (v0.15).
//
// Finds DomainEvents that enabled rules have NOT been checked against yet
// (spec 30–31) and runs them through the engine. It NEVER uses
// DomainEvent.processedAt — that flag belongs to the Notification Projector.
//
// Discovery strategy (spec 31–32): batch-first, not rule-first:
//   1. load enabled rules once, index them by triggerType;
//   2. fetch candidate events for those trigger types (occurredAt ASC, spec 33)
//      — bounded by the earliest rule activation so a newly enabled rule can
//      never process months of backlog (spec 93);
//   3. load existing executions for (those rules × those events) in ONE query
//      and skip the pairs that already ran;
//   4. process each pair via processEventRule (which owns idempotency,
//      actionability, loop protection, conditions and actions).
//
// Events published BY automation actions are picked up on the NEXT run —
// chains resolve across runs, never recursively inline (spec 80).

import { db } from "@/lib/db";
import { processEventRule } from "./automation-engine";

export interface AutomationProcessorSummary {
  rulesConsidered: number;
  candidateEvents: number;
  executionsCreated: number;
  processedPairs: number;
  durationMs: number;
}

/** Process pending (event × rule) pairs for ONE organization. */
export async function runAutomationProcessor(orgId: string, opts: { limit?: number } = {}): Promise<AutomationProcessorSummary> {
  const startedAt = Date.now();
  const limit = Math.min(2000, Math.max(1, opts.limit ?? 1000));

  // 1. Enabled, not-deleted rules of THIS org (tenant scope, spec 4).
  const rules = await db.automationRule.findMany({
    where: { organizationId: orgId, enabled: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!rules.length) {
    return { rulesConsidered: 0, candidateEvents: 0, executionsCreated: 0, processedPairs: 0, durationMs: Date.now() - startedAt };
  }

  const rulesByTrigger = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = rulesByTrigger.get(rule.triggerType) ?? [];
    list.push(rule);
    rulesByTrigger.set(rule.triggerType, list);
  }

  // 2. Candidate events — bounded by the earliest activation time among the
  //    enabled rules (backlog guard, spec 92–93).
  const earliestActivation = rules.reduce<number>(
    (min, r) => Math.min(min, new Date(r.enabledAt ?? r.createdAt).getTime()),
    Number.POSITIVE_INFINITY
  );
  const candidateEvents = await db.domainEvent.findMany({
    where: {
      organizationId: orgId,
      type: { in: Array.from(rulesByTrigger.keys()) },
      occurredAt: { gte: new Date(earliestActivation) },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  if (!candidateEvents.length) {
    return { rulesConsidered: rules.length, candidateEvents: 0, executionsCreated: 0, processedPairs: 0, durationMs: Date.now() - startedAt };
  }

  // 3. Existing executions for these (rules × events) — ONE query (spec 32).
  const ruleIds = rules.map((r) => r.id);
  const eventIds = candidateEvents.map((e) => e.id);
  const existing = await db.automationExecution.findMany({
    where: { ruleId: { in: ruleIds }, eventId: { in: eventIds } },
    select: { ruleId: true, eventId: true },
  });
  const donePairs = new Set(existing.map((e) => `${e.ruleId}:${e.eventId}`));

  // 4. Process pairs in occurredAt ASC order (spec 33).
  let executionsCreated = 0;
  let processedPairs = 0;
  for (const event of candidateEvents) {
    for (const rule of rulesByTrigger.get(event.type) ?? []) {
      if (donePairs.has(`${rule.id}:${event.id}`)) continue;
      // Per-rule backlog guard: the event must have occurred at/after THIS
      // rule's activation (a newer rule never processes older events).
      if (event.occurredAt.getTime() < new Date(rule.enabledAt ?? rule.createdAt).getTime()) continue;
      processedPairs++;
      const result = await processEventRule(event, rule);
      if (result.created) executionsCreated++;
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[AUTOMATION-PROCESSOR] org=${orgId} rules=${rules.length} candidates=${candidateEvents.length} ` +
      `pairs=${processedPairs} executions=${executionsCreated} duration=${durationMs}ms`
  );
  return { rulesConsidered: rules.length, candidateEvents: candidateEvents.length, executionsCreated, processedPairs, durationMs };
}
