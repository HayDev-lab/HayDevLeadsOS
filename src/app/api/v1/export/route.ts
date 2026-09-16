import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { serverError } from "@/lib/leados/api";
import { toCsv } from "@/lib/leados/attribution";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";
import { SLA_STATUS, computeFirstResponseSla, type SlaStatus } from "@/lib/sla";
import { getFirstResponseMap, getSlaThresholds, slaFilterWhere } from "@/lib/leados/sla-service";
import { FOLLOWUP_SLA_STATUS, computeFollowUpSla, type FollowUpSlaStatus } from "@/lib/sla-followup";
import {
  followUpFilterWhere,
  followUpTodayFilterWhere,
  getFollowUpConfig,
  getFollowUpTaskMap,
} from "@/lib/leados/followup-sla-service";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const p = new URL(req.url).searchParams;
    const where: Record<string, unknown> = { organizationId: session.orgId, status: { not: "ARCHIVED" } };
    const sourceId = p.get("sourceId");
    const ownerId = p.get("ownerId");
    const stageId = p.get("stageId");
    const priority = p.getAll("priority");
    const q = p.get("q");
    if (sourceId) where.sourceId = sourceId;
    if (ownerId) where.ownerId = ownerId;
    if (stageId) where.stageId = stageId;
    if (priority.length) where.priority = { in: priority };
    // Server-side SLA filter (same engine as the lead list).
    const slaStatus = p.get("sla");
    const slaThresholds = await getSlaThresholds(session.orgId);
    if (slaStatus) {
      const upper = slaStatus.toUpperCase();
      if (upper in SLA_STATUS) {
        const frag = slaFilterWhere(upper as SlaStatus, slaThresholds);
        where.AND = [...((where.AND as unknown[]) ?? []), ...(Array.isArray(frag.AND) ? frag.AND : [frag])] as never;
      }
    }
    // Server-side FOLLOW-UP filter (same engine as the lead list).
    const followUpStatus = p.get("followUp");
    const followUpConfig = await getFollowUpConfig(session.orgId);
    if (followUpStatus) {
      const upper = followUpStatus.toUpperCase();
      const frag =
        upper === "TODAY"
          ? followUpTodayFilterWhere(session.organization.timezone)
          : upper in FOLLOWUP_SLA_STATUS || upper === "NONE"
          ? followUpFilterWhere(upper as FollowUpSlaStatus | "NONE", followUpConfig.warningBeforeHours)
          : null;
      if (frag) {
        where.AND = [...((where.AND as unknown[]) ?? []), ...(Array.isArray(frag.AND) ? frag.AND : [frag])] as never;
      }
    }
    if (q) {
      const nPhone = normalizePhone(q);
      const nEmail = normalizeEmail(q);
      where.OR = [
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { company: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        ...(nPhone ? [{ normalizedPhone: nPhone }] : []),
        ...(nEmail ? [{ normalizedEmail: nEmail }] : []),
      ];
    }
    const rows = await db.lead.findMany({
      where,
      include: { stage: true, source: true, owner: { select: { name: true } }, leadTags: { include: { tag: true } }, customValues: { include: { field: true } }, attributions: { take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
    // First-response SLA per exported row (one grouped query — no N+1).
    const firstResponseMap = await getFirstResponseMap(session.orgId, rows.map((r) => r.id));
    const taskMap = await getFollowUpTaskMap(session.orgId, rows.map((r) => r.id));
    const now = new Date();
    const exportRows = rows.map((l) => {
      const sla = computeFirstResponseSla(
        { createdAt: l.createdAt, firstResponseAt: firstResponseMap.get(l.id) ?? null },
        slaThresholds,
        now
      );
      const pair = taskMap.get(l.id) ?? { open: null, lastCompleted: null };
      const fu = computeFollowUpSla(
        {
          leadStatus: l.status,
          firstResponseAt: firstResponseMap.get(l.id) ?? null,
          openTask: pair.open,
          lastCompleted: pair.lastCompleted,
        },
        followUpConfig,
        now
      );
      const base: Record<string, unknown> = {
        firstName: l.firstName ?? "",
        lastName: l.lastName ?? "",
        company: l.company ?? "",
        phone: l.phone ?? "",
        email: l.email ?? "",
        source: l.source?.name ?? "",
        stage: l.stage?.name ?? "",
        status: l.status,
        priority: l.priority,
        score: l.leadScore,
        owner: l.owner?.name ?? "",
        estimatedValue: l.estimatedValue ?? "",
        currency: l.currency ?? "",
      summary: l.summary ?? "",
      nextActionAt: l.nextActionAt ? new Date(l.nextActionAt).toISOString() : "",
      lastContactAt: l.lastContactAt ? new Date(l.lastContactAt).toISOString() : "",
      tags: l.leadTags.map((t) => t.tag.name).join("; "),
      utmSource: l.attributions[0]?.utmSource ?? "",
      utmCampaign: l.attributions[0]?.utmCampaign ?? "",
      createdAt: new Date(l.createdAt).toISOString(),
      slaStatus: sla.status,
      slaElapsedMinutes: sla.isResponded ? "" : sla.elapsedMinutes,
      slaFirstResponseMinutes: sla.responseMinutes ?? "",
      followUpStatus: fu.status,
      followUpDueAt: fu.dueAt ? new Date(fu.dueAt).toISOString() : "",
      followUpOverdueMinutes: fu.overdueMinutes ?? "",
      followUpCompletedAt: fu.completedAt ? new Date(fu.completedAt).toISOString() : "",
      };
      // append custom field values as columns
      for (const cv of l.customValues) {
        const key = `cf_${cv.field.key}`;
        if (cv.valueText != null) base[key] = cv.valueText;
        else if (cv.valueNumber != null) base[key] = cv.valueNumber;
        else if (cv.valueBool != null) base[key] = cv.valueBool;
        else if (cv.valueDate != null) base[key] = new Date(cv.valueDate).toISOString().slice(0, 10);
        else base[key] = "";
      }
      return base;
    });
    const csv = toCsv(exportRows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leados-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    return serverError("export-failed", e);
  }
}
