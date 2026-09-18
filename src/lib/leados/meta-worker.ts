// HAYDEV LEADOS — META LEAD WORKER (v0.19).
//
// Runs under the PRODUCTION scheduler (no browser needed) as its own leased
// step inside runAllLeadOSWorkers — a Meta failure never blocks other steps.
//
// CHAIN: MetaWebhookEvent(PENDING) → Graph/demo fetch → mapper → canonical
// ingestLead() → Lead → LEAD_INGESTED → (existing) SLA/Automation/Notification.
//
// RELIABILITY:
//   • Crash recovery: PROCESSING rows whose CLAIM (claimedAt, v0.19.1) is
//     older than STALE_MS are reclaimed to PENDING (a crash mid-FETCH can
//     never wedge an event forever; legacy rows without claimedAt fall back
//     to receivedAt).
//   • Crash AFTER ingestLead() before COMPLETED → retry hits the externalId
//     idempotency in ingestLead → same Lead returned → marked COMPLETED.
//     NEVER a second Lead.
//   • Bounded retries: retryable errors (timeout/429/temp-5xx/network) retry
//     with backoff up to MAX_ATTEMPTS; auth/permission/config/unmapped never
//     auto-retry; beyond the cap → FAILED (manual retry button).
//   • Token expiry mid-batch → connection flips to REAUTH_REQUIRED once.

import { db } from "@/lib/db";
import { getMetaProvider } from "@/lib/integrations/meta/provider";
import { MetaError, META_ERROR_CODE } from "@/lib/integrations/meta/errors";
import { mapMetaLead, metadataNote, type MappingRule } from "@/lib/integrations/meta/lead-mapper";
import { ingestLead } from "./ingest-lead";
import { META_CONNECTION_STATUS, META_EVENT_STATUS, requireActiveConnection, markConnectionStatus } from "./meta-service";

const MAX_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 3 * 60_000; // reclaim crashed PROCESSING rows
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000]; // after attempt n
const BATCH_SIZE = 20;

export interface MetaWorkerSummary {
  scanned: number;
  processed: number;
  completed: number;
  deduplicated: number;
  failed: number;
  unmappedPage: number;
  unmappedForm: number;
  requeued: number;
  reclaimedStale: number;
  reauthTriggered: boolean;
  error?: string;
}

interface MappingRow {
  formId: string;
  formName: string | null;
  active: boolean;
  leadSourceId: string | null;
  defaultOwnerId: string | null;
  defaultStageId: string | null;
  mapping: unknown;
}

/** Process pending Meta webhook events. Returns a summary for WorkerRun. */
export async function runMetaLeadWorker(opts: { maxRunMs?: number } = {}): Promise<MetaWorkerSummary> {
  const maxRunMs = opts.maxRunMs ?? 15_000;
  const startedAt = Date.now();
  const summary: MetaWorkerSummary = {
    scanned: 0, processed: 0, completed: 0, deduplicated: 0, failed: 0,
    unmappedPage: 0, unmappedForm: 0, requeued: 0, reclaimedStale: 0, reauthTriggered: false,
  };

  // CRASH RECOVERY: reclaim PROCESSING rows whose worker died mid-fetch.
  // v0.19.1: keyed on claimedAt (CLAIM time), not receivedAt (arrival time) —
  // an event queued for hours in PENDING must not be stolen from a live
  // worker the instant it is claimed. Legacy rows (claimedAt null) fall back
  // to receivedAt so nothing wedges after the migration.
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const reclaimed = await db.metaWebhookEvent.updateMany({
    where: {
      status: META_EVENT_STATUS.PROCESSING,
      OR: [
        { claimedAt: { lt: staleBefore } },
        { claimedAt: null, receivedAt: { lt: staleBefore } },
      ],
    },
    data: { status: META_EVENT_STATUS.PENDING, nextAttemptAt: new Date() },
  });
  summary.reclaimedStale = reclaimed.count;

  // One connection context per org, resolved lazily.
  const connCache = new Map<string, Awaited<ReturnType<typeof requireActiveConnection>> | null>();
  const resolveConn = async (orgId: string) => {
    if (!connCache.has(orgId)) {
      try {
        connCache.set(orgId, await requireActiveConnection(orgId));
      } catch {
        connCache.set(orgId, null);
      }
    }
    return connCache.get(orgId) ?? null;
  };

  const mappingCache = new Map<string, MappingRow | null>();
  const resolveMapping = async (orgId: string, formId: string): Promise<MappingRow | null> => {
    const key = `${orgId}:${formId}`;
    if (!mappingCache.has(key)) {
      mappingCache.set(key, await db.metaLeadForm.findUnique({ where: { organizationId_formId: { organizationId: orgId, formId } } }));
    }
    return mappingCache.get(key) ?? null;
  };

  while (Date.now() - startedAt < maxRunMs) {
    const batch = await db.metaWebhookEvent.findMany({
      where: { status: META_EVENT_STATUS.PENDING, nextAttemptAt: { lte: new Date() } },
      orderBy: [{ nextAttemptAt: "asc" }],
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;
    summary.scanned += batch.length;

    for (const ev of batch) {
      if (Date.now() - startedAt >= maxRunMs) break;
      await processEvent(ev.id, { summary, resolveConn, resolveMapping });
    }
  }
  return summary;
}

interface ProcessCtx {
  summary: MetaWorkerSummary;
  resolveConn: (orgId: string) => Promise<Awaited<ReturnType<typeof requireActiveConnection>> | null>;
  resolveMapping: (orgId: string, formId: string) => Promise<MappingRow | null>;
}

async function processEvent(eventId: string, ctx: ProcessCtx): Promise<void> {
  const { summary } = ctx;
  // Claim atomically: only PENDING → PROCESSING wins (concurrent workers safe).
  // claimedAt (v0.19.1) marks the CLAIM time for the stale-reclaim above.
  const claimed = await db.metaWebhookEvent.updateMany({
    where: { id: eventId, status: META_EVENT_STATUS.PENDING },
    data: { status: META_EVENT_STATUS.PROCESSING, attempts: { increment: 1 }, claimedAt: new Date() },
  });
  if (claimed.count !== 1) return;
  const ev = await db.metaWebhookEvent.findUnique({ where: { id: eventId } });
  if (!ev) return;

  const fail = async (code: string, opts?: { requeue?: boolean; reauth?: boolean }) => {
    if (opts?.reauth) {
      await markConnectionStatus(ev.organizationId ?? "", META_CONNECTION_STATUS.REAUTH_REQUIRED, code);
      summary.reauthTriggered = true;
    }
    if (opts?.requeue && ev.attempts < MAX_ATTEMPTS) {
      const backoff = BACKOFF_MS[Math.min(ev.attempts - 1, BACKOFF_MS.length - 1)] ?? 30 * 60_000;
      await db.metaWebhookEvent.update({
        where: { id: ev.id },
        data: {
          status: META_EVENT_STATUS.PENDING,
          nextAttemptAt: new Date(Date.now() + backoff),
          lastErrorCode: code,
          lastErrorAt: new Date(),
        },
      });
      summary.requeued++;
      return;
    }
    await db.metaWebhookEvent.update({
      where: { id: ev.id },
      data: { status: META_EVENT_STATUS.FAILED, lastErrorCode: code, lastErrorAt: new Date() },
    });
    summary.failed++;
  };

  // 1) ROUTE — organization may have been mapped since the webhook arrived.
  let orgId = ev.organizationId;
  if (!orgId) {
    const page = await db.metaPageConnection.findFirst({ where: { pageId: ev.pageId } });
    orgId = page?.organizationId ?? null;
    if (!orgId) {
      // Unknown page stays parked as UNMAPPED_PAGE — safe, no Lead, no retry burn.
      await db.metaWebhookEvent.update({ where: { id: ev.id }, data: { status: META_EVENT_STATUS.UNMAPPED_PAGE } });
      summary.unmappedPage++;
      return;
    }
    await db.metaWebhookEvent.update({ where: { id: ev.id }, data: { organizationId: orgId } });
  }

  // 2) CONNECTION + provider (demo provider = zero network by construction).
  const conn = await ctx.resolveConn(orgId);
  if (!conn) {
    await fail("META_NOT_CONNECTED", { requeue: true }); // connect may return — bounded
    return;
  }
  const provider = conn.provider ?? getMetaProvider();

  // 3) FORM mapping (missing or inactive form → parked, requeued on activation).
  const form = await ctx.resolveMapping(orgId, ev.formId);
  if (!form || !form.active) {
    await db.metaWebhookEvent.update({ where: { id: ev.id }, data: { status: META_EVENT_STATUS.UNMAPPED_FORM } });
    summary.unmappedForm++;
    return;
  }

  // 4) FETCH the full lead.
  let leadData: Awaited<ReturnType<typeof provider.getLead>>;
  try {
    leadData = await provider.getLead(conn.accessToken, ev.leadgenId);
  } catch (e) {
    if (e instanceof MetaError) {
      if (e.code === META_ERROR_CODE.META_TOKEN_EXPIRED) return void (await fail(e.code, { requeue: false, reauth: true }));
      if (e.retryable) return void (await fail(e.code, { requeue: true }));
      return void (await fail(e.code));
    }
    return void (await fail("META_TEMPORARY_ERROR", { requeue: true }));
  }

  // 5) MAP + INGEST via the canonical path.
  try {
    const rules = Array.isArray(form.mapping) ? (form.mapping as unknown as MappingRule[]) : null;
    const mapped = mapMetaLead(leadData.fieldData, rules);
    const note = metadataNote(mapped, form.formName);
    const result = await ingestLead(orgId, null, {
      channel: "meta_lead_ads",
      externalId: ev.leadgenId,
      channelContext: `Meta Lead Ads${form.formName ? ` · ${form.formName}` : ""}`,
      firstName: mapped.leadFields.firstName,
      lastName: mapped.leadFields.lastName,
      email: mapped.leadFields.email,
      phone: mapped.leadFields.phone,
      company: mapped.leadFields.company,
      position: mapped.leadFields.position,
      summary: note ?? mapped.leadFields.summary,
      sourceId: form.leadSourceId ?? undefined,
      sourceType: form.leadSourceId ? undefined : "meta_ads",
      sourceDetail: form.formName ?? undefined,
      ownerId: form.defaultOwnerId ?? undefined,
      stageId: form.defaultStageId ?? undefined,
      note: note ?? undefined,
    });

    const now = new Date();
    await db.metaWebhookEvent.update({
      where: { id: ev.id },
      data: {
        status: META_EVENT_STATUS.COMPLETED,
        leadId: result.lead?.id ?? null,
        processedAt: now,
        lastErrorCode: null,
      },
    });
    // Touch lastLeadAt surfaces (connection/page/form + lead source activity).
    await db.metaConnection.updateMany({ where: { organizationId: orgId }, data: { lastLeadAt: now } });
    await db.metaPageConnection.updateMany({ where: { organizationId: orgId, pageId: ev.pageId }, data: { lastLeadAt: now } });
    await db.metaLeadForm.updateMany({ where: { organizationId: orgId, formId: ev.formId }, data: { lastLeadAt: now } });

    summary.processed++;
    if (result.deduplicated) summary.deduplicated++; else summary.completed++;
  } catch (e) {
    // createLead/ingestLead failure — treat as non-retryable data problem
    // unless it looks transient; canonical engine owns its own semantics.
    const code = e instanceof MetaError ? e.code : "INGEST_ERROR";
    return void (await fail(code, { requeue: false }));
  }
}

/** Send a demo lead through the SAME webhook processing contract (demo only). */
export async function sendDemoLead(orgId: string, formId: string, overrides?: Record<string, string>) {
  const { provider, accessToken } = await requireActiveConnection(orgId);
  if (provider.mode !== "DEMO" || !provider.sendDemoLead) {
    throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Demo lead sending requires demo mode");
  }
  const page = await db.metaPageConnection.findFirst({ where: { organizationId: orgId } });
  const { leadgenId } = await provider.sendDemoLead(formId, page?.pageId ?? "", overrides);
  // Route through the SAME durable event path as a real webhook.
  const { persistLeadgenEvents } = await import("./meta-service");
  const res = await persistLeadgenEvents(
    [{ pageId: page?.pageId ?? "", formId, leadgenId, createdTime: Date.now() }],
    { demo: true, formId, leadgenId }
  );
  return { leadgenId, persisted: res.persisted, duplicates: res.duplicates };
}
