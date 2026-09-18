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
    const audits = await db.businessAudit.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
    });
    return ok({ audits });
  } catch (e) {
    return apiError("audit-list-failed", e);
  }
}
