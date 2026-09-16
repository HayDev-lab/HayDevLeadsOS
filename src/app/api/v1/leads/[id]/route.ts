import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, validate, parseJson } from "@/lib/leados/api";
import { LeadUpdate } from "@/lib/schemas/lead";
import { updateLead, archiveLead } from "@/lib/leados/lead-service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({
      where: { id },
      include: {
        source: true,
        stage: { include: { pipeline: true } },
        owner: { select: { id: true, name: true, email: true, avatarColor: true } },
        leadTags: { include: { tag: true } },
        audits: true,
        scoreComponents: { orderBy: { createdAt: "asc" } },
        attributions: true,
        integrationSyncs: { orderBy: { createdAt: "desc" }, take: 5 },
        flags: { where: { resolvedAt: null } },
        customValues: { include: { field: true } },
      },
    });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    return ok({ lead });
  } catch (e) {
    return serverError("lead-get-failed", e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot mutate leads");
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const v = validate(LeadUpdate, body);
    if (!v.ok) return v.error;
    const updated = await updateLead(session.orgId, id, session.userId, v.value);
    return ok({ lead: updated });
  } catch (e) {
    if ((e as Error).message === "LEAD_NOT_FOUND") return notFound("lead");
    return serverError("lead-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot archive leads");
    const { id } = await ctx.params;
    const archived = await archiveLead(session.orgId, id, session.userId);
    return ok({ lead: archived });
  } catch (e) {
    if ((e as Error).message === "LEAD_NOT_FOUND") return notFound("lead");
    return serverError("lead-archive-failed", e);
  }
}
