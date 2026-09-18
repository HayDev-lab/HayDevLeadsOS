import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";

const Update = z.object({
  name: z.string().min(1).max(60).optional(),
  type: z.enum(["open", "won", "lost"]).optional(),
  color: z.string().optional(),
  position: z.number().int().min(0).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit stages");
    const { id } = await ctx.params;
    const stage = await db.pipelineStage.findUnique({ where: { id }, include: { pipeline: true } });
    if (!stage || stage.pipeline.organizationId !== session.orgId) return notFound("stage");
    const body = await parseJson(req);
    const v = Update.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const data: Record<string, unknown> = {};
    if (v.data.name !== undefined) data.name = v.data.name;
    if (v.data.type !== undefined) {
      data.type = v.data.type;
      data.isWon = v.data.type === "won";
      data.isLost = v.data.type === "lost";
    }
    if (v.data.color !== undefined) data.color = v.data.color;
    if (v.data.position !== undefined) data.position = v.data.position;
    const updated = await db.pipelineStage.update({ where: { id }, data });
    return ok({ stage: updated });
  } catch (e) {
    return apiError("stage-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot delete stages");
    const { id } = await ctx.params;
    const stage = await db.pipelineStage.findUnique({ where: { id }, include: { pipeline: true } });
    if (!stage || stage.pipeline.organizationId !== session.orgId) return notFound("stage");
    // prevent deleting if leads are in this stage
    const leadCount = await db.lead.count({ where: { stageId: id, status: { notIn: ["ARCHIVED"] } } });
    if (leadCount > 0) return badRequest(`Cannot delete: ${leadCount} active lead(s) are in this stage. Move them first.`);
    await db.pipelineStage.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return apiError("stage-delete-failed", e);
  }
}
