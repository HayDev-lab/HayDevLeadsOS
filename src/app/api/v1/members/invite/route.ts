// INVITE CREATION (v0.17 spec 30–32, 66): OWNER/ADMIN invites a user by
// email. The response carries the invite link (the inviter shares it — the
// standard self-hosted pattern when no email provider is configured; a real
// provider also receives the email).

import { z } from "zod";
import { ok, badRequest, forbidden, apiError, validate, parseJson } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { createInvite } from "@/lib/leados/member-service";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { getEmailProvider } from "@/lib/leados/delivery/providers";
import { ROLES } from "@/lib/leados/constants";

const InviteSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum([ROLES.ADMIN, ROLES.MEMBER, ROLES.VIEWER]).default(ROLES.MEMBER),
});

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const body = await parseJson(req);
    const v = validate(InviteSchema, body);
    if (!v.ok) return v.error;

    const result = await createInvite(session, { email: v.value.email, role: v.value.role });
    if (!("ok" in result)) {
      const res =
        result.status === 403 ? forbidden(result.code) :
        result.status === 404 ? badRequest(result.code) :
        badRequest(result.code);
      return res;
    }

    const origin = new URL(req.url).origin;
    const inviteUrl = `${origin}/#/invite/${result.token}`;

    // Deliver by email when a REAL provider is configured; otherwise the
    // link is returned to the inviter (self-hosted sharing).
    let emailed = false;
    const provider = getEmailProvider();
    if (provider && provider.mode === "REAL") {
      const sent = await provider.send({
        to: v.value.email.trim().toLowerCase(),
        subject: "You are invited to LeadOS",
        text: `You have been invited to collaborate in "${session.organization.name}" on HayDev LeadOS.\n\nOpen your invite (valid 7 days, one-time use):\n${inviteUrl}`,
      });
      emailed = sent.ok;
    }

    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.MEMBER_INVITED,
      resourceType: "member",
      resourceId: result.inviteId,
      metadata: { email: v.value.email.trim().toLowerCase(), role: v.value.role },
      ...meta,
    });

    return ok({ ok: true, inviteUrl, emailed, expiresAt: result.expiresAt });
  } catch (e) {
    return apiError("invite-create-failed", e);
  }
}
