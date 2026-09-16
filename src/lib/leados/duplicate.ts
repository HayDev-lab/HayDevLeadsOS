// Duplicate detection — checks normalized phone/email/external id within an org.

import { db } from "@/lib/db";
import { normalizeEmail, normalizePhone } from "./normalize";

export interface DuplicateMatch {
  id: string;
  reason: "phone" | "email" | "external_id";
  matchValue: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  stageName?: string | null;
  status?: string;
  createdAt: Date;
}

export interface DuplicateCheckResult {
  hasDuplicates: boolean;
  matches: DuplicateMatch[];
}

export async function detectDuplicates(
  orgId: string,
  opts: { phone?: string | null; email?: string | null; externalId?: string | null; excludeLeadId?: string | null }
): Promise<DuplicateCheckResult> {
  const phone = normalizePhone(opts.phone);
  const email = normalizeEmail(opts.email);
  const matches: DuplicateMatch[] = [];

  const where: Record<string, unknown>[] = [{ organizationId: orgId }];
  if (opts.excludeLeadId) where.push({ id: { not: opts.excludeLeadId } });
  const baseAnd = where;

  if (phone) {
    const rows = await db.lead.findMany({
      where: { AND: [...baseAnd, { normalizedPhone: phone }] },
      include: { stage: true },
      take: 5,
    });
    for (const r of rows) {
      matches.push({
        id: r.id,
        reason: "phone",
        matchValue: phone,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.company,
        stageName: r.stage?.name,
        status: r.status,
        createdAt: r.createdAt,
      });
    }
  }
  if (email) {
    const rows = await db.lead.findMany({
      where: { AND: [...baseAnd, { normalizedEmail: email }] },
      include: { stage: true },
      take: 5,
    });
    for (const r of rows) {
      if (matches.some((m) => m.id === r.id)) continue;
      matches.push({
        id: r.id,
        reason: "email",
        matchValue: email,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.company,
        stageName: r.stage?.name,
        status: r.status,
        createdAt: r.createdAt,
      });
    }
  }
  if (opts.externalId) {
    const rows = await db.lead.findMany({
      where: { AND: [...baseAnd, { externalId: opts.externalId }] },
      include: { stage: true },
      take: 5,
    });
    for (const r of rows) {
      if (matches.some((m) => m.id === r.id)) continue;
      matches.push({
        id: r.id,
        reason: "external_id",
        matchValue: opts.externalId!,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.company,
        stageName: r.stage?.name,
        status: r.status,
        createdAt: r.createdAt,
      });
    }
  }
  return { hasDuplicates: matches.length > 0, matches };
}
