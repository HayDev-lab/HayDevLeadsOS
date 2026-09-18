import { NextResponse } from "next/server";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound } from "@/lib/leados/api";
import { restoreLead } from "@/lib/leados/lead-service";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot restore leads");
    const { id } = await ctx.params;
    const lead = await restoreLead(session.orgId, id, session.userId);
    return ok({ lead });
  } catch (e) {
    if ((e as Error).message === "LEAD_NOT_FOUND") return notFound("lead");
    return apiError("restore-failed", e);
  }
}
