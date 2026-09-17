import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { detectDuplicates } from "@/lib/leados/duplicate";
import { db } from "@/lib/db";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { phone: true, email: true, externalId: true, organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return ok({ hasDuplicates: false, matches: [] });
    const result = await detectDuplicates(session.orgId, {
      phone: lead.phone,
      email: lead.email,
      externalId: lead.externalId,
      excludeLeadId: id,
    });
    return ok(result);
  } catch (e) {
    return apiError("duplicate-check-failed", e);
  }
}
