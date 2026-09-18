// LOST LEAD DETECTOR — deterministic rule engine. NOT "AI".
// Inspects each active lead and produces flags explaining why it needs attention.

import { FOLLOWUP, LOST_FLAG_REASON, PRIORITY, STAGE_SEMANTIC, type LostFlagReason } from "./constants";
import { hoursSince, isOverdue } from "./followup";

export interface DetectorLeadInput {
  id: string;
  status: string;
  stageType: string;
  /** Display name — informational only, NEVER used for decisions (§12). */
  stageName?: string | null;
  /** Stable semantic code — drives all detector decisions (§12). */
  stageSemanticCode?: string | null;
  ownerId?: string | null;
  priority: string;
  createdAt: Date | string;
  lastContactAt?: Date | string | null;
  lastActivityAt?: Date | string | null;
  nextActionAt?: Date | string | null;
}

export interface DetectedFlag {
  leadId: string;
  reason: LostFlagReason;
  message: string;
  severity: "info" | "warning" | "critical";
}

const NOW = () => new Date();

function date(d: Date | string | null | undefined): Date | null {
  return d ? new Date(d) : null;
}

/** Inspect a single lead and return any flags. */
export function detectLeadFlags(lead: DetectorLeadInput, now: Date = NOW()): DetectedFlag[] {
  const flags: DetectedFlag[] = [];

  // Only inspect active (open) leads — won/lost/archived are not "lost candidates"
  if (lead.status === "WON" || lead.status === "LOST" || lead.status === "ARCHIVED") {
    return flags;
  }

  const created = date(lead.createdAt);
  const lastContact = date(lead.lastContactAt);
  const lastActivity = date(lead.lastActivityAt);
  const next = date(lead.nextActionAt);

  const isUrgent = lead.priority === PRIORITY.URGENT || lead.priority === PRIORITY.HIGH;

  // 1. Unassigned
  if (!lead.ownerId) {
    flags.push({
      leadId: lead.id,
      reason: LOST_FLAG_REASON.UNASSIGNED,
      message: "Lead is unassigned",
      severity: isUrgent ? "critical" : "warning",
    });
  }

  // 2. New lead with no contact past the contact window
  const sinceCreatedH = hoursSince(created, now);
  const sinceContactH = hoursSince(lastContact, now);
  if (lead.status === "NEW" || lead.stageSemanticCode === STAGE_SEMANTIC.NEW) {
    if (sinceContactH == null && sinceCreatedH != null && sinceCreatedH > FOLLOWUP.NEW_LEAD_CONTACT_WINDOW_HOURS) {
      flags.push({
        leadId: lead.id,
        reason: LOST_FLAG_REASON.NO_CONTACT,
        message: "New lead, not contacted yet",
        severity: isUrgent ? "critical" : "warning",
      });
    }
  }

  // 3. Overdue follow-up (nextActionAt in the past)
  if (isOverdue(next, now)) {
    flags.push({
      leadId: lead.id,
      reason: LOST_FLAG_REASON.OVERDUE_FOLLOWUP,
      message: "Follow-up is overdue",
      severity: isUrgent ? "critical" : "warning",
    });
  }

  // 4. No activity for X hours in an active (open) pipeline stage
  const sinceActivityH = hoursSince(lastActivity ?? lastContact, now);
  if (
    lead.stageType === "open" &&
    lead.stageSemanticCode !== STAGE_SEMANTIC.NEW &&
    sinceActivityH != null &&
    sinceActivityH > FOLLOWUP.INACTIVE_HOURS
  ) {
    flags.push({
      leadId: lead.id,
      reason: LOST_FLAG_REASON.NO_ACTIVITY,
      message: `No activity for ${Math.round(sinceActivityH)}h`,
      severity: "warning",
    });
  }

  // 5. Proposal sent without a follow-up
  if (lead.stageSemanticCode === STAGE_SEMANTIC.PROPOSAL) {
    if (!next || isOverdue(next, now)) {
      flags.push({
        leadId: lead.id,
        reason: LOST_FLAG_REASON.PROPOSAL_NO_FOLLOWUP,
        message: "Proposal sent, no follow-up scheduled",
        severity: "warning",
      });
    }
  }

  // 6. Meeting completed without a next action
  if (lead.stageSemanticCode === STAGE_SEMANTIC.MEETING) {
    if (!next) {
      flags.push({
        leadId: lead.id,
        reason: LOST_FLAG_REASON.MEETING_NO_NEXT,
        message: "Meeting completed, no next action",
        severity: "info",
      });
    }
  }

  return flags;
}

/** Summarize flags by reason for dashboard counts. */
export function summarizeFlags(flags: DetectedFlag[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of flags) out[f.reason] = (out[f.reason] ?? 0) + 1;
  return out;
}
