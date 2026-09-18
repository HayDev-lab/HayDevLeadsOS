// HAYDEV LEADOS — AUTOMATION EXECUTION CONTEXT (v0.15).
//
// AsyncLocalStorage carries the CURRENT automation execution through the
// async call chain so that:
//   1. every DomainEvent published by an automation action is stamped with
//      automationExecutionId (CAUSATION, spec 29) — no parameter plumbing
//      through the business services;
//   2. every Task created by CREATE_TASK is attributed to the rule
//      (automationRuleId / automationExecutionId, spec 61/64).
//
// The store is tiny and read via getAutomationExecutionContext() — returning
// null when we are NOT inside an automation (the normal path).

import { AsyncLocalStorage } from "node:async_hooks";

export interface AutomationExecutionContext {
  executionId: string;
  ruleId: string;
  /** Causation chain depth of the EVENT being processed (0 = user/world event). */
  eventDepth: number;
}

const als = new AsyncLocalStorage<AutomationExecutionContext>();

export function runWithAutomationContext<T>(ctx: AutomationExecutionContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getAutomationExecutionContext(): AutomationExecutionContext | null {
  return als.getStore() ?? null;
}
