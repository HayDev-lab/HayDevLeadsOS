// Team performance service — per-user metrics. Deterministic, no fake numbers.
import { db } from "@/lib/db";

export interface UserPerf {
  userId: string;
  name: string;
  email: string;
  role: string;
  avatarColor: string | null;
  totalAssigned: number;
  activeLeads: number;
  won: number;
  lost: number;
  conversionRate: number;
  overdueTasks: number;
  openTasks: number;
  avgResponseHours: number | null;
  wonValue: number;
  pipelineValue: number;
}

export async function getTeamPerformance(orgId: string): Promise<{ users: UserPerf[]; totals: Record<string, number> }> {
  const users = await db.user.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: { id: true, name: true, email: true, role: true, avatarColor: true },
    orderBy: { createdAt: "asc" },
  });

  const result: UserPerf[] = [];
  let totalActive = 0, totalWon = 0, totalLost = 0, totalOverdue = 0, totalOpenTasks = 0;

  for (const u of users) {
    const [assigned, active, won, lost, overdueTasks, openTasks, wonValueAgg, pipelineValueAgg] = await Promise.all([
      db.lead.count({ where: { organizationId: orgId, ownerId: u.id, status: { notIn: ["ARCHIVED"] } } }),
      db.lead.count({ where: { organizationId: orgId, ownerId: u.id, status: { notIn: ["WON", "LOST", "ARCHIVED"] } } }),
      db.lead.count({ where: { organizationId: orgId, ownerId: u.id, status: "WON" } }),
      db.lead.count({ where: { organizationId: orgId, ownerId: u.id, status: "LOST" } }),
      db.task.count({ where: { organizationId: orgId, assignedTo: u.id, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { lt: new Date() } } }),
      db.task.count({ where: { organizationId: orgId, assignedTo: u.id, status: { in: ["TODO", "IN_PROGRESS"] } } }),
      db.lead.aggregate({ where: { organizationId: orgId, ownerId: u.id, status: "WON" }, _sum: { estimatedValue: true } }),
      db.lead.aggregate({ where: { organizationId: orgId, ownerId: u.id, status: { notIn: ["WON", "LOST", "ARCHIVED"] } }, _sum: { estimatedValue: true } }),
    ]);
    const wonValue = wonValueAgg._sum.estimatedValue ?? 0;
    const pipelineValue = pipelineValueAgg._sum.estimatedValue ?? 0;

    // avg response time for this user's leads
    const userLeads = await db.lead.findMany({
      where: { organizationId: orgId, ownerId: u.id },
      select: { id: true, createdAt: true },
      take: 200,
    });
    let totalRespMs = 0, respCount = 0;
    for (const l of userLeads) {
      const firstAct = await db.activity.findFirst({
        where: { leadId: l.id, type: { in: ["CALL", "MESSAGE", "EMAIL", "FOLLOW_UP"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      if (firstAct) {
        const diff = new Date(firstAct.createdAt).getTime() - new Date(l.createdAt).getTime();
        if (diff > 0) { totalRespMs += diff; respCount++; }
      }
    }
    const avgResponseHours = respCount > 0 ? Math.round((totalRespMs / respCount / 3600000) * 10) / 10 : null;

    const conversionRate = assigned > 0 ? Math.round((won / assigned) * 100) : 0;

    result.push({
      userId: u.id, name: u.name, email: u.email, role: u.role, avatarColor: u.avatarColor,
      totalAssigned: assigned, activeLeads: active, won, lost, conversionRate,
      overdueTasks, openTasks, avgResponseHours, wonValue, pipelineValue,
    });

    totalActive += active; totalWon += won; totalLost += lost; totalOverdue += overdueTasks; totalOpenTasks += openTasks;
  }

  return {
    users: result.sort((a, b) => b.won - a.won || b.pipelineValue - a.pipelineValue),
    totals: { totalActive, totalWon, totalLost, totalOverdue, totalOpenTasks, userCount: users.length },
  };
}
