// HAYDEV LEADOS — NOTIFICATION DELIVERY WORKER (v0.16, spec 43, 57–60, 63).
//
//   PENDING / FAILED_RETRYABLE (nextAttemptAt elapsed)
//     → resolve recipient + provider
//     → SENDING → provider.send()
//        ├─ ok → SENT (providerMessageId, spec 61)
//        ├─ retryable fail → FAILED_RETRYABLE, attemptCount+1, backoff 1m/5m/15m
//        │    └─ attemptCount ≥ 3 → FAILED (permanent, manual action, spec 21)
//        └─ permanent fail / channel unavailable / not connected
//             → FAILED (errorCode) / SKIPPED (CHANNEL_NOT_*) — never crashes
//               the run and never touches other channels (spec 59, 43).
//
// The worker holds its OWN WorkerLease (NOTIFICATION_DELIVERY) so an email
// failure can never block in-app/automation consumers (spec 59), processes in
// batches of 250 with a time budget, and heartbeats the run between batches.
//
// STALE SENDING RECOVERY: a crash between provider.send() and the status write
// leaves SENDING rows — the next run recovers them to FAILED_RETRYABLE with
// errorCode WORKER_CRASHED. Honest limitation (documented): for external
// providers the message MAY have been sent before the crash — a retry can
// produce one duplicate external message in that rare window. Webhook
// receivers can dedupe by X-HayDev-Event-Id; in-app effects stay strictly
// idempotent.
//
// TENANT SAFETY (spec 102–103): every recipient is re-validated against the
// delivery's organization before sending — a user or endpoint that moved orgs
// or was deleted can never receive another org's notification.

import { db } from "@/lib/db";
import type { NotificationDelivery } from "@prisma/client";
import {
  acquireWorkerLease,
  releaseWorkerLease,
  extendWorkerLease,
  WORKER_LEASE_TYPE,
} from "../worker-lease";
import {
  startWorkerRun,
  heartbeatWorkerRun,
  completeWorkerRun,
  WORKER_RUN_TYPE,
  WORKER_RUN_STATUS,
} from "../worker-run-service";
import {
  AUTO_ERROR,
  MAX_DELIVERY_ATTEMPTS,
  nextRetryAt,
  classifyAutomationError,
} from "../automation-errors";
import { DELIVERY_CHANNEL, DELIVERY_STATUS } from "./channels";
import {
  getEmailProvider,
  getTelegramProvider,
  getWebhookProvider,
  signWebhookBody,
} from "./providers";

const BATCH_SIZE = 250;
/** SENDING rows older than this are considered crashed. */
const STALE_SENDING_MS = 5 * 60_000;

/** Injectable for tests: fake providers without touching env vars. */
export interface DeliveryWorkerProviders {
  email?: ReturnType<typeof getEmailProvider>;
  telegram?: ReturnType<typeof getTelegramProvider>;
  webhook?: ReturnType<typeof getWebhookProvider>;
}

export interface DeliveryWorkerResult {
  ok: boolean;
  leaseBusy?: boolean;
  runId: string | null;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "LEASE_BUSY";
  stats: {
    scanned: number;
    sent: number;
    failedRetryable: number;
    failed: number;
    skipped: number;
    recoveredStale: number;
    remaining: number;
    durationMs: number;
  };
}

export async function runNotificationDeliveryWorker(
  opts: { maxRunMs?: number; trigger?: string; providers?: DeliveryWorkerProviders } = {}
): Promise<DeliveryWorkerResult> {
  const startedAt = Date.now();
  const maxRunMs = opts.maxRunMs ?? 25_000;
  const providers = opts.providers ?? {};

  const stats = {
    scanned: 0, sent: 0, failedRetryable: 0, failed: 0, skipped: 0,
    recoveredStale: 0, remaining: 0, durationMs: 0,
  };

  const runStart = await startWorkerRun(WORKER_RUN_TYPE.DELIVERY, opts.trigger ?? "internal");
  const lease = await acquireWorkerLease(WORKER_LEASE_TYPE.DELIVERY, runStart.id, Math.max(60_000, maxRunMs + 30_000));
  if (!lease.ok) {
    await completeWorkerRun(runStart.id, WORKER_RUN_STATUS.FAILED, {
      error: "LEASE_BUSY",
      stats: { ...stats, note: "Another delivery worker holds the lease." },
    });
    return {
      ok: false, leaseBusy: true, runId: runStart.id, status: "LEASE_BUSY",
      stats: { ...stats, durationMs: Date.now() - startedAt },
    };
  }

  let budgetExceeded = false;
  try {
    // 0. Recover stale SENDING rows (crash between send and status write).
    stats.recoveredStale = await recoverStaleDeliveries();

    for (;;) {
      if (Date.now() - startedAt > maxRunMs) {
        budgetExceeded = true;
        break;
      }
      await heartbeatWorkerRun(runStart.id);
      await extendWorkerLease(WORKER_LEASE_TYPE.DELIVERY, runStart.id);

      const due = await db.notificationDelivery.findMany({
        where: {
          status: { in: [DELIVERY_STATUS.PENDING, DELIVERY_STATUS.FAILED_RETRYABLE] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
      });
      if (!due.length) break;
      stats.scanned += due.length;

      for (const delivery of due) {
        const outcome = await processOneDelivery(delivery, providers);
        if (outcome === "SENT") stats.sent++;
        else if (outcome === "FAILED_RETRYABLE") stats.failedRetryable++;
        else if (outcome === "FAILED") stats.failed++;
        else if (outcome === "SKIPPED") stats.skipped++;
      }
    }
  } catch (e) {
    console.error("[DELIVERY-WORKER] fatal:", e);
    stats.remaining = await countRemaining();
    stats.durationMs = Date.now() - startedAt;
    await completeWorkerRun(runStart.id, WORKER_RUN_STATUS.FAILED, {
      error: (e as Error)?.message ?? String(e), stats: stats as never,
    });
    await releaseWorkerLease(WORKER_LEASE_TYPE.DELIVERY, runStart.id);
    return { ok: false, runId: runStart.id, status: "FAILED", stats };
  }

  stats.remaining = await countRemaining();
  stats.durationMs = Date.now() - startedAt;
  const status = budgetExceeded || stats.failed > 0 || stats.failedRetryable > 0 ? WORKER_RUN_STATUS.PARTIAL : WORKER_RUN_STATUS.SUCCESS;
  await completeWorkerRun(runStart.id, status, { stats: { ...stats, budgetExceeded } as never });
  await releaseWorkerLease(WORKER_LEASE_TYPE.DELIVERY, runStart.id);
  console.log(
    `[DELIVERY-WORKER] run=${runStart.id} scanned=${stats.scanned} sent=${stats.sent} ` +
      `retryable=${stats.failedRetryable} failed=${stats.failed} skipped=${stats.skipped} ` +
      `recovered=${stats.recoveredStale} remaining=${stats.remaining} duration=${stats.durationMs}ms`
  );
  return { ok: true, runId: runStart.id, status, stats };
}

async function countRemaining(): Promise<number> {
  return db.notificationDelivery.count({
    where: {
      status: { in: [DELIVERY_STATUS.PENDING, DELIVERY_STATUS.FAILED_RETRYABLE, DELIVERY_STATUS.SENDING] },
    },
  });
}

async function recoverStaleDeliveries(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SENDING_MS);
  const stale = await db.notificationDelivery.findMany({
    where: { status: DELIVERY_STATUS.SENDING, updatedAt: { lt: cutoff } },
    select: { id: true, attemptCount: true },
    take: BATCH_SIZE,
  });
  for (const row of stale) {
    const attempt = row.attemptCount + 1;
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: attempt >= MAX_DELIVERY_ATTEMPTS ? DELIVERY_STATUS.FAILED : DELIVERY_STATUS.FAILED_RETRYABLE,
        attemptCount: attempt,
        errorCode: AUTO_ERROR.WORKER_CRASHED,
        errorMessage: "Worker crashed during send (auto-recovered).",
        failedAt: attempt >= MAX_DELIVERY_ATTEMPTS ? new Date() : null,
        nextAttemptAt: attempt >= MAX_DELIVERY_ATTEMPTS ? null : nextRetryAt(attempt),
      },
    });
  }
  return stale.length;
}

type DeliveryOutcome = "SENT" | "FAILED_RETRYABLE" | "FAILED" | "SKIPPED";

async function processOneDelivery(
  delivery: NotificationDelivery,
  injected: DeliveryWorkerProviders
): Promise<DeliveryOutcome> {
  const markSending = () =>
    db.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: DELIVERY_STATUS.SENDING, updatedAt: new Date() },
    });

  const failWith = (facts: { errorCode: string; errorMessage: string; retryable: boolean }) => {
    const attempt = delivery.attemptCount + 1;
    const permanent = !facts.retryable || attempt >= MAX_DELIVERY_ATTEMPTS;
    return db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: permanent ? DELIVERY_STATUS.FAILED : DELIVERY_STATUS.FAILED_RETRYABLE,
        attemptCount: attempt,
        errorCode: facts.errorCode,
        errorMessage: facts.errorMessage,
        failedAt: permanent ? new Date() : null,
        nextAttemptAt: permanent ? null : nextRetryAt(attempt),
      },
    }) as Promise<unknown>;
  };

  const skipWith = (errorCode: string, errorMessage: string) =>
    db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: DELIVERY_STATUS.SKIPPED,
        errorCode,
        errorMessage,
        failedAt: new Date(),
      },
    }) as Promise<unknown>;

  try {
    switch (delivery.channel) {
      case DELIVERY_CHANNEL.EMAIL: {
        const user = await db.user.findUnique({ where: { id: delivery.recipient }, select: { id: true, email: true, organizationId: true } });
        if (!user || user.organizationId !== delivery.organizationId) {
          await failWith({ errorCode: AUTO_ERROR.INVALID_RECIPIENT, errorMessage: "Recipient not found in this organization.", retryable: false });
          return "FAILED";
        }
        if (!user.email) {
          await failWith({ errorCode: AUTO_ERROR.INVALID_RECIPIENT, errorMessage: "Recipient has no email address.", retryable: false });
          return "FAILED";
        }
        const provider = injected.email ?? getEmailProvider();
        if (!provider) {
          await skipWith(AUTO_ERROR.CHANNEL_NOT_CONFIGURED, "Email provider is not configured (CHANNEL_UNAVAILABLE).");
          return "SKIPPED";
        }
        const payload = (delivery.payload ?? {}) as Record<string, unknown>;
        await markSending();
        const result = await provider.send({
          to: user.email,
          subject: String(payload.subject ?? "LeadOS notification"),
          text: String(payload.text ?? ""),
          html: typeof payload.html === "string" ? payload.html : null,
        });
        if (result.ok) {
          await db.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: DELIVERY_STATUS.SENT, sentAt: new Date(), providerMessageId: result.messageId ?? null, errorCode: null, errorMessage: null },
          });
          return "SENT";
        }
        await failWith({
          errorCode: result.errorCode ?? AUTO_ERROR.PROVIDER_UNAVAILABLE,
          errorMessage: result.errorMessage ?? "Email send failed.",
          retryable: result.retryable ?? false,
        });
        return result.retryable && delivery.attemptCount + 1 < MAX_DELIVERY_ATTEMPTS ? "FAILED_RETRYABLE" : "FAILED";
      }

      case DELIVERY_CHANNEL.TELEGRAM: {
        const user = await db.user.findUnique({ where: { id: delivery.recipient }, select: { id: true, telegramChatId: true, organizationId: true } });
        if (!user || user.organizationId !== delivery.organizationId) {
          await failWith({ errorCode: AUTO_ERROR.INVALID_RECIPIENT, errorMessage: "Recipient not found in this organization.", retryable: false });
          return "FAILED";
        }
        if (!user.telegramChatId) {
          // Spec 81 (TEST G): not connected → SKIPPED, the rest of the
          // automation/other channels keep working.
          await skipWith(AUTO_ERROR.CHANNEL_NOT_CONNECTED, "Recipient has not connected Telegram.");
          return "SKIPPED";
        }
        const provider = injected.telegram ?? getTelegramProvider();
        if (!provider) {
          await skipWith(AUTO_ERROR.CHANNEL_NOT_CONFIGURED, "Telegram bot is not configured (CHANNEL_UNAVAILABLE).");
          return "SKIPPED";
        }
        const payload = (delivery.payload ?? {}) as Record<string, unknown>;
        await markSending();
        const result = await provider.send({ chatId: user.telegramChatId, text: String(payload.text ?? "") });
        if (result.ok) {
          await db.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: DELIVERY_STATUS.SENT, sentAt: new Date(), providerMessageId: result.messageId ?? null, errorCode: null, errorMessage: null },
          });
          return "SENT";
        }
        await failWith({
          errorCode: result.errorCode ?? AUTO_ERROR.PROVIDER_UNAVAILABLE,
          errorMessage: result.errorMessage ?? "Telegram send failed.",
          retryable: result.retryable ?? false,
        });
        return result.retryable && delivery.attemptCount + 1 < MAX_DELIVERY_ATTEMPTS ? "FAILED_RETRYABLE" : "FAILED";
      }

      case DELIVERY_CHANNEL.WEBHOOK: {
        const endpoint = await db.webhookEndpoint.findUnique({ where: { id: delivery.recipient } });
        if (!endpoint || endpoint.organizationId !== delivery.organizationId) {
          await failWith({ errorCode: AUTO_ERROR.INVALID_ENDPOINT, errorMessage: "Webhook endpoint not found in this organization.", retryable: false });
          return "FAILED";
        }
        if (!endpoint.enabled) {
          await skipWith(AUTO_ERROR.INVALID_ENDPOINT, "Webhook endpoint is disabled.");
          return "SKIPPED";
        }
        const provider = injected.webhook ?? getWebhookProvider();
        const payload = (delivery.payload ?? {}) as Record<string, unknown>;
        const webhookPayload = payload.webhookPayload ?? {};
        const body = JSON.stringify(webhookPayload);
        const eventId =
          (webhookPayload as { event?: string; occurredAt?: string }).event === "HAYDEV_WEBHOOK_TEST"
            ? `test-${delivery.id}`
            : delivery.eventId ?? delivery.id;
        await markSending();
        const result = await provider.send({
          url: endpoint.url,
          secret: endpoint.secret,
          eventId,
          body,
        });
        if (result.ok) {
          await db.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { lastDeliveryAt: new Date(), lastStatus: "OK", failCount: 0 },
          });
          await db.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: DELIVERY_STATUS.SENT, sentAt: new Date(), providerMessageId: result.messageId ?? null, errorCode: null, errorMessage: null },
          });
          return "SENT";
        }
        await db.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { lastDeliveryAt: new Date(), lastStatus: "FAILED", failCount: { increment: 1 } },
        });
        await failWith({
          errorCode: result.errorCode ?? AUTO_ERROR.PROVIDER_UNAVAILABLE,
          errorMessage: result.errorMessage ?? "Webhook delivery failed.",
          retryable: result.retryable ?? false,
        });
        return result.retryable && delivery.attemptCount + 1 < MAX_DELIVERY_ATTEMPTS ? "FAILED_RETRYABLE" : "FAILED";
      }

      default:
        await failWith({ errorCode: AUTO_ERROR.ACTION_FAILED, errorMessage: `Unknown channel ${delivery.channel}.`, retryable: false });
        return "FAILED";
    }
  } catch (e) {
    const facts = classifyAutomationError({ message: (e as Error)?.message ?? String(e) });
    await failWith({ errorCode: facts.code, errorMessage: facts.message, retryable: facts.retryable });
    return facts.retryable ? "FAILED_RETRYABLE" : "FAILED";
  }
}

// ---------------------------------------------------------------------------
// MANUAL RETRY (spec 63): OWNER/ADMIN resets a FAILED/SKIPPED/SENT-unknown
// delivery back to PENDING — processed on the next worker pass regardless of
// attemptCount (manual action, not an automatic retry loop).
// ---------------------------------------------------------------------------

export async function manuallyRetryDelivery(
  orgId: string,
  deliveryId: string
): Promise<{ ok: boolean; error?: string }> {
  const delivery = await db.notificationDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.organizationId !== orgId) return { ok: false, error: "Delivery not found." };
  if (delivery.status === DELIVERY_STATUS.SENDING || delivery.status === DELIVERY_STATUS.PENDING) {
    return { ok: false, error: "Delivery is already queued or in progress." };
  }
  await db.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: DELIVERY_STATUS.PENDING,
      nextAttemptAt: null,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    },
  });
  return { ok: true };
}
