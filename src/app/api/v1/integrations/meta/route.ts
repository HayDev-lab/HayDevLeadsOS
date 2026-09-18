/**
 * Meta Lead Ads Integration — API Routes
 * 
 * Provides REST API for managing Meta connections, pages, forms, and leads.
 * All routes require authentication and appropriate permissions.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, type Session } from "@/lib/leados/context";
import { db } from "@/lib/db";
import { ok, badRequest, unauthorized, forbidden, apiError } from "@/lib/leados/api";
import {
  connectMetaAccount,
  getAvailablePages,
  connectPage,
  getPageLeadForms,
  mapFormFields,
  disconnectMeta,
  validateConnection,
  processMetaLead,
} from "@/lib/integrations/meta/meta-service";
import { isMetaConfigured } from "@/lib/integrations/meta/meta-config";
import { z } from "zod";

const ConnectSchema = z.object({
  accessToken: z.string(),
  businessId: z.string().optional(),
  metaUserId: z.string().optional(),
});

const ConnectPageSchema = z.object({
  pageId: z.string(),
  pageName: z.string(),
  pageAccessToken: z.string(),
});

const MapFormSchema = z.object({
  pageConnectionId: z.string(),
  formId: z.string(),
  formName: z.string(),
  fieldMapping: z.array(
    z.object({
      metaFieldName: z.string(),
      leadOSField: z.enum([
        "firstName",
        "lastName",
        "fullName",
        "email",
        "phone",
        "company",
        "position",
        "city",
        "country",
        "custom",
      ]),
    })
  ),
  defaultOwnerId: z.string().optional(),
  defaultStageId: z.string().optional(),
  leadSourceId: z.string().optional(),
});

/**
 * GET /api/v1/integrations/meta
 * Get Meta connection status for the organization.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const orgId = request.nextUrl.searchParams.get("organizationId") || session.orgId;

    // Check membership
    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: orgId },
    });

    if (!member) return forbidden();

    const connection = await db.metaConnection.findFirst({
      where: { organizationId: orgId },
      include: {
        pageConnections: {
          select: {
            id: true,
            pageId: true,
            pageName: true,
            subscribed: true,
            status: true,
            lastWebhookAt: true,
            lastLeadAt: true,
          },
        },
      },
    });

    // Don't expose sensitive data
    const safeConnection = connection
      ? {
          id: connection.id,
          status: connection.status,
          metaBusinessId: connection.metaBusinessId,
          tokenExpiresAt: connection.tokenExpiresAt,
          grantedScopes: connection.grantedScopes,
          lastValidatedAt: connection.lastValidatedAt,
          lastErrorCode: connection.lastErrorCode,
          createdAt: connection.createdAt,
          pageConnections: connection.pageConnections,
        }
      : null;

    return ok({ connection: safeConnection, configured: isMetaConfigured() });
  } catch (error) {
    return apiError("meta-connection-get", error);
  }
}

/**
 * POST /api/v1/integrations/meta
 * Connect Meta account with OAuth token.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const body = await request.json().catch(() => null);
    const parsed = ConnectSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest(parsed.error.message);
    }

    // Only OWNER or ADMIN can connect integrations
    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: session.orgId },
    });

    if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
      return forbidden();
    }

    const result = await connectMetaAccount({
      organizationId: session.orgId,
      userId: session.user.id,
      ...parsed.data,
    });

    // Log audit event
    await db.auditLog.create({
      data: {
        organizationId: session.orgId,
        actorUserId: session.user.id,
        actorType: "USER",
        action: "META_CONNECTED",
        resourceType: "integration",
        resourceId: result.connectionId,
        metadata: { status: result.status },
      },
    });

    return ok(result);
  } catch (error) {
    return apiError("meta-connect", error);
  }
}

/**
 * DELETE /api/v1/integrations/meta/:connectionId
 * Disconnect Meta integration.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const connectionId = request.nextUrl.searchParams.get("connectionId");
    if (!connectionId) return badRequest("Missing connectionId");

    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: session.orgId },
    });

    if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
      return forbidden();
    }

    const result = await disconnectMeta({ connectionId });

    if (!result.success) {
      return badRequest("Failed to disconnect");
    }

    // Log audit event
    await db.auditLog.create({
      data: {
        organizationId: session.orgId,
        actorUserId: session.user.id,
        actorType: "USER",
        action: "META_DISCONNECTED",
        resourceType: "integration",
        resourceId: connectionId,
      },
    });

    return ok({ success: true });
  } catch (error) {
    return apiError("meta-disconnect", error);
  }
}

/**
 * Handle PATCH requests for validation/revalidation.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const action = request.nextUrl.searchParams.get("action");
    const connectionId = request.nextUrl.searchParams.get("connectionId");

    if (!connectionId) return badRequest("Missing connectionId");

    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: session.orgId },
    });

    if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
      return forbidden();
    }

    if (action === "validate") {
      const result = await validateConnection(connectionId);
      return ok(result);
    }

    return badRequest("Unknown action");
  } catch (error) {
    return apiError("meta-validate", error);
  }
}
