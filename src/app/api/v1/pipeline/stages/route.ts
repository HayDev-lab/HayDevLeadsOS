import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson, validate } from "@/lib/leados/api";
import { z } from "zod";

const Create = z.object({
  pipelineId: z.string().min(1),
  name: z.string().min(1).max(60),
  type: z.enum(["open", "won", "lost"]).default("open"),
  color: z.string().optional(),
  position: z.number().int().min(0).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create stages");
    const body = await parseJson(req);
    const v = validate(Create, body);
    if (!v.ok) return v.error;
    // ensure pipeline belongs to org
    const pipeline = await db.pipeline.findUnique({ where: { id: v.value.pipelineId } });
    if (!pipeline || pipeline.organizationId !== session.orgId) return badRequest("pipeline-not-in-org");
    const count = await db.pipelineStage.count({ where: { pipelineId: v.value.pipelineId } });
    const stage = await db.pipelineStage.create({
      data: {
        pipelineId: v.value.pipelineId,
        name: v.value.name,
        type: v.value.type,
        color: v.value.color ?? "#94a3b8",
        position: v.value.position ?? count,
        isWon: v.value.type === "won",
        isLost: v.value.type === "lost",
      },
    });
    return ok({ stage });
  } catch (e) {
    return serverError("stage-create-failed", e);
  }
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const pipelineId = new URL(req.url).searchParams.get("pipelineId");
    if (!pipelineId) return ok({ rows: [] });
    const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId } });
    if (!pipeline || pipeline.organizationId !== session.orgId) return badRequest("pipeline-not-in-org");
    const rows = await db.pipelineStage.findMany({ where: { pipelineId }, orderBy: { position: "asc" } });
    return ok({ rows });
  } catch (e) {
    return serverError("stage-list-failed", e);
  }
}
