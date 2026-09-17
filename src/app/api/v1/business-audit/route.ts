import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, badRequest, apiError, parseJson, validate } from "@/lib/leados/api";
import { BusinessAuditPayload } from "@/lib/leados/audit-ingest";
import { ingestBusinessAudit } from "@/lib/leados/audit-ingest";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const body = await parseJson(req);
    const v = validate(BusinessAuditPayload, body);
    if (!v.ok) return v.error;
    const result = await ingestBusinessAudit(session.orgId, v.value, session.userId);
    return ok(result);
  } catch (e) {
    return apiError("audit-ingest-failed", e);
  }
}
