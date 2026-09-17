import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, apiError, notFound } from "@/lib/leados/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const rows = await db.leadEvent.findMany({
      where: { leadId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok({ rows });
  } catch (e) {
    return apiError("events-list-failed", e);
  }
}
