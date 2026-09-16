import { NextResponse } from "next/server";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound } from "@/lib/leados/api";
import { syncLeadToErp } from "@/lib/leados/erp-adapter";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot trigger ERP sync");
    const { id } = await ctx.params;
    const record = await syncLeadToErp(id, session.orgId, session.userId);
    return ok({ sync: record });
  } catch (e) {
    if ((e as Error).message === "LEAD_NOT_FOUND") return notFound("lead");
    return serverError("erp-sync-failed", e);
  }
}
