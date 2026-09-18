// Explainable, configurable lead scoring. Deterministic — no random values.
// Returns score 0-100, category, and the list of contributing reasons with signed deltas.

import { SCORE_CATEGORY, SCORE_THRESHOLDS, type ScoreCategory } from "./constants";

export interface ScoreRule {
  key: string;
  label: string;
  points: number;
  enabled: boolean;
}

export interface ScoreInput {
  audit?: { automation: number; aiReadiness: number; acquisition?: number; sales?: number } | null;
  estimatedValue?: number | null;
  priority?: string | null;
  stageType?: string | null;
  stageName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  sourceType?: string | null;
  hasMeetingRequestFlag?: boolean;
  hasBudgetFlag?: boolean;
}

export interface ScoreComponent {
  key: string;
  reason: string;
  delta: number;
}

export interface ScoreResult {
  score: number;
  category: ScoreCategory;
  components: ScoreComponent[];
}

/** Map a raw score to a category band. */
export function categoryFor(score: number): ScoreCategory {
  if (score >= SCORE_THRESHOLDS.MEDIUM) return SCORE_CATEGORY.HIGH;
  if (score >= SCORE_THRESHOLDS.LOW) return SCORE_CATEGORY.MEDIUM;
  return SCORE_CATEGORY.LOW;
}

/**
 * Compute the lead score against a set of enabled rules.
 * Pure function — deterministic given the same inputs.
 */
export function computeScore(input: ScoreInput, rules: ScoreRule[]): ScoreResult {
  const enabled = new Map(rules.filter((r) => r.enabled).map((r) => [r.key, r]));
  const components: ScoreComponent[] = [];

  const add = (key: string, reason: string, delta: number) => {
    const rule = enabled.get(key);
    if (!rule || delta === 0) return;
    components.push({ key, reason: rule.label || reason, delta: rule.points > 0 ? rule.points : delta });
  };

  if (input.audit) {
    add("audit_completed", "Business Audit completed", 25);
    if ((input.audit.automation ?? 0) >= 60) add("high_automation_potential", "High automation potential", 15);
    if ((input.audit.aiReadiness ?? 0) >= 70) add("ai_readiness_high", "High AI readiness", 10);
  }
  if (input.hasBudgetFlag || (input.estimatedValue != null && input.estimatedValue > 0)) {
    add("budget_indicated", "Budget indicated", 10);
  }
  if (input.priority === "URGENT" || input.priority === "HIGH") {
    add("urgency_high", "High urgency", 10);
  }
  if (input.hasMeetingRequestFlag || input.stageName === "Meeting" || input.stageName === "Proposal") {
    add("meeting_requested", "Requested consultation/meeting", 15);
  }
  if (input.company) {
    add("company_provided", "Company name provided", 5);
  }
  if (input.phone && input.email) {
    add("multi_channel_contact", "Multiple contact channels", 5);
  }
  if (input.sourceType === "referral" || input.sourceType === "business_audit") {
    add("source_quality", "High-quality source", 10);
  }

  let score = 0;
  for (const c of components) score += c.delta > 0 ? c.delta : 0;
  // negative deltas are possible if we add penalty rules later — keep them for explanation
  const negatives = components.filter((c) => c.delta < 0);
  for (const c of negatives) score += c.delta;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, category: categoryFor(score), components };
}

/** Human-readable reasons list for the UI (e.g. "+ Business Audit completed"). */
export function explainScore(result: ScoreResult): string[] {
  return result.components.map((c) => `${c.delta > 0 ? "+" : ""}${c.delta} ${c.reason}`);
}
