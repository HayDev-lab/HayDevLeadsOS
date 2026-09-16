import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { syncLeadToErp } from "@/lib/leados/erp-adapter";
import { z } from "zod";

export async function GET(_req: Request) {
  try {
    const session = await getSession();
    const rows = await db.integrationSync.findMany({
      where: { organizationId: session.orgId },
      include: { lead: { select: { id: true, firstName: true, lastName: true, company: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const events = await db.integrationEvent.findMany({
      where: { organizationId: session.orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ok({ rows, events });
  } catch (e) {
    return serverError("erp-list-failed", e);
  }
}

const SyncBody = z.object({ leadId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot trigger ERP sync");
    const body = await parseJson(req);
    const v = SyncBody.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const record = await syncLeadToErp(v.data.leadId, session.orgId, session.userId);
    return ok({ sync: record });
  } catch (e) {
    if ((e as Error).message === "LEAD_NOT_FOUND") return notFound("lead");
    return serverError("erp-sync-failed", e);
  }
}
