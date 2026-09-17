// TEAM MANAGEMENT API (v0.17 spec 34): members + pending invites for the
// active organization. Readable by any member (TEAM_READ); mutations are in
// the subroutes and require MEMBER_MANAGE.

import { db } from "@/lib/db";
import { ok, apiError } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { requirePermission, sessionCan, PERMISSIONS } from "@/lib/leados/context";
import { listMembers, listInvites } from "@/lib/leados/member-service";
import { can } from "@/lib/leados/auth/permissions";

export async function GET() {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.TEAM_READ);
    const [members, invites] = await Promise.all([
      listMembers(session.orgId),
      can(session.role, PERMISSIONS.MEMBER_MANAGE) ? listInvites(session.orgId) : Promise.resolve([]),
    ]);
    return ok({
      members: members.map((m) => ({ ...m, isSelf: m.userId === session.userId })),
      invites,
      canManage: can(session.role, PERMISSIONS.MEMBER_MANAGE),
      myRole: session.role,
    });
  } catch (e) {
    return apiError("members-list-failed", e);
  }
}

export const dynamic = "force-dynamic";
