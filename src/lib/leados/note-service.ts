// HAYDEV LEADOS — NOTE SERVICE (v0.15 + v0.16 idempotency).
//
// Extracted from POST /api/v1/leads/[id]/notes so the API route and the
// Automation Engine ADD_NOTE action share ONE business path (spec 18).

import { db } from "@/lib/db";
import { LEAD_EVENT } from "./constants";
import { publishEvent } from "./events";
import { getAutomationExecutionContext } from "./automation-context";

export async function createNote(
  orgId: string,
  leadId: string,
  userId: string | null,
  content: string,
  opts: {
    /** ACTION-LEVEL IDEMPOTENCY (v0.16 spec 15): set for automation-created
     *  notes so a retry after a crash reuses the row (Note unique). */
    actionIndex?: number | null;
  } = {}
) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { organizationId: true } });
  if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");
  const autoCtx = getAutomationExecutionContext();
  const note = await db.note.create({
    data: {
      organizationId: orgId,
      leadId,
      userId,
      content,
      automationExecutionId: autoCtx?.executionId ?? null,
      automationActionIndex: opts.actionIndex ?? null,
    },
  });
  await publishEvent({
    orgId,
    leadId,
    userId,
    type: LEAD_EVENT.NOTE_ADDED,
    payload: { noteId: note.id } as never,
  });
  return note;
}
