import { NextResponse } from "next/server";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { Merge } from "@/lib/schemas/lead";
import { mergeLeads } from "@/lib/leados/lead-service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot merge leads");
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const v = validate(Merge, body);
    if (!v.ok) return v.error;
    const target = await mergeLeads(session.orgId, id, v.value.sourceId, session.userId);
    return ok({ lead: target });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "SAME_LEAD") return badRequest("Cannot merge a lead into itself");
    if (m === "TARGET_NOT_FOUND" || m === "SOURCE_NOT_FOUND") return notFound("lead");
    return apiError("merge-failed", e);
  }
}
