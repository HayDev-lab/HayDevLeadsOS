/**
 * Meta Forms API — List forms and manage field mappings
 */

import { NextRequest } from "next/server";
import { getSession, type Session } from "@/lib/leados/context";
import { db } from "@/lib/db";
import { ok, badRequest, unauthorized, forbidden, apiError } from "@/lib/leados/api";
import { getPageLeadForms, mapFormFields } from "@/lib/integrations/meta/meta-service";
import { z } from "zod";

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
 * GET /api/v1/integrations/meta/forms
 * List lead forms for a connected page.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const pageConnectionId = request.nextUrl.searchParams.get("pageConnectionId");
    if (!pageConnectionId) return badRequest("Missing pageConnectionId");

    // Verify membership
    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: session.orgId },
    });

    if (!member) return forbidden();

    // Verify page connection belongs to org
    const pageConnection = await db.metaPageConnection.findFirst({
      where: { id: pageConnectionId, organizationId: session.orgId },
    });

    if (!pageConnection) return forbidden();

    const forms = await getPageLeadForms({ pageConnectionId });
    return ok({ forms });
  } catch (error) {
    return apiError("meta-forms-get", error);
  }
}

/**
 * POST /api/v1/integrations/meta/forms
 * Map form fields to LeadOS fields.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();

    const body = await request.json().catch(() => null);
    const parsed = MapFormSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest(parsed.error.message);
    }

    // Only OWNER or ADMIN can map forms
    const member = await db.organizationMember.findFirst({
      where: { userId: session.user.id, organizationId: session.orgId },
    });

    if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
      return forbidden();
    }

    // Verify page connection belongs to org
    const pageConnection = await db.metaPageConnection.findFirst({
      where: { id: parsed.data.pageConnectionId, organizationId: session.orgId },
    });

    if (!pageConnection) return forbidden();

    const result = await mapFormFields(parsed.data);

    // Log audit event
    await db.auditLog.create({
      data: {
        organizationId: session.orgId,
        actorUserId: session.user.id,
        actorType: "USER",
        action: "META_FORM_MAPPED",
        resourceType: "meta_form",
        resourceId: result.formId,
        metadata: { formName: parsed.data.formName },
      },
    });

    return ok(result);
  } catch (error) {
    return apiError("meta-form-map", error);
  }
}
