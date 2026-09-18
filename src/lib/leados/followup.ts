// Follow-up engine — deterministic "next action" recommendations + overdue checks.
//
// v0.20 §12: suggestions key on the STABLE stage SEMANTIC CODE, never the
// display name — renaming or localizing a stage does not change follow-up
// behavior.

import { FOLLOWUP, STAGE_SEMANTIC } from "./constants";

export interface FollowupSuggestion {
  nextActionAt: Date;
  label: string;
  reason: string;
}

/** Suggest a next action when a lead moves to a stage. Pure helper.
 * @param stageSemanticCode PipelineStage.semanticCode (NEW/CONTACTED/…) */
export function suggestNextAction(stageSemanticCode: string, now: Date = new Date()): FollowupSuggestion {
  const h = (n: number) => new Date(now.getTime() + n * 3600_000);
  switch (stageSemanticCode) {
    case STAGE_SEMANTIC.CONTACTED:
      return { nextActionAt: h(FOLLOWUP.NEW_LEAD_CONTACT_WINDOW_HOURS), label: "Follow up", reason: "Contacted — follow up within 24h" };
    case STAGE_SEMANTIC.QUALIFIED:
      return { nextActionAt: h(48), label: "Schedule meeting", reason: "Qualified — propose a meeting" };
    case STAGE_SEMANTIC.MEETING:
      return { nextActionAt: h(4), label: "Send recap", reason: "After meeting — send recap & next step" };
    case STAGE_SEMANTIC.PROPOSAL:
      return { nextActionAt: h(48), label: "Follow up on proposal", reason: "Proposal sent — follow up in 48h" };
    case STAGE_SEMANTIC.NEGOTIATION:
      return { nextActionAt: h(48), label: "Push negotiation", reason: "Negotiation — confirm terms" };
    default:
      // NEW / OPEN / CUSTOM / unknown → first-contact cadence.
      return { nextActionAt: h(24), label: "Initial contact", reason: "New lead — make first contact" };
  }
}

export function hoursSince(date: Date | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  return Math.max(0, (now.getTime() - new Date(date).getTime()) / 3600_000);
}

export function isOverdue(nextActionAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!nextActionAt) return false;
  return new Date(nextActionAt).getTime() < now.getTime();
}
