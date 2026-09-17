// Export a lead's full activity timeline as CSV for client reports.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { apiError, notFound } from "@/lib/leados/api";
import { toCsv } from "@/lib/leados/attribution";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true, firstName: true, lastName: true, company: true, email: true, phone: true, status: true, priority: true, leadScore: true, createdAt: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");

    const [activities, tasks, notes, events, audits] = await Promise.all([
      db.activity.findMany({ where: { leadId: id }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
      db.task.findMany({ where: { leadId: id }, include: { assignee: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
      db.note.findMany({ where: { leadId: id }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
      db.leadEvent.findMany({ where: { leadId: id }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
      db.businessAudit.findMany({ where: { leadId: id }, orderBy: { createdAt: "asc" } }),
    ]);

    const rows: Record<string, unknown>[] = [];

    // Lead summary header
    rows.push({ section: "LEAD SUMMARY", field: "Name", value: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "—" });
    rows.push({ section: "LEAD SUMMARY", field: "Company", value: lead.company ?? "—" });
    rows.push({ section: "LEAD SUMMARY", field: "Email", value: lead.email ?? "—" });
    rows.push({ section: "LEAD SUMMARY", field: "Phone", value: lead.phone ?? "—" });
    rows.push({ section: "LEAD SUMMARY", field: "Status", value: lead.status });
    rows.push({ section: "LEAD SUMMARY", field: "Priority", value: lead.priority });
    rows.push({ section: "LEAD SUMMARY", field: "Score", value: lead.leadScore });
    rows.push({ section: "LEAD SUMMARY", field: "Created", value: new Date(lead.createdAt).toISOString() });
    rows.push({ section: "", field: "", value: "" });

    // Activities
    rows.push({ section: "ACTIVITIES", field: "", value: "" });
    rows.push({ section: "Date", field: "Type", value: "Title / Description" });
    for (const a of activities) {
      rows.push({ section: new Date(a.createdAt).toISOString(), field: a.type, value: `${a.title}${a.description ? ` — ${a.description}` : ""} (by ${a.user?.name ?? "system"})` });
    }
    rows.push({ section: "", field: "", value: "" });

    // Tasks
    rows.push({ section: "TASKS", field: "", value: "" });
    rows.push({ section: "Created", field: "Due / Status", value: "Title" });
    for (const t of tasks) {
      rows.push({ section: new Date(t.createdAt).toISOString(), field: `${t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : "—"} / ${t.status}`, value: `${t.title}${t.assignee ? ` (assigned: ${t.assignee.name})` : ""}` });
    }
    rows.push({ section: "", field: "", value: "" });

    // Notes
    rows.push({ section: "NOTES", field: "", value: "" });
    rows.push({ section: "Date", field: "Author", value: "Content" });
    for (const n of notes) {
      rows.push({ section: new Date(n.createdAt).toISOString(), field: n.user?.name ?? "system", value: n.content });
    }
    rows.push({ section: "", field: "", value: "" });

    // Events (audit trail)
    rows.push({ section: "EVENTS (audit trail)", field: "", value: "" });
    rows.push({ section: "Date", field: "Event", value: "By" });
    for (const e of events) {
      rows.push({ section: new Date(e.createdAt).toISOString(), field: e.type, value: e.user?.name ?? "system" });
    }
    rows.push({ section: "", field: "", value: "" });

    // Business audits
    if (audits.length > 0) {
      rows.push({ section: "BUSINESS AUDITS", field: "", value: "" });
      for (const a of audits) {
        rows.push({ section: new Date(a.createdAt).toISOString(), field: "Acquisition", value: a.acquisition });
        rows.push({ section: "", field: "Sales", value: a.sales });
        rows.push({ section: "", field: "Operations", value: a.operations });
        rows.push({ section: "", field: "Data", value: a.data });
        rows.push({ section: "", field: "Automation", value: a.automation });
        rows.push({ section: "", field: "AI Readiness", value: a.aiReadiness });
        if (a.reportSummary) rows.push({ section: "", field: "Summary", value: a.reportSummary });
        rows.push({ section: "", field: "", value: "" });
      }
    }

    const csv = toCsv(rows);
    const safeName = (lead.company ?? [lead.firstName, lead.lastName].filter(Boolean).join("_") ?? "lead").replace(/[^a-zA-Z0-9_-]/g, "_");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leados-${safeName}-activity-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    return apiError("activity-export-failed", e);
  }
}
