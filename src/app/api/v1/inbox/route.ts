import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { z } from "zod";
import { listMessages, getInboxStats, groupByConversation } from "@/lib/leados/inbox-service";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const p = new URL(req.url).searchParams;
    const source = p.get("source");
    const unassigned = p.get("unassigned") === "1";
    const view = p.get("view"); // "conversations" | "stats"
    if (view === "stats") {
      const stats = await getInboxStats(session.orgId);
      return ok(stats);
    }
    const rows = await listMessages(session.orgId, { source, unassigned });
    const conversations = groupByConversation(rows as any[]);
    return ok({ rows, conversations, total: rows.length });
  } catch (e) {
    return apiError("inbox-list-failed", e);
  }
}

// Ingest a new incoming message (adapter endpoint for channel integrations).
const IngestMessage = z.object({
  source: z.string().min(1),
  externalMessageId: z.string().optional(),
  leadId: z.string().optional(),
  conversationId: z.string().optional(),
  content: z.string().min(1).max(4000),
  channel: z.string().optional(),
  fromHandle: z.string().optional(),
  meta: z.any().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot ingest messages");
    const body = await parseJson(req);
    const v = validate(IngestMessage, body);
    if (!v.ok) return v.error;
    const msg = await db.incomingMessage.create({
      data: {
        organizationId: session.orgId,
        source: v.value.source,
        externalMessageId: v.value.externalMessageId ?? null,
        leadId: v.value.leadId ?? null,
        conversationId: v.value.conversationId ?? null,
        direction: "inbound",
        content: v.value.content,
        channel: v.value.channel ?? null,
        fromHandle: v.value.fromHandle ?? null,
        metadata: (v.value.meta ?? null) as never,
      },
    });
    return ok({ message: msg });
  } catch (e) {
    return apiError("inbox-create-failed", e);
  }
}
