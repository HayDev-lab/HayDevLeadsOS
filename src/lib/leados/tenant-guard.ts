// HAYDEV LEADOS — CENTRAL TENANT GUARDS (v0.19.2, hardening spec §10–17).
//
// ONE place where every FOREIGN ID (source / stage / pipeline / owner /
// assignee / tag / custom field / lead) coming from a client, an automation
// rule or a connector is validated server-side BEFORE any Prisma
// connect/write. An ID that belongs to another organization is treated
// exactly like a missing row (404) — no cross-org enumeration, no partial
// writes, no silent cross-tenant relations.
//
// MEMBERSHIP SOURCE OF TRUTH (§14–16): authorization for "user X may act on
// org Y resources" is ALWAYS OrganizationMember(organizationId, userId,
// status=ACTIVE). User.organizationId / User.role are legacy cache/active
// pointers ONLY — never an authorization decision.
//
// Usage:
//   import { requireOrgStage, TenantGuardError } from "./tenant-guard";
//   const stage = await requireOrgStage(orgId, input.stageId); // throws → 404
//
// Non-throwing variant for engine/worker paths that report failures
// gracefully (FAILED INVALID_RECIPIENT instead of an exception):
//   if (!(await isOrgMember(orgId, userId))) { ... }

import { db } from "@/lib/db";
import { ROLES } from "./constants";

/** Typed, safe error for foreign/missing IDs. Maps to HTTP 404 by apiError()
 *  (identical outcome for foreign and missing — no org enumeration). */
export class TenantGuardError extends Error {
  readonly httpStatus = 404;
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TenantGuardError";
    this.code = code;
  }
}

function fail(what: string): never {
  throw new TenantGuardError(`${what}_NOT_FOUND`, `${what} not found for this organization`);
}

// ---------------------------------------------------------------------------
// Membership — THE authorization primitive (§14)
// ---------------------------------------------------------------------------

/** ACTIVE OrganizationMember required. Foreign, removed or suspended user →
 *  404-equivalent (suspended users never receive assignments/notifications). */
export async function requireOrgMember(orgId: string, userId: string) {
  const m = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    include: { user: { select: { status: true } } },
  });
  if (!m || m.status !== "ACTIVE" || m.user.status !== "ACTIVE") fail("Member");
  return m;
}

/** Non-throwing membership check (engines/workers report failures themselves). */
export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const m = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    include: { user: { select: { status: true } } },
  });
  return !!m && m.status === "ACTIVE" && m.user.status === "ACTIVE";
}

// ---------------------------------------------------------------------------
// Org-scoped resource guards (§10–13)
// ---------------------------------------------------------------------------

export async function requireOrgLead(orgId: string, leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.organizationId !== orgId) fail("Lead");
  return lead;
}

export async function requireOrgSource(orgId: string, sourceId: string) {
  const source = await db.leadSource.findUnique({ where: { id: sourceId } });
  if (!source || source.organizationId !== orgId) fail("Source");
  return source;
}

export async function requireOrgPipeline(orgId: string, pipelineId: string) {
  const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId } });
  if (!pipeline || pipeline.organizationId !== orgId) fail("Pipeline");
  return pipeline;
}

/** Stage guard validates THROUGH its pipeline (§13): stage existence alone
 *  is insufficient — stage.pipeline.organizationId must equal orgId. */
export async function requireOrgStage(orgId: string, stageId: string) {
  const stage = await db.pipelineStage.findUnique({
    where: { id: stageId },
    include: { pipeline: true },
  });
  if (!stage || stage.pipeline.organizationId !== orgId) fail("Stage");
  return stage;
}

export async function requireOrgTag(orgId: string, tagId: string) {
  const tag = await db.tag.findUnique({ where: { id: tagId } });
  if (!tag || tag.organizationId !== orgId) fail("Tag");
  return tag;
}

export async function requireOrgCustomField(orgId: string, fieldId: string) {
  const field = await db.customField.findUnique({ where: { id: fieldId } });
  if (!field || field.organizationId !== orgId) fail("Custom field");
  return field;
}

// ---------------------------------------------------------------------------
// Fallback recipient — membership-based (§16)
// ---------------------------------------------------------------------------

/** Org fallback recipient for domain-event projection: first ACTIVE OWNER
 *  member, then ADMIN, then any ACTIVE member. NEVER User.role /
 *  User.organizationId (legacy cache only). Returns null for an org with no
 *  active members. */
export async function resolveOrgFallbackRecipient(orgId: string): Promise<string | null> {
  for (const role of [ROLES.OWNER, ROLES.ADMIN]) {
    const m = await db.organizationMember.findFirst({
      where: { organizationId: orgId, role, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (m) return m.userId;
  }
  const any = await db.organizationMember.findFirst({
    where: { organizationId: orgId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return any?.userId ?? null;
}
