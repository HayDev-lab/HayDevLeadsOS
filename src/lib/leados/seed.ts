// DEMO seed — realistic, fully fictional companies/contacts. Idempotent.
// Creates org, users, sources, pipeline+stages, tags, lost reasons, scoring
// config, custom fields, and ~30 leads across all stages with activities,
// tasks, notes, audits, attributions and a few "lost" flags.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_LOST_REASONS,
  DEFAULT_SCORING_RULES,
  DEFAULT_SOURCES,
  DEFAULT_STAGES,
  DEFAULT_TAGS,
  LEAD_EVENT,
  LEAD_STATUS,
  PRIORITY,
  ROLES,
} from "./constants";
import { normalizeEmail, normalizePhone } from "./normalize";
import { computeScore } from "./scoring";
import { suggestNextAction } from "./followup";
import { publishEvent } from "./events";

const ORG_SLUG = "haydev-demo";

const USERS = [
  { name: "Aram Grigoryan", email: "aram@haydev.am", role: ROLES.OWNER, title: "Founder", color: "#0ea5e9" },
  { name: "Lilit Mkrtchyan", email: "lilit@haydev.am", role: ROLES.ADMIN, title: "Head of Sales", color: "#8b5cf6" },
  { name: "David Khachatryan", email: "david@haydev.am", role: ROLES.MANAGER, title: "Sales Manager", color: "#16a34a" },
  { name: "Narek Vardanyan", email: "narek@haydev.am", role: ROLES.SALES_MANAGER, title: "Sales Rep", color: "#f59e0b" },
];

interface SeedLead {
  first: string;
  last: string;
  company: string;
  phone: string;
  email: string;
  sourceType: string;
  stageIndex: number; // index into DEFAULT_STAGES
  priority: string;
  ownerIdx: number | null; // index into USERS
  est?: number;
  summary: string;
  requirements?: string;
  audit?: { acquisition: number; sales: number; operations: number; data: number; automation: number; aiReadiness: number };
  tags?: string[];
  createdAtDaysAgo: number;
  lastContactHoursAgo?: number | null;
  nextActionHoursFromNow?: number | null; // negative = overdue
  meetingRequested?: boolean;
  budgetFlag?: boolean;
}

const LEADS: SeedLead[] = [
  { first: "Tigran", last: "Petrosyan", company: "Astghik Construction LLC", phone: "+37494123456", email: "tigran@astghik.am", sourceType: "website", stageIndex: 0, priority: PRIORITY.HIGH, ownerIdx: null, est: 0, summary: "Interested in ERP for construction company", requirements: "CRM + project accounting", createdAtDaysAgo: 0, meetingRequested: true },
  { first: "Anna", last: "Hakobyan", company: "Yerevan Dental Clinic", phone: "+37455112233", email: "anna@ydc.am", sourceType: "instagram", stageIndex: 0, priority: PRIORITY.URGENT, ownerIdx: null, summary: "Wants CRM for clinic + WhatsApp automation", createdAtDaysAgo: 1, meetingRequested: true },
  { first: "Sergey", last: "Ivanov", company: "MosRetail Group", phone: "+79261234567", email: "s.ivanov@mosretail.ru", sourceType: "google_ads", stageIndex: 1, priority: PRIORITY.HIGH, ownerIdx: 2, est: 1800000, summary: "Retail chain, 14 stores, needs POS+CRM sync", requirements: "Inventory + loyalty", createdAtDaysAgo: 3, lastContactHoursAgo: 30, nextActionHoursFromNow: -5, budgetFlag: true },
  { first: "Marina", last: "Ovsepyan", company: "Arev Beauty Studio", phone: "+37493677881", email: "arev@beauty.am", sourceType: "instagram", stageIndex: 1, priority: PRIORITY.MEDIUM, ownerIdx: 3, summary: "Booking automation for beauty studio", createdAtDaysAgo: 4, lastContactHoursAgo: 20, nextActionHoursFromNow: 4 },
  { first: "Vardan", last: "Sargsyan", company: "Vega Logistics", phone: "+37499887766", email: "vardan@vega.am", sourceType: "referral", stageIndex: 2, priority: PRIORITY.HIGH, ownerIdx: 2, est: 2400000, summary: "Qualified — fleet tracking + CRM integration", requirements: "GPS + dispatch automation", createdAtDaysAgo: 6, lastContactHoursAgo: 12, nextActionHoursFromNow: 36, meetingRequested: true, budgetFlag: true, audit: { acquisition: 58, sales: 45, operations: 72, data: 51, automation: 64, aiReadiness: 70 } },
  { first: "Elena", last: "Poghosyan", company: "Flora Pharmacy Chain", phone: "+37477123400", email: "elena@flora.am", sourceType: "business_audit", stageIndex: 2, priority: PRIORITY.HIGH, ownerIdx: 3, est: 3200000, summary: "Audit completed, high automation potential", requirements: "Inventory automation + AI demand forecast", createdAtDaysAgo: 7, lastContactHoursAgo: 16, nextActionHoursFromNow: 20, meetingRequested: true, budgetFlag: true, audit: { acquisition: 62, sales: 50, operations: 80, data: 55, automation: 78, aiReadiness: 82 } },
  { first: "Hovhannes", last: "Ghazaryan", company: "Gyumri Tech Hub", phone: "+37493334455", email: "hoghannes@gytech.am", sourceType: "website", stageIndex: 3, priority: PRIORITY.MEDIUM, ownerIdx: 2, est: 1200000, summary: "Meeting scheduled for coworking CRM", createdAtDaysAgo: 9, lastContactHoursAgo: 50, nextActionHoursFromNow: 48 },
  { first: "Karine", last: "Asatryan", company: "Sweet Bakery", phone: "+37498101010", email: "karine@sweetbakery.am", sourceType: "facebook", stageIndex: 3, priority: PRIORITY.LOW, ownerIdx: 3, summary: "Order automation for bakery", createdAtDaysAgo: 10, lastContactHoursAgo: 6 },
  { first: "Dmitry", last: "Smirnov", company: "AquaService", phone: "+79031122334", email: "d.smirnov@aquaservice.ru", sourceType: "meta_ads", stageIndex: 4, priority: PRIORITY.HIGH, ownerIdx: 2, est: 950000, summary: "Proposal sent — water delivery automation", requirements: "Routing + customer app", createdAtDaysAgo: 12, lastContactHoursAgo: 72, nextActionHoursFromNow: -24, budgetFlag: true },
  { first: "Lusine", last: "Minasyan", company: "Elite Real Estate", phone: "+37495556677", email: "lusine@elite.am", sourceType: "website", stageIndex: 4, priority: PRIORITY.HIGH, ownerIdx: 3, est: 4500000, summary: "Proposal — CRM + agent portal", createdAtDaysAgo: 14, lastContactHoursAgo: 60 },
  { first: "Arman", last: "Gevorgyan", company: "AutoPro Service", phone: "+37492221100", email: "arman@autopro.am", sourceType: "referral", stageIndex: 5, priority: PRIORITY.URGENT, ownerIdx: 2, est: 2800000, summary: "Negotiating — service center management", createdAtDaysAgo: 18, lastContactHoursAgo: 30, nextActionHoursFromNow: 12, budgetFlag: true },
  { first: "Sona", last: "Zakaryan", company: "Kidlandia Kindergarten", phone: "+37493445566", email: "sona@kidlandia.am", sourceType: "instagram", stageIndex: 5, priority: PRIORITY.MEDIUM, ownerIdx: 3, est: 700000, summary: "Negotiation — parent communication portal", createdAtDaysAgo: 20, lastContactHoursAgo: 24 },
  { first: "Mher", last: "Avetisyan", company: "HayAuto Import", phone: "+37491234599", email: "mher@hayauto.am", sourceType: "website", stageIndex: 6, priority: PRIORITY.HIGH, ownerIdx: 2, est: 3600000, summary: "WON — ERP + inventory + finance, full rollout", requirements: "ERP + CRM + accounting", createdAtDaysAgo: 30, lastContactHoursAgo: 2, audit: { acquisition: 70, sales: 55, operations: 85, data: 60, automation: 80, aiReadiness: 75 }, meetingRequested: true, budgetFlag: true },
  { first: "Gayane", last: "Tadevosyan", company: "Aroma Coffee Roasters", phone: "+37494455667", email: "gayane@aroma.am", sourceType: "business_audit", stageIndex: 6, priority: PRIORITY.MEDIUM, ownerIdx: 3, est: 900000, summary: "WON — B2B order automation + CRM", createdAtDaysAgo: 35, lastContactHoursAgo: 48, audit: { acquisition: 50, sales: 40, operations: 65, data: 45, automation: 60, aiReadiness: 55 } },
  { first: "Pavel", last: "Morozov", company: "QuickFix Services", phone: "+79161239876", email: "p.morozov@quickfix.ru", sourceType: "google_ads", stageIndex: 7, priority: PRIORITY.LOW, ownerIdx: 2, summary: "LOST — chose competitor on price", createdAtDaysAgo: 40, lastContactHoursAgo: 200 },
  { first: "Anahit", last: "Hovhannisyan", company: "Sunset Restaurant Group", phone: "+37496554433", email: "anahit@sunset.am", sourceType: "website", stageIndex: 7, priority: PRIORITY.MEDIUM, ownerIdx: 3, summary: "LOST — timing not right, revisit Q3", createdAtDaysAgo: 45, lastContactHoursAgo: 500 },
  // extra "needs attention" leads
  { first: "Robert", last: "Mkrtchyan", company: "ExpressDelivery AM", phone: "+37493776655", email: "robert@express.am", sourceType: "website", stageIndex: 0, priority: PRIORITY.HIGH, ownerIdx: null, summary: "New lead — delivery automation, no contact yet", createdAtDaysAgo: 2, meetingRequested: true },
  { first: "Irina", last: "Safaryan", company: "BookWorld Store", phone: "+37499123411", email: "irina@bookworld.am", sourceType: "instagram", stageIndex: 1, priority: PRIORITY.MEDIUM, ownerIdx: 2, summary: "Contacted but no follow-up scheduled", createdAtDaysAgo: 5, lastContactHoursAgo: 60 },
  { first: "Gagik", last: "Kirakosyan", company: "Mountain Foods", phone: "+37477998800", email: "gagik@mountainfoods.am", sourceType: "referral", stageIndex: 4, priority: PRIORITY.HIGH, ownerIdx: 3, est: 2100000, summary: "Proposal sent 4 days ago, no follow-up", createdAtDaysAgo: 11, lastContactHoursAgo: 96, nextActionHoursFromNow: -72 },
  { first: "Nina", last: "Babayan", company: "PetVet Clinic", phone: "+37493223344", email: "nina@petvet.am", sourceType: "business_audit", stageIndex: 3, priority: PRIORITY.MEDIUM, ownerIdx: 2, summary: "Meeting done, no next action set", createdAtDaysAgo: 13, lastContactHoursAgo: 80, audit: { acquisition: 55, sales: 35, operations: 60, data: 40, automation: 50, aiReadiness: 60 } },
  // a few more for volume
  { first: "Ashot", last: "Danielyan", company: "Garni Stone", phone: "+37494775544", email: "ashot@garnistone.am", sourceType: "phone", stageIndex: 2, priority: PRIORITY.MEDIUM, ownerIdx: 3, est: 650000, summary: "Quarry ops tracking", createdAtDaysAgo: 8, lastContactHoursAgo: 40 },
  { first: "Lyudmila", last: "Arakelyan", company: "Sevan Foods", phone: "+37491234501", email: "luda@sevanfoods.am", sourceType: "email", stageIndex: 2, priority: PRIORITY.LOW, ownerIdx: null, summary: "Inquiry about ERP pricing", createdAtDaysAgo: 9 },
  { first: "Eduard", last: "Sukiasyan", company: "Vanadzor Textile", phone: "+37491234502", email: "eduard@vztex.am", sourceType: "website", stageIndex: 1, priority: PRIORITY.MEDIUM, ownerIdx: 2, est: 1100000, summary: "Production planning + CRM", createdAtDaysAgo: 7, lastContactHoursAgo: 18 },
  { first: "Tatev", last: "Baghdasaryan", company: "Artashat Agro", phone: "+37491234503", email: "tatev@artagro.am", sourceType: "whatsapp", stageIndex: 1, priority: PRIORITY.LOW, ownerIdx: 3, summary: "WhatsApp inquiry — farm management", createdAtDaysAgo: 6, lastContactHoursAgo: 30 },
  { first: "Vladimir", last: "Petrov", company: "TechNova Solutions", phone: "+79037778899", email: "v.petrov@technova.ru", sourceType: "referral", stageIndex: 5, priority: PRIORITY.HIGH, ownerIdx: 2, est: 5200000, summary: "Negotiation — full ERP migration", requirements: "Data migration + custom modules", createdAtDaysAgo: 22, lastContactHoursAgo: 36, nextActionHoursFromNow: 24, budgetFlag: true, meetingRequested: true },
  { first: "Margarita", last: "Sahakyan", company: "Little Stars School", phone: "+37491234504", email: "margo@littlestars.am", sourceType: "instagram", stageIndex: 4, priority: PRIORITY.MEDIUM, ownerIdx: 3, est: 540000, summary: "Proposal — parent & grade portal", createdAtDaysAgo: 15, lastContactHoursAgo: 70 },
  { first: "Boris", last: "Lebedev", company: "CleanPro Services", phone: "+79269990011", email: "b.lebedev@cleanpro.ru", sourceType: "meta_ads", stageIndex: 2, priority: PRIORITY.MEDIUM, ownerIdx: 2, est: 780000, summary: "Qualified — cleaning service automation", createdAtDaysAgo: 6, lastContactHoursAgo: 14 },
  { first: "Arev", last: "Nersisyan", company: "Dilijan Resort", phone: "+37491234505", email: "arev@dilijanresort.am", sourceType: "website", stageIndex: 3, priority: PRIORITY.HIGH, ownerIdx: 3, est: 1900000, summary: "Meeting — booking + CRM", createdAtDaysAgo: 11, lastContactHoursAgo: 44 },
  { first: "Yuri", last: "Barseghyan", company: "Garda Security", phone: "+37491234506", email: "yuri@gardasec.am", sourceType: "phone", stageIndex: 5, priority: PRIORITY.URGENT, ownerIdx: 2, est: 3100000, summary: "Negotiation — guard scheduling + reporting", createdAtDaysAgo: 16, lastContactHoursAgo: 28, nextActionHoursFromNow: 6, budgetFlag: true },
  { first: "Olga", last: "Karapetyan", company: "Kamaris Winery", phone: "+37491234507", email: "olga@kamaris.am", sourceType: "business_audit", stageIndex: 2, priority: PRIORITY.MEDIUM, ownerIdx: 3, est: 880000, summary: "Qualified — wine club + e-commerce", createdAtDaysAgo: 8, lastContactHoursAgo: 20, audit: { acquisition: 48, sales: 52, operations: 58, data: 50, automation: 55, aiReadiness: 48 } },
];

export async function seedIfEmpty(): Promise<{ seeded: boolean; orgId: string | null }> {
  const existing = await db.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (existing) return { seeded: false, orgId: existing.id };
  await seed();
  const org = await db.organization.findUnique({ where: { slug: ORG_SLUG } });
  return { seeded: true, orgId: org?.id ?? null };
}

export async function seed(): Promise<{ orgId: string }> {
  const org = await db.organization.create({
    data: {
      name: "HayDev Demo",
      slug: ORG_SLUG,
      locale: "hy",
      timezone: "Asia/Yerevan",
      currency: "AMD",
    },
  });
  const orgId = org.id;

  // users
  const users: Awaited<ReturnType<typeof db.user.create>>[] = [];
  for (const u of USERS) {
    users.push(
      await db.user.create({
        data: {
          organizationId: orgId,
          name: u.name,
          email: u.email,
          role: u.role,
          status: "ACTIVE",
          title: u.title,
          avatarColor: u.color,
        },
      })
    );
  }

  // sources
  for (let i = 0; i < DEFAULT_SOURCES.length; i++) {
    await db.leadSource.create({
      data: {
        organizationId: orgId,
        name: DEFAULT_SOURCES[i].name,
        type: DEFAULT_SOURCES[i].type,
        position: i,
        isSystem: true,
        active: true,
      },
    });
  }

  // pipeline + stages
  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "Sales Pipeline", isDefault: true },
  });
  const stages: Awaited<ReturnType<typeof db.pipelineStage.create>>[] = [];
  for (let i = 0; i < DEFAULT_STAGES.length; i++) {
    stages.push(
      await db.pipelineStage.create({
        data: {
          pipelineId: pipeline.id,
          name: DEFAULT_STAGES[i].name,
          position: i,
          type: DEFAULT_STAGES[i].type,
          color: DEFAULT_STAGES[i].color,
          isWon: DEFAULT_STAGES[i].type === "won",
          isLost: DEFAULT_STAGES[i].type === "lost",
        },
      })
    );
  }

  // tags
  for (const t of DEFAULT_TAGS) {
    await db.tag.create({ data: { organizationId: orgId, name: t.name, color: t.color } });
  }
  const tagByName = new Map((await db.tag.findMany({ where: { organizationId: orgId } })).map((t) => [t.name, t.id]));

  // lost reasons
  for (let i = 0; i < DEFAULT_LOST_REASONS.length; i++) {
    await db.lostReason.create({
      data: { organizationId: orgId, name: DEFAULT_LOST_REASONS[i], position: i, isSystem: true },
    });
  }

  // scoring config
  for (const r of DEFAULT_SCORING_RULES) {
    await db.scoringConfig.create({
      data: { organizationId: orgId, key: r.key, label: r.label, points: r.points, enabled: true },
    });
  }
  const scoringRules = (await db.scoringConfig.findMany({ where: { organizationId: orgId } })).map((r) => ({
    key: r.key,
    label: r.label,
    points: r.points,
    enabled: r.enabled,
  }));

  // custom fields
  const cfDefs: { name: string; key: string; type: string; options?: string[] }[] = [
    { name: "Industry", key: "industry", type: "select", options: ["Construction", "Retail", "Healthcare", "Hospitality", "Logistics", "Real Estate", "Food & Beverage", "Education", "Other"] },
    { name: "Budget", key: "budget", type: "number" },
  ];
  for (const cf of cfDefs) {
    await db.customField.create({
      data: {
        organizationId: orgId,
        name: cf.name,
        key: cf.key,
        type: cf.type,
        options: (cf.options ?? null) as Prisma.InputJsonValue,
      },
    });
  }

  // leads
  const sourceByType = new Map((await db.leadSource.findMany({ where: { organizationId: orgId } })).map((s) => [s.type, s.id]));
  let leadCounter = 0;
  for (const l of LEADS) {
    leadCounter++;
    const created = new Date(Date.now() - l.createdAtDaysAgo * 86400000 - leadCounter * 60000);
    const stage = stages[l.stageIndex];
    const owner = l.ownerIdx != null ? users[l.ownerIdx] : null;
    const nPhone = normalizePhone(l.phone);
    const nEmail = normalizeEmail(l.email);
    let nextActionAt: Date | null = null;
    let nextActionLabel: string | null = null;
    if (l.nextActionHoursFromNow != null) {
      nextActionAt = new Date(Date.now() + l.nextActionHoursFromNow * 3600000);
      nextActionLabel = suggestNextAction(stage.name, new Date()).label;
    }
    const lastContactAt = l.lastContactHoursAgo != null ? new Date(Date.now() - l.lastContactHoursAgo * 3600000) : null;

    const status =
      stage.type === "won" ? LEAD_STATUS.WON : stage.type === "lost" ? LEAD_STATUS.LOST : stage.name === "New" ? LEAD_STATUS.NEW : stage.name === "Contacted" ? LEAD_STATUS.CONTACTED : stage.name === "Qualified" ? LEAD_STATUS.QUALIFIED : LEAD_STATUS.OPEN;

    const lead = await db.lead.create({
      data: {
        organizationId: orgId,
        sourceId: sourceByType.get(l.sourceType) ?? null,
        sourceDetail: l.sourceType,
        firstName: l.first,
        lastName: l.last,
        company: l.company,
        phone: l.phone,
        normalizedPhone: nPhone,
        email: l.email,
        normalizedEmail: nEmail,
        locale: "hy",
        status,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: owner?.id ?? null,
        priority: l.priority,
        estimatedValue: l.est ?? null,
        currency: "AMD",
        summary: l.summary,
        requirements: l.requirements ?? null,
        lastContactAt,
        nextActionAt,
        nextActionLabel,
        createdAt: created,
        updatedAt: created,
      },
    });

    // scoring
    const score = computeScore(
      {
        audit: l.audit ? { automation: l.audit.automation, aiReadiness: l.audit.aiReadiness } : null,
        estimatedValue: l.est ?? null,
        priority: l.priority,
        stageName: stage.name,
        company: l.company,
        phone: l.phone,
        email: l.email,
        sourceType: l.sourceType,
        hasMeetingRequestFlag: l.meetingRequested,
        hasBudgetFlag: l.budgetFlag,
      },
      scoringRules
    );
    await db.lead.update({ where: { id: lead.id }, data: { leadScore: score.score, scoreCategory: score.category } });
    for (const c of score.components) {
      await db.leadScoreComponent.create({ data: { leadId: lead.id, reason: c.reason, key: c.key, delta: c.delta } });
    }

    // tags
    if (l.tags) for (const tn of l.tags) {
      const tid = tagByName.get(tn);
      if (tid) await db.leadTag.create({ data: { leadId: lead.id, tagId: tid } }).catch(() => {});
    }
    // auto-tag high value
    if ((l.est ?? 0) >= 2500000) {
      const tid = tagByName.get("HIGH VALUE");
      if (tid) await db.leadTag.create({ data: { leadId: lead.id, tagId: tid } }).catch(() => {});
    }

    // business audit
    if (l.audit) {
      const audit = await db.businessAudit.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          companyName: l.company,
          contactName: `${l.first} ${l.last}`,
          contactEmail: l.email,
          contactPhone: l.phone,
          locale: "hy",
          acquisition: l.audit.acquisition,
          sales: l.audit.sales,
          operations: l.audit.operations,
          data: l.audit.data,
          automation: l.audit.automation,
          aiReadiness: l.audit.aiReadiness,
          reportSummary: `${l.company}: automation ${l.audit.automation}/100, AI readiness ${l.audit.aiReadiness}/100`,
          priorityAutomations: ["Lead capture automation", "CRM follow-up reminders"] as Prisma.InputJsonValue,
          recommendations: ["Implement automated follow-up reminders", "Connect Instagram + Website to CRM"] as Prisma.InputJsonValue,
        },
      });
      await db.activity.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          type: "AUDIT_IMPORT",
          title: "Business Audit completed",
          description: `Acquisition ${l.audit.acquisition} · Automation ${l.audit.automation} · AI ${l.audit.aiReadiness}`,
          metadata: { auditId: audit.id } as Prisma.InputJsonValue,
          createdAt: created,
        },
      });
    }

    // activities timeline
    if (l.lastContactHoursAgo != null) {
      await db.activity.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          userId: owner?.id ?? null,
          type: l.sourceType === "phone" ? "CALL" : "MESSAGE",
          title: l.sourceType === "phone" ? "Inbound call" : "Initial message",
          description: `Contact via ${l.sourceType}`,
          createdAt: new Date(created.getTime() + 3600000),
        },
      });
    }
    if (stage.name !== "New" && stage.name !== "Lost" && stage.name !== "Won") {
      await db.activity.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          userId: owner?.id ?? null,
          type: "STAGE_CHANGE",
          title: `Moved to ${stage.name}`,
          createdAt: new Date(created.getTime() + 7200000),
        },
      });
    }

    // tasks (a few overdue, a few upcoming)
    if (l.priority === "HIGH" || l.priority === "URGENT") {
      await db.task.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          assignedTo: owner?.id ?? null,
          title: `Follow up with ${l.company}`,
          status: "TODO",
          priority: l.priority,
          dueAt: new Date(Date.now() + (l.nextActionHoursFromNow ?? 48) * 3600000),
          createdAt: created,
        },
      });
    }
    if (stage.name === "Proposal") {
      await db.task.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          assignedTo: owner?.id ?? users[1].id,
          title: `Prepare revised proposal for ${l.company}`,
          status: "TODO",
          priority: "HIGH",
          dueAt: new Date(Date.now() - 86400000),
          createdAt: created,
        },
      });
    }

    // notes
    if (l.requirements) {
      await db.note.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          userId: owner?.id ?? users[0].id,
          content: `Requirements: ${l.requirements}. Source: ${l.sourceType}.`,
          createdAt: created,
        },
      });
    }

    // lead created event
    await publishEvent({
      orgId,
      leadId: lead.id,
      userId: owner?.id ?? null,
      type: LEAD_EVENT.LEAD_CREATED,
      payload: { source: l.sourceType, stage: stage.name } as Prisma.InputJsonValue,
    });
    if (owner) {
      await publishEvent({
        orgId,
        leadId: lead.id,
        userId: owner.id,
        type: LEAD_EVENT.LEAD_ASSIGNED,
        payload: { owner: owner.name } as Prisma.InputJsonValue,
      });
    }
    if (stage.type !== "open") {
      await publishEvent({
        orgId,
        leadId: lead.id,
        type: stage.type === "won" ? LEAD_EVENT.LEAD_WON : LEAD_EVENT.LEAD_LOST,
        payload: { stage: stage.name } as Prisma.InputJsonValue,
      });
    }

    // ERP sync for won leads (so the integration panel has data to show)
    if (stage.type === "won") {
      await db.integrationSync.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          provider: "HAYDEV_ERP",
          externalRefId: `ERP-${lead.id.slice(-8).toUpperCase()}`,
          entity: "customer",
          direction: "outbound",
          status: "SYNCED",
          lastSyncAt: new Date(),
          attempts: 1,
          response: { mode: "local-mock" } as Prisma.InputJsonValue,
        },
      });
    }
  }

  // a notification for the owner about a new unassigned urgent lead
  await db.notification.create({
    data: {
      organizationId: orgId,
      userId: users[0].id,
      leadId: null,
      type: "new_unassigned",
      title: "Unassigned urgent lead",
      message: "Astghik Construction and Yerevan Dental Clinic are unassigned",
    },
  });

  // incoming messages — a realistic inbox sample across channels. Some linked
  // to existing leads (by index into LEADS), some unassigned.
  const msgSeeds: { source: string; handle: string; leadIdx: number | null; convId: string; content: string; minsAgo: number }[] = [
    { source: "instagram", handle: "@arev.beauty", leadIdx: 3, convId: "ig:arev.beauty", content: "Բարև, հետաքրքրում է ձեր առաջարկը CRM-ի համար", minsAgo: 25 },
    { source: "instagram", handle: "@arev.beauty", leadIdx: 3, convId: "ig:arev.beauty", content: "Մենք ունենք 2 մասնագետ և շուրջ 200 հաճախորդ", minsAgo: 22 },
    { source: "instagram", handle: "@arev.beauty", leadIdx: 3, convId: "ig:arev.beauty", content: "Ե՞րբ կարող ենք զանգահարել", minsAgo: 20 },
    { source: "whatsapp", handle: "+37493677881", leadIdx: 4, convId: "wa:arev", content: "Hello, I saw your post about automation — can you send pricing?", minsAgo: 120 },
    { source: "whatsapp", handle: "+37493677881", leadIdx: 4, convId: "wa:arev", content: "We're a beauty studio in Yerevan", minsAgo: 118 },
    { source: "telegram", handle: "@dmitry_aqua", leadIdx: 8, convId: "tg:dmitry", content: "Добрый день! Нужна автоматизация для доставки воды", minsAgo: 240 },
    { source: "telegram", handle: "@dmitry_aqua", leadIdx: 8, convId: "tg:dmitry", content: "У нас 4 машины, хотим GPS + CRM", minsAgo: 238 },
    { source: "instagram", handle: "@sunset.group", leadIdx: 15, convId: "ig:sunset", content: "Hi, restaurant group inquiry about reservations automation", minsAgo: 480 },
    { source: "facebook", handle: "BookWorld AM", leadIdx: 17, convId: "fb:bookworld", content: "Hello, do you integrate with our existing POS?", minsAgo: 600 },
    { source: "whatsapp", handle: "+37495556677", leadIdx: 10, convId: "wa:elite", content: "Հետաքրքրում է CRM + agent portal արժեքը", minsAgo: 90 },
    { source: "whatsapp", handle: "+37495556677", leadIdx: 10, convId: "wa:elite", content: "Ունենք 12 գործակալ", minsAgo: 88 },
    // unassigned (leadIdx = null)
    { source: "instagram", handle: "@newclient.2026", leadIdx: null, convId: "ig:newclient", content: "Hi, saw your ad — can you tell me about your services?", minsAgo: 5 },
    { source: "telegram", handle: "@unknown_user", leadIdx: null, convId: "tg:unknown", content: "Здравствуйте, хочу узнать про ERP для магазина", minsAgo: 12 },
    { source: "whatsapp", handle: "+37499111223", leadIdx: null, convId: "wa:anon", content: "Բարև, հետաքրքրում է ավտոմատացման համակարգ", minsAgo: 35 },
    { source: "facebook", handle: "Anonymous Page", leadIdx: null, convId: "fb:anon", content: "Do you do clinics? Need appointment automation", minsAgo: 75 },
  ];
  for (const m of msgSeeds) {
    await db.incomingMessage.create({
      data: {
        organizationId: orgId,
        source: m.source,
        direction: "inbound",
        content: m.content,
        fromHandle: m.handle,
        conversationId: m.convId,
        leadId: m.leadIdx != null ? (await db.lead.findFirst({ where: { organizationId: orgId, company: LEADS[m.leadIdx].company }, select: { id: true } }))?.id ?? null : null,
        channel: m.source === "instagram" || m.source === "facebook" ? "dm" : "chat",
        metadata: {} as Prisma.InputJsonValue,
        timestamp: new Date(Date.now() - m.minsAgo * 60_000),
      },
    });
  }

  return { orgId };
}
