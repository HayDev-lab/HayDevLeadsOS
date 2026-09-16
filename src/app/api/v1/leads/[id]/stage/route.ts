import { NextResponse } from "next/server";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, validate, parseJson } from "@/lib/leados/api";
import { StageChange } from "@/lib/schemas/lead";
import { changeStage } from "@/lib/leados/lead-service";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot change stages");
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const v = validate(StageChange, body);
    if (!v.ok) return v.error;
    const lead = await changeStage(session.orgId, id, session.userId, v.value.stageId);
    return ok({ lead });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "LEAD_NOT_FOUND") return notFound("lead");
    if (m === "STAGE_NOT_FOUND") return notFound("stage");
    return serverError("stage-change-failed", e);
  }
}
