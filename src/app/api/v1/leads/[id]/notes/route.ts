import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { NoteCreate } from "@/lib/schemas/lead";
import { LEAD_EVENT } from "@/lib/leados/constants";
import { publishEvent } from "@/lib/leados/events";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const rows = await db.note.findMany({
      where: { leadId: id },
      include: { user: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok({ rows });
  } catch (e) {
    return apiError("notes-list-failed", e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot add notes");
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const body = await parseJson(req);
    const v = validate(NoteCreate, body);
    if (!v.ok) return v.error;
    const note = await db.note.create({
      data: {
        organizationId: session.orgId,
        leadId: id,
        userId: session.userId,
        content: v.value.content,
      },
    });
    await publishEvent({
      orgId: session.orgId,
      leadId: id,
      userId: session.userId,
      type: LEAD_EVENT.NOTE_ADDED,
      payload: { noteId: note.id } as never,
    });
    return ok({ note });
  } catch (e) {
    return apiError("note-create-failed", e);
  }
}
