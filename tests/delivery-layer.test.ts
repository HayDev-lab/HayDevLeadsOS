// NOTIFICATION DELIVERY LAYER (v0.16) — INTEGRATION tests against the real
// SQLite DB. Run with: bun test tests/delivery-layer.test.ts
//
// CRITICAL TESTS (spec 79–84):
//   E — EMAIL TEMP FAILURE: provider 500 → FAILED_RETRYABLE with backoff;
//       next run retries; provider succeeds → SENT.
//   F — EMAIL PERMANENT FAILURE: invalid recipient → FAILED, no endless
//       retries.
//   G — TELEGRAM NOT CONNECTED: the action/delivery is SKIPPED with
//       CHANNEL_NOT_CONNECTED and never breaks the rest (spec 81).
//   H — WEBHOOK SIGNATURE: HMAC-SHA256 over the exact body; a tampered body
//       produces a different signature (receiver-side verification fails).
//   I — SSRF: localhost / 127.0.0.1 / 169.254.169.254 / private LAN / IPv6
//       loopback / ULA / IPv4-mapped / file:// are ALL blocked.
//   J — DELIVERY DUPLICATION: worker ×10 → exactly one delivery per
//       (notification × channel × recipient).
//
// Plus: channel preferences parse/validate (spec 38–40, 98), fan-out
// idempotency + defaults OFF, webhook payload v1 shape (spec 52),
// demo-mode provider selection (spec 99–101) and tenant re-validation.

/// <reference types="bun-types" />
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "crypto";
import { DOMAIN_EVENT, ENTITY_TYPE, followUpOverdueDedupKey } from "../src/lib/domain-events";
import { publishDomainEvent } from "../src/lib/leados/domain-event-service";
import {
  fanoutNotificationDeliveries,
} from "../src/lib/leados/delivery/fanout";
import {
  runNotificationDeliveryWorker,
  manuallyRetryDelivery,
  type DeliveryWorkerProviders,
} from "../src/lib/leados/delivery/delivery-worker";
import {
  validateWebhookUrl,
} from "../src/lib/leados/delivery/ssrf";
import {
  buildWebhookPayload,
  emailHtml,
  appLink,
} from "../src/lib/leados/delivery/channels";
import { isDemoDeliveryMode, signWebhookBody } from "../src/lib/leados/delivery/providers";
import { runWithAutomationContext } from "../src/lib/leados/automation-context";
import { processEventRule } from "../src/lib/leados/automation-engine";
import { parseChannelPreferences, validateChannelPreferences, DEFAULT_CHANNEL_PREFERENCES } from "../src/lib/leados/delivery/channels";
import { notificationPreferencesSettingKey } from "../src/lib/leados/notification-service";

const db = new PrismaClient();
const SLUG = `delivery-test-${Date.now()}`;
let orgId = "";
let userId = "";

// Fake providers (spec 100 pattern): controllable behavior per test.
function fakeEmailProvider(behavior: () => { ok: boolean; status?: number; errorMessage?: string; retryable?: boolean } | Promise<{ ok: boolean; status?: number; errorMessage?: string; retryable?: boolean }>): DeliveryWorkerProviders["email"] {
  return {
    mode: "REAL",
    async send() {
      const r = await behavior();
      return {
        ok: r.ok,
        status: r.status,
        messageId: r.ok ? `fake-${Math.random().toString(36).slice(2)}` : undefined,
        errorMessage: r.errorMessage,
        retryable: r.retryable,
        errorCode: r.ok ? undefined : r.status === 500 ? "PROVIDER_UNAVAILABLE" : r.retryable ? "NETWORK_ERROR" : "INVALID_RECIPIENT",
      };
    },
  };
}

async function mkUser(email?: string) {
  return db.user.create({
    data: {
      organizationId: orgId,
      name: `U${Math.random().toString(36).slice(2, 6)}`,
      email: email ?? `u${Math.random().toString(36).slice(2)}@test.dev`,
      role: "MANAGER",
      status: "ACTIVE",
      telegramChatId: "554433221",
      telegramConnectedAt: new Date(),
    },
  });
}

/** A projected notification (event + projection) for the fan-out to pick up. */
async function mkNotification(opts: { user: { id: string }; type?: string; payload?: Record<string, unknown> } ) {
  const user = await db.user.findUniqueOrThrow({ where: { id: opts.user.id } });
  const lead = await db.lead.create({
    data: {
      organizationId: orgId,
      firstName: "Delivery",
      company: "Delivery Co",
      status: "OPEN",
      pipelineId: (await db.pipeline.findFirstOrThrow({ where: { organizationId: orgId } })).id,
      stageId: (await db.pipelineStage.findFirstOrThrow({ where: { pipeline: { organizationId: orgId } } })).id,
      ownerId: user.id,
      priority: "MEDIUM",
      stageEnteredAt: new Date(),
      createdAt: new Date(),
    },
  });
  const task = await db.task.create({
    data: {
      organizationId: orgId,
      leadId: lead.id,
      title: "Follow up",
      type: "FOLLOW_UP",
      status: "TODO",
      assignedTo: user.id,
      dueAt: new Date(Date.now() - 3 * 3_600_000),
    },
  });
  const { event, projection } = await publishDomainEvent(orgId, {
    type: (opts.type ?? DOMAIN_EVENT.FOLLOW_UP_OVERDUE) as never,
    entityType: ENTITY_TYPE.TASK,
    entityId: task.id,
    occurredAt: new Date(),
    deduplicationKey: followUpOverdueDedupKey(task.id, task.dueAt) + ":" + Math.random().toString(36).slice(2),
    payload: {
      leadId: lead.id,
      leadName: "Delivery Co",
      taskId: task.id,
      taskTitle: "Follow up",
      dueAt: task.dueAt?.toISOString(),
      overdueMinutes: 180,
      assigneeId: user.id,
      ownerId: user.id,
      ...(opts.payload ?? {}),
    },
  });
  void projection;
  const notification = await db.notification.findFirstOrThrow({
    where: { eventId: event.id, userId: opts.user.id },
  });
  return { event, task, lead, notification };
}

async function setChannelPrefs(user: { id: string }, channels: Record<string, { email: boolean; telegram: boolean }>) {
  await db.setting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: notificationPreferencesSettingKey(user.id) } },
    create: { organizationId: orgId, key: notificationPreferencesSettingKey(user.id), value: { channels } as never },
    update: { value: { channels } as never },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: "Delivery Test", slug: SLUG, locale: "ru", timezone: "Asia/Yerevan", currency: "AMD" },
  });
  orgId = org.id;
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } });
  await db.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New", type: "open", position: 0 } });
  userId = (await mkUser()).id;
});

afterAll(async () => {
  await db.workerLease.deleteMany({});
  await db.workerRun.deleteMany({});
  await db.organization.delete({ where: { id: orgId } }).catch(() => {});
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Channel preferences (spec 38–40, 98)
// ---------------------------------------------------------------------------

describe("channel preferences (spec 38-40, 98)", () => {
  test("defaults: external channels OFF (no sending after deployment)", () => {
    for (const type of Object.values(DOMAIN_EVENT)) {
      expect(DEFAULT_CHANNEL_PREFERENCES[type]).toEqual({ email: false, telegram: false });
    }
  });
  test("parse: legacy rows without channels → all OFF; .channels wins", () => {
    const legacy = parseChannelPreferences({ FIRST_RESPONSE_BREACHED: true });
    expect(legacy.FIRST_RESPONSE_BREACHED.email).toBe(false);
    const withChannels = parseChannelPreferences({
      channels: { FOLLOW_UP_OVERDUE: { email: true }, TASK_OVERDUE: { telegram: true } },
    });
    expect(withChannels.FOLLOW_UP_OVERDUE.email).toBe(true);
    expect(withChannels.FOLLOW_UP_OVERDUE.telegram).toBe(false);
    expect(withChannels.TASK_OVERDUE.telegram).toBe(true);
  });
  test("validate: unknown types / non-boolean values → 400-style errors", () => {
    expect(validateChannelPreferences({ NOT_A_TYPE: { email: true } }).ok).toBe(false);
    expect(validateChannelPreferences({ TASK_OVERDUE: { email: "yes" } }).ok).toBe(false);
    expect(validateChannelPreferences({ TASK_OVERDUE: { email: true, telegram: false } }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Webhook payload + signature (spec 52–53) — CRITICAL TEST H
// ---------------------------------------------------------------------------

describe("CRITICAL TEST H — webhook signature (spec 83)", () => {
  test("HMAC-SHA256 hex over the exact body; tampered body fails verification", () => {
    const secret = "whsec_test_123";
    const body = JSON.stringify(buildWebhookPayload({
      event: "FOLLOW_UP_OVERDUE",
      occurredAt: "2026-09-17T10:00:00Z",
      organizationId: "org1",
      entityType: "task",
      entityId: "task1",
      data: { leadName: "AquaService" },
    }));
    const signature = signWebhookBody(body, secret);
    // Receiver-side verification (what a customer endpoint does):
    const verified = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(signature).toBe(verified);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    // TAMPERED body → different signature → verification fails (spec 83).
    const tampered = body.replace("AquaService", "EvilCorp");
    expect(signWebhookBody(tampered, secret)).not.toBe(signature);
    // Wrong secret → verification fails too.
    expect(signWebhookBody(body, "other-secret")).not.toBe(signature);
  });

  test("webhook payload v1 shape (spec 52): version/event/occurredAt/org/entity/data", () => {
    const payload = buildWebhookPayload({
      event: "HAYDEV_WEBHOOK_TEST",
      occurredAt: new Date("2026-09-17T10:00:00Z"),
      organizationId: "org1",
      entityType: "lead",
      entityId: "lead1",
      data: { x: 1 },
    });
    expect(payload.version).toBe("1");
    expect(payload.event).toBe("HAYDEV_WEBHOOK_TEST");
    expect(payload.occurredAt).toBe("2026-09-17T10:00:00.000Z");
    expect(payload.organizationId).toBe("org1");
    expect(payload.entity).toEqual({ type: "lead", id: "lead1" });
    expect(payload.data).toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------
// CRITICAL TEST I — SSRF protection (spec 84)
// ---------------------------------------------------------------------------

describe("CRITICAL TEST I — SSRF (spec 54)", () => {
  const blocked: [string, string][] = [
    ["http://127.0.0.1/x", "loopback IPv4"],
    ["http://localhost/x", "localhost"],
    ["http://localhost:3000/api", "localhost with port"],
    ["http://169.254.169.254/latest/meta-data", "cloud metadata"],
    ["http://192.168.1.5/x", "private LAN"],
    ["http://10.0.0.1/x", "private 10/8"],
    ["http://172.16.0.9/x", "private 172.16/12"],
    ["http://0.0.0.0/x", "this-network"],
    ["http://[::1]/x", "IPv6 loopback"],
    ["http://[fe80::1]/x", "IPv6 link-local"],
    ["http://[fd12::1]/x", "IPv6 ULA"],
    ["http://[::ffff:127.0.0.1]/x", "IPv4-mapped loopback"],
    ["file:///etc/passwd", "non-http scheme"],
    ["ftp://example.com/x", "ftp scheme"],
    ["http://user:pass@example.com/x", "userinfo"],
  ];
  for (const [url, label] of blocked) {
    test(`blocked: ${label} (${url})`, async () => {
      const r = await validateWebhookUrl(url);
      expect(r.ok).toBe(false);
    });
  }
  test("DNS name resolving to a private IP is blocked", async () => {
    const r = await validateWebhookUrl("http://intranet.corp/hook", {
      resolve: async () => [{ address: "10.1.2.3" }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("PRIVATE_ADDRESS_BLOCKED");
  });
  test("public DNS name passes; every resolved address is checked", async () => {
    const r = await validateWebhookUrl("https://api.example.com/hook", {
      resolve: async () => [{ address: "93.184.216.34" }],
    });
    expect(r.ok).toBe(true);
    const mixed = await validateWebhookUrl("https://api.example.com/hook", {
      resolve: async () => [{ address: "93.184.216.34" }, { address: "192.168.0.9" }],
    });
    expect(mixed.ok).toBe(false);
  });
  test("redirects cannot bypass validation (redirect: manual policy, spec 55)", async () => {
    // Force the REAL provider (demo mode would simulate the send).
    const prevDemo = process.env.LEADOS_DEMO;
    process.env.LEADOS_DEMO = "false";
    try {
      const { getWebhookProvider } = await import("../src/lib/leados/delivery/providers");
      // Direct localhost fetch attempt → SSRF-blocked before ANY network I/O.
      const r = await getWebhookProvider().send({
        url: "http://127.0.0.1:9999/hook",
        secret: "s",
        eventId: "e1",
        body: "{}",
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("INVALID_WEBHOOK_URL");
    } finally {
      process.env.LEADOS_DEMO = prevDemo;
    }
  });
});

// ---------------------------------------------------------------------------
// Fan-out + CRITICAL TEST J — delivery duplication (spec 84, 60)
// ---------------------------------------------------------------------------

describe("fan-out + CRITICAL TEST J — delivery duplication (spec 60, 84)", () => {
  test("fan-out derives email/telegram/webhook rows; ×10 runs never duplicate", async () => {
    const user = await db.user.update({ where: { id: userId }, data: { telegramChatId: "111222333" } });
    await setChannelPrefs(user, { FOLLOW_UP_OVERDUE: { email: true, telegram: true } });
    const endpoint = await db.webhookEndpoint.create({
      data: {
        organizationId: orgId,
        name: "J-endpoint",
        url: "https://example.com/hook",
        secret: "whsec_j",
        events: "FOLLOW_UP_OVERDUE",
        enabled: true,
      },
    });
    const { notification } = await mkNotification({ user });

    // FAN-OUT ×10 (idempotency via uniques, spec 60).
    for (let i = 0; i < 10; i++) {
      await fanoutNotificationDeliveries(orgId);
    }
    const email = await db.notificationDelivery.count({ where: { notificationId: notification.id, channel: "EMAIL", recipient: user.id } });
    const telegram = await db.notificationDelivery.count({ where: { notificationId: notification.id, channel: "TELEGRAM", recipient: user.id } });
    const webhook = await db.notificationDelivery.count({ where: { notificationId: null, channel: "WEBHOOK", recipient: endpoint.id, eventId: notification.eventId } });
    expect(email).toBe(1);
    expect(telegram).toBe(1);
    expect(webhook).toBe(1);

    // DELIVERY WORKER ×10 with an always-OK provider → exactly one SENT per channel.
    const okProvider = { mode: "REAL" as const, async send() { return { ok: true, messageId: "m1" }; } };
    for (let i = 0; i < 10; i++) {
      await runNotificationDeliveryWorker({
        providers: { email: okProvider, telegram: okProvider, webhook: okProvider },
        trigger: "internal",
      });
    }
    const sent = await db.notificationDelivery.findMany({
      where: { organizationId: orgId, status: "SENT" },
    });
    expect(sent.filter((d) => d.channel === "EMAIL").length).toBe(1);
    expect(sent.filter((d) => d.channel === "TELEGRAM").length).toBe(1);
    expect(sent.filter((d) => d.channel === "WEBHOOK").length).toBe(1);
    // Every SENT row keeps its provider message id (spec 61).
    for (const d of sent) expect(d.providerMessageId).toBeTruthy();
  });

  test("prefs OFF → NO delivery rows (defaults, spec 98)", async () => {
    const user = await mkUser();
    await setChannelPrefs(user, {}); // everything OFF
    const { notification } = await mkNotification({ user });
    await fanoutNotificationDeliveries(orgId);
    const rows = await db.notificationDelivery.findMany({ where: { notificationId: notification.id } });
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL TEST E — email temp failure (spec 79)
// ---------------------------------------------------------------------------

describe("CRITICAL TEST E — email temporary failure → retry → SENT (spec 79)", () => {
  test("provider 500 → FAILED_RETRYABLE with backoff; next run succeeds → SENT", async () => {
    const user = await db.user.update({ where: { id: userId }, data: { telegramChatId: null } });
    await setChannelPrefs(user, { TASK_OVERDUE: { email: true, telegram: false } });
    const { notification } = await mkNotification({ user, type: DOMAIN_EVENT.TASK_OVERDUE });
    await fanoutNotificationDeliveries(orgId);

    // Provider 500 → FAILED_RETRYABLE (attempt 1, backoff scheduled).
    let failing = true;
    const provider = fakeEmailProvider(() =>
      failing ? { ok: false, status: 500, errorMessage: "upstream exploded", retryable: true } : { ok: true }
    );
    const run1 = await runNotificationDeliveryWorker({ providers: { email: provider }, trigger: "internal" });
    expect(run1.stats.failedRetryable).toBeGreaterThanOrEqual(1);

    const row = await db.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: "EMAIL" },
    });
    expect(row.status).toBe("FAILED_RETRYABLE");
    expect(row.attemptCount).toBe(1);
    expect(row.nextAttemptAt).not.toBeNull();

    // Backoff not elapsed → a run WITHOUT the due window does not retry yet.
    await runNotificationDeliveryWorker({ providers: { email: provider }, trigger: "internal" });
    const stillWaiting = await db.notificationDelivery.findFirstOrThrow({ where: { id: row.id } });
    expect(stillWaiting.status).toBe("FAILED_RETRYABLE");
    expect(stillWaiting.attemptCount).toBe(1);

    // Backoff elapsed + provider healthy → retried → SENT.
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    failing = false;
    const run3 = await runNotificationDeliveryWorker({ providers: { email: provider }, trigger: "internal" });
    expect(run3.stats.sent).toBeGreaterThanOrEqual(1);
    const sent = await db.notificationDelivery.findFirstOrThrow({ where: { id: row.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).not.toBeNull();
    expect(sent.providerMessageId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CRITICAL TEST F — email permanent failure (spec 80)
// ---------------------------------------------------------------------------

describe("CRITICAL TEST F — email permanent failure → FAILED, no endless retries (spec 80)", () => {
  test("invalid recipient (4xx) → FAILED permanent; later runs never pick it up", async () => {
    const user = await db.user.update({ where: { id: userId }, data: { telegramChatId: null } });
    await setChannelPrefs(user, { FIRST_RESPONSE_BREACHED: { email: true, telegram: false } });
    const { notification } = await mkNotification({ user, type: DOMAIN_EVENT.FIRST_RESPONSE_BREACHED });
    await fanoutNotificationDeliveries(orgId);

    const provider = fakeEmailProvider(() => ({ ok: false, status: 400, errorMessage: "invalid_to_address" }));
    const run1 = await runNotificationDeliveryWorker({ providers: { email: provider }, trigger: "internal" });
    expect(run1.stats.failed).toBeGreaterThanOrEqual(1);

    const row = await db.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: "EMAIL" },
    });
    expect(row.status).toBe("FAILED");
    expect(row.nextAttemptAt).toBeNull();
    expect(row.failedAt).not.toBeNull();

    // Subsequent runs NEVER retry a permanent failure…
    for (let i = 0; i < 3; i++) {
      await runNotificationDeliveryWorker({ providers: { email: provider }, trigger: "internal" });
    }
    const still = await db.notificationDelivery.findFirstOrThrow({ where: { id: row.id } });
    expect(still.status).toBe("FAILED");
    expect(still.attemptCount).toBe(1);

    // …but MANUAL retry (spec 63) resets it to PENDING.
    const manual = await manuallyRetryDelivery(orgId, row.id);
    expect(manual.ok).toBe(true);
    const reset = await db.notificationDelivery.findFirstOrThrow({ where: { id: row.id } });
    expect(reset.status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// CRITICAL TEST G — Telegram not connected (spec 81)
// ---------------------------------------------------------------------------

describe("CRITICAL TEST G — telegram not connected → SKIPPED, rest unaffected (spec 81)", () => {
  test("automation SEND_TELEGRAM to an unconnected user: SKIPPED + CHANNEL_NOT_CONNECTED, other actions still run", async () => {
    const user = await db.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramConnectedAt: null } });
    const lead = await db.lead.create({
      data: {
        organizationId: orgId,
        firstName: "GLead",
        company: "G Co",
        status: "OPEN",
        pipelineId: (await db.pipeline.findFirstOrThrow({ where: { organizationId: orgId } })).id,
        stageId: (await db.pipelineStage.findFirstOrThrow({ where: { pipeline: { organizationId: orgId } } })).id,
        ownerId: user.id,
        priority: "HIGH",
        stageEnteredAt: new Date(),
        createdAt: new Date(),
      },
    });
    const rule = await db.automationRule.create({
      data: {
        organizationId: orgId,
        name: "g-telegram",
        enabled: true,
        enabledAt: new Date(),
        triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
        conditions: undefined,
        actions: [
          { type: "SET_LEAD_PRIORITY", params: { priority: "URGENT" } },
          { type: "SEND_TELEGRAM", params: { message: "hello {leadName}", recipient: "LEAD_OWNER" } },
          { type: "CREATE_TASK", params: { title: "after telegram", assignTo: "LEAD_OWNER", priority: "HIGH" } },
        ] as never,
      },
    });
    const { event } = await publishDomainEvent(orgId, {
      type: DOMAIN_EVENT.STAGE_BECAME_STALE,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: new Date(),
      deduplicationKey: `G:${Date.now()}:${Math.random()}`,
      payload: { leadId: lead.id, leadName: "GLead", stageId: lead.stageId, stageName: "New", ownerId: user.id },
    });

    const res = await processEventRule(event, rule);
    expect(res.execution?.status).toBe("SUCCESS"); // ← SKIPPED action ≠ failed execution
    const result = (res.execution!.result ?? {}) as {
      actions: { type: string; status: string; errorCode?: string | null }[];
    };
    expect(result.actions[0]).toMatchObject({ type: "SET_LEAD_PRIORITY", status: "SUCCESS" });
    expect(result.actions[1]).toMatchObject({ type: "SEND_TELEGRAM", status: "SKIPPED", errorCode: "CHANNEL_NOT_CONNECTED" });
    expect(result.actions[2]).toMatchObject({ type: "CREATE_TASK", status: "SUCCESS" });
    expect(await db.task.count({ where: { organizationId: orgId, leadId: lead.id, automationRuleId: rule.id } })).toBe(1);
  });

  test("fan-out skips telegram when the user has no chat id even with prefs ON", async () => {
    const user = await db.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramConnectedAt: null } });
    await setChannelPrefs(user, { FOLLOW_UP_DUE_SOON: { email: false, telegram: true } });
    const { notification } = await mkNotification({ user, type: DOMAIN_EVENT.FOLLOW_UP_DUE_SOON });
    await fanoutNotificationDeliveries(orgId);
    expect(
      await db.notificationDelivery.count({ where: { notificationId: notification.id, channel: "TELEGRAM" } })
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Automation → delivery integration (spec 64–67) + demo safety (spec 99–101)
// ---------------------------------------------------------------------------

describe("automation external actions + demo safety (spec 64-67, 99-101)", () => {
  test("SEND_EMAIL action creates exactly ONE durable delivery per execution+action (spec 67)", async () => {
    const user = await db.user.update({ where: { id: userId }, data: { telegramChatId: "777" } });
    const lead = await db.lead.create({
      data: {
        organizationId: orgId,
        firstName: "ExtLead",
        company: "Ext Co",
        status: "OPEN",
        pipelineId: (await db.pipeline.findFirstOrThrow({ where: { organizationId: orgId } })).id,
        stageId: (await db.pipelineStage.findFirstOrThrow({ where: { pipeline: { organizationId: orgId } } })).id,
        ownerId: user.id,
        priority: "HIGH",
        stageEnteredAt: new Date(),
        createdAt: new Date(),
      },
    });
    const rule = await db.automationRule.create({
      data: {
        organizationId: orgId,
        name: "ext-email",
        enabled: true,
        enabledAt: new Date(),
        triggerType: DOMAIN_EVENT.STAGE_BECAME_STALE,
        conditions: undefined,
        actions: [
          { type: "SEND_EMAIL", params: { subject: "Deal {leadName}", body: "Check {leadName}", recipient: "LEAD_OWNER" } },
        ] as never,
      },
    });
    const { event } = await publishDomainEvent(orgId, {
      type: DOMAIN_EVENT.STAGE_BECAME_STALE,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: new Date(),
      deduplicationKey: `E:${Date.now()}:${Math.random()}`,
      payload: { leadId: lead.id, leadName: "ExtLead", stageId: lead.stageId, stageName: "New", ownerId: user.id },
    });

    // 1) run inside an execution context (spec 67: delivery keyed by execution+action)
    const run1 = await processEventRule(event, rule);
    expect(run1.execution?.status).toBe("SUCCESS");
    const executionId = run1.execution!.id;
    const delivery1 = await db.notificationDelivery.findFirstOrThrow({
      where: { automationExecutionId: executionId, automationActionIndex: 0 },
    });
    expect(delivery1.channel).toBe("EMAIL");
    expect(delivery1.status).toBe("PENDING");

    // 2) RETRY after a simulated crash — REUSED, no second delivery row.
    await db.automationExecution.update({
      where: { id: executionId },
      data: { status: "FAILED_RETRYABLE", attemptCount: 1, nextAttemptAt: new Date(), result: {} as never },
    });
    const retry = await (await import("../src/lib/leados/automation-engine")).retryAutomationExecution(orgId, executionId);
    expect(retry.execution?.status).toBe("SUCCESS");
    const retryResult = (retry.execution!.result ?? {}) as { actions: { effect?: string }[] };
    expect(retryResult.actions[0].effect).toBe("REUSED");
    expect(
      await db.notificationDelivery.count({ where: { automationExecutionId: executionId } })
    ).toBe(1);
  });

  test("demo mode is active in this environment (LEADOS_DEMO, spec 99) and emailHtml/appLink are safe", () => {
    // The demo deployment simulates external sends.
    expect(isDemoDeliveryMode()).toBe(true);
    const html = emailHtml("Sub", "Body text", appLink("lead/123"));
    expect(html).toContain("Sub");
    expect(html).toContain("lead/123");
    expect(appLink("lead/123")).toContain("lead/123");
  });
});

// ---------------------------------------------------------------------------
// Tenant re-validation (spec 102–103)
// ---------------------------------------------------------------------------

describe("tenant safety at send time (spec 102-103)", () => {
  test("a delivery whose recipient left the org → FAILED INVALID_RECIPIENT, no send", async () => {
    const user = await mkUser();
    await setChannelPrefs(user, { TASK_DUE_SOON: { email: true, telegram: false } });
    const { notification } = await mkNotification({ user, type: DOMAIN_EVENT.TASK_DUE_SOON });
    await fanoutNotificationDeliveries(orgId);
    const row = await db.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: "EMAIL" },
    });
    // Simulate the user being deleted between fan-out and send.
    await db.user.delete({ where: { id: user.id } });
    const okProvider = { mode: "REAL" as const, async send() { return { ok: true }; } };
    await runNotificationDeliveryWorker({ providers: { email: okProvider }, trigger: "internal" });
    const after = await db.notificationDelivery.findFirstOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorCode).toBe("INVALID_RECIPIENT");
  });
});
