import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";

// Returns the default pipeline grouped by stage with lead cards for the Kanban.
export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));

    const pipeline = await db.pipeline.findFirst({
      where: { organizationId: session.orgId, isDefault: true },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    if (!pipeline) return ok({ pipeline: null, columns: [], totals: { leads: 0, estValue: 0 } });

    const stages = pipeline.stages;
    const leads = await db.lead.findMany({
      where: { organizationId: session.orgId, pipelineId: pipeline.id, status: { not: "ARCHIVED" } },
      include: {
        owner: { select: { id: true, name: true, avatarColor: true } },
        source: { select: { id: true, name: true, type: true } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: limit * stages.length,
    });

    const columns = stages.map((s) => ({
      id: s.id,
      pipelineId: s.pipelineId,
      name: s.name,
      position: s.position,
      type: s.type,
      color: s.color,
      isWon: s.isWon,
      isLost: s.isLost,
      leads: leads.filter((l) => l.stageId === s.id),
    }));

    const estValue = leads.reduce((acc, l) => acc + (l.estimatedValue ?? 0), 0);
    return ok({
      pipeline: { id: pipeline.id, name: pipeline.name },
      columns,
      totals: { leads: leads.length, estValue },
    });
  } catch (e) {
    return serverError("kanban-failed", e);
  }
}
