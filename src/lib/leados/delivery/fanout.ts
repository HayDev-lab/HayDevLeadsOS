// HAYDEV LEADOS — DELIVERY FAN-OUT (v0.16, spec 33–38, 60, 98).
//
// After the projector creates an in-app Notification, this step derives the
// EXTERNAL delivery rows:
//   EMAIL / TELEGRAM — one per (notification × channel × recipient user),
//     only when the user's channel preferences enable that event type AND the
//     destination exists (email set / Telegram connected). Preferences default
//     OFF (spec 98): nothing is ever sent until a user opts in.
//   WEBHOOK — one per (event × org endpoint), regardless of user prefs
//     (org-level integration). Recipient = endpoint id.
//
// IDEMPOTENCY (spec 60): DB uniques make re-running a no-op —
//   unique(notificationId, channel, recipient) for email/telegram,
//   unique(eventId, channel, recipient) for webhook.
// The fanoutAt stamp on the notification is a SCAN marker only (never a
// correctness flag): existing notifications are backfilled once at rollout so
// old history is never emailed retroactively.
//
// CONTENT (spec 44–45, 49, 52): rendered once at fan-out time — v0.17 uses
// the RECIPIENT'S personal locale (User.locale) with the org locale as
// fallback — and snapshotted into delivery.payload; the worker never
// re-renders, so a preference/locale change mid-flight cannot alter
// already-planned content.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { humanizeDuration } from "@/lib/sla";
import { t, resolveLocale, type DictKey } from "../i18n";
import {
  NOTIFICATION_TEMPLATES,
  type DomainEventType,
} from "@/lib/domain-events";
import {
  DELIVERY_CHANNEL,
  appLink,
  buildWebhookPayload,
  emailHtml,
} from "./channels";

const BATCH_SIZE = 100;

export interface FanoutSummary {
  notificationsScanned: number;
  deliveriesCreated: number;
  emailCreated: number;
  telegramCreated: number;
  webhookCreated: number;
  durationMs: number;
  budgetExceeded: boolean;
  remaining: number;
}

interface FanoutDeps {
  now?: Date;
  maxRunMs?: number;
}

/** Render localized email/telegram content for a projected notification. */
function renderChannelContent(input: {
  locale: string;
  type: string;
  title: string;
  message: string;
  templateKey: string | null;
  payload: Record<string, unknown>;
  deepLink: string | null;
  severity: string;
}): { subject: string; text: string; telegram: string; link: string } {
  const locale = resolveLocale(input.locale);
  const link = appLink(input.deepLink);
  let subject = input.title;
  let body = input.message;
  if (input.templateKey) {
    const template = NOTIFICATION_TEMPLATES[input.type as DomainEventType];
    if (template) {
      const p = input.payload;
      const vars = {
        name: String(p.leadName ?? p.taskTitle ?? ""),
        stage: String(p.stageName ?? ""),
        task: String(p.taskTitle ?? ""),
        duration: humanizeDuration(Number(p.overdueMinutes ?? p.remainingMinutes ?? 0)),
        threshold: humanizeDuration(Number(p.thresholdMinutes ?? 0)),
      };
      const titleKey = input.templateKey as DictKey;
      const messageKey = template.messageKey as DictKey;
      subject = t(locale, titleKey, vars) || subject;
      body = t(locale, messageKey, vars) || body;
    }
  }
  const icon = input.severity === "CRITICAL" ? "🔴" : input.severity === "WARNING" ? "🟠" : "🔵";
  const telegram = `${icon} ${subject}\n\n${body}\n\n${link}`;
  return { subject: `LeadOS: ${subject}`, text: `${body}\n\nOpen LeadOS:\n${link}`, telegram, link };
}

/** One fan-out pass for an organization. Safe to re-run (unique constraints). */
export async function fanoutNotificationDeliveries(
  orgId: string,
  opts: FanoutDeps = {}
): Promise<FanoutSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const maxRunMs = opts.maxRunMs ?? 15_000;
  const summary: FanoutSummary = {
    notificationsScanned: 0,
    deliveriesCreated: 0,
    emailCreated: 0,
    telegramCreated: 0,
    webhookCreated: 0,
    durationMs: 0,
    budgetExceeded: false,
    remaining: 0,
  };

  // Org-level config (webhook endpoints; fallback locale for rendering).
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { locale: true } });
  const orgLocale = org?.locale ?? "en";

  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    if (Date.now() - started > maxRunMs) {
      summary.budgetExceeded = true;
      break;
    }
    const notifications = await db.notification.findMany({
      where: {
        organizationId: orgId,
        fanoutAt: null,
        eventId: { not: null },
        userId: { not: null },
        ...(cursor
          ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });
    if (!notifications.length) break;
    summary.notificationsScanned += notifications.length;

    // Batch-load users + events + org webhook endpoints + PERSONAL prefs
    // (v0.17: user-owned rows + user locale per recipient).
    const userIds: string[] = Array.from(new Set(notifications.filter((n) => n.userId != null).map((n) => n.userId as string)));
    const eventIds: string[] = Array.from(new Set(notifications.filter((n) => n.eventId != null).map((n) => n.eventId as string)));
    const [users, events, endpoints, prefRows] = await Promise.all([
      db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, telegramChatId: true, locale: true } }),
      db.domainEvent.findMany({ where: { id: { in: eventIds } } }),
      db.webhookEndpoint.findMany({ where: { organizationId: orgId, enabled: true } }),
      db.userNotificationPreference.findMany({ where: { userId: { in: userIds } } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const eventById = new Map(events.map((e) => [e.id, e]));
    // prefs: userId → eventType → { email, telegram }
    const prefsByUser = new Map<string, Map<string, { email: boolean; telegram: boolean }>>();
    for (const row of prefRows) {
      let byType = prefsByUser.get(row.userId);
      if (!byType) {
        byType = new Map();
        prefsByUser.set(row.userId, byType);
      }
      byType.set(row.eventType, { email: row.email, telegram: row.telegram });
    }

    for (const notification of notifications) {
      const user = userById.get(notification.userId as string);
      const event = eventById.get(notification.eventId as string);
      if (!event) {
        // Event deleted (SetNull on Notification makes this rare) — nothing to
        // derive content from; stamp so it is never rescanned.
        await db.notification.update({ where: { id: notification.id }, data: { fanoutAt: now } });
        continue;
      }
      const payload = (notification.payload ?? {}) as Record<string, unknown>;
      // PERSONAL LOCALE (v0.17 spec 48): recipient's locale, org fallback.
      const recipient = notification.userId != null ? userById.get(notification.userId) : undefined;
      const renderLocale = resolveLocale(recipient?.locale ?? orgLocale);
      const rendered = renderChannelContent({
        locale: renderLocale,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        templateKey: notification.templateKey,
        payload,
        deepLink: notification.deepLink,
        severity: notification.severity,
      });

      const creates: Prisma.NotificationDeliveryUncheckedCreateInput[] = [];

      // EMAIL / TELEGRAM — per-user preferences (spec 38–40, 98).
      if (user) {
        const toggles = prefsByUser.get(user.id)?.get(event.type as DomainEventType) ?? { email: false, telegram: false };
        if (toggles.email && user.email) {
          creates.push({
            organizationId: orgId,
            notificationId: notification.id,
            eventId: null,
            channel: DELIVERY_CHANNEL.EMAIL,
            recipient: user.id,
            payload: {
              subject: rendered.subject,
              text: rendered.text,
              html: emailHtml(rendered.subject, rendered.text, rendered.link),
              to: user.email,
            } as unknown as Prisma.InputJsonValue,
          });
        }
        if (toggles.telegram && user.telegramChatId) {
          creates.push({
            organizationId: orgId,
            notificationId: notification.id,
            eventId: null,
            channel: DELIVERY_CHANNEL.TELEGRAM,
            recipient: user.id,
            payload: {
              text: rendered.telegram,
              chatId: user.telegramChatId,
            } as unknown as Prisma.InputJsonValue,
          });
        }
      }

      // WEBHOOK — org-level endpoints matching the event type (spec 50–52).
      for (const endpoint of endpoints) {
        const matches =
          endpoint.events === "*" ||
          endpoint.events.split(",").map((e) => e.trim()).includes(event.type);
        if (!matches) continue;
        creates.push({
          organizationId: orgId,
          notificationId: null,
          eventId: event.id,
          channel: DELIVERY_CHANNEL.WEBHOOK,
          recipient: endpoint.id,
          payload: {
            webhookPayload: buildWebhookPayload({
              event: event.type,
              occurredAt: event.occurredAt,
              organizationId: orgId,
              entityType: event.entityType,
              entityId: event.entityId,
              data: payload,
            }),
            url: endpoint.url,
          } as unknown as Prisma.InputJsonValue,
        });
      }

      // SQLite does not support createMany({skipDuplicates}) — insert row by
      // row; unique constraints make duplicates a no-op (spec 60).
      for (const c of creates) {
        try {
          const created = await db.notificationDelivery.create({ data: c });
          summary.deliveriesCreated++;
          if (created.channel === DELIVERY_CHANNEL.EMAIL) summary.emailCreated++;
          else if (created.channel === DELIVERY_CHANNEL.TELEGRAM) summary.telegramCreated++;
          else summary.webhookCreated++;
        } catch {
          /* unique conflict = already fanned out (idempotent no-op) */
        }
      }

      // SCAN MARKER: stamped even when nothing was derived (prefs OFF) so the
      // row is never rescanned; a later opt-in affects future notifications.
      await db.notification.update({ where: { id: notification.id }, data: { fanoutAt: now } });
    }

    const last = notifications[notifications.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  summary.remaining = await db.notification.count({
    where: { organizationId: orgId, fanoutAt: null, eventId: { not: null }, userId: { not: null } },
  });
  summary.durationMs = Date.now() - started;
  return summary;
}
