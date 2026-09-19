import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, parseJson } from "@/lib/leados/api";
import { parseCsv, CsvLimitError, MAX_CSV_IMPORT_BYTES } from "@/lib/leados/csv";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";
import { createLead } from "@/lib/leados/lead-service";
import { z } from "zod";

const ImportPayload = z.object({
  csv: z.string().min(1),
  mapping: z.record(z.string(), z.string()).optional(), // csvColumn -> lead field
  sourceType: z.string().default("manual"),
});

function tooLarge(code: string) {
  // 413 — the payload (bytes, rows, columns or field width) exceeds a hard limit.
  return NextResponse.json({ error: code }, { status: 413 });
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot import leads");

    // BOUNDED IMPORT (v0.19.3): reject oversized payloads BEFORE buffering —
    // request body, then parsed text, then rows/columns/fields.
    const lenHeader = req.headers.get("content-length");
    if (lenHeader) {
      const len = Number(lenHeader);
      // JSON envelope overhead is small; a request larger than the CSV limit
      // cannot carry a valid import below it.
      if (Number.isFinite(len) && len > MAX_CSV_IMPORT_BYTES + 1024) return tooLarge("request-too-large");
    }

    const body = await parseJson(req);
    const v = ImportPayload.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    if (v.data.csv.length > MAX_CSV_IMPORT_BYTES) return tooLarge("csv-too-large");

    let headers, rows;
    try {
      ({ headers, rows } = parseCsv(v.data.csv));
    } catch (e) {
      if (e instanceof CsvLimitError) return tooLarge(e.code);
      throw e;
    }
    if (!rows.length) return badRequest("empty-csv");

    // auto-map: header → field (case-insensitive). Allow override.
    const auto: Record<string, string> = {
      first_name: "firstName",
      first: "firstName",
      name: "firstName",
      last_name: "lastName",
      last: "lastName",
      company: "company",
      organization: "company",
      phone: "phone",
      email: "email",
      source: "sourceType",
      stage: "stageId",
      owner: "ownerId",
      priority: "priority",
      value: "estimatedValue",
      budget: "estimatedValue",
      summary: "summary",
      requirements: "requirements",
      note: "note",
    };
    const mapping = v.data.mapping ?? {};
    const mappedHeaders: Record<string, string> = {};
    for (const h of headers) {
      const key = (mapping[h] || auto[h.toLowerCase()] || "").toString();
      if (key) mappedHeaders[h] = key;
    }

    let created = 0, updated = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      try {
        const data: Record<string, unknown> = {};
        for (const h of headers) {
          const field = mappedHeaders[h];
          if (field) data[field] = row[h];
        }
        // ensure at least an identifying field
        const hasIdentity = data.firstName || data.company || data.email || data.phone;
        if (!hasIdentity) { skipped++; continue; }
        // normalize numbers
        if (data.estimatedValue) data.estimatedValue = Number(String(data.estimatedValue).replace(/[^\d]/g, "")) || undefined;
        data.sourceType = data.sourceType ?? v.data.sourceType;
        const result = await createLead(session.orgId, session.userId, data as never);
        if (result.created) created++;
        else updated++;
      } catch {
        errors++;
      }
    }
    return ok({ imported: { created, updated, skipped, errors }, total: rows.length });
  } catch (e) {
    return apiError("import-failed", e);
  }
}
