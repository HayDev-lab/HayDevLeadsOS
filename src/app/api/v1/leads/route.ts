import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, validate, qInt, qStr, qArr, qBool, paginate, parseJson } from "@/lib/leados/api";
import { LeadCreate } from "@/lib/schemas/lead";
import { createLead } from "@/lib/leados/lead-service";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";
import { PRIORITY } from "@/lib/leados/constants";

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
    const allowed = ["createdAt", "updatedAt", "leadScore", "priority", "estimatedValue", "nextActionAt", "lastContactAt"];
    const orderBy: Record<string, "asc" | "desc"> = {};
    orderBy[allowed.includes(sortField) ? sortField : "createdAt"] = sortDir;

    const [total, rows] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        include: {
          source: true,
          stage: true,
          owner: { select: { id: true, name: true, avatarColor: true } },
          leadTags: { include: { tag: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return ok({ rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
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
