import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";
import { runLostDetector, getActiveFlags, FLAG_REASON_LABEL } from "@/lib/leados/lost-detector-service";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await getSession();
    const flags = await getActiveFlags(session.orgId);
    const leadsNeedingAttention = new Set(flags.map((f) => f.leadId)).size;
    return ok({ flags, leadsNeedingAttention, labels: FLAG_REASON_LABEL, total: flags.length });
  } catch (e) {
    return serverError("lost-detector-get-failed", e);
  }
}

export async function POST() {
  try {
    const session = await getSession();
    const result = await runLostDetector(session.orgId);
    // attach lead summaries for the UI
    const leadIds = Array.from(new Set(result.flags.map((f) => f.leadId)));
    const leads = leadIds.length
      ? await db.lead.findMany({
          where: { id: { in: leadIds } },
          include: { stage: true, owner: { select: { id: true, name: true, avatarColor: true } }, source: true },
        })
      : [];
    return ok({ ...result, leads });
  } catch (e) {
    return serverError("lost-detector-run-failed", e);
  }
}
