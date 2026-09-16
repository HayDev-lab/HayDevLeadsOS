import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import { DEFAULT_SCORING_RULES } from "@/lib/leados/constants";
import { SLA_SETTING_KEY, invalidateSlaThresholdsCache } from "@/lib/leados/sla-service";
import { validateSlaThresholds } from "@/lib/sla";

export async function GET() {
  try {
    const session = await getSession();
    const [org, users, sources, tags, lostReasons, scoring, customFields, pipelines, settings] = await Promise.all([
      db.organization.findUnique({ where: { id: session.orgId } }),
      db.user.findMany({ where: { organizationId: session.orgId }, select: { id: true, name: true, email: true, role: true, status: true, title: true, avatarColor: true } }),
      db.leadSource.findMany({ where: { organizationId: session.orgId }, orderBy: { position: "asc" } }),
      db.tag.findMany({ where: { organizationId: session.orgId }, orderBy: { name: "asc" } }),
      db.lostReason.findMany({ where: { organizationId: session.orgId }, orderBy: { position: "asc" } }),
      db.scoringConfig.findMany({ where: { organizationId: session.orgId }, orderBy: { key: "asc" } }),
      db.customField.findMany({ where: { organizationId: session.orgId }, orderBy: { position: "asc" } }),
      db.pipeline.findMany({ where: { organizationId: session.orgId }, include: { stages: { orderBy: { position: "asc" } } } }),
      db.setting.findMany({ where: { organizationId: session.orgId } }),
    ]);
    return ok({ org, users, sources, tags, lostReasons, scoring, customFields, pipelines, settings });
  } catch (e) {
    return serverError("settings-get-failed", e);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit settings");
    const body = await parseJson(req);
    const { org: orgPatch, scoring: scoringPatch } = body as { org?: Record<string, unknown>; scoring?: { key: string; points: number; enabled: boolean }[] };
    if (orgPatch) {
      const allowed: Record<string, unknown> = {};
      for (const k of ["name", "locale", "timezone", "currency"]) if (orgPatch[k] != null) allowed[k] = orgPatch[k];
      if (Object.keys(allowed).length) await db.organization.update({ where: { id: session.orgId }, data: allowed });
    }
    if (scoringPatch) {
      for (const s of scoringPatch) {
        await db.scoringConfig.updateMany({
          where: { organizationId: session.orgId, key: s.key },
          data: { points: s.points, enabled: s.enabled },
        });
      }
    }
    return ok({ ok: true });
  } catch (e) {
    return serverError("settings-update-failed", e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot init settings");
    const body = (await parseJson(req)) as { key?: string; value?: unknown } | null;
    // if body has key + value, upsert a Setting row (with per-key validation)
    if (body?.key && body?.value !== undefined) {
      if (body.key === SLA_SETTING_KEY) {
        // SERVER-SIDE VALIDATION — target < warning < breach, all > 0, finite.
        const v = validateSlaThresholds(body.value);
        if (!v.ok) return badRequest(v.errors.join(" "), v.errors);
        await upsertSetting(session.orgId, SLA_SETTING_KEY, v.thresholds);
        invalidateSlaThresholdsCache(session.orgId);
        return ok({ ok: true, value: v.thresholds });
      }
      await upsertSetting(session.orgId, body.key, body.value);
      return ok({ ok: true });
    }
    // default: ensure scoring rules exist (seed fallback)
    const existing = await db.scoringConfig.count({ where: { organizationId: session.orgId } });
    if (!existing) {
      for (const r of DEFAULT_SCORING_RULES) {
        await db.scoringConfig.create({ data: { organizationId: session.orgId, key: r.key, label: r.label, points: r.points, enabled: true } });
      }
    }
    return ok({ ok: true });
  } catch (e) {
    return serverError("settings-init-failed", e);
  }
}

async function upsertSetting(orgId: string, key: string, value: unknown) {
  const existing = await db.setting.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } });
  if (existing) {
    await db.setting.update({ where: { id: existing.id }, data: { value: value as never } });
  } else {
    await db.setting.create({ data: { organizationId: orgId, key, value: value as never } });
  }
}
