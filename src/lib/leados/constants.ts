// HAYDEV LEADOS — shared constants and type-safe enums (SQLite stores them as String).

export const ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  // Legacy pre-v0.17 values — normalized to MEMBER by the permission layer
  // and migrated in data by scripts/auth-backfill.ts.
  MANAGER: "MEMBER",
  SALES_MANAGER: "MEMBER",
  VIEWER: "VIEWER",
} as const;
export type Role = string;

export const ROLE_HIERARCHY: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 80,
  MANAGER: 50,
  SALES_MANAGER: 40,
  VIEWER: 10,
};

export const LEAD_STATUS = {
  NEW: "NEW",
  OPEN: "OPEN",
  CONTACTED: "CONTACTED",
  QUALIFIED: "QUALIFIED",
  WON: "WON",
  LOST: "LOST",
  ARCHIVED: "ARCHIVED",
} as const;
export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export const PRIORITY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const PRIORITY_RANK: Record<Priority, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export const SCORE_CATEGORY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;
export type ScoreCategory = (typeof SCORE_CATEGORY)[keyof typeof SCORE_CATEGORY];

export const STAGE_TYPE = {
  OPEN: "open",
  WON: "won",
  LOST: "lost",
} as const;

// v0.20 closure §12 — STABLE STAGE SEMANTICS.
//
// Business logic NEVER reads stage display names (user-renamable, localizable):
// it reads PipelineStage.semanticCode. Superset of the suggested core set
// (NEW/CONTACTED/QUALIFIED/OPEN/CUSTOM/WON/LOST): MEETING/PROPOSAL/
// NEGOTIATION exist because follow-up suggestions, lost-detection and scoring
// heuristics genuinely distinguish them and map 1:1 from the default stages.
export const STAGE_SEMANTIC = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  QUALIFIED: "QUALIFIED",
  MEETING: "MEETING",
  PROPOSAL: "PROPOSAL",
  NEGOTIATION: "NEGOTIATION",
  OPEN: "OPEN",
  CUSTOM: "CUSTOM",
  WON: "WON",
  LOST: "LOST",
} as const;
export type StageSemanticCode = (typeof STAGE_SEMANTIC)[keyof typeof STAGE_SEMANTIC];
export const STAGE_SEMANTIC_VALUES = [
  STAGE_SEMANTIC.NEW,
  STAGE_SEMANTIC.CONTACTED,
  STAGE_SEMANTIC.QUALIFIED,
  STAGE_SEMANTIC.MEETING,
  STAGE_SEMANTIC.PROPOSAL,
  STAGE_SEMANTIC.NEGOTIATION,
  STAGE_SEMANTIC.OPEN,
  STAGE_SEMANTIC.CUSTOM,
  STAGE_SEMANTIC.WON,
  STAGE_SEMANTIC.LOST,
] as const;

/** Derive Lead.status from stage SEMANTICS (never display names). Structural
 * type (won/lost) and semanticCode agree on final stages by invariant. */
export function statusFromStageSemantic(semanticCode: string, stageType: string): string {
  if (stageType === STAGE_TYPE.WON || semanticCode === STAGE_SEMANTIC.WON) return LEAD_STATUS.WON;
  if (stageType === STAGE_TYPE.LOST || semanticCode === STAGE_SEMANTIC.LOST) return LEAD_STATUS.LOST;
  switch (semanticCode) {
    case STAGE_SEMANTIC.NEW:
      return LEAD_STATUS.NEW;
    case STAGE_SEMANTIC.CONTACTED:
      return LEAD_STATUS.CONTACTED;
    case STAGE_SEMANTIC.QUALIFIED:
      return LEAD_STATUS.QUALIFIED;
    default:
      return LEAD_STATUS.OPEN;
  }
}

export const ACTIVITY_TYPE = {
  CALL: "CALL",
  MESSAGE: "MESSAGE",
  EMAIL: "EMAIL",
  NOTE: "NOTE",
  STATUS_CHANGE: "STATUS_CHANGE",
  ASSIGNMENT: "ASSIGNMENT",
  MEETING: "MEETING",
  FOLLOW_UP: "FOLLOW_UP",
  SYSTEM_EVENT: "SYSTEM_EVENT",
  AUDIT_IMPORT: "AUDIT_IMPORT",
  STAGE_CHANGE: "STAGE_CHANGE",
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

export const TASK_STATUS = {
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  CANCELLED: "CANCELLED",
} as const;
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_TYPE = {
  TASK: "TASK",
  FOLLOW_UP: "FOLLOW_UP",
} as const;
export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE];

export const LEAD_EVENT = {
  LEAD_CREATED: "LEAD_CREATED",
  LEAD_ASSIGNED: "LEAD_ASSIGNED",
  STAGE_CHANGED: "STAGE_CHANGED",
  LEAD_QUALIFIED: "LEAD_QUALIFIED",
  LEAD_WON: "LEAD_WON",
  LEAD_LOST: "LEAD_LOST",
  LEAD_ARCHIVED: "LEAD_ARCHIVED",
  LEAD_MERGED: "LEAD_MERGED",
  TASK_CREATED: "TASK_CREATED",
  TASK_OVERDUE: "TASK_OVERDUE",
  FOLLOW_UP_SCHEDULED: "FOLLOW_UP_SCHEDULED",
  FOLLOW_UP_COMPLETED: "FOLLOW_UP_COMPLETED",
  FOLLOW_UP_RESCHEDULED: "FOLLOW_UP_RESCHEDULED",
  FOLLOW_UP_CANCELLED: "FOLLOW_UP_CANCELLED",
  AUDIT_COMPLETED: "AUDIT_COMPLETED",
  NOTE_ADDED: "NOTE_ADDED",
  ACTIVITY_LOGGED: "ACTIVITY_LOGGED",
  CRM_SYNC: "CRM_SYNC",
} as const;
export type LeadEventType = (typeof LEAD_EVENT)[keyof typeof LEAD_EVENT];

export const CHANNELS = {
  PHONE: "PHONE",
  EMAIL: "EMAIL",
  WHATSAPP: "WHATSAPP",
  TELEGRAM: "TELEGRAM",
  MESSENGER: "MESSENGER",
  OTHER: "OTHER",
} as const;

export const INTEGRATION_EVENTS = {
  LEAD_CREATED: "lead.created",
  LEAD_ASSIGNED: "lead.assigned",
  LEAD_STAGE_CHANGED: "lead.stage_changed",
  LEAD_QUALIFIED: "lead.qualified",
  LEAD_WON: "lead.won",
  LEAD_LOST: "lead.lost",
  TASK_CREATED: "task.created",
  TASK_OVERDUE: "task.overdue",
  FOLLOW_UP_SCHEDULED: "followup.scheduled",
  FOLLOW_UP_COMPLETED: "followup.completed",
  FOLLOW_UP_RESCHEDULED: "followup.rescheduled",
  FOLLOW_UP_CANCELLED: "followup.cancelled",
  AUDIT_COMPLETED: "audit.completed",
} as const;

export const DEFAULT_SOURCES: { name: string; type: string }[] = [
  { name: "Website", type: "website" },
  { name: "Business Audit", type: "business_audit" },
  { name: "Instagram", type: "instagram" },
  { name: "Facebook", type: "facebook" },
  { name: "WhatsApp", type: "whatsapp" },
  { name: "Telegram", type: "telegram" },
  { name: "Google Ads", type: "google_ads" },
  { name: "Meta Ads", type: "meta_ads" },
  { name: "Referral", type: "referral" },
  { name: "Manual", type: "manual" },
  { name: "API", type: "api" },
  { name: "Email", type: "email" },
  { name: "Phone", type: "phone" },
  { name: "Other", type: "other" },
];

export const DEFAULT_STAGES: { name: string; type: string; color: string; semanticCode: string }[] = [
  { name: "New", type: "open", color: "#94a3b8", semanticCode: STAGE_SEMANTIC.NEW },
  { name: "Contacted", type: "open", color: "#64748b", semanticCode: STAGE_SEMANTIC.CONTACTED },
  { name: "Qualified", type: "open", color: "#0ea5e9", semanticCode: STAGE_SEMANTIC.QUALIFIED },
  { name: "Meeting", type: "open", color: "#8b5cf6", semanticCode: STAGE_SEMANTIC.MEETING },
  { name: "Proposal", type: "open", color: "#f59e0b", semanticCode: STAGE_SEMANTIC.PROPOSAL },
  { name: "Negotiation", type: "open", color: "#ec4899", semanticCode: STAGE_SEMANTIC.NEGOTIATION },
  { name: "Won", type: "won", color: "#16a34a", semanticCode: STAGE_SEMANTIC.WON },
  { name: "Lost", type: "lost", color: "#dc2626", semanticCode: STAGE_SEMANTIC.LOST },
];

export const DEFAULT_LOST_REASONS = [
  "No response",
  "Price",
  "Timing",
  "Competitor",
  "Not qualified",
  "Duplicate",
  "Spam",
  "Other",
];

export const DEFAULT_TAGS = [
  { name: "HIGH VALUE", color: "#dc2626" },
  { name: "ERP", color: "#8b5cf6" },
  { name: "AI AUTOMATION", color: "#0ea5e9" },
  { name: "WEBSITE", color: "#64748b" },
  { name: "URGENT", color: "#f59e0b" },
  { name: "RETAIL", color: "#16a34a" },
  { name: "CLINIC", color: "#ec4899" },
];

export const DEFAULT_SCORING_RULES: { key: string; label: string; points: number }[] = [
  { key: "audit_completed", label: "Business Audit completed", points: 25 },
  { key: "high_automation_potential", label: "High automation potential (≥60)", points: 15 },
  { key: "ai_readiness_high", label: "High AI readiness (≥70)", points: 10 },
  { key: "budget_indicated", label: "Budget indicated", points: 10 },
  { key: "urgency_high", label: "High urgency", points: 10 },
  { key: "meeting_requested", label: "Requested consultation/meeting", points: 15 },
  { key: "company_provided", label: "Company name provided", points: 5 },
  { key: "multi_channel_contact", label: "Multiple contact channels", points: 5 },
  { key: "source_quality", label: "High-quality source (referral/audit)", points: 10 },
];

export const LOST_FLAG_REASON = {
  NO_CONTACT: "no_contact",
  OVERDUE_FOLLOWUP: "overdue_followup",
  NO_ACTIVITY: "no_activity",
  PROPOSAL_NO_FOLLOWUP: "proposal_no_followup",
  MEETING_NO_NEXT: "meeting_no_next",
  UNASSIGNED: "unassigned",
} as const;
export type LostFlagReason = (typeof LOST_FLAG_REASON)[keyof typeof LOST_FLAG_REASON];

export const FOLLOWUP = {
  NEW_LEAD_CONTACT_WINDOW_HOURS: 24,
  INACTIVE_HOURS: 48,
  OVERDUE_HOURS: 0,
};

export const SCORE_THRESHOLDS = { LOW: 40, MEDIUM: 70 } as const;

export const LOCALES = ["hy", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "hy";

export function isHighRole(role: string): boolean {
  return ROLE_HIERARCHY[role as Role] >= ROLE_HIERARCHY.ADMIN;
}
