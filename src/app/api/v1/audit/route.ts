// SECURITY AUDIT LOG (v0.17 spec 56): read-only, OWNER/ADMIN (AUDIT_READ).
// Append-only — no write endpoints exist; rows are never shown with secrets.

import { db } from "@/lib/db";
import { ok, apiError, qInt } from "@/lib/leados/api";
import { getSession, requirePermission, PERMISSIONS } from "@/lib/leados/context";
import { AUDIT_ACTIONS } from "@/lib/leados/auth/audit";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.AUDIT_READ);
    const url = new URL(req.url);
    const page = Math.max(1, qInt(url.searchParams.get("page")) ?? 1);
    const limit = Math.min(200, Math.max(1, qInt(url.searchParams.get("limit")) ?? 50));
    const action = url.searchParams.get("action");
    const actorUserId = url.searchParams.get("actorUserId");

    const where = {
      organizationId: session.orgId,
      ...(action ? { action } : {}),
      ...(actorUserId ? { actorUserId } : {}),
    };

    const [rows, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { name: true, email: true } } },
      }),
      db.auditLog.count({ where }),
    ]);

    return ok({
      rows: rows.map((r) => ({
        id: r.id,
        actor: r.user?.name ?? r.actorType,
        actorType: r.actorType,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        metadata: r.metadata,
        ip: r.ip,
        createdAt: r.createdAt,
      })),
      total,
      page,
      availableActions: Object.values(AUDIT_ACTIONS),
    });
  } catch (e) {
    return apiError("audit-list-failed", e);
  }
}
