// EVENT ENGINE (v0.14) — INTEGRATION tests against the real SQLite database.
// Run with: bun test tests/event-engine.test.ts
//
// Every test runs inside a THROWAWAY organization (deleted afterwards with
// cascade — the demo org is never touched). Covers the spec's critical
// scenarios: idempotency (Sections 60, 104, 118), time-based detection (61),
// follow-up cycles (62–63), resolutions (65–67), read ≠ resolve (68, 106),
// multi-issue (67, 107), tenant isolation (70, 108), preferences (99),
// crash recovery (92), assignment events (98) and the 500-lead scale test (95).

/// <reference types="bun-types" />
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  firstResponseBreachedDedupKey,
  leadAssignedDedupKey,
  stageStaleDedupKey,
  followUpOverdueDedupKey,
  taskOverdueDedupKey,
} from "../src/lib/domain-events";
import {
  publishDomainEvent,
  reprocessUnprocessedEvents,
  resolveNotificationRecipients,
} from "../src/lib/leados/domain-event-service";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveFollowUpNotifications,
  resolveStageNotifications,
  setNotificationPreferences,
  getNotificationPreferences,
} from "../src/lib/leados/notification-service";
import { runEventReconciliation } from "../src/lib/leados/event-reconciler";
import { changeStage, assignLead } from "../src/lib/leados/lead-service";
import {
  completeFollowUp,
  rescheduleFollowUp,
  scheduleFollowUp,
} from "../src/lib/leados/followup-sla-service";

const db = new PrismaClient();

const SLUG = `event-engine-test-${Date.now()}`;

let orgId = "";
let ownerA = ""; // OWNER — fallback recipient
let managerB = ""; // MANAGER — second recipient
let managerC = ""; // MANAGER — assignment target
let stageNew = "";
let stageProposal = "";
let stageMeeting = "";
let stageWon = "";

const iso = (d: Date) => d.toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000);

async function mkUser(name: string, email: string, role: string) {
  const u = await db.user.create({
    data: { organizationId: orgId, name, email, role, status: "ACTIVE" },
  });
  return u.id;
}

/** A lead with an explicit stage entry age and optional owner. */
async function mkLead(opts: {
  name: string;
  stageId: string;
  stageAgeHours?: number;
  ownerId?: string | null;
  createdAt?: Date;
  firstResponseHoursAgo?: number;
}) {
  const created = opts.createdAt ?? hoursAgo(opts.stageAgeHours ?? 1);
  return db.lead.create({
    data: {
      organizationId: orgId,
      firstName: opts.name,
      company: `${opts.name} Co`,
      status: "OPEN",
      pipelineId: (await db.pipelineStage.findUnique({ where: { id: opts.stageId } }))!.pipelineId,
      stageId: opts.stageId,
      ownerId: opts.ownerId === undefined ? managerB : opts.ownerId,
      priority: "MEDIUM",
      stageEnteredAt: hoursAgo(opts.stageAgeHours ?? 1),
      createdAt: created,
    },
  });
}

async function notificationsFor(org: string, type: string) {
  return db.notification.findMany({
    where: { organizationId: org, type },
    orderBy: { createdAt: "asc" },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: "Event Engine Test", slug: SLUG, locale: "en", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  orgId = org.id;
  ownerA = await mkUser("Owner A", "owner-a@test.local", "OWNER");
  managerB = await mkUser("Manager B", "manager-b@test.local", "MANAGER");
  managerC = await mkUser("Manager C", "manager-c@test.local", "MANAGER");

  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "Test Pipeline", isDefault: true },
  });
  const mkStage = (name: string, type: string, position: number) =>
    db.pipelineStage.create({
      data: { pipelineId: pipeline.id, name, type, position },
    });
  stageNew = (await mkStage("New", "open", 0)).id;
  stageProposal = (await mkStage("Proposal", "open", 1)).id;
  stageMeeting = (await mkStage("Meeting", "open", 2)).id;
  stageWon = (await mkStage("Won", "won", 3)).id;
});

afterAll(async () => {
  // Cascade removes users, leads, events, notifications of the temp org.
  await db.organization.delete({ where: { id: orgId } }).catch(() => {});
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Publishing, idempotency, projector recovery (Sections 60, 88–92, 118)
// ---------------------------------------------------------------------------

describe("event store idempotency", () => {
  test("same dedup key published twice → ONE event, ONE notification per recipient", async () => {
    const lead = await mkLead({ name: "Idem Lead", stageId: stageProposal, stageAgeHours: 1 });
    const input = {
      type: DOMAIN_EVENT.STAGE_BECAME_STALE,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: hoursAgo(2),
      deduplicationKey: stageStaleDedupKey(lead.id, hoursAgo(2)),
      payload: {
        leadId: lead.id,
        leadName: "Idem Lead",
        stageName: "Proposal",
        ownerId: managerB,
      },
    };
    const first = await publishDomainEvent(orgId, input);
    expect(first.created).toBe(true);
    expect(first.projection.notificationsCreated).toBe(1);

    const second = await publishDomainEvent(orgId, input);
    expect(second.created).toBe(false);
    expect(second.projection.notificationsCreated).toBe(0);

    const events = await db.domainEvent.findMany({
      where: { organizationId: orgId, deduplicationKey: input.deduplicationKey },
    });
    expect(events).toHaveLength(1);
    const notifs = await notificationsFor(orgId, DOMAIN_EVENT.STAGE_BECAME_STALE);
    expect(notifs.filter((n) => n.entityId === lead.id)).toHaveLength(1);
  });

  test("projector crash recovery: unprocessed event → notification exactly once", async () => {
    const lead = await mkLead({ name: "Crash Lead", stageId: stageNew, stageAgeHours: 1 });
    // Simulate a crash: event created directly, never projected (Section 92).
    const event = await db.domainEvent.create({
      data: {
        organizationId: orgId,
        type: DOMAIN_EVENT.FIRST_RESPONSE_BREACHED,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead.id,
        occurredAt: hoursAgo(1),
        payload: { leadId: lead.id, leadName: "Crash Lead", overdueMinutes: 90, ownerId: managerB },
        deduplicationKey: firstResponseBreachedDedupKey(lead.id, lead.createdAt),
      },
    });
    expect(event.processedAt).toBeNull();

    const r1 = await reprocessUnprocessedEvents(orgId);
    expect(r1.reprocessed).toBeGreaterThanOrEqual(1);
    const notifs = await db.notification.findMany({ where: { eventId: event.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(managerB);

    const r2 = await reprocessUnprocessedEvents(orgId);
    expect(r2.notificationsCreated).toBe(0);
    const after = await db.notification.findMany({ where: { eventId: event.id } });
    expect(after).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Recipients (Sections 16–18)
// ---------------------------------------------------------------------------

describe("recipient resolution", () => {
  test("lead events → owner first, org owner as fallback", async () => {
    const withOwner = resolveNotificationRecipients(
      { type: DOMAIN_EVENT.STAGE_BECAME_STALE, payload: { ownerId: managerB } },
      { orgFallbackUserId: ownerA }
    );
    expect(withOwner).toEqual([managerB]);

    const ownerless = resolveNotificationRecipients(
      { type: DOMAIN_EVENT.STAGE_BECAME_STALE, payload: { ownerId: null } },
      { orgFallbackUserId: ownerA }
    );
    expect(ownerless).toEqual([ownerA]);

    const taskChain = resolveNotificationRecipients(
      { type: DOMAIN_EVENT.FOLLOW_UP_OVERDUE, payload: { assigneeId: null, ownerId: managerB } },
      { orgFallbackUserId: ownerA }
    );
    expect(taskChain).toEqual([managerB]);
  });

  test("reconciled events notify the lead owner (or org owner when unowned)", async () => {
    const owned = await mkLead({ name: "Owned Stale", stageId: stageProposal, stageAgeHours: 200, ownerId: managerB });
    const unowned = await mkLead({ name: "Unowned Stale", stageId: stageProposal, stageAgeHours: 200, ownerId: null });
    await runEventReconciliation(orgId);

    const ownedNotif = await db.notification.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.STAGE_BECAME_STALE, entityId: owned.id },
    });
    expect(ownedNotif?.userId).toBe(managerB);

    const unownedNotif = await db.notification.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.STAGE_BECAME_STALE, entityId: unowned.id },
    });
    expect(unownedNotif?.userId).toBe(ownerA);
  });
});

// ---------------------------------------------------------------------------
// Assignment events (Section 98, 51)
// ---------------------------------------------------------------------------

describe("LEAD_ASSIGNED", () => {
  test("owner change A→B emits exactly one event to B; repeat same assignment → no new event", async () => {
    const lead = await mkLead({ name: "Assign Lead", stageId: stageNew, ownerId: null });
    await assignLead(orgId, lead.id, ownerA, managerC);

    let events = await db.domainEvent.findMany({
      where: { organizationId: orgId, type: DOMAIN_EVENT.LEAD_ASSIGNED, entityId: lead.id },
    });
    expect(events).toHaveLength(1);

    const notif = await db.notification.findFirst({ where: { eventId: events[0].id } });
    expect(notif?.userId).toBe(managerC);

    // Same assignee again — no new event.
    await assignLead(orgId, lead.id, ownerA, managerC);
    events = await db.domainEvent.findMany({
      where: { organizationId: orgId, type: DOMAIN_EVENT.LEAD_ASSIGNED, entityId: lead.id },
    });
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation (Sections 21–26, 60–64)
// ---------------------------------------------------------------------------

describe("reconciliation", () => {
  test("creates exactly the missing events; re-running with the same state creates ZERO (Section 60)", async () => {
    const lead = await mkLead({ name: "Breach Lead", stageId: stageNew, stageAgeHours: 30, ownerId: null });
    await db.activity.deleteMany({ where: { leadId: lead.id } }); // ensure unresponded
    const leadRow = await db.lead.findUnique({ where: { id: lead.id } });
    const before = await db.domainEvent.count({ where: { organizationId: orgId } });

    const run1 = await runEventReconciliation(orgId);
    expect(run1.eventsCreated).toBeGreaterThanOrEqual(1);
    const eventsAfterRun1 = await db.domainEvent.count({ where: { organizationId: orgId } });
    expect(eventsAfterRun1).toBe(before + run1.eventsCreated);

    const run2 = await runEventReconciliation(orgId);
    expect(run2.eventsCreated).toBe(0);
    expect(run2.notificationsCreated).toBe(0);
    expect(run2.reprocessed).toBe(0);
    const eventsAfterRun2 = await db.domainEvent.count({ where: { organizationId: orgId } });
    expect(eventsAfterRun2).toBe(eventsAfterRun1);
  });

  test("time-based: WARNING lead → no event; after breach (clock advanced via age) → exactly one event", async () => {
    // 5h old lead → WARNING (4h..24h), not yet breach.
    const lead = await mkLead({ name: "Warning Lead", stageId: stageNew, stageAgeHours: 5 });
    await db.activity.deleteMany({ where: { leadId: lead.id } });
    const run = await runEventReconciliation(orgId);
    const has = await db.domainEvent.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.FIRST_RESPONSE_BREACHED, entityId: lead.id },
    });
    expect(has).toBeNull();

    // Age the lead past the breach line (48h old → BREACH).
    const agedTo = hoursAgo(48);
    await db.lead.update({
      where: { id: lead.id },
      data: { createdAt: agedTo, stageEnteredAt: agedTo },
    });
    const run2 = await runEventReconciliation(orgId);
    expect(run2.eventsCreated).toBeGreaterThanOrEqual(1);
    const ev = await db.domainEvent.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.FIRST_RESPONSE_BREACHED, entityId: lead.id },
    });
    expect(ev).not.toBeNull();
    // occurredAt = breachAt = createdAt + 24h (Section 87: honest onset time).
    expect(ev!.occurredAt.getTime()).toBe(agedTo.getTime() + 24 * 3_600_000);
  });

  test("stage stale event anchors to stageEnteredAt — a new cycle produces a NEW event (Section 27)", async () => {
    const lead = await mkLead({ name: "Cycle Lead", stageId: stageProposal, stageAgeHours: 200 });
    await runEventReconciliation(orgId);
    const first = await db.domainEvent.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.STAGE_BECAME_STALE, entityId: lead.id },
    });
    expect(first).not.toBeNull();

    // Real transition resets the timer; the lead becomes stale AGAIN later.
    await changeStage(orgId, lead.id, ownerA, stageMeeting);
    await db.lead.update({ where: { id: lead.id }, data: { stageEnteredAt: hoursAgo(300) } });
    await runEventReconciliation(orgId);
    const all = await db.domainEvent.findMany({
      where: { organizationId: orgId, type: DOMAIN_EVENT.STAGE_BECAME_STALE, entityId: lead.id },
    });
    expect(all).toHaveLength(2);
    expect(all[1].deduplicationKey).not.toBe(all[0].deduplicationKey);
  });
});

// ---------------------------------------------------------------------------
// Resolutions (Sections 29, 40, 63, 65–67, 105, 107)
// ---------------------------------------------------------------------------

describe("automatic resolution", () => {
  test("stage change resolves active stage notifications (Section 65)", async () => {
    const lead = await mkLead({ name: "Resolve Stage", stageId: stageProposal, stageAgeHours: 200 });
    await runEventReconciliation(orgId);
    const notif = await db.notification.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.STAGE_BECAME_STALE, entityId: lead.id, resolvedAt: null },
    });
    expect(notif).not.toBeNull();

    await changeStage(orgId, lead.id, ownerA, stageMeeting);
    const resolved = await db.notification.findUnique({ where: { id: notif!.id } });
    expect(resolved!.resolvedAt).not.toBeNull();
    expect(resolved!.readAt).toBeNull(); // resolved ≠ read
  });

  test("follow-up overdue → reschedule resolves it; new dueAt overdue → NEW event (Sections 29, 63)", async () => {
    const lead = await mkLead({ name: "FU Lead", stageId: stageProposal, stageAgeHours: 2 });
    // responded lead with an overdue follow-up
    await db.activity.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        userId: managerB,
        type: "MESSAGE",
        title: "First contact",
        createdAt: hoursAgo(30),
      },
    });
    const task = await scheduleFollowUp(orgId, lead.id, managerB, { dueAt: hoursAgo(3) });
    await runEventReconciliation(orgId);

    const overdueNotif = await db.notification.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.FOLLOW_UP_OVERDUE, entityId: task.id, resolvedAt: null },
    });
    expect(overdueNotif).not.toBeNull();

    // Reschedule to the future → the overdue notification resolves.
    await rescheduleFollowUp(orgId, lead.id, managerB, { dueAt: hoursAhead(48) });
    const resolved = await db.notification.findUnique({ where: { id: overdueNotif!.id } });
    expect(resolved!.resolvedAt).not.toBeNull();

    // Move the due date into the past again → a NEW event under a new key.
    await db.task.update({ where: { id: task.id }, data: { dueAt: hoursAgo(5) } });
    const run = await runEventReconciliation(orgId);
    expect(run.eventsCreated).toBeGreaterThanOrEqual(1);
    const all = await db.domainEvent.findMany({
      where: { organizationId: orgId, type: DOMAIN_EVENT.FOLLOW_UP_OVERDUE, entityId: task.id },
    });
    expect(all).toHaveLength(2);
    expect(all[1].deduplicationKey).not.toBe(all[0].deduplicationKey);
  });

  test("completing the follow-up resolves BOTH active follow-up notifications (Section 67)", async () => {
    const lead = await mkLead({ name: "FU Complete", stageId: stageProposal, stageAgeHours: 2 });
    await db.activity.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        userId: managerB,
        type: "CALL",
        title: "First contact",
        createdAt: hoursAgo(20),
      },
    });
    const task = await scheduleFollowUp(orgId, lead.id, managerB, { dueAt: hoursAgo(4) });
    await runEventReconciliation(orgId);
    const active = await db.notification.findMany({
      where: { organizationId: orgId, entityId: task.id, resolvedAt: null },
    });
    expect(active.length).toBeGreaterThanOrEqual(1);

    await completeFollowUp(orgId, lead.id, managerB);
    const still = await db.notification.findMany({
      where: { organizationId: orgId, entityId: task.id, resolvedAt: null },
    });
    expect(still).toHaveLength(0);
  });

  test("multi-issue: FU overdue + stale → 2 notifications; fix one, the other stays (Sections 67, 107)", async () => {
    const lead = await mkLead({ name: "Multi Issue", stageId: stageProposal, stageAgeHours: 200 });
    await db.activity.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        userId: managerB,
        type: "MESSAGE",
        title: "First contact",
        createdAt: hoursAgo(30),
      },
    });
    const task = await scheduleFollowUp(orgId, lead.id, managerB, { dueAt: hoursAgo(3) });
    await runEventReconciliation(orgId);

    const active = await db.notification.findMany({
      where: { organizationId: orgId, leadId: lead.id, resolvedAt: null },
    });
    const types = new Set(active.map((n) => n.type));
    expect(types.has(DOMAIN_EVENT.FOLLOW_UP_OVERDUE)).toBe(true);
    expect(types.has(DOMAIN_EVENT.STAGE_BECAME_STALE)).toBe(true);

    await resolveFollowUpNotifications(orgId, task.id); // what completeFollowUp does
    const after = await db.notification.findMany({
      where: { organizationId: orgId, leadId: lead.id, resolvedAt: null },
    });
    expect(after.map((n) => n.type)).toContain(DOMAIN_EVENT.STAGE_BECAME_STALE);
    expect(after.map((n) => n.type)).not.toContain(DOMAIN_EVENT.FOLLOW_UP_OVERDUE);

    await resolveStageNotifications(orgId, lead.id);
    const final = await db.notification.findMany({
      where: { organizationId: orgId, leadId: lead.id, resolvedAt: null },
    });
    expect(final).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// READ vs RESOLVED (Sections 37–39, 68–69, 106)
// ---------------------------------------------------------------------------

describe("read semantics", () => {
  test("mark read sets readAt but NOT resolvedAt while the problem exists (Section 68)", async () => {
    const lead = await mkLead({ name: "Read Lead", stageId: stageProposal, stageAgeHours: 200 });
    await runEventReconciliation(orgId);
    const notif = await db.notification.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.STAGE_BECAME_STALE, entityId: lead.id },
    });
    expect(notif).not.toBeNull();

    const marked = await markNotificationRead(orgId, notif!.userId!, notif!.id);
    expect(marked).toBe(true);
    const row = await db.notification.findUnique({ where: { id: notif!.id } });
    expect(row!.readAt).not.toBeNull();
    expect(row!.resolvedAt).toBeNull();
    expect(row!.read).toBe(true); // legacy mirror stays in sync
  });

  test("unread count is server-side and drops after reading; mark-all is recipient-scoped", async () => {
    const lead = await mkLead({ name: "Count Lead", stageId: stageProposal, stageAgeHours: 200 });
    await runEventReconciliation(orgId);
    const before = await countUnreadNotifications(orgId, managerB);
    expect(before).toBeGreaterThan(0);

    const count = await markAllNotificationsRead(orgId, managerB);
    expect(count).toBeGreaterThan(0);
    const afterB = await countUnreadNotifications(orgId, managerB);
    expect(afterB).toBe(0);

    // Another recipient's unread rows are untouched (Section 69).
    const afterA = await countUnreadNotifications(orgId, ownerA);
    expect(afterA).toBeGreaterThan(0);
  });

  test("listing filters: unread / critical / resolved (Section 35)", async () => {
    await markAllNotificationsRead(orgId, managerB);
    const lead = await mkLead({ name: "Filter Lead", stageId: stageProposal, stageAgeHours: 200, ownerId: managerB });
    await runEventReconciliation(orgId);

    const all = await listNotifications(orgId, managerB, { filter: "all", page: 1, limit: 50 });
    expect(all.rows.length).toBeGreaterThan(0);

    const unread = await listNotifications(orgId, managerB, { filter: "unread", page: 1, limit: 50 });
    expect(unread.rows.every((r) => r.readAt === null)).toBe(true);

    const critical = await listNotifications(orgId, managerB, { filter: "critical", page: 1, limit: 50 });
    expect(critical.rows.every((r) => r.severity === "CRITICAL")).toBe(true);
    expect(critical.rows.length).toBeGreaterThan(0);

    // Resolve everything for this lead, then the resolved filter finds it.
    await resolveStageNotifications(orgId, lead.id);
    const resolved = await listNotifications(orgId, managerB, { filter: "resolved", page: 1, limit: 50 });
    expect(resolved.rows.length).toBeGreaterThan(0);
    expect(resolved.rows.some((r) => r.entityId === lead.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation (Sections 70, 108)
// ---------------------------------------------------------------------------

describe("tenant isolation", () => {
  test("org A never sees org B events or notifications", async () => {
    const orgB = await db.organization.create({
      data: { name: "Other Org", slug: `${SLUG}-b`, locale: "en", currency: "AMD" },
    });
    const userB = await db.user.create({
      data: { organizationId: orgB.id, name: "B Owner", email: "b-owner@test.local", role: "OWNER" },
    });
    // Notification in org B for its user (same person id? no — distinct ids).
    await db.notification.create({
      data: {
        organizationId: orgB.id,
        userId: userB.id,
        type: DOMAIN_EVENT.STAGE_BECAME_STALE,
        severity: "CRITICAL",
        title: "t",
        message: "m",
      },
    });

    const listB = await listNotifications(orgB.id, userB.id, { filter: "all", page: 1, limit: 50 });
    expect(listB.total).toBe(1);

    const listA = await listNotifications(orgId, managerB, { filter: "all", page: 1, limit: 50 });
    expect(listA.rows.every((r) => r.organizationId === orgId)).toBe(true);
    expect(listA.rows.some((r) => r.id === listB.rows[0].id)).toBe(false);

    // Mark-all in org A cannot touch org B rows.
    await markAllNotificationsRead(orgId, managerB);
    const stillB = await db.notification.findFirst({ where: { organizationId: orgB.id } });
    expect(stillB!.readAt).toBeNull();

    await db.organization.delete({ where: { id: orgB.id } });
  });
});

// ---------------------------------------------------------------------------
// Preferences (Section 99) — event ≠ delivery preference
// ---------------------------------------------------------------------------

describe("delivery preferences", () => {
  test("disabled STAGE_AGING → the DomainEvent still exists, but NO notification is created", async () => {
    await setNotificationPreferences(orgId, managerB, {
      ...{ FIRST_RESPONSE_BREACHED: true, FOLLOW_UP_DUE_SOON: true, FOLLOW_UP_OVERDUE: true, STAGE_BECAME_STALE: true, LEAD_ASSIGNED: true, TASK_ASSIGNED: true, TASK_DUE_SOON: true, TASK_OVERDUE: true },
      STAGE_AGING: false,
    });
    const prefs = await getNotificationPreferences(orgId, managerB);
    expect(prefs.STAGE_AGING).toBe(false);

    // Lead inside the AGING window, owned by managerB.
    const lead = await mkLead({ name: "Prefs Lead", stageId: stageProposal, stageAgeHours: 65 });
    const run = await runEventReconciliation(orgId);

    const event = await db.domainEvent.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.STAGE_AGING, entityId: lead.id },
    });
    expect(event).not.toBeNull(); // event exists

    const notif = await db.notification.findFirst({ where: { eventId: event!.id, userId: managerB } });
    expect(notif).toBeNull(); // delivery skipped for this recipient

    // Restore for later tests.
    await setNotificationPreferences(orgId, managerB, {
      FIRST_RESPONSE_BREACHED: true, FOLLOW_UP_DUE_SOON: true, FOLLOW_UP_OVERDUE: true,
      STAGE_AGING: true, STAGE_BECAME_STALE: true, LEAD_ASSIGNED: true,
      TASK_ASSIGNED: true, TASK_DUE_SOON: true, TASK_OVERDUE: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Task events (Sections 6, 52) — FOLLOW_UP never double-notifies
// ---------------------------------------------------------------------------

describe("task events", () => {
  test("generic overdue TASK → TASK_OVERDUE to the assignee; FOLLOW_UP task → only FOLLOW_UP_OVERDUE", async () => {
    const lead = await mkLead({ name: "Task Lead", stageId: stageProposal, stageAgeHours: 1, ownerId: managerB });
    await db.activity.create({
      data: { organizationId: orgId, leadId: lead.id, userId: managerB, type: "CALL", title: "Contact", createdAt: hoursAgo(30) },
    });

    await db.task.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        assignedTo: managerC,
        title: "Prepare slides",
        status: "TODO",
        dueAt: hoursAgo(6),
        type: "TASK",
      },
    });
    await scheduleFollowUp(orgId, lead.id, managerB, { dueAt: hoursAgo(2) });

    await runEventReconciliation(orgId);

    const taskOverdue = await db.notification.findFirst({
      where: { organizationId: orgId, type: DOMAIN_EVENT.TASK_OVERDUE, entityType: "task" },
    });
    expect(taskOverdue).not.toBeNull();
    expect(taskOverdue!.userId).toBe(managerC);

    // Every FOLLOW_UP_OVERDUE notification must point at a FOLLOW_UP task, and
    // those tasks must NOT have TASK_OVERDUE notifications (no double notify).
    const fuNotifs = await notificationsFor(orgId, DOMAIN_EVENT.FOLLOW_UP_OVERDUE);
    expect(fuNotifs.length).toBeGreaterThan(0);
    for (const n of fuNotifs) {
      const task = await db.task.findUnique({ where: { id: n.entityId! } });
      expect(task?.type).toBe("FOLLOW_UP");
      const dup = await db.notification.findFirst({
        where: { organizationId: orgId, type: DOMAIN_EVENT.TASK_OVERDUE, entityId: n.entityId ?? undefined },
      });
      expect(dup).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Scale (Section 95): 500 leads, two runs, zero duplicates
// ---------------------------------------------------------------------------

describe("500-lead scale test", () => {
  test("reconcile twice: run2 = 0 new events / 0 new notifications, sane duration", async () => {
    const pipelineId = (await db.pipelineStage.findUnique({ where: { id: stageNew } }))!.pipelineId;
    const N = 500;
    const rows = Array.from({ length: N }, (_, i) => ({
      organizationId: orgId,
      firstName: `Scale ${i}`,
      company: `Scale Co ${i}`,
      status: "OPEN",
      pipelineId,
      stageId: i % 3 === 0 ? stageProposal : stageNew,
      ownerId: i % 2 === 0 ? managerB : ownerA,
      priority: "MEDIUM",
      // ~20% stale (200h), ~20% aging (65h), the rest fresh.
      stageEnteredAt: hoursAgo(i % 5 === 0 ? 200 : i % 5 === 1 ? 65 : 1),
      createdAt: hoursAgo(i % 7 === 0 ? 30 : i % 7 === 1 ? 5 : 1),
    }));
    // Split into chunks to keep the createMany payload small.
    for (let i = 0; i < rows.length; i += 100) {
      await db.lead.createMany({ data: rows.slice(i, i + 100) });
    }

    const run1 = await runEventReconciliation(orgId);
    expect(run1.scannedLeads).toBeGreaterThanOrEqual(N);
    expect(run1.eventsCreated).toBeGreaterThan(0);
    expect(run1.durationMs).toBeLessThan(30_000); // generous CI bound; measured locally in ms

    const run2 = await runEventReconciliation(orgId);
    expect(run2.eventsCreated).toBe(0);
    expect(run2.notificationsCreated).toBe(0);

    // No duplicate (type, entity) pairs beyond the legitimate cycle keys.
    const dup = await db.domainEvent.groupBy({
      by: ["deduplicationKey"],
      where: { organizationId: orgId },
      _count: { id: true },
      having: { deduplicationKey: { _count: { gt: 1 } } },
    });
    expect(dup).toHaveLength(0);

    const dupNotifs = await db.notification.groupBy({
      by: ["eventId", "userId"],
      where: { organizationId: orgId, eventId: { not: null } },
      _count: { id: true },
      having: { eventId: { _count: { gt: 1 } } },
    });
    expect(dupNotifs).toHaveLength(0);
  });
});
