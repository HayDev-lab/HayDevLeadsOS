// On-demand lead score recalculation. Reads the lead + linked audit + stage,
// recomputes the score against the org's enabled scoring rules, persists the
// components, and returns the new result. Pure-ish; safe to call from any API.

import { db } from "@/lib/db";
import { computeScore, type ScoreResult } from "./scoring";

export async function recalculateLeadScore(orgId: string, leadId: string): Promise<{ lead: { id: string; leadScore: number; scoreCategory: string }; result: ScoreResult }> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { stage: true, source: true, audits: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");
  const audit = lead.audits[0];
  const rules = await db.scoringConfig.findMany({ where: { organizationId: orgId } });
  const result = computeScore(
    {
      audit: audit ? { automation: audit.automation, aiReadiness: audit.aiReadiness, acquisition: audit.acquisition, sales: audit.sales } : null,
      estimatedValue: lead.estimatedValue,
      priority: lead.priority,
      stageSemanticCode: lead.stage?.semanticCode ?? null,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.company,
      phone: lead.phone,
      email: lead.email,
      sourceType: lead.source?.type ?? null,
      hasMeetingRequestFlag: lead.stage?.semanticCode === "MEETING" || lead.stage?.semanticCode === "PROPOSAL",
      hasBudgetFlag: (lead.estimatedValue ?? 0) > 0,
    },
    rules.map((r) => ({ key: r.key, label: r.label, points: r.points, enabled: r.enabled }))
  );
  await db.leadScoreComponent.deleteMany({ where: { leadId } });
  await db.lead.update({ where: { id: leadId }, data: { leadScore: result.score, scoreCategory: result.category } });
  for (const c of result.components) {
    await db.leadScoreComponent.create({ data: { leadId, reason: c.reason, key: c.key, delta: c.delta } });
  }
  return { lead: { id: lead.id, leadScore: result.score, scoreCategory: result.category }, result };
}
