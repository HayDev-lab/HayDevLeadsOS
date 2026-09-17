// POST /api/v1/deliveries/:id/retry — MANUAL RETRY (v0.16 spec 63).
// OWNER/ADMIN: resets a FAILED/SKIPPED delivery to PENDING — the next worker
// pass picks it up regardless of attemptCount (manual action, not the bounded
// automatic retry loop).
import { getSession, canManage } from "@/lib/leados/context";
import { ok, forbidden, notFound, serverError } from "@/lib/leados/api";
import { manuallyRetryDelivery } from "@/lib/leados/delivery/delivery-worker";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canManage(session.role)) return forbidden("Only owners and admins retry deliveries");
    const { id } = await params;
    const result = await manuallyRetryDelivery(session.orgId, id);
    if (!result.ok) return notFound(result.error ?? "Delivery not found");
    return ok({ ok: true });
  } catch (e) {
    return serverError("delivery-retry-failed", e);
  }
}
