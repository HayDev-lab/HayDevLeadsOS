/**
 * Meta Pages API — List and connect pages
 */

import { NextRequest } from "next/server";
import { getSession, type Session } from "@/lib/leados/context";
import { db } from "@/lib/db";
import { ok, badRequest, unauthorized, forbidden, apiError } from "@/lib/leados/api";
import { getAvailablePages, connectPage } from "@/lib/integrations/meta/meta-service";
import { z } from "zod";

const ConnectPageSchema = z.object({
  connectionId: z.string(),
  pageId: z.string(),
  pageName: z.string(),
  pageAccessToken: z.string(),
});

/**
 * GET /api/v1/integrations/meta/pages
 * List available pages for the connected Meta account.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const connectionId = request.nextUrl.searchParams.get("connectionId");
    if (!connectionId) return badRequest("Missing connectionId");

    // Verify membership
    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: session.orgId },
    });

    if (!member) return forbidden();

    // Verify connection belongs to org
    const connection = await db.metaConnection.findFirst({
      where: { id: connectionId, organizationId: session.orgId },
    });

    if (!connection) return forbidden();

    const pages = await getAvailablePages(connectionId);
    return ok({ pages });
  } catch (error) {
    return apiError("meta-pages-get", error);
  }
}

/**
 * POST /api/v1/integrations/meta/pages
 * Connect a page to the organization.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const body = await request.json().catch(() => null);
    const parsed = ConnectPageSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest(parsed.error.message);
    }

    // Only OWNER or ADMIN can connect pages
    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: session.orgId },
    });

    if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
      return forbidden();
    }

    // Verify connection belongs to org
    const connection = await db.metaConnection.findFirst({
      where: { id: parsed.data.connectionId, organizationId: session.orgId },
    });

    if (!connection) return forbidden();

    const result = await connectPage(parsed.data);

    // Log audit event
    await db.auditLog.create({
      data: {
        organizationId: session.orgId,
        actorUserId: session.user.id,
        actorType: "USER",
        action: "META_PAGE_CONNECTED",
        resourceType: "meta_page",
        resourceId: result.pageConnectionId,
        metadata: { pageId: parsed.data.pageId, subscribed: result.subscribed },
      },
    });

    return ok(result);
  } catch (error) {
    return apiError("meta-page-connect", error);
  }
}
