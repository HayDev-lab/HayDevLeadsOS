// INVITE ACTIONS (v0.17 spec 34, 78): resend (rotates the token + expiry) or
// revoke a pending invite. Single-use is enforced at acceptance.

import { ok, badRequest, forbidden, notFound, apiError } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { resendInvite, revokeInvite } from "@/lib/leados/member-service";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { getEmailProvider } from "@/lib/leados/delivery/providers";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const result = await resendInvite(session, id);
    if (!("ok" in result)) {
      if (result.status === 404) return notFound(result.code);
      if (result.status === 403) return forbidden(result.code);
      return badRequest(result.code);
    }
    const origin = new URL(req.url).origin;
    const inviteUrl = `${origin}/#/invite/${result.token}`;
    let emailed = false;
    const provider = getEmailProvider();
    if (provider && provider.mode === "REAL") {
      const invite = await getSessionInviteEmail(id, session.orgId);
      if (invite) {
        const sent = await provider.send({
          to: invite,
          subject: "Reminder: your LeadOS invite",
          text: `This is a reminder — your invite to "${session.organization.name}" is still open:\n${inviteUrl}`,
        });
        emailed = sent.ok;
      }
    }
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.INVITE_RESENT,
      resourceType: "member",
      resourceId: id,
      ...meta,
    });
    return ok({ ok: true, inviteUrl, emailed, expiresAt: result.expiresAt });
  } catch (e) {
    return apiError("invite-resend-failed", e);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const result = await revokeInvite(session, id);
    if (result !== true) {
      if (result.status === 404) return notFound(result.code);
      if (result.status === 403) return forbidden(result.code);
      return badRequest(result.code);
    }
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.INVITE_REVOKED,
      resourceType: "member",
      resourceId: id,
      ...meta,
    });
    return ok({ ok: true });
  } catch (e) {
    return apiError("invite-revoke-failed", e);
  }
}

async function getSessionInviteEmail(inviteId: string, orgId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const invite = await db.organizationInvite.findFirst({ where: { id: inviteId, organizationId: orgId } });
  return invite?.email ?? null;
}
