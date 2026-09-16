// Inbox service — channel-based unified inbox for incoming messages.
// Architecture-ready: real adapters (Instagram/WhatsApp/Telegram) would write
// IncomingMessage rows via their own ingestion endpoints. This service is the
// read/assign layer the UI consumes.

import { db } from "@/lib/db";

export interface InboxFilters {
  source?: string | null;
  unassigned?: boolean; // messages not yet linked to a lead
  sinceHours?: number | null;
}

export async function listMessages(orgId: string, filters: InboxFilters = {}) {
  const where: Record<string, unknown> = { organizationId: orgId };
  if (filters.source) where.source = filters.source;
  if (filters.unassigned) where.leadId = null;
  if (filters.sinceHours) where.timestamp = { gte: new Date(Date.now() - filters.sinceHours * 3600_000) };
  return db.incomingMessage.findMany({
    where,
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, company: true, ownerId: true, owner: { select: { id: true, name: true } } } },
    },
    orderBy: { timestamp: "desc" },
    take: 200,
  });
}

export async function getInboxStats(orgId: string) {
  const bySource = await db.incomingMessage.groupBy({
    by: ["source"],
    where: { organizationId: orgId },
    _count: { _all: true },
  });
  const unassigned = await db.incomingMessage.count({ where: { organizationId: orgId, leadId: null } });
  const total = await db.incomingMessage.count({ where: { organizationId: orgId } });
  const last24h = await db.incomingMessage.count({
    where: { organizationId: orgId, timestamp: { gte: new Date(Date.now() - 86400_000) } },
  });
  return {
    total,
    unassigned,
    last24h,
    bySource: bySource.map((r) => ({ source: r.source, count: r._count._all })),
  };
}

/** Group messages by conversationId (or fall back to fromHandle + source). */
export function groupByConversation(rows: any[]) {
  const groups = new Map<string, { id: string; source: string; handle: string | null; leadId: string | null; lead: any; messages: any[]; lastAt: Date }>();
  for (const r of rows) {
    const key = r.conversationId || `${r.source}:${r.fromHandle || "anon"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.messages.push(r);
      if (new Date(r.timestamp).getTime() > existing.lastAt.getTime()) existing.lastAt = new Date(r.timestamp);
    } else {
      groups.set(key, {
        id: key,
        source: r.source,
        handle: r.fromHandle,
        leadId: r.leadId,
        lead: r.lead,
        messages: [r],
        lastAt: new Date(r.timestamp),
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}
