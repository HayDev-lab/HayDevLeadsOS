// HAYDEV LEADOS — SEMANTIC CODE UNIT TESTS (v0.20 §12).
//
// Pure-function proofs that renaming stages (Armenian/Russian/custom display
// names) does NOT change lost-detection or scoring behavior — both engines
// key on the stable PipelineStage.semanticCode, never the display name.

import { describe, expect, test } from "bun:test";
import { detectLeadFlags } from "../src/lib/leados/lost-detector";
import { computeScore } from "../src/lib/leados/scoring";
import { LOST_FLAG_REASON, STAGE_SEMANTIC } from "../src/lib/leados/constants";

const OLD = (h: number) => new Date(Date.now() - h * 3600_000);

describe("lost detector keys on semantic codes (§12)", () => {
  const base = {
    id: "l1",
    status: "NEW",
    stageType: "open",
    ownerId: "u1",
    priority: "MEDIUM",
    createdAt: OLD(72),
    lastContactAt: null as Date | null,
    lastActivityAt: null as Date | null,
    nextActionAt: null as Date | null,
  };

  test("renamed NEW stage (Armenian name) still triggers NO_CONTACT", () => {
    const flags = detectLeadFlags({
      ...base,
      stageName: "Նոր",
      stageSemanticCode: STAGE_SEMANTIC.NEW,
    });
    expect(flags.some((f) => f.reason === LOST_FLAG_REASON.NO_CONTACT)).toBe(true);
  });

  test("English-named NEW stage triggers the same flag (behavior identical)", () => {
    const flags = detectLeadFlags({
      ...base,
      stageName: "New",
      stageSemanticCode: STAGE_SEMANTIC.NEW,
    });
    expect(flags.some((f) => f.reason === LOST_FLAG_REASON.NO_CONTACT)).toBe(true);
  });

  test("renamed PROPOSAL stage (Russian name) still triggers PROPOSAL_NO_FOLLOWUP", () => {
    const flags = detectLeadFlags({
      ...base,
      status: "OPEN",
      stageName: "Предложение отправлено",
      stageSemanticCode: STAGE_SEMANTIC.PROPOSAL,
    });
    expect(flags.some((f) => f.reason === LOST_FLAG_REASON.PROPOSAL_NO_FOLLOWUP)).toBe(true);
  });

  test("NO_ACTIVITY excludes the NEW semantic regardless of name", () => {
    const flags = detectLeadFlags({
      ...base,
      status: "OPEN",
      stageName: "Whatever",
      stageSemanticCode: STAGE_SEMANTIC.NEW,
      lastActivityAt: OLD(200),
    });
    expect(flags.some((f) => f.reason === LOST_FLAG_REASON.NO_ACTIVITY)).toBe(false);
  });

  test("display name alone (no semantic code) NEVER drives a stage-specific flag", () => {
    // A stage DISPLAY-named "Proposal" but semantically CUSTOM must NOT
    // trigger the proposal-specific detector — semantics are authoritative.
    const flags = detectLeadFlags({
      ...base,
      status: "OPEN",
      stageName: "Proposal",
      stageSemanticCode: STAGE_SEMANTIC.CUSTOM,
    });
    expect(flags.some((f) => f.reason === LOST_FLAG_REASON.PROPOSAL_NO_FOLLOWUP)).toBe(false);
  });
});

describe("scoring keys on semantic codes (§12)", () => {
  const rules = [{ key: "meeting_requested", label: "Requested consultation/meeting", points: 15, enabled: true }];

  test("renamed MEETING stage still scores meeting_requested", () => {
    const r = computeScore({ stageSemanticCode: STAGE_SEMANTIC.MEETING }, rules);
    expect(r.components.map((c) => c.key)).toContain("meeting_requested");
  });

  test("renamed PROPOSAL stage (Armenian) still scores meeting_requested", () => {
    const r = computeScore({ stageSemanticCode: STAGE_SEMANTIC.PROPOSAL }, rules);
    expect(r.components.map((c) => c.key)).toContain("meeting_requested");
  });

  test("display-named 'Meeting' but semantically CUSTOM → no meeting points", () => {
    const r = computeScore({ stageName: "Meeting", stageSemanticCode: STAGE_SEMANTIC.CUSTOM }, rules);
    expect(r.components.map((c) => c.key)).not.toContain("meeting_requested");
  });
});
