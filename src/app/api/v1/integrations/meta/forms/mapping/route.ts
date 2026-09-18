// POST /api/v1/integrations/meta/forms/mapping — persist a form's mapping
// config (v0.19 spec 14). SERVER-VALIDATED TENANT RULES:
//   • formId → MetaLeadForm of session.orgId (forged foreign IDs → 404)
//   • leadSourceId → LeadSource of session.orgId
//   • defaultOwnerId → ACTIVE OrganizationMember of session.orgId
//   • defaultStageId → stage of a pipeline of session.orgId
// Activating a form requeues its parked UNMAPPED_FORM events (exactly one
// Lead per leadgenId — the unique constraint guarantees it).
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { setFormMapping } from "@/lib/leados/meta-service";
import type { MappingRule } from "@/lib/integrations/meta/lead-mapper";

interface MappingBody {
  formId?: string;
  active?: boolean;
  leadSourceId?: string | null;
  defaultOwnerId?: string | null;
  defaultStageId?: string | null;
  mapping?: MappingRule[] | null;
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const body = (await req.json().catch(() => null)) as MappingBody | null;
    if (!body?.formId) return badRequest("formId is required");

    // Structural validation of mapping rules (target whitelist).
    if (body.mapping !== undefined && body.mapping !== null) {
      if (!Array.isArray(body.mapping)) return badRequest("mapping must be an array of rules");
      for (const r of body.mapping) {
        if (typeof r?.metaField !== "string" || !r.metaField.trim()) return badRequest("mapping rule metaField required");
        const t = r.target;
        const known = ["firstName", "lastName", "email", "phone", "company", "position", "city", "country", "summary", "CUSTOM_FIELD", "METADATA", "IGNORE"];
        if (typeof t !== "string" || !known.includes(t)) return badRequest(`mapping rule target invalid: ${String(t)}`);
        if (t === "CUSTOM_FIELD" && (typeof r.customFieldKey !== "string" || !r.customFieldKey.trim())) {
          return badRequest("CUSTOM_FIELD mapping requires customFieldKey");
        }
      }
    }

    const form = await setFormMapping(session.orgId, body.formId, {
      active: body.active,
      leadSourceId: body.leadSourceId,
      defaultOwnerId: body.defaultOwnerId,
      defaultStageId: body.defaultStageId,
      mapping: body.mapping,
    });
    return ok({ ok: true, form: { formId: form.formId, active: form.active } });
  } catch (e) {
    return apiError("meta-mapping-failed", e);
  }
}
