// USER DIRECTORY (v0.17): users of the ACTIVE organization via membership —
// powers assignee pickers. Direct user creation was replaced by the invite
// flow (spec 30); POST is intentionally gone.

import { db } from "@/lib/db";
import { ok, apiError } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.organizationMember.findMany({
      where: { organizationId: session.orgId, status: "ACTIVE" },
      include: {
        user: {
          select: { id: true, name: true, email: true, status: true, title: true, avatarColor: true, phone: true, createdAt: true },
        },
      },
      orderBy: [{ joinedAt: "asc" }],
    });
    return ok({
      rows: rows.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        status: m.user.status,
        title: m.user.title,
        avatarColor: m.user.avatarColor,
        phone: m.user.phone,
        createdAt: m.user.createdAt,
      })),
    });
  } catch (e) {
    return apiError("users-list-failed", e);
  }
}
