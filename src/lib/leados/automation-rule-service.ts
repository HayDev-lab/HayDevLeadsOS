// HAYDEV LEADOS — AUTOMATION RULE SERVICE (v0.15).
//
// Organization-scoped CRUD for AutomationRule + execution history reads.
// Server-side validation (spec 67): name, trigger, conditions (whitelist +
// org-scoped dynamic refs), at least 1 action, valid users / stages /
// enum values. Invalid input → typed error the API maps to HTTP 400.
//
// Policies implemented here:
//   - ACTIVATION (spec 92): enabling (or significantly editing) a rule sets
//     enabledAt = now → old events are never back-processed (spec 93).
//   - VERSIONING (spec 69–72): trigger/conditions/actions edits bump
//     version; executions store ruleVersion. Old history stays honest.
//   - SOFT DELETE (spec 68): rules with history are never hard-deleted.

import { db } from "@/lib/db";
import type { AutomationRule, AutomationExecution, DomainEvent } from "@prisma/client";
import { DOMAIN_EVENT_TYPES, type DomainEventType } from "@/lib/domain-events";
import {
  validateConditionGroup,
  normalizeConditionGroup,
  type ConditionGroup,
} from "@/lib/automation-conditions";
import { validateAutomationActions, type AutomationAction } from "@/lib/automation-actions";

export class RuleValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors[0] ?? "Invalid automation rule");
    this.errors = errors;
  }
}

export interface RuleWithMetrics extends AutomationRule {
  metrics: {
    runs: number;
    success: number;
    failed: number;
    skipped: number;
    lastRunAt: Date | null;
    lastStatus: string | null;
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface RuleInput {
  name?: unknown;
  description?: unknown;
  triggerType?: unknown;
  conditions?: unknown;
  actions?: unknown;
  enabled?: unknown;
}

export async function validateRuleInput(
  orgId: string,
  input: RuleInput,
  opts: { partial?: boolean } = {}
): Promise<{
  name: string;
  description: string | null;
  triggerType: string;
  conditions: ConditionGroup | null;
  actions: AutomationAction[];
  enabled: boolean;
}> {
  const errors: string[] = [];

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!opts.partial || input.name !== undefined) {
    if (name.length < 1 || name.length > 120) errors.push("Rule name is required (max 120 chars).");
  }

  let description: string | null = null;
  if (input.description != null) {
    if (typeof input.description !== "string" || input.description.length > 500) {
      errors.push("Description too long (max 500 chars).");
    } else description = input.description.trim() || null;
  }

  const triggerType = typeof input.triggerType === "string" ? input.triggerType : "";
  if (!opts.partial || input.triggerType !== undefined) {
    if (!DOMAIN_EVENT_TYPES.includes(triggerType as DomainEventType)) {
      errors.push(`Unknown trigger type: ${triggerType || "(missing)"}.`);
    }
  }

  let conditions: ConditionGroup | null = null;
  if (input.conditions !== undefined) {
    if (input.conditions !== null) {
      const orgContext = await buildDynamicContext(orgId);
      const condValidation = validateConditionGroup(input.conditions, orgContext);
      if (!condValidation.ok) errors.push(...condValidation.errors);
      conditions = normalizeConditionGroup(input.conditions);
    }
  }

  let actions: AutomationAction[] = [];
  if (!opts.partial || input.actions !== undefined) {
    if (input.actions === undefined || input.actions === null) {
      errors.push("At least one action is required.");
    } else {
      const users = await db.user.findMany({ where: { organizationId: orgId }, select: { id: true } });
      const actionValidation = validateAutomationActions(input.actions, { userIds: users.map((u) => u.id) });
      if (!actionValidation.ok) errors.push(...actionValidation.errors);
      actions = input.actions as AutomationAction[];
    }
  }

  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);

  if (errors.length) throw new RuleValidationError(errors);
  return { name, description, triggerType, conditions, actions, enabled };
}

/** Org-scoped valid values for dynamic condition fields (source/stage/user ids). */
async function buildDynamicContext(orgId: string) {
  const [sources, stages, users] = await Promise.all([
    db.leadSource.findMany({ where: { organizationId: orgId }, select: { id: true } }),
    db.pipelineStage.findMany({ where: { pipeline: { organizationId: orgId } }, select: { id: true } }),
    db.user.findMany({ where: { organizationId: orgId }, select: { id: true } }),
  ]);
  return {
    sourceIds: sources.map((s) => s.id),
    stageIds: stages.map((s) => s.id),
    userIds: users.map((u) => u.id),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAutomationRule(
  orgId: string,
  userId: string | null,
  input: RuleInput
): Promise<AutomationRule> {
  const v = await validateRuleInput(orgId, input);
  const now = new Date();
  return db.automationRule.create({
    data: {
      organizationId: orgId,
      name: v.name,
      description: v.description,
      triggerType: v.triggerType,
      conditions: (v.conditions ?? undefined) as never,
      actions: v.actions as never,
      enabled: v.enabled,
      // A NEW rule only applies to events from its creation onwards (spec 93).
      enabledAt: v.enabled ? now : null,
      createdBy: userId,
      version: 1,
    },
  });
}

export async function updateAutomationRule(
  orgId: string,
  ruleId: string,
  userId: string | null,
  input: RuleInput
): Promise<AutomationRule> {
  const existing = await db.automationRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.organizationId !== orgId) throw new Error("RULE_NOT_FOUND");

  const v = await validateRuleInput(orgId, input, { partial: true });
  const now = new Date();

  // Significant change = trigger / conditions / actions (spec 69, 95):
  // bump version AND restart activation so old events are not replayed.
  const conditionsChanged = JSON.stringify(v.conditions ?? null) !== JSON.stringify(normalizeConditionGroup(existing.conditions) ?? null);
  const actionsChanged = v.actions.length > 0 && JSON.stringify(v.actions) !== JSON.stringify(existing.actions);
  const triggerChanged = v.triggerType && v.triggerType !== existing.triggerType;
  const significant = triggerChanged || conditionsChanged || actionsChanged;

  const wasEnabled = existing.enabled;
  const willBeEnabled = input.enabled === undefined ? wasEnabled : Boolean(input.enabled);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = v.name;
  if (input.description !== undefined) data.description = v.description;
  if (input.triggerType !== undefined) data.triggerType = v.triggerType;
  if (input.conditions !== undefined) data.conditions = (v.conditions ?? undefined) as never;
  if (input.actions !== undefined && v.actions.length) data.actions = v.actions as never;
  if (input.enabled !== undefined) data.enabled = willBeEnabled;
  if (significant) {
    data.version = existing.version + 1;
    data.enabledAt = willBeEnabled ? now : null;
  } else if (input.enabled !== undefined && !wasEnabled && willBeEnabled) {
    // Re-activating a paused rule: only NEW events from now on (spec 92).
    data.enabledAt = now;
  } else if (input.enabled !== undefined && wasEnabled && !willBeEnabled) {
    data.enabledAt = null;
  }

  return db.automationRule.update({ where: { id: ruleId }, data: data as never });
}

/** Soft delete (spec 68): history stays; the rule stops matching immediately. */
export async function deleteAutomationRule(orgId: string, ruleId: string): Promise<AutomationRule> {
  const existing = await db.automationRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.organizationId !== orgId) throw new Error("RULE_NOT_FOUND");
  return db.automationRule.update({
    where: { id: ruleId },
    data: { deletedAt: new Date(), enabled: false, enabledAt: null },
  });
}

// ---------------------------------------------------------------------------
// Reads (list + metrics + history)
// ---------------------------------------------------------------------------

export async function listAutomationRules(orgId: string): Promise<RuleWithMetrics[]> {
  const rules = await db.automationRule.findMany({
    where: { organizationId: orgId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }],
  });
  if (!rules.length) return [];

  // Metrics in ONE grouped query — not per-rule (no N+1).
  const grouped = await db.automationExecution.groupBy({
    by: ["ruleId", "status"],
    where: { organizationId: orgId, ruleId: { in: rules.map((r) => r.id) } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const lastRuns = await db.automationExecution.findMany({
    where: { organizationId: orgId, ruleId: { in: rules.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { ruleId: true, createdAt: true, status: true },
  });
  const lastByRule = new Map<string, { createdAt: Date; status: string }>();
  for (const row of lastRuns) {
    if (!lastByRule.has(row.ruleId)) lastByRule.set(row.ruleId, { createdAt: row.createdAt, status: row.status });
  }

  const counts = new Map<string, { runs: number; success: number; failed: number; skipped: number }>();
  for (const g of grouped) {
    const entry = counts.get(g.ruleId) ?? { runs: 0, success: 0, failed: 0, skipped: 0 };
    entry.runs += g._count._all;
    if (g.status === "SUCCESS") entry.success += g._count._all;
    else if (g.status === "FAILED") entry.failed += g._count._all;
    else if (g.status === "SKIPPED") entry.skipped += g._count._all;
    counts.set(g.ruleId, entry);
  }

  return rules.map((rule) => {
    const entry = counts.get(rule.id);
    const last = lastByRule.get(rule.id);
    return {
      ...rule,
      metrics: {
        runs: entry?.runs ?? 0,
        success: entry?.success ?? 0,
        failed: entry?.failed ?? 0,
        skipped: entry?.skipped ?? 0,
        lastRunAt: last?.createdAt ?? null,
        lastStatus: last?.status ?? null,
      },
    };
  });
}

export async function getAutomationRule(orgId: string, ruleId: string): Promise<AutomationRule | null> {
  const rule = await db.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.organizationId !== orgId || rule.deletedAt) return null;
  return rule;
}

export interface ExecutionListRow extends AutomationExecution {
  ruleName: string;
  eventName: string;
}

export async function listAutomationExecutions(
  orgId: string,
  opts: { ruleId?: string; status?: string; limit?: number; page?: number } = {}
): Promise<{ rows: ExecutionListRow[]; total: number }> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const where: Record<string, unknown> = { organizationId: orgId };
  if (opts.ruleId) where.ruleId = opts.ruleId;
  if (opts.status) where.status = opts.status;

  const [rows, total] = await Promise.all([
    db.automationExecution.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: (page - 1) * limit,
    }),
    db.automationExecution.count({ where }),
  ]);

  // Resolve rule names + event types in bulk (no per-row queries).
  const ruleIds = Array.from(new Set(rows.map((r) => r.ruleId)));
  const eventIds = Array.from(new Set(rows.map((r) => r.eventId)));
  const [rules, events] = await Promise.all([
    ruleIds.length
      ? db.automationRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    eventIds.length
      ? db.domainEvent.findMany({ where: { id: { in: eventIds } }, select: { id: true, type: true } })
      : Promise.resolve([] as { id: string; type: string }[]),
  ]);
  const ruleNames = new Map<string, string>(rules.map((r) => [r.id, r.name] as [string, string]));
  const eventTypes = new Map<string, string>(events.map((e) => [e.id, e.type] as [string, string]));

  return {
    rows: rows.map((r) => ({
      ...r,
      ruleName: ruleNames.get(r.ruleId) ?? "(deleted rule)",
      eventName: eventTypes.get(r.eventId) ?? r.eventId,
    })),
    total,
  };
}

export interface ExecutionDetailRow extends AutomationExecution {
  ruleName: string;
  ruleTriggerType: string;
  event: DomainEvent | null;
}

export async function getAutomationExecution(
  orgId: string,
  executionId: string
): Promise<ExecutionDetailRow | null> {
  const execution = await db.automationExecution.findUnique({
    where: { id: executionId },
    include: { rule: { select: { id: true, name: true, triggerType: true } } },
  });
  if (!execution || execution.organizationId !== orgId) return null;
  const event = await db.domainEvent.findUnique({ where: { id: execution.eventId } });
  return {
    ...execution,
    ruleName: execution.rule.name,
    ruleTriggerType: execution.rule.triggerType,
    event,
  };
}

/** Org-level automation summary for the Automations page header (spec 99/101). */
export async function automationSummary(orgId: string): Promise<{
  rules: number;
  active: number;
  runsToday: number;
  failedTotal: number;
  lastFailed: AutomationExecution | null;
}> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [rules, active, runsToday, failedTotal, lastFailed] = await Promise.all([
    db.automationRule.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.automationRule.count({ where: { organizationId: orgId, deletedAt: null, enabled: true } }),
    db.automationExecution.count({ where: { organizationId: orgId, createdAt: { gte: startOfDay } } }),
    db.automationExecution.count({ where: { organizationId: orgId, status: "FAILED" } }),
    db.automationExecution.findFirst({
      where: { organizationId: orgId, status: "FAILED" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { rules, active, runsToday, failedTotal, lastFailed };
}
