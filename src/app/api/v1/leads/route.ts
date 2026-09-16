import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, validate, qInt, qStr, qArr, qBool, paginate, parseJson } from "@/lib/leados/api";
import { LeadCreate } from "@/lib/schemas/lead";
import { createLead } from "@/lib/leados/lead-service";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";
import { PRIORITY } from "@/lib/leados/constants";
import { SLA_STATUS, type SlaStatus } from "@/lib/sla";
import { attachSlaToLeads, getFirstResponseMap, getSlaThresholds, slaFilterWhere, sortLeadIdsBySlaPriority } from "@/lib/leados/sla-service";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const p = url.searchParams;
    const { page, limit, skip } = paginate(qInt(p.get("page")), qInt(p.get("limit")));
    const q = qStr(p.get("q"));
    const sourceId = qStr(p.get("sourceId"));
    const sourceType = qStr(p.get("sourceType"));
    const ownerId = qStr(p.get("ownerId"));
    const stageId = qStr(p.get("stageId"));
    const priority = qArr(p.get("priority"));
    const tags = qArr(p.get("tags"));
    const status = qArr(p.get("status"));
    const overdue = qBool(p.get("overdue"));
    const unassigned = qBool(p.get("unassigned"));
    const includeArchived = qBool(p.get("archived"));
    const dateFrom = qStr(p.get("dateFrom"));
    const dateTo = qStr(p.get("dateTo"));
    const slaStatus = qStr(p.get("sla"));
    const sort = qStr(p.get("sort")) ?? "createdAt:desc";

    const where: Record<string, unknown> = { organizationId: session.orgId };
    if (!includeArchived) where.status = { not: "ARCHIVED" };
    if (status) where.status = { in: status };
    if (sourceId) where.sourceId = sourceId;
    if (sourceType) where.source = { type: sourceType };
    if (ownerId) where.ownerId = ownerId;
    if (stageId) where.stageId = stageId;
    if (priority) where.priority = { in: priority };
    if (unassigned) where.ownerId = null;
    if (overdue) where.nextActionAt = { lt: new Date() };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
    }
    if (tags?.length) {
      where.leadTags = { some: { tag: { name: { in: tags } } } };
    }

    // SLA thresholds are resolved ONCE per request (never per lead).
    const slaThresholds = await getSlaThresholds(session.orgId);

    // Server-side SLA filter — works on the FULL dataset (with pagination/counts).
    if (slaStatus) {
      const upper = slaStatus.toUpperCase();
      if (!(upper in SLA_STATUS)) return badRequest(`Unknown SLA filter: ${slaStatus}`);
      const frag = slaFilterWhere(upper as SlaStatus, slaThresholds);
      where.AND = [...((where.AND as unknown[]) ?? []), ...(Array.isArray(frag.AND) ? frag.AND : [frag])] as never;
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

    const [sortField, sortDirRaw] = sort.split(":");
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";
    const isSlaSort = sortField === "sla" || sort === "sla:priority";
    const allowed = ["createdAt", "updatedAt", "leadScore", "priority", "estimatedValue", "nextActionAt", "lastContactAt"];
    const orderBy: Record<string, "asc" | "desc"> = {};
    if (!isSlaSort) orderBy[allowed.includes(sortField) ? sortField : "createdAt"] = sortDir;

    const include = {
      source: true,
      stage: true,
      owner: { select: { id: true, name: true, avatarColor: true } },
      leadTags: { include: { tag: true } },
    };

    let rows;
    let total: number;
    let firstResponseMap = new Map<string, Date>();

    if (isSlaSort) {
      // Default SLA priority order (BREACH → WARNING → TARGET → RESPONDED).
      // Two-phase: rank ALL filtered leads cheaply, hydrate only the page.
      const ranked = await sortLeadIdsBySlaPriority(session.orgId, where, slaThresholds, page, limit);
      total = ranked.total;
      firstResponseMap = ranked.firstResponseMap;
      if (ranked.ids.length) {
        const hydrated = await db.lead.findMany({ where: { ...where, id: { in: ranked.ids } }, include });
        const byId = new Map(hydrated.map((r) => [r.id, r]));
        rows = ranked.ids.map((id) => byId.get(id)).filter(Boolean) as typeof hydrated;
      } else {
        rows = [];
      }
    } else {
      [total, rows] = await Promise.all([
        db.lead.count({ where }),
        db.lead.findMany({ where, include, orderBy, skip, take: limit }),
      ]);
      firstResponseMap = await getFirstResponseMap(session.orgId, rows.map((r) => r.id));
    }

    // Attach SLA to every row (computed by the single engine, N+1-safe).
    const withSla = attachSlaToLeads(rows, slaThresholds, firstResponseMap);

    return ok({
      rows: withSla,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      slaConfig: slaThresholds,
    });
  } catch (e) {
    return serverError("leads-list-failed", e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const body = await parseJson(req);
    const v = validate(LeadCreate, body);
    if (!v.ok) return v.error;
    const result = await createLead(session.orgId, session.userId, v.value);
    return ok({ lead: result.lead, duplicate: result.duplicate, created: result.created });
  } catch (e) {
    return serverError("lead-create-failed", e);
  }
}
