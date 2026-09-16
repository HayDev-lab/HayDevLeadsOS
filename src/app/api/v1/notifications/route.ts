import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, badRequest, serverError } from "@/lib/leados/api";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.notification.findMany({
      where: { organizationId: session.orgId, OR: [{ userId: session.userId }, { userId: null }] },
      include: { lead: { select: { id: true, firstName: true, lastName: true, company: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const unread = await db.notification.count({ where: { organizationId: session.orgId, userId: session.userId, read: false } });
    return ok({ rows, unread });
  } catch (e) {
    return serverError("notifications-list-failed", e);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    const body = await req.json().catch(() => ({}));
    const { id, all } = body as { id?: string; all?: boolean };
    if (all) {
      await db.notification.updateMany({ where: { organizationId: session.orgId, userId: session.userId, read: false }, data: { read: true } });
      return ok({ ok: true });
    }
    if (!id) return badRequest("id-required");
    await db.notification.updateMany({ where: { id, organizationId: session.orgId, userId: session.userId }, data: { read: true } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("notification-update-failed", e);
  }
}
