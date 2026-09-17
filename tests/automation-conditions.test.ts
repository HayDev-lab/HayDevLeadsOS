// AUTOMATION CONDITION ENGINE (v0.15) — pure unit tests. Run with: bun test
//
// Covers spec Sections 85–86: every operator, ALL/ANY boolean groups and
// the validation failures (unknown field / unknown operator / wrong enum /
// no actions). No DB — the DSL is pure.

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  CONDITION_FIELDS,
  CONDITION_OPERATOR,
  evaluateConditionGroup,
  normalizeConditionGroup,
  traceLine,
  validateConditionGroup,
  type ConditionEvalContext,
} from "../src/lib/automation-conditions";
import { validateAutomationActions, interpolate } from "../src/lib/automation-actions";

const CTX: ConditionEvalContext = {
  lead: {
    priority: "HIGH",
    status: "OPEN",
    stageId: "stage-proposal",
    stageType: "open",
    ownerId: "user-1",
    sourceId: "src-website",
    estimatedValue: 500000,
    leadScore: 72,
  },
  event: {
    type: "STAGE_BECAME_STALE",
    payload: { overdueMinutes: 2880, remainingMinutes: null, leadName: "AquaService" },
  },
  task: { assignedTo: "user-2", status: "TODO" },
};

describe("condition operators (spec 85)", () => {
  test("equals — enum match", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }] }, CTX);
    expect(r.matched).toBe(true);
    expect(r.trace[0].passed).toBe(true);
  });

  test("equals — no match", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.priority", operator: "equals", value: "LOW" }] }, CTX);
    expect(r.matched).toBe(false);
    expect(r.trace[0].passed).toBe(false);
  });

  test("not_equals", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.status", operator: "not_equals", value: "WON" }] }, CTX);
    expect(r.matched).toBe(true);
  });

  test("in — list membership", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.priority", operator: "in", value: ["HIGH", "URGENT"] }] }, CTX);
    expect(r.matched).toBe(true);
  });

  test("in — list non-membership", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.priority", operator: "in", value: ["LOW", "MEDIUM"] }] }, CTX);
    expect(r.matched).toBe(false);
  });

  test("not_in", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.priority", operator: "not_in", value: ["LOW", "MEDIUM"] }] }, CTX);
    expect(r.matched).toBe(true);
  });

  test("exists — ownerId set", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.ownerId", operator: "exists" }] }, CTX);
    expect(r.matched).toBe(true);
  });

  test("not_exists — missing owner (unassigned lead)", () => {
    const r = evaluateConditionGroup(
      { all: [{ field: "lead.ownerId", operator: "not_exists" }] },
      { ...CTX, lead: { ...CTX.lead!, ownerId: null } }
    );
    expect(r.matched).toBe(true);
  });

  test("exists — null numeric payload field", () => {
    const r = evaluateConditionGroup({ all: [{ field: "event.payload.remainingMinutes", operator: "exists" }] }, CTX);
    expect(r.matched).toBe(false);
  });

  test("greater_than — numeric payload", () => {
    const r = evaluateConditionGroup({ all: [{ field: "event.payload.overdueMinutes", operator: "greater_than", value: 1440 }] }, CTX);
    expect(r.matched).toBe(true);
  });

  test("greater_than — boundary (equal is not greater)", () => {
    const r = evaluateConditionGroup({ all: [{ field: "event.payload.overdueMinutes", operator: "greater_than", value: 2880 }] }, CTX);
    expect(r.matched).toBe(false);
  });

  test("less_than — estimated value", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.estimatedValue", operator: "less_than", value: 1000000 }] }, CTX);
    expect(r.matched).toBe(true);
  });

  test("less_than — string numbers compared numerically", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.leadScore", operator: "greater_than", value: "70" }] }, CTX);
    expect(r.matched).toBe(true);
  });

  test("task fields — assignedTo + status", () => {
    const r = evaluateConditionGroup(
      { all: [{ field: "task.assignedTo", operator: "equals", value: "user-2" }, { field: "task.status", operator: "equals", value: "TODO" }] },
      CTX
    );
    expect(r.matched).toBe(true);
  });

  test("event.type field", () => {
    const r = evaluateConditionGroup({ all: [{ field: "event.type", operator: "equals", value: "STAGE_BECAME_STALE" }] }, CTX);
    expect(r.matched).toBe(true);
  });
});

describe("boolean logic ALL / ANY (spec 8, 123)", () => {
  const one = { field: "lead.priority", operator: "equals", value: "HIGH" } as const;
  const two = { field: "lead.status", operator: "equals", value: "WON" } as const;

  test("ALL — one fails → no match", () => {
    expect(evaluateConditionGroup({ all: [one, two] }, CTX).matched).toBe(false);
  });

  test("ANY — one passes → match", () => {
    expect(evaluateConditionGroup({ any: [one, two] }, CTX).matched).toBe(true);
  });

  test("ANY — all fail → no match", () => {
    expect(evaluateConditionGroup({ any: [two] }, CTX).matched).toBe(false);
  });

  test("empty group matches everything", () => {
    expect(evaluateConditionGroup({ all: [] }, CTX).matched).toBe(true);
  });

  test("null group matches everything (no conditions = always)", () => {
    expect(evaluateConditionGroup(null, CTX).matched).toBe(true);
  });

  test("ALL and ANY give DIFFERENT results for the same items (spec 123)", () => {
    const items = [one, two] as never[];
    expect(evaluateConditionGroup({ all: items }, CTX).matched).toBe(false);
    expect(evaluateConditionGroup({ any: items }, CTX).matched).toBe(true);
  });
});

describe("condition trace (spec 53)", () => {
  test("trace records expected / actual / passed", () => {
    const r = evaluateConditionGroup({ all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }] }, CTX);
    expect(r.trace).toEqual([
      { field: "lead.priority", operator: "equals", expected: "HIGH", actual: "HIGH", passed: true },
    ]);
  });

  test("traceLine renders a readable line", () => {
    const line = traceLine({ field: "lead.priority", operator: "equals", expected: "HIGH", actual: "NORMAL", passed: false });
    expect(line).toContain("lead.priority equals HIGH");
    expect(line).toContain("NORMAL");
    expect(line).toContain("fail");
  });
});

describe("condition validation (spec 86, 10)", () => {
  const ctx = { sourceIds: ["src-1"], stageIds: ["stage-1"], userIds: ["user-1"] };

  test("unknown field FAILS", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.secretField", operator: "equals", value: "x" }] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("unknown field");
  });

  test("arbitrary DB traversal is impossible (whitelist)", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.organization.deleteMany", operator: "equals", value: 1 }] }, ctx);
    expect(r.ok).toBe(false);
    expect(Object.keys(CONDITION_FIELDS)).not.toContain("lead.organization.deleteMany");
  });

  test("unknown operator FAILS", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.priority", operator: "regex", value: ".*" }] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("not allowed");
  });

  test("operator not allowed for the field type FAILS (greater_than on enum)", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.priority", operator: "greater_than", value: 1 }] }, ctx);
    expect(r.ok).toBe(false);
  });

  test("wrong enum value FAILS", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.priority", operator: "equals", value: "EXTREME" }] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("Invalid value");
  });

  test("wrong value type on numeric field FAILS", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.estimatedValue", operator: "greater_than", value: "not-a-number" }] }, ctx);
    expect(r.ok).toBe(false);
  });

  test("org-scoped dynamic refs: unknown stage id FAILS", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.stageId", operator: "equals", value: "stage-2" }] }, ctx);
    expect(r.ok).toBe(false);
  });

  test("org-scoped dynamic refs: known stage id passes", () => {
    const r = validateConditionGroup({ all: [{ field: "lead.stageId", operator: "equals", value: "stage-1" }] }, ctx);
    expect(r.ok).toBe(true);
  });

  test("valid group passes", () => {
    const r = validateConditionGroup(
      { all: [{ field: "lead.priority", operator: "in", value: ["HIGH", "URGENT"] }] },
      ctx
    );
    expect(r.ok).toBe(true);
  });

  test("null conditions = always-true is valid", () => {
    expect(validateConditionGroup(null, ctx).ok).toBe(true);
  });

  test("mixing all+any FAILS (no nested trees, spec 8)", () => {
    const r = validateConditionGroup({ all: [], any: [] }, ctx);
    expect(r.ok).toBe(false);
  });
});

describe("action validation (spec 86, 67)", () => {
  const ctx = { userIds: ["user-1"] };

  test("no actions FAILS", () => {
    const r = validateAutomationActions([], ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0].toLowerCase()).toContain("at least one action");
  });

  test("unknown action type FAILS (whitelist, spec 16)", () => {
    const r = validateAutomationActions([{ type: "SEND_EMAIL", params: {} }], ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("unknown action type");
  });

  test("SEND_TELEGRAM / webhooks / custom JS are impossible", () => {
    for (const t of ["SEND_TELEGRAM", "SEND_WHATSAPP", "SMS", "WEBHOOK", "RUN_JAVASCRIPT", "AI_ACTION"]) {
      const r = validateAutomationActions([{ type: t, params: {} }], ctx);
      expect(r.ok).toBe(false);
    }
  });

  test("CREATE_TASK without title FAILS", () => {
    const r = validateAutomationActions([{ type: "CREATE_TASK", params: { assignTo: "LEAD_OWNER" } }], ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("title");
  });

  test("CREATE_TASK SPECIFIC_USER without userId FAILS", () => {
    const r = validateAutomationActions(
      [{ type: "CREATE_TASK", params: { title: "T", assignTo: "SPECIFIC_USER" } }],
      ctx
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("specific user");
  });

  test("CREATE_TASK SPECIFIC_USER with unknown user FAILS", () => {
    const r = validateAutomationActions(
      [{ type: "CREATE_TASK", params: { title: "T", assignTo: "SPECIFIC_USER", userId: "ghost" } }],
      ctx
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("unknown user");
  });

  test("SET_LEAD_PRIORITY with invalid enum FAILS", () => {
    const r = validateAutomationActions([{ type: "SET_LEAD_PRIORITY", params: { priority: "MAX" } }], ctx);
    expect(r.ok).toBe(false);
  });

  test("valid CREATE_TASK passes", () => {
    const r = validateAutomationActions(
      [{ type: "CREATE_TASK", params: { title: "Call {leadName}", dueInHours: 4, priority: "URGENT", assignTo: "LEAD_OWNER" } }],
      ctx
    );
    expect(r.ok).toBe(true);
  });

  test("all five MVP action types are valid shapes", () => {
    const r = validateAutomationActions(
      [
        { type: "CREATE_TASK", params: { title: "T", assignTo: "LEAD_OWNER" } },
        { type: "CREATE_NOTIFICATION", params: { recipient: "LEAD_OWNER", message: "M" } },
        { type: "SET_LEAD_PRIORITY", params: { priority: "HIGH" } },
        { type: "ASSIGN_LEAD", params: { assignTo: "ORGANIZATION_OWNER" } },
        { type: "ADD_NOTE", params: { content: "Note" } },
      ],
      ctx
    );
    expect(r.ok).toBe(true);
  });
});

describe("normalize + interpolation", () => {
  test("normalizeConditionGroup picks all/any", () => {
    expect(normalizeConditionGroup({ all: [] })).toEqual({ all: [] });
    expect(normalizeConditionGroup({ any: [{ field: "lead.priority", operator: "equals" }] })).toEqual({ any: [{ field: "lead.priority", operator: "equals" }] });
    expect(normalizeConditionGroup(null)).toBeNull();
    expect(normalizeConditionGroup({})).toBeNull();
  });

  test("interpolate replaces {leadName} placeholders", () => {
    expect(interpolate("Review {leadName} ({stageName})", { leadName: "AquaService", stageName: "Proposal" })).toBe(
      "Review AquaService (Proposal)"
    );
  });

  test("interpolate leaves unknown placeholders untouched", () => {
    expect(interpolate("Hello {who}", {})).toBe("Hello {who}");
  });
});
