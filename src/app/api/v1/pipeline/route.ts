import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";

export async function GET(_req: Request) {
  try {
    const session = await getSession();
    const pipelines = await db.pipeline.findMany({
      where: { organizationId: session.orgId },
      include: { stages: { orderBy: { position: "asc" } } },
      orderBy: { isDefault: "desc" },
    });
    const sources = await db.leadSource.findMany({ where: { organizationId: session.orgId }, orderBy: { position: "asc" } });
    return ok({ pipelines, sources });
  } catch (e) {
    return apiError("pipeline-list-failed", e);
  }
}
