// v0.17 PRODUCTION AUTH — INTEGRATION tests (spec 70–83, 106, 110–117).
//
// Service-level coverage: password hashing, session store lifecycle, the
// centralized permission model, rate limiting + lockout, login flow,
// token-resolved sessions (incl. membership-loss fallback), member service
// (last-owner protection, admin scope), invite lifecycle (single use, expiry,
// revocation), cross-tenant data access, demo isolation, personal prefs and
// recipient-locale fan-out. Live HTTP behavior (cookies, 401/403 mapping,
// security headers) is proven by scripts/auth-http-qa.ts against the dev server.

/// <reference types="bun-types" />
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "../src/lib/leados/auth/password";
import { generateToken, hashToken, safeEqualHex } from "../src/lib/leados/auth/tokens";
import { RateLimiter } from "../src/lib/leados/auth/rate-limit";
import {
  createSession,
  validateSessionToken,
  revokeSessionToken,
  revokeAllUserSessions,
} from "../src/lib/leados/auth/session-store";
import { can, normalizeRole, permissionsForRole, PERMISSIONS } from "../src/lib/leados/auth/permissions";
import { performLogin, acceptInvite, mintInviteToken } from "../src/lib/leados/auth/auth-service";
import { resolveAuthenticatedSessionFromToken } from "../src/lib/leados/context";
import { recordAudit, AUDIT_ACTIONS } from "../src/lib/leados/auth/audit";
import {
  createInvite,
  changeMemberRole,
  removeMember,
} from "../src/lib/leados/member-service";
import type { Session } from "../src/lib/leados/context";
import { updateLead } from "../src/lib/leados/lead-service";
import {
  setNotificationPreferences,
  getFullNotificationPreferences,
} from "../src/lib/leados/notification-service";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../src/lib/domain-events";

const db = new PrismaClient();
const RUN = Date.now().toString(36);
const uniq = (s: string) => `${s}-${RUN}@test.local`;
const slugify = (s: string) => `${s}-${RUN}`.toLowerCase();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function mkOrg(name: string, isDemo = false) {
  return db.organization.create({
    data: { name, slug: slugify(name), isDemo, locale: "hy", timezone: "Asia/Yerevan", currency: "AMD" },
  });
}

async function mkUser(orgId: string, email: string, role = "MEMBER", password?: string) {
  const user = await db.user.create({
    data: {
      organizationId: orgId,
      name: email.split("@")[0],
      email,
      role,
      status: "ACTIVE",
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    },
  });
  await db.organizationMember.create({
    data: { organizationId: orgId, userId: user.id, role, status: "ACTIVE" },
  });
  return user;
}

function fakeSession(userId: string, orgId: string, role: string): Session {
  return {
    user: { id: userId, name: "t", email: "t@t", role, locale: "hy", timezone: "Asia/Yerevan" },
    organization: { id: orgId, name: "t", slug: "t", locale: "hy", timezone: "Asia/Yerevan", currency: "AMD", isDemo: false },
    orgId,
    userId,
    role,
    membership: { role, joinedAt: new Date() },
    permissions: permissionsForRole(role),
    demo: false,
    authenticated: true,
  };
}


function isErr(r: unknown): r is { status: number; code: string } {
  return typeof r === "object" && r !== null && "status" in r;
}

let orgA: Awaited<ReturnType<typeof mkOrg>>;
let orgB: Awaited<ReturnType<typeof mkOrg>>;
let demoOrg: Awaited<ReturnType<typeof mkOrg>>;

beforeAll(async () => {
  orgA = await mkOrg("Alpha");
  orgB = await mkOrg("Beta");
  demoOrg = await mkOrg("DemoOrg", true);
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { slug: { contains: RUN } } });
  await db.session.deleteMany({});
  await db.passwordResetToken.deleteMany({});
  await db.user.deleteMany({ where: { email: { contains: RUN } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id, demoOrg.id] } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// PASSWORDS (spec 20)
// ---------------------------------------------------------------------------

describe("password hashing", () => {
  test("hash + verify roundtrip; wrong password fails", async () => {
    const hash = await hashPassword("Sup3rSecret");
    expect(hash).not.toContain("Sup3rSecret");
    expect(await verifyPassword("Sup3rSecret", hash)).toBe(true);
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });

  test("policy: min 8 chars, letter + digit", () => {
    expect(validatePasswordPolicy("short1")).not.toBeNull();
    expect(validatePasswordPolicy("onlyletters")).not.toBeNull();
    expect(validatePasswordPolicy("12345678")).not.toBeNull();
    expect(validatePasswordPolicy("goodpass1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TOKENS (spec 31, 98)
// ---------------------------------------------------------------------------

describe("opaque tokens", () => {
  test("generate → hash is deterministic and non-reversible", () => {
    const t = generateToken(32);
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });
  test("constant-time compare", () => {
    expect(safeEqualHex("a" .repeat(64), "a".repeat(64))).toBe(true);
    expect(safeEqualHex("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(safeEqualHex("short", "longer-value")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RATE LIMITING (spec 21, 99)
// ---------------------------------------------------------------------------

describe("rate limiter + lockout", () => {
  test("sliding window blocks after max hits", () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 3, failureWindowMs: 1000, maxFailures: 99, initialLockMs: 10, maxLockMs: 20 });
    expect(rl.checkRateLimit("k")).toBe(true);
    expect(rl.checkRateLimit("k")).toBe(true);
    expect(rl.checkRateLimit("k")).toBe(true);
    expect(rl.checkRateLimit("k")).toBe(false);
  });

  test("lockout escalates and expires (never permanent)", async () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 99, failureWindowMs: 5000, maxFailures: 2, initialLockMs: 30, maxLockMs: 60 });
    rl.registerFailure("acc");
    expect(rl.lockStatus("acc").locked).toBe(false);
    rl.registerFailure("acc");
    const locked = rl.lockStatus("acc");
    expect(locked.locked).toBe(true);
    expect(locked.retryAfterMs).toBeGreaterThan(0);
    // expires
    await new Promise((r) => setTimeout(r, 80));
    expect(rl.lockStatus("acc").locked).toBe(false);
  });

  test("clearFailures resets the strike count", () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 99, failureWindowMs: 5000, maxFailures: 2, initialLockMs: 1000, maxLockMs: 2000 });
    rl.registerFailure("ok");
    rl.clearFailures("ok");
    rl.registerFailure("ok");
    expect(rl.lockStatus("ok").locked).toBe(false); // 1 strike after clear
  });
});

// ---------------------------------------------------------------------------
// PERMISSIONS (spec 8–10, 44–47)
// ---------------------------------------------------------------------------

describe("centralized permission model", () => {
  test("role → permission sets (spec 9)", () => {
    expect(can("OWNER", PERMISSIONS.ORGANIZATION_DELETE)).toBe(true);
    expect(can("ADMIN", PERMISSIONS.ORGANIZATION_DELETE)).toBe(false);
    expect(can("ADMIN", PERMISSIONS.AUTOMATION_MANAGE)).toBe(true);
    expect(can("ADMIN", PERMISSIONS.MEMBER_MANAGE)).toBe(true);
    expect(can("MEMBER", PERMISSIONS.AUTOMATION_MANAGE)).toBe(false); // spec 44
    expect(can("MEMBER", PERMISSIONS.AUTOMATION_READ)).toBe(true); // read-only
    expect(can("MEMBER", PERMISSIONS.LEAD_WRITE)).toBe(true);
    expect(can("MEMBER", PERMISSIONS.INTEGRATION_MANAGE)).toBe(false); // spec 45
    expect(can("VIEWER", PERMISSIONS.LEAD_WRITE)).toBe(false);
    expect(can("VIEWER", PERMISSIONS.LEAD_READ)).toBe(true);
    expect(can("MEMBER", PERMISSIONS.WORKER_HEALTH_READ)).toBe(false); // spec 46
    expect(can("MEMBER", PERMISSIONS.AUDIT_READ)).toBe(false); // spec 56
  });

  test("legacy roles normalize to MEMBER (spec 7 migration)", () => {
    expect(normalizeRole("MANAGER")).toBe("MEMBER");
    expect(normalizeRole("SALES_MANAGER")).toBe("MEMBER");
    expect(normalizeRole("OWNER")).toBe("OWNER");
    expect(can("MANAGER", PERMISSIONS.AUTOMATION_MANAGE)).toBe(false); // legacy cannot bypass
  });
});

// ---------------------------------------------------------------------------
// SESSION STORE (spec 16–18, 24)
// ---------------------------------------------------------------------------

describe("server-side session store", () => {
  test("create → validate → revoke; hash stored, never the token", async () => {
    const user = await mkUser(orgA.id, uniq("sess"), "MEMBER");
    const issued = await createSession(user.id, { ip: "1.2.3.4", userAgent: "test" });
    expect(issued.token).toBeTruthy();

    const row = await db.session.findUnique({ where: { tokenHash: hashToken(issued.token) } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).not.toBe(issued.token); // only the SHA-256 hash persists

    const v = await validateSessionToken(issued.token);
    expect(v.valid).toBe(true);
    expect(v.session!.userId).toBe(user.id);

    expect(await revokeSessionToken(issued.token)).toBe(true);
    const after = await validateSessionToken(issued.token);
    expect(after.valid).toBe(false);
    expect(after.reason).toBe("REVOKED");
  });

  test("idle expiry + absolute expiry (no eternal sessions, spec 18)", async () => {
    const user = await mkUser(orgA.id, uniq("expire"), "MEMBER");

    const idle = await createSession(user.id, {});
    await db.session.update({
      where: { tokenHash: hashToken(idle.token) },
      data: { idleExpiresAt: new Date(Date.now() - 1000) },
    });
    const v1 = await validateSessionToken(idle.token);
    expect(v1.valid).toBe(false);
    expect(v1.reason).toBe("IDLE_EXPIRED");

    const absolute = await createSession(user.id, {});
    await db.session.update({
      where: { tokenHash: hashToken(absolute.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const v2 = await validateSessionToken(absolute.token);
    expect(v2.valid).toBe(false);
    expect(v2.reason).toBe("EXPIRED");
  });

  test("logout everywhere revokes all sessions (spec 24)", async () => {
    const user = await mkUser(orgA.id, uniq("multi"), "MEMBER");
    await createSession(user.id, {});
    await createSession(user.id, {});
    await createSession(user.id, {});
    const revoked = await revokeAllUserSessions(user.id);
    expect(revoked).toBe(3);
    const remaining = await db.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(remaining).toBe(0);
  });

  test("disabled user invalidates sessions", async () => {
    const user = await mkUser(orgA.id, uniq("disabled"), "MEMBER");
    const issued = await createSession(user.id, {});
    await db.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    const v = await validateSessionToken(issued.token);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("USER_DISABLED");
  });
});

// ---------------------------------------------------------------------------
// LOGIN FLOW (spec 19–22, 99–100)
// ---------------------------------------------------------------------------

describe("performLogin", () => {
  test("success → session issued + audit row", async () => {
    const email = uniq("login-ok");
    await mkUser(orgA.id, email, "ADMIN", "Passw0rd!");
    const res = await performLogin(email, "Passw0rd!", { ip: uniq("ip1"), userAgent: "test" });
    expect(res.ok).toBe(true);
    expect(res.issued!.token).toBeTruthy();
    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgA.id, action: AUDIT_ACTIONS.LOGIN_SUCCESS },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  test("wrong password and unknown email give the SAME error (spec 22)", async () => {
    const email = uniq("login-bad");
    await mkUser(orgA.id, email, "MEMBER", "Passw0rd!");
    const wrong = await performLogin(email, "nope1234", { ip: uniq("ip2"), userAgent: "t" });
    const unknown = await performLogin(uniq("ghost"), "nope1234", { ip: uniq("ip3"), userAgent: "t" });
    expect(wrong.failure).toBe("INVALID");
    expect(unknown.failure).toBe("INVALID");
  });

  test("5 failures lock the account; even the CORRECT password is blocked (spec 99 brute-force QA)", async () => {
    const email = uniq("locked");
    await mkUser(orgA.id, email, "MEMBER", "Passw0rd!");
    let last = "" as string;
    for (let i = 0; i < 5; i++) {
      const r = await performLogin(email, "badpass1", { ip: uniq(`ip4-${i}`), userAgent: "t" });
      last = r.failure ?? "";
    }
    expect(last).toBe("INVALID"); // the 5th failure itself still answers INVALID
    const locked = await performLogin(email, "badpass1", { ip: uniq("ip4-x"), userAgent: "t" });
    expect(locked.failure).toBe("LOCKED");
    const good = await performLogin(email, "Passw0rd!", { ip: uniq("ip5"), userAgent: "t" });
    expect(good.failure).toBe("LOCKED"); // even the CORRECT password is blocked while locked
    const audit = await db.auditLog.findFirst({ where: { action: AUDIT_ACTIONS.LOGIN_LOCKED } });
    expect(audit).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SESSION RESOLUTION — membership revalidated every request (spec 12, 29, 80)
// ---------------------------------------------------------------------------

describe("resolveAuthenticatedSessionFromToken", () => {
  test("valid token → session with MEMBERSHIP role + permissions", async () => {
    const user = await mkUser(orgA.id, uniq("resolve"), "MEMBER");
    // deliberately stale role cache on the user row — membership is the truth
    await db.user.update({ where: { id: user.id }, data: { role: "OWNER" } });
    const issued = await createSession(user.id, {});
    const s = await resolveAuthenticatedSessionFromToken(issued.token);
    expect(s).not.toBeNull();
    expect(s!.role).toBe("MEMBER"); // from membership, NOT the user.role cache
    expect(s!.orgId).toBe(orgA.id);
    expect(s!.permissions).toContain(PERMISSIONS.LEAD_READ);
    expect(s!.permissions).not.toContain(PERMISSIONS.AUTOMATION_MANAGE);
  });

  test("garbage / revoked / missing tokens → null (401 in production)", async () => {
    expect(await resolveAuthenticatedSessionFromToken("garbage-token")).toBeNull();
    expect(await resolveAuthenticatedSessionFromToken(null)).toBeNull();
    const user = await mkUser(orgA.id, uniq("revoked"), "MEMBER");
    const issued = await createSession(user.id, {});
    await revokeSessionToken(issued.token);
    expect(await resolveAuthenticatedSessionFromToken(issued.token)).toBeNull();
  });

  test("membership lost with NO other org → session dead (spec 80)", async () => {
    const user = await mkUser(orgA.id, uniq("removed"), "MEMBER");
    const issued = await createSession(user.id, {});
    await db.organizationMember.deleteMany({ where: { userId: user.id } });
    expect(await resolveAuthenticatedSessionFromToken(issued.token)).toBeNull();
  });

  test("membership lost with a second org → SAFE FALLBACK to the other org (spec 29)", async () => {
    const user = await mkUser(orgA.id, uniq("fallback"), "ADMIN");
    await db.organizationMember.create({
      data: { organizationId: orgB.id, userId: user.id, role: "MEMBER", status: "ACTIVE" },
    });
    const issued = await createSession(user.id, {});
    await db.organizationMember.deleteMany({ where: { userId: user.id, organizationId: orgA.id } });
    const s = await resolveAuthenticatedSessionFromToken(issued.token);
    expect(s).not.toBeNull();
    expect(s!.orgId).toBe(orgB.id); // hopped to org B
    expect(s!.role).toBe("MEMBER"); // with the org B role, not the old ADMIN
    const userAfter = await db.user.findUnique({ where: { id: user.id } });
    expect(userAfter!.organizationId).toBe(orgB.id); // pointer self-healed
  });

  test("role escalation via the user.role cache is impossible — membership wins (spec 110)", async () => {
    const user = await mkUser(orgA.id, uniq("escalate"), "MEMBER");
    // attacker "PATCHes" their own role cache directly in the DB:
    await db.user.update({ where: { id: user.id }, data: { role: "OWNER" } });
    const issued = await createSession(user.id, {});
    const s = await resolveAuthenticatedSessionFromToken(issued.token);
    expect(s!.role).toBe("MEMBER");
    expect(s!.permissions).not.toContain(PERMISSIONS.ORGANIZATION_DELETE);
  });
});

// ---------------------------------------------------------------------------
// MEMBER SERVICE — last owner, admin scope, self-demotion (spec 33–36, 76, 110)
// ---------------------------------------------------------------------------

describe("member service guards", () => {
  test("MEMBER cannot invite (spec 73)", async () => {
    const member = await mkUser(orgA.id, uniq("m-member"), "MEMBER");
    const res = await createInvite(fakeSession(member.id, orgA.id, "MEMBER"), { email: uniq("new"), role: "MEMBER" });
    expect(isErr(res) && res.status === 403).toBe(true);
  });

  test("OWNER cannot be granted via invite (spec 32)", async () => {
    const owner = await mkUser(orgA.id, uniq("m-owner"), "OWNER");
    const res = await createInvite(fakeSession(owner.id, orgA.id, "OWNER"), { email: uniq("new"), role: "OWNER" });
    expect(isErr(res) && res.status === 400).toBe(true);
  });

  test("ADMIN may invite MEMBER but not ADMIN (spec 30–32)", async () => {
    const admin = await mkUser(orgA.id, uniq("m-admin"), "ADMIN");
    const okRes = await createInvite(fakeSession(admin.id, orgA.id, "ADMIN"), { email: uniq("inv-ok"), role: "MEMBER" });
    expect("ok" in okRes).toBe(true);
    const badRes = await createInvite(fakeSession(admin.id, orgA.id, "ADMIN"), { email: uniq("inv-bad"), role: "ADMIN" });
    expect("status" in badRes && badRes.status === 403).toBe(true);
  });

  test("already-member email cannot be invited", async () => {
    const owner = await mkUser(orgA.id, uniq("m-own2"), "OWNER");
    const member = await mkUser(orgA.id, uniq("m-dup"), "MEMBER");
    const res = await createInvite(fakeSession(owner.id, orgA.id, "OWNER"), { email: member.email, role: "MEMBER" });
    expect(isErr(res) && res.status === 400).toBe(true);
  });

  test("LAST OWNER demotion blocked with 409 (spec 33, 76, 36)", async () => {
    // dedicated org so this owner is genuinely the LAST one
    const soloOrg = await mkOrg("SoloOrg");
    const owner = await mkUser(soloOrg.id, uniq("m-lastowner"), "OWNER");
    const admin = await mkUser(soloOrg.id, uniq("m-admin2"), "ADMIN");
    const ownerMembership = await db.organizationMember.findFirst({
      where: { organizationId: soloOrg.id, userId: owner.id },
    });
    expect(ownerMembership).not.toBeNull();
    // even the OWNER themself cannot demote the last owner
    const res = await changeMemberRole(fakeSession(owner.id, soloOrg.id, "OWNER"), ownerMembership!.id, "MEMBER");
    expect(isErr(res) && res.status === 409).toBe(true);
    void admin;
  });

  test("ADMIN cannot manage OWNER or ADMIN rows (spec 35)", async () => {
    const owner = await mkUser(orgA.id, uniq("m-own3"), "OWNER");
    const admin = await mkUser(orgA.id, uniq("m-adm3"), "ADMIN");
    const admin2 = await mkUser(orgA.id, uniq("m-adm4"), "ADMIN");
    const m2 = await db.organizationMember.findFirst({ where: { organizationId: orgA.id, userId: admin2.id } });
    // admin changing admin
    const r1 = await changeMemberRole(fakeSession(admin.id, orgA.id, "ADMIN"), m2!.id, "MEMBER");
    expect(isErr(r1) && r1.status === 403).toBe(true);
    // admin removing admin
    const r2 = await removeMember(fakeSession(admin.id, orgA.id, "ADMIN"), m2!.id);
    expect(isErr(r2) && r2.status === 403).toBe(true);
    void owner;
  });

  test("OWNER demotes ADMIN→MEMBER and the user.role cache syncs", async () => {
    const owner = await mkUser(orgA.id, uniq("m-own4"), "OWNER");
    const victim = await mkUser(orgA.id, uniq("m-victim"), "ADMIN");
    const m = await db.organizationMember.findFirst({ where: { organizationId: orgA.id, userId: victim.id } });
    const res = await changeMemberRole(fakeSession(owner.id, orgA.id, "OWNER"), m!.id, "MEMBER");
    expect(res).toBe(true);
    const userAfter = await db.user.findUnique({ where: { id: victim.id } });
    expect(userAfter!.role).toBe("MEMBER");
  });

  test("cannot change own role (self-demotion guard, spec 36)", async () => {
    const owner = await mkUser(orgA.id, uniq("m-own5"), "OWNER");
    const helper = await mkUser(orgA.id, uniq("m-helper"), "ADMIN");
    const ownerM = await db.organizationMember.findFirst({ where: { organizationId: orgA.id, userId: owner.id } });
    const res = await changeMemberRole(fakeSession(owner.id, orgA.id, "OWNER"), ownerM!.id, "MEMBER");
    expect(isErr(res) && res.status === 400).toBe(true);
    void helper;
  });

  test("OWNER removes a member → their session in this org dies immediately", async () => {
    const owner = await mkUser(orgA.id, uniq("m-own6"), "OWNER");
    const victim = await mkUser(orgA.id, uniq("m-victim2"), "MEMBER");
    const issued = await createSession(victim.id, {});
    const m = await db.organizationMember.findFirst({ where: { organizationId: orgA.id, userId: victim.id } });
    const res = await removeMember(fakeSession(owner.id, orgA.id, "OWNER"), m!.id);
    expect(res).toBe(true);
    expect(await resolveAuthenticatedSessionFromToken(issued.token)).toBeNull(); // spec 80, 112
  });
});

// ---------------------------------------------------------------------------
// INVITE LIFECYCLE (spec 30–32, 78–79)
// ---------------------------------------------------------------------------

describe("invite acceptance", () => {
  test("new user accepts (name+password) → membership + session; reuse FAILS (spec 78)", async () => {
    const owner = await mkUser(orgA.id, uniq("i-owner"), "OWNER");
    const email = uniq("invited-new");
    const inviteRes = await createInvite(fakeSession(owner.id, orgA.id, "OWNER"), { email, role: "MEMBER" });
    expect(isErr(inviteRes)).toBe(false);
    const token = isErr(inviteRes) ? "" : inviteRes.token;

    const accepted = await acceptInvite({ token, name: "New Person", password: "Passw0rd!", meta: { ip: "9.9.9.9", userAgent: "t" } });
    expect(accepted.ok).toBe(true);
    expect(accepted.issued).toBeTruthy();
    expect(accepted.organization!.id).toBe(orgA.id);

    const member = await db.organizationMember.findFirst({
      where: { organizationId: orgA.id, user: { email } },
    });
    expect(member!.role).toBe("MEMBER");

    const reused = await acceptInvite({ token, name: "X", password: "Passw0rd!", meta: { ip: "9.9.9.9", userAgent: "t" } });
    expect(reused.ok).toBe(false);
    expect(reused.failure).toBe("ALREADY_USED");
  });

  test("expired invite FAILS (spec 79)", async () => {
    const owner = await mkUser(orgA.id, uniq("i-owner2"), "OWNER");
    const email = uniq("invited-exp");
    const inviteRes = await createInvite(fakeSession(owner.id, orgA.id, "OWNER"), { email, role: "MEMBER" });
    const token = isErr(inviteRes) ? "" : inviteRes.token;
    await db.organizationInvite.updateMany({
      where: { email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await acceptInvite({ token, name: "X", password: "Passw0rd!", meta: { ip: "8.8.8.8", userAgent: "t" } });
    expect(res.failure).toBe("EXPIRED");
  });

  test("revoked invite FAILS", async () => {
    const owner = await mkUser(orgA.id, uniq("i-owner3"), "OWNER");
    const email = uniq("invited-rev");
    const inviteRes = await createInvite(fakeSession(owner.id, orgA.id, "OWNER"), { email, role: "MEMBER" });
    const token = isErr(inviteRes) ? "" : inviteRes.token;
    await db.organizationInvite.updateMany({ where: { email }, data: { status: "REVOKED" } });
    const res = await acceptInvite({ token, name: "X", password: "Passw0rd!", meta: { ip: "7.7.7.7", userAgent: "t" } });
    expect(res.failure).toBe("REVOKED");
  });

  test("existing-user invite requires the matching session (spec 12 — no client trust)", async () => {
    const owner = await mkUser(orgA.id, uniq("i-owner4"), "OWNER");
    const existing = await mkUser(orgB.id, uniq("i-existing"), "MEMBER");
    const inviteRes = await createInvite(fakeSession(owner.id, orgA.id, "OWNER"), { email: existing.email, role: "MEMBER" });
    const token = isErr(inviteRes) ? "" : inviteRes.token;

    // no session → rejected
    const no = await acceptInvite({ token, meta: { ip: "6.6.6.6", userAgent: "t" } });
    expect(no.failure).toBe("SIGN_IN_REQUIRED");
    // WRONG session → rejected
    const other = await mkUser(orgB.id, uniq("i-other"), "MEMBER");
    const wrong = await acceptInvite({ token, sessionUserId: other.id, meta: { ip: "6.6.6.6", userAgent: "t" } });
    expect(wrong.failure).toBe("SIGN_IN_REQUIRED");
    // matching session → joins org A
    const yes = await acceptInvite({ token, sessionUserId: existing.id, meta: { ip: "6.6.6.6", userAgent: "t" } });
    expect(yes.ok).toBe(true);
    const memberships = await db.organizationMember.count({ where: { userId: existing.id } });
    expect(memberships).toBe(2); // org B + org A (spec 27: user in multiple orgs)
  });

  test("mintInviteToken rotates tokens (resend = old link dies)", async () => {
    const owner = await mkUser(orgA.id, uniq("i-owner5"), "OWNER");
    const email = uniq("invited-rot");
    const inviteRes = await createInvite(fakeSession(owner.id, orgA.id, "OWNER"), { email, role: "MEMBER" });
    const oldToken = isErr(inviteRes) ? "" : inviteRes.token;
    const inviteId = isErr(inviteRes) ? "" : inviteRes.inviteId;
    const newToken = await mintInviteToken(inviteId);
    expect(newToken).not.toBe(oldToken);
    const res = await acceptInvite({ token: oldToken, name: "X", password: "Passw0rd!", meta: { ip: "5.5.5.5", userAgent: "t" } });
    expect(res.failure).toBe("INVALID"); // old token no longer resolves
  });
});

// ---------------------------------------------------------------------------
// CROSS-TENANT DATA ACCESS (spec 71–72, 116)
// ---------------------------------------------------------------------------

describe("cross-tenant isolation", () => {
  test("org B context cannot update an org A lead (write blocked, spec 72/116)", async () => {
    const ownerA = await mkUser(orgA.id, uniq("ct-a"), "OWNER");
    const source = await db.leadSource.create({
      data: { organizationId: orgA.id, name: `Web-${RUN}`, type: "website" },
    });
    const lead = await db.lead.create({
      data: {
        organizationId: orgA.id,
        firstName: "Cross",
        lastName: "Tenant",
        status: "NEW",
        priority: "MEDIUM",
        sourceId: source.id,
      },
    });
    void ownerA;
    // org B actor attempts to update org A's lead through the service layer:
    let blocked = false;
    try {
      await updateLead(orgB.id, lead.id, "attacker-user", { priority: "URGENT" });
    } catch {
      blocked = true; // LEAD_NOT_FOUND — existence is not even revealed
    }
    expect(blocked).toBe(true);
    const unchanged = await db.lead.findUnique({ where: { id: lead.id } });
    expect(unchanged!.priority).toBe("MEDIUM");
  });
});

// ---------------------------------------------------------------------------
// DEMO ISOLATION (spec 25–26, 83, 113)
// ---------------------------------------------------------------------------

describe("demo isolation", () => {
  test("a demo-org user has NO reach into real orgs — membership is the wall", async () => {
    const demoUser = await mkUser(demoOrg.id, uniq("demo-user"), "OWNER");
    // the demo user is a member of the demo org ONLY
    const memberships = await db.organizationMember.findMany({ where: { userId: demoUser.id } });
    expect(memberships.map((m) => m.organizationId)).toEqual([demoOrg.id]);

    const issued = await createSession(demoUser.id, {});
    const s = await resolveAuthenticatedSessionFromToken(issued.token);
    expect(s!.organization.isDemo).toBe(true);
    expect(s!.orgId).toBe(demoOrg.id);

    // even if the demo user is (illegally) pointed at a real org, the
    // membership check kicks them back into the demo org:
    await db.user.update({ where: { id: demoUser.id }, data: { organizationId: orgA.id } });
    const s2 = await resolveAuthenticatedSessionFromToken(issued.token);
    expect(s2!.orgId).toBe(demoOrg.id); // never org A
    expect(s2!.organization.isDemo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AUDIT LOG (spec 52–55)
// ---------------------------------------------------------------------------

describe("security audit log", () => {
  test("records actor-typed entries (spec 39–41: system actors are not fake users)", async () => {
    await recordAudit({
      organizationId: orgA.id,
      actorType: "AUTOMATION",
      action: AUDIT_ACTIONS.AUTOMATION_ENABLED,
      resourceType: "automation",
      resourceId: "rule-1",
      metadata: { name: "Test rule" },
    });
    const row = await db.auditLog.findFirst({
      where: { organizationId: orgA.id, action: AUDIT_ACTIONS.AUTOMATION_ENABLED },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.actorType).toBe("AUTOMATION");
    expect(row!.actorUserId).toBeNull(); // no fake worker@system user
  });
});

// ---------------------------------------------------------------------------
// PERSONAL PREFERENCES + RECIPIENT LOCALE (spec 48, 50)
// ---------------------------------------------------------------------------

describe("personal notification preferences (user-owned storage)", () => {
  test("set + get roundtrip persists per-event channel toggles", async () => {
    const user = await mkUser(orgA.id, uniq("prefs"), "MEMBER");
    const { parseChannelPreferences } = await import("../src/lib/leados/delivery/channels");
    const types = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    types.STAGE_AGING = false;
    const channels = parseChannelPreferences(null);
    channels.FOLLOW_UP_OVERDUE.email = true;
    channels.FOLLOW_UP_OVERDUE.telegram = true;
    await setNotificationPreferences(user.id, types, channels);
    const loaded = await getFullNotificationPreferences(user.id);
    expect(loaded.types.STAGE_AGING).toBe(false);
    expect(loaded.channels.FOLLOW_UP_OVERDUE.email).toBe(true);
    expect(loaded.channels.FOLLOW_UP_OVERDUE.telegram).toBe(true);
    // user-owned rows — org Settings untouched:
    const orgSettings = await db.setting.count({
      where: { organizationId: orgA.id, key: { startsWith: "notification_preferences" } },
    });
    expect(orgSettings).toBe(0);
  });

  test("fan-out renders in the RECIPIENT'S locale, not the org's (spec 48)", async () => {
    const { fanoutNotificationDeliveries } = await import("../src/lib/leados/delivery/fanout");
    const orgRu = await mkOrg("LocaleOrg"); // org locale: hy (default)
    const userRu = await db.user.create({
      data: { organizationId: orgRu.id, name: "ru", email: uniq("ru-user"), role: "MEMBER", status: "ACTIVE", locale: "ru" },
    });
    await db.organizationMember.create({ data: { organizationId: orgRu.id, userId: userRu.id, role: "MEMBER" } });
    await db.userNotificationPreference.create({
      data: { userId: userRu.id, eventType: "FOLLOW_UP_OVERDUE", inApp: true, email: true, telegram: false },
    });
    const pipeline = await db.pipeline.create({ data: { organizationId: orgRu.id, name: "P", isDefault: true } });
    const stage = await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } });
    const lead = await db.lead.create({
      data: { organizationId: orgRu.id, firstName: "Locale", lastName: "Test", stageId: stage.id, status: "NEW", priority: "HIGH" },
    });
    const event = await db.domainEvent.create({
      data: {
        organizationId: orgRu.id,
        type: "FOLLOW_UP_OVERDUE",
        entityType: "lead",
        entityId: lead.id,
        occurredAt: new Date(),
        deduplicationKey: `locale-test-${RUN}`,
        payload: { leadName: "Locale Test", taskTitle: "Follow up", overdueMinutes: 120 },
      },
    });
    await db.notification.create({
      data: {
        organizationId: orgRu.id,
        userId: userRu.id,
        eventId: event.id,
        leadId: lead.id,
        type: "FOLLOW_UP_OVERDUE",
        templateKey: "notif.fu_overdue.title",
        payload: { leadName: "Locale Test", taskTitle: "Follow up", overdueMinutes: 120 },
        severity: "CRITICAL",
        title: "placeholder",
        message: "placeholder",
        deepLink: `lead/${lead.id}`,
      },
    });
    await fanoutNotificationDeliveries(orgRu.id);
    const delivery = await db.notificationDelivery.findFirst({
      where: { organizationId: orgRu.id, channel: "EMAIL", recipient: userRu.id },
      orderBy: { createdAt: "desc" },
    });
    expect(delivery).not.toBeNull();
    const payload = (delivery!.payload ?? {}) as { subject?: string };
    // The org locale is hy, but the recipient chose ru → Russian subject
    // ("Следующий шаг просрочен").
    expect(payload.subject).toContain("просрочен");
  });
});
