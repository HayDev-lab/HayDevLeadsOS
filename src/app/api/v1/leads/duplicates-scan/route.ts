// Scan all leads in an org for potential duplicates (same normalized phone/email).
// Returns groups of duplicate leads for review.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";

export async function GET() {
  try {
    const session = await getSession();
    const leads = await db.lead.findMany({
      where: { organizationId: session.orgId, status: { notIn: ["ARCHIVED"] } },
      select: { id: true, firstName: true, lastName: true, company: true, phone: true, email: true, normalizedPhone: true, normalizedEmail: true, createdAt: true, stageId: true, stage: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    // group by normalized phone
    const byPhone = new Map<string, typeof leads>();
    const byEmail = new Map<string, typeof leads>();
    for (const l of leads) {
      if (l.normalizedPhone) {
        const arr = byPhone.get(l.normalizedPhone) ?? [];
        arr.push(l);
        byPhone.set(l.normalizedPhone, arr);
      }
      if (l.normalizedEmail) {
        const arr = byEmail.get(l.normalizedEmail) ?? [];
        arr.push(l);
        byEmail.set(l.normalizedEmail, arr);
      }
    }

    // build groups — dedupe by lead id set
    const seenGroups = new Set<string>();
    const groups: { key: string; reason: string; matchValue: string; leads: typeof leads }[] = [];

    for (const [phone, arr] of byPhone) {
      if (arr.length < 2) continue;
      const ids = arr.map((l) => l.id).sort().join(",");
      if (seenGroups.has(ids)) continue;
      seenGroups.add(ids);
      groups.push({ key: `phone:${phone}`, reason: "phone", matchValue: phone, leads: arr });
    }
    for (const [email, arr] of byEmail) {
      if (arr.length < 2) continue;
      const ids = arr.map((l) => l.id).sort().join(",");
      if (seenGroups.has(ids)) continue;
      seenGroups.add(ids);
      groups.push({ key: `email:${email}`, reason: "email", matchValue: email, leads: arr });
    }

    return ok({ groups, total: groups.length, leadsScanned: leads.length });
  } catch (e) {
    return apiError("duplicates-scan-failed", e);
  }
}
