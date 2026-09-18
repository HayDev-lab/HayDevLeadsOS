// Per-lead custom field values — list + upsert.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, parseJson, validate } from "@/lib/leados/api";
import { z } from "zod";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const field = await db.customField.findUnique({ where: { id }, select: { organizationId: true } });
    if (!field || field.organizationId !== session.orgId) return notFound("custom-field");
    const values = await db.customFieldValue.findMany({
      where: { fieldId: id },
      include: { lead: { select: { id: true, firstName: true, lastName: true, company: true } } },
    });
    return ok({ values });
  } catch (e) {
    return apiError("custom-values-list-failed", e);
  }
}

const Upsert = z.object({
  leadId: z.string().min(1),
  valueText: z.string().nullable().optional(),
  valueNumber: z.number().nullable().optional(),
  valueBool: z.boolean().nullable().optional(),
  valueDate: z.string().nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot set custom values");
    const { id } = await ctx.params;
    const field = await db.customField.findUnique({ where: { id }, select: { organizationId: true, type: true } });
    if (!field || field.organizationId !== session.orgId) return notFound("custom-field");
    const body = await parseJson(req);
    const v = validate(Upsert, body);
    if (!v.ok) return v.error;
    const lead = await db.lead.findUnique({ where: { id: v.value.leadId }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const data = {
      leadId: v.value.leadId,
      fieldId: id,
      valueText: v.value.valueText ?? null,
      valueNumber: v.value.valueNumber ?? null,
      valueBool: v.value.valueBool ?? null,
      valueDate: v.value.valueDate ? new Date(v.value.valueDate) : null,
    };
    const existing = await db.customFieldValue.findUnique({ where: { leadId_fieldId: { leadId: v.value.leadId, fieldId: id } } });
    let value;
    if (existing) value = await db.customFieldValue.update({ where: { id: existing.id }, data });
    else value = await db.customFieldValue.create({ data });
    return ok({ value });
  } catch (e) {
    return apiError("custom-value-upsert-failed", e);
  }
}
