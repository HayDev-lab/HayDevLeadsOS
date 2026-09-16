import { NextResponse } from "next/server";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, serverError, notFound } from "@/lib/leados/api";
import { recalculateLeadScore } from "@/lib/leados/lead-score-service";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return ok({ error: "view-only" });
    const { id } = await ctx.params;
    const res = await recalculateLeadScore(session.orgId, id);
    return ok(res);
  } catch (e) {
    if ((e as Error).message === "LEAD_NOT_FOUND") return notFound("lead");
    return serverError("score-recalc-failed", e);
  }
}
