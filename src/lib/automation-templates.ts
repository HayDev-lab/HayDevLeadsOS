// HAYDEV LEADOS — AUTOMATION RULE TEMPLATES (v0.15, spec 45–49).
//
// Templates are PREBUILT rule drafts the user explicitly chooses ("Use
// template") — they are NEVER auto-enabled for an organization. Template 4
// (LEAD_ASSIGNED → notify assignee) is intentionally absent: the standard
// Notification Projector already notifies the assignee, and a duplicate
// notification template would only create noise (spec 48).
//
// PURE module — shared by the UI gallery and the seed demo rules.

import type { ConditionGroup } from "./automation-conditions";
import type { AutomationAction } from "./automation-actions";

export interface AutomationRuleTemplate {
  id: string;
  /** i18n key for the template name. */
  nameKey: string;
  /** i18n key for the description. */
  descriptionKey: string;
  triggerType: string;
  conditions: ConditionGroup | null;
  actions: AutomationAction[];
}

export const AUTOMATION_TEMPLATES: AutomationRuleTemplate[] = [
  {
    id: "tpl-urgent-first-response",
    nameKey: "auto.tpl.fr_breach.name",
    descriptionKey: "auto.tpl.fr_breach.desc",
    triggerType: "FIRST_RESPONSE_BREACHED",
    conditions: null,
    actions: [
      {
        type: "CREATE_TASK",
        params: {
          title: "First response overdue — contact {leadName} now",
          description: "This lead has been waiting without a first response. Automated follow-up.",
          dueInHours: 4,
          priority: "URGENT",
          assignTo: "LEAD_OWNER",
        },
      },
    ],
  },
  {
    id: "tpl-escalate-high-priority-followup",
    nameKey: "auto.tpl.fu_overdue.name",
    descriptionKey: "auto.tpl.fu_overdue.desc",
    triggerType: "FOLLOW_UP_OVERDUE",
    conditions: {
      all: [{ field: "lead.priority", operator: "equals", value: "HIGH" }],
    },
    actions: [
      {
        type: "CREATE_NOTIFICATION",
        params: {
          recipient: "LEAD_OWNER",
          message: "High-priority follow-up is overdue for {leadName} — an urgent task was created.",
        },
      },
      {
        type: "CREATE_TASK",
        params: {
          title: "Escalation: overdue follow-up for {leadName}",
          dueInHours: 8,
          priority: "HIGH",
          assignTo: "LEAD_OWNER",
        },
      },
    ],
  },
  {
    id: "tpl-review-stalled-proposal",
    nameKey: "auto.tpl.stale_proposal.name",
    descriptionKey: "auto.tpl.stale_proposal.desc",
    triggerType: "STAGE_BECAME_STALE",
    conditions: {
      all: [{ field: "lead.stage.type", operator: "equals", value: "open" }],
    },
    actions: [
      {
        type: "CREATE_TASK",
        params: {
          title: "Review stalled proposal: {leadName}",
          description: "The deal has been in {stageName} longer than the allowed maximum.",
          dueInHours: 24,
          priority: "MEDIUM",
          assignTo: "LEAD_OWNER",
        },
      },
    ],
  },
];

export function templateById(id: string): AutomationRuleTemplate | null {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id) ?? null;
}
