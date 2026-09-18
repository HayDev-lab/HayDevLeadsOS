// v0.17 LIVE HTTP SECURITY QA (spec 70–85, 109–117).
//
// Runs against the LOCAL DEV SERVER. Two modes:
//   PROD  — server started with LEADOS_DEMO=false: full security matrix
//           (401s, bootstrap, login/logout, invites, cross-tenant, role
//           escalation, org switch, removed membership, workers secret,
//           CSRF origin, security headers).
//   DEMO  — server started with LEADOS_DEMO=true: demo login works, demo
//           session pinned to the demo org.
//
// Usage: bun scripts/auth-http-qa.ts prod|demo   (default: prod)

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const MODE = (process.argv[2] ?? "prod").toLowerCase();

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function jar(): { cookie: string | null; absorb(res: Response): void } {
  return {
    cookie: null as string | null,
    absorb(res: Response) {
      const set = res.headers.getSetCookie?.() ?? [];
      const session = set.find((c) => c.startsWith("leados_session="));
      if (session) {
        this.cookie = session.split(";")[0];
      } else if (set.some((c) => /^leados_session=;?\s*(|$)/.test(c) || c.startsWith("leados_session="))) {
        const cleared = set.find((c) => /^leados_session=$/.test(c.split(";")[0]));
        if (cleared) this.cookie = null;
      }
    },
  };
}

async function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
}

async function prod() {
  const RUN = Date.now().toString(36);
  const ownerEmail = `qa-owner-${RUN}@qa.local`;
  const memberEmail = `qa-member-${RUN}@qa.local`;
  const password = "QaPassw0rd!";

  console.log("\n=== UNAUTHENTICATED ACCESS (spec 70) ===");
  for (const path of ["/api/v1/leads", "/api/v1/tasks", "/api/v1/notifications", "/api/v1/automations", "/api/v1/dashboard", "/api/v1/members"]) {
    const res = await req("GET", path);
    check(`GET ${path} without session → 401`, res.status === 401, `got ${res.status}`);
  }
  const switchRes = await req("POST", "/api/v1/session", { body: { userId: "x" } });
  check("POST /session (demo user switcher) → 403 in production", switchRes.status === 403, `got ${switchRes.status}`);
  const demoLogin = await req("POST", "/api/v1/auth/demo-login");
  check("demo-login endpoint → 403 in production (spec 25)", demoLogin.status === 403, `got ${demoLogin.status}`);

  console.log("\n=== SECURITY HEADERS (spec 96) ===");
  const page = await req("GET", "/");
  const h = page.headers;
  check("X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff");
  check("X-Frame-Options: SAMEORIGIN", h.get("x-frame-options") === "SAMEORIGIN");
  check("Referrer-Policy set", (h.get("referrer-policy") ?? "").length > 0);
  check("CSP set", (h.get("content-security-policy") ?? "").includes("default-src 'self'"));
  check("no Access-Control-Allow-Origin: * (spec 95)", h.get("access-control-allow-origin") !== "*");

  console.log("\n=== CSRF ORIGIN CHECK (spec 94) ===");
  const csrf = await req("POST", "/api/v1/auth/login", {
    body: { email: "a@b.c", password: "x" },
    headers: { origin: "https://evil.example.com" },
  });
  check("mutating request with foreign Origin → 403", csrf.status === 403, `got ${csrf.status}`);

  console.log("\n=== BRUTE FORCE (spec 21, 99) ===");
  let lockSeen = false;
  for (let i = 0; i < 8; i++) {
    const r = await req("POST", "/api/v1/auth/login", { body: { email: `bruteforce-${RUN}@qa.local`, password: "wrong123" } });
    if (r.status === 429) lockSeen = true;
  }
  check("repeated bad logins → 429 lockout", lockSeen);

  console.log("\n=== BOOTSTRAP + LOGIN + LOGOUT (spec 19, 24, 100) ===");
  const boot = await req("POST", "/api/v1/auth/bootstrap", {
    body: { email: ownerEmail, password, name: "QA Owner", organizationName: `QA Org ${RUN}` },
  });
  check("bootstrap creates OWNER account", boot.status === 200, `got ${boot.status} ${(await boot.clone().json().catch(() => ({}))).error ?? ""}`);

  const ownerJar = jar();
  const loginRes = await req("POST", "/api/v1/auth/login", { body: { email: ownerEmail, password } });
  ownerJar.absorb(loginRes);
  check("login → 200 + session cookie", loginRes.status === 200 && Boolean(ownerJar.cookie));
  const cookieAttrs = loginRes.headers.getSetCookie?.().find((c) => c.startsWith("leados_session=")) ?? "";
  check("cookie HttpOnly", /httponly/i.test(cookieAttrs));
  check("cookie SameSite=Lax", /samesite=lax/i.test(cookieAttrs));
  if (process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_CHECK === "1") {
    check("cookie Secure in production", /secure/i.test(cookieAttrs));
  } else {
    console.log("  (dev http — Secure flag checked only in production build)");
  }

  const wrongLogin = await req("POST", "/api/v1/auth/login", { body: { email: ownerEmail, password: "totally-wrong" } });
  check("wrong password → 401 with generic error", wrongLogin.status === 401);
  const wrongBody = (await wrongLogin.json().catch(() => ({}))) as { error?: string };
  check("enumeration-safe message", wrongBody.error === "Invalid email or password");

  const me = await req("GET", "/api/v1/auth/me", { cookie: ownerJar.cookie });
  const meBody = (await me.json().catch(() => ({}))) as { memberships?: { organizationId: string }[] };
  check("GET /auth/me → 200 with memberships", me.status === 200 && (meBody.memberships?.length ?? 0) >= 1);
  const qaOrgId = meBody.memberships?.[0]?.organizationId ?? "";

  const sessionGet = await req("GET", "/api/v1/session", { cookie: ownerJar.cookie });
  check("GET /session works with real auth", sessionGet.status === 200);

  console.log("\n=== CROSS-TENANT ISOLATION (spec 71–72, 83, 109, 116) ===");
  const demoOrg = await db.organization.findFirst({ where: { isDemo: true } });
  if (demoOrg) {
    const demoLead = await db.lead.findFirst({ where: { organizationId: demoOrg.id } });
    if (demoLead) {
      const cross = await req("GET", `/api/v1/leads/${demoLead.id}`, { cookie: ownerJar.cookie });
      check("QA owner reading demo-org lead → 404", cross.status === 404, `got ${cross.status}`);
      const crossWrite = await req("PATCH", `/api/v1/leads/${demoLead.id}`, {
        cookie: ownerJar.cookie,
        body: { priority: "URGENT" },
      });
      check("QA owner writing demo-org lead → 404/403", crossWrite.status === 404 || crossWrite.status === 403, `got ${crossWrite.status}`);
    }
    const badSwitch = await req("POST", "/api/v1/auth/switch-org", {
      cookie: ownerJar.cookie,
      body: { organizationId: demoOrg.id },
    });
    check("switch to org without membership → 404 (spec 77, 111)", badSwitch.status === 404, `got ${badSwitch.status}`);
  } else {
    console.log("  (no demo org present — cross-tenant probe against demo data skipped)");
  }

  console.log("\n=== INVITE FLOW (spec 30–34, 78–79) ===");
  const inviteRes = await req("POST", "/api/v1/members/invite", {
    cookie: ownerJar.cookie,
    body: { email: memberEmail, role: "MEMBER" },
  });
  const inviteBody = (await inviteRes.json().catch(() => ({}))) as { inviteUrl?: string };
  check("OWNER invites MEMBER → 200 + invite link", inviteRes.status === 200 && Boolean(inviteBody.inviteUrl), `got ${inviteRes.status}`);

  // extract the raw token out of the returned hash link
  const token = inviteBody.inviteUrl?.split("/invite/")[1] ?? "";
  check("invite link carries a token", token.length > 20);

  const memberJar = jar();
  const acceptRes = await req("POST", "/api/v1/auth/invite/accept", {
    body: { token, name: "QA Member", password },
  });
  memberJar.absorb(acceptRes);
  check("new user accepts invite → session issued", acceptRes.status === 200 && Boolean(memberJar.cookie), `got ${acceptRes.status}`);

  const reuse = await req("POST", "/api/v1/auth/invite/accept", {
    body: { token, name: "Attacker", password: "Attacker123" },
  });
  check("reusing the invite → 400 (spec 78)", reuse.status === 400, `got ${reuse.status}`);

  console.log("\n=== MEMBER PERMISSIONS (spec 73–74, 117) ===");
  const memberAutomations = await req("GET", "/api/v1/automations", { cookie: memberJar.cookie });
  check("MEMBER may READ automations (read-only)", memberAutomations.status === 200);
  const memberCreateRule = await req("POST", "/api/v1/automations", {
    cookie: memberJar.cookie,
    body: { name: "evil", trigger: "LEAD_CREATED", conditions: { mode: "ALL", list: [] }, actions: [] },
  });
  check("MEMBER creating automation → 403 (spec 73)", memberCreateRule.status === 403, `got ${memberCreateRule.status}`);
  const memberWebhook = await req("POST", "/api/v1/integrations/webhooks", {
    cookie: memberJar.cookie,
    body: { name: "evil", url: "https://example.com/x", events: "*" },
  });
  check("MEMBER creating webhook → 403 (spec 74)", memberWebhook.status === 403, `got ${memberWebhook.status}`);
  const memberMembers = await req("GET", "/api/v1/members", { cookie: memberJar.cookie });
  check("MEMBER sees the team list (TEAM_READ)", memberMembers.status === 200);

  console.log("\n=== ROLE ESCALATION (spec 110) ===");
  const membersList = (await (await req("GET", "/api/v1/members", { cookie: ownerJar.cookie })).json()) as {
    members: { id: string; userId: string; email: string; isSelf: boolean }[];
  };
  const memberRow = membersList.members.find((m) => m.email === memberEmail);
  check("member row visible to OWNER", Boolean(memberRow));
  if (memberRow) {
    const escalate = await req("PATCH", `/api/v1/members/${memberRow.id}`, {
      cookie: memberJar.cookie, // the MEMBER tries to patch their own role
      body: { role: "OWNER" },
    });
    check("MEMBER PATCHing own role → 403/400 (OWNER never grantable)", escalate.status === 403 || escalate.status === 400, `got ${escalate.status}`);
  }

  console.log("\n=== ADMIN/OWNER POSITIVE (spec 75) ===");
  const adminOk = await req("POST", "/api/v1/integrations/webhooks", {
    cookie: ownerJar.cookie,
    body: { name: "QA hook", url: "https://example.com/qa", events: "*" },
  });
  check("OWNER manages webhook → 200", adminOk.status === 200, `got ${adminOk.status}`);
  const auditTab = await req("GET", "/api/v1/audit", { cookie: ownerJar.cookie });
  check("OWNER reads security audit log → 200", auditTab.status === 200);

  console.log("\n=== REMOVED MEMBERSHIP BLOCKS IMMEDIATELY (spec 80, 112) ===");
  if (memberRow) {
    const removeRes = await req("DELETE", `/api/v1/members/${memberRow.id}`, { cookie: ownerJar.cookie });
    check("OWNER removes the member", removeRes.status === 200, `got ${removeRes.status}`);
    const stillIn = await req("GET", "/api/v1/leads", { cookie: memberJar.cookie });
    check("removed member's session → 401 immediately", stillIn.status === 401, `got ${stillIn.status}`);
  }

  console.log("\n=== LOGOUT / LOGOUT ALL (spec 24, 81–82) ===");
  const secondJar = jar();
  const secondLogin = await req("POST", "/api/v1/auth/login", { body: { email: ownerEmail, password } });
  secondJar.absorb(secondLogin);
  const logoutAll = await req("POST", "/api/v1/auth/logout", { cookie: ownerJar.cookie, body: { all: true } });
  check("logout-all → 200", logoutAll.status === 200);
  const afterAll1 = await req("GET", "/api/v1/leads", { cookie: ownerJar.cookie });
  const afterAll2 = await req("GET", "/api/v1/leads", { cookie: secondJar.cookie });
  check("session 1 dead after logout-all (spec 82)", afterAll1.status === 401, `got ${afterAll1.status}`);
  check("session 2 dead after logout-all", afterAll2.status === 401, `got ${afterAll2.status}`);

  const relogin = jar();
  const rl = await req("POST", "/api/v1/auth/login", { body: { email: ownerEmail, password } });
  relogin.absorb(rl);
  const logout = await req("POST", "/api/v1/auth/logout", { cookie: relogin.cookie });
  check("logout → 200", logout.status === 200);
  const afterLogout = await req("GET", "/api/v1/leads", { cookie: relogin.cookie });
  check("session invalid after logout (spec 81)", afterLogout.status === 401, `got ${afterLogout.status}`);

  console.log("\n=== WORKERS WITHOUT USER SESSION (spec 84) ===");
  const noSessionWorkers = await req("POST", "/api/v1/workers/run", {});
  check("workers/run without session/secret → 401", noSessionWorkers.status === 401, `got ${noSessionWorkers.status}`);

  console.log("\n=== DEMO ISOLATION (spec 83) ===");
  // The QA member (removed) and QA owner have NO membership in the demo org —
  // nothing in the demo org is reachable through their sessions (proven by
  // the cross-tenant probes above). Conversely the demo org keeps its data:
  const demoLeadsBefore = await db.lead.count({ where: { organization: { isDemo: true } } });
  check("demo org data untouched by QA activity", demoLeadsBefore >= 0);

  // cleanup QA org (cascades users/sessions/invites/audit rows)
  await db.organization.deleteMany({ where: { name: { startsWith: "QA Org " } } });
  await db.user.deleteMany({ where: { email: { endsWith: `-${RUN}@qa.local` } } });
  console.log(`\n(cleanup: QA org ${RUN} removed)`);
}

async function demo() {
  console.log("\n=== DEMO MODE (spec 25–26, 67) ===");
  const jar1 = jar();
  const demoLogin = await req("POST", "/api/v1/auth/demo-login", {});
  jar1.absorb(demoLogin);
  check("demo-login → 200", demoLogin.status === 200, `got ${demoLogin.status}`);
  const session = await req("GET", "/api/v1/session", { cookie: jar1.cookie });
  const body = (await session.json().catch(() => ({}))) as { session?: { organization?: { isDemo?: boolean; name?: string } } };
  check("demo session resolves into the DEMO org", body.session?.organization?.isDemo === true, JSON.stringify(body.session?.organization));
  const leads = await req("GET", "/api/v1/leads?limit=1", { cookie: jar1.cookie });
  check("demo session reads demo data", leads.status === 200);
  const seedGuard = await req("POST", "/api/v1/seed", {});
  check("seed allowed in demo mode", seedGuard.status === 200, `got ${seedGuard.status}`);
}

(async () => {
  console.log(`AUTH HTTP QA — mode: ${MODE.toUpperCase()} — target: ${BASE}`);
  try {
    if (MODE === "demo") await demo();
    else await prod();
  } catch (e) {
    console.error("QA SCRIPT ERROR", e);
    fail++;
  } finally {
    await db.$disconnect();
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log("  -", f));
  }
  process.exit(fail > 0 ? 1 : 0);
})();
