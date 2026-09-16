// Zod schemas for LeadOS payloads.

import { z } from "zod";

export const LeadCreate = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().max(80).optional(),
  company: z.string().max(160).optional(),
  position: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(160).optional(),
  preferredChannel: z.string().optional(),
  locale: z.string().max(8).optional(),
  sourceId: z.string().optional(),
  sourceType: z.string().optional(), // fallback when sourceId unknown — resolves by type
  sourceDetail: z.string().max(160).optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  estimatedValue: z.number().int().min(0).optional(),
  currency: z.string().max(8).optional(),
  summary: z.string().max(1000).optional(),
  requirements: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
  nextActionLabel: z.string().max(120).optional(),
  nextActionAt: z.string().optional(), // ISO
  externalId: z.string().max(120).optional(),
  utm: z
    .object({
      utm_source: z.string().optional(),
      utm_medium: z.string().optional(),
      utm_campaign: z.string().optional(),
      utm_content: z.string().optional(),
      utm_term: z.string().optional(),
      landing_page: z.string().optional(),
      referrer: z.string().optional(),
    })
    .optional(),
  note: z.string().max(2000).optional(), // initial note
  force: z.boolean().optional(), // skip duplicate check and create anyway
  meta: z.any().optional(),
});
export type LeadCreateT = z.infer<typeof LeadCreate>;

export const LeadUpdate = z.object({
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  company: z.string().max(160).optional(),
  position: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(160).optional(),
  preferredChannel: z.string().optional(),
  locale: z.string().max(8).optional(),
  sourceId: z.string().optional(),
  sourceDetail: z.string().max(160).optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  estimatedValue: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(8).optional(),
  summary: z.string().max(1000).optional(),
  requirements: z.string().max(2000).optional(),
  nextActionLabel: z.string().max(120).nullable().optional(),
  nextActionAt: z.string().nullable().optional(),
  lostReason: z.string().max(80).optional(),
  lostNotes: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
});
export type LeadUpdateT = z.infer<typeof LeadUpdate>;

export const StageChange = z.object({
  stageId: z.string().min(1),
});
export const Assign = z.object({
  ownerId: z.string().min(1),
});
export const Merge = z.object({
  sourceId: z.string().min(1),
});
export const TaskCreate = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  leadId: z.string().optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueAt: z.string().optional(),
});
export const NoteCreate = z.object({
  content: z.string().min(1).max(4000),
});
export const ActivityCreate = z.object({
  type: z.enum(["CALL", "MESSAGE", "EMAIL", "MEETING", "FOLLOW_UP", "NOTE"]),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
});
