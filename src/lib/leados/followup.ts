// Follow-up engine — deterministic "next action" recommendations + overdue checks.

import { FOLLOWUP } from "./constants";

export interface FollowupSuggestion {
  nextActionAt: Date;
  label: string;
  reason: string;
}

/** Suggest a next action when a lead moves to a stage. Pure helper. */
export function suggestNextAction(stageName: string, now: Date = new Date()): FollowupSuggestion {
  const h = (n: number) => new Date(now.getTime() + n * 3600_000);
  switch (stageName) {
    case "Contacted":
      return { nextActionAt: h(FOLLOWUP.NEW_LEAD_CONTACT_WINDOW_HOURS), label: "Follow up", reason: "Contacted — follow up within 24h" };
    case "Qualified":
      return { nextActionAt: h(48), label: "Schedule meeting", reason: "Qualified — propose a meeting" };
    case "Meeting":
      return { nextActionAt: h(4), label: "Send recap", reason: "After meeting — send recap & next step" };
    case "Proposal":
      return { nextActionAt: h(48), label: "Follow up on proposal", reason: "Proposal sent — follow up in 48h" };
    case "Negotiation":
      return { nextActionAt: h(48), label: "Push negotiation", reason: "Negotiation — confirm terms" };
    default:
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
