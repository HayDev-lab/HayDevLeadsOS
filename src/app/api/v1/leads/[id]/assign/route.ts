import { NextResponse } from "next/server";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, validate, parseJson } from "@/lib/leados/api";
import { Assign } from "@/lib/schemas/lead";
import { assignLead } from "@/lib/leados/lead-service";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot assign leads");
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const v = validate(Assign, body);
    if (!v.ok) return v.error;
    const lead = await assignLead(session.orgId, id, session.userId, v.value.ownerId);
    return ok({ lead });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "LEAD_NOT_FOUND") return notFound("lead");
    if (m === "USER_NOT_FOUND") return notFound("user");
    return serverError("assign-failed", e);
  }
}
