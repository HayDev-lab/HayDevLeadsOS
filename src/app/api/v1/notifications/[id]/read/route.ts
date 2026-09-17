// PATCH /api/v1/notifications/:id/read — mark ONE notification read for the
// current recipient (Section 37/71: recipient identity comes from the session).
import { getSession } from "@/lib/leados/context";
import { ok, notFound, serverError } from "@/lib/leados/api";
import { markNotificationRead } from "@/lib/leados/notification-service";

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const marked = await markNotificationRead(session.orgId, session.userId, id);
    if (!marked) return notFound("notification");
    return ok({ ok: true });
  } catch (e) {
    return serverError("notification-read-failed", e);
  }
}
