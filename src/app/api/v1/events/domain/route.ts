// GET /api/v1/events/domain — DEV-ONLY event inspector (spec Section 86):
// type / entity / dedup key / occurredAt for QA. Tenant-scoped, paginated.
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { listDomainEvents } from "@/lib/leados/domain-event-service";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const type = url.searchParams.get("type") ?? undefined;
    const { rows, total } = await listDomainEvents(session.orgId, { page, limit, type });
    return ok({
      rows: rows.map((e) => ({
        id: e.id,
        type: e.type,
        entityType: e.entityType,
        entityId: e.entityId,
        occurredAt: e.occurredAt,
        deduplicationKey: e.deduplicationKey,
        processedAt: e.processedAt,
        payload: e.payload,
      })),
      total,
      page,
      limit,
    });
  } catch (e) {
    return apiError("domain-events-list-failed", e);
  }
}
