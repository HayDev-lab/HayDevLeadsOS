// POST /api/v1/integrations/meta/forms/test-mapping — DRY preview (v0.19
// spec 15): applies the backend mapper to sample Meta fields with the given
// rules and returns the preview. ZERO Lead writes, ZERO DB mutations.
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { mapMetaLead, metadataNote, type MappingRule, type MetaLeadField } from "@/lib/integrations/meta/lead-mapper";

interface TestMappingBody {
  fields?: MetaLeadField[];
  rules?: MappingRule[] | null;
  formName?: string;
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const body = (await req.json().catch(() => null)) as TestMappingBody | null;
    const fields: MetaLeadField[] = Array.isArray(body?.fields)
      ? body!.fields.filter((f) => typeof f?.name === "string" && Array.isArray(f?.values))
      : [
          { name: "full_name", values: ["Narek Margaryan"] },
          { name: "email", values: ["narek@demo.am"] },
          { name: "phone_number", values: ["+37499123456"] },
          { name: "company_name", values: ["Demo Company"] },
          { name: "budget", values: ["1.5M AMD"] },
        ];
    const mapped = mapMetaLead(fields, body?.rules ?? null);
    const note = metadataNote(mapped, body?.formName ?? "Website Development Leads");
    return ok({
      ok: true,
      preview: {
        leadFields: mapped.leadFields,
        metadata: mapped.metadata,
        customFieldValues: mapped.customFieldValues,
        unresolved: mapped.unresolved,
        initialNote: note,
      },
      writes: 0, // guaranteed: this route never touches Lead tables
    });
  } catch (e) {
    return apiError("meta-test-mapping-failed", e);
  }
}
