import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const deliveries = await db.notificationDelivery.findMany({ include: { notification: { select: { type: true } } } });
console.log("deliveries:", deliveries.map(d => ({
  ch: d.channel, status: d.status, evt: d.notification?.type ?? "automation/webhook", msgId: d.providerMessageId?.slice(0, 14),
})));
const runs = await db.workerRun.findMany({ orderBy: { startedAt: "desc" }, take: 3 });
console.log("worker runs:", runs.map(r => ({ type: r.type, status: r.status, trigger: r.trigger })));
const user = await db.user.findFirst({ where: { role: "OWNER" }, include: { organization: true } });
console.log("demo owner telegram:", user?.telegramChatId, "| org:", user?.organization?.name);
const leases = await db.workerLease.findMany();
console.log("active leases:", leases.length);
const failed = await db.notificationDelivery.count({ where: { status: "FAILED" } });
const skipped = await db.notificationDelivery.count({ where: { status: "SKIPPED" } });
console.log("failed:", failed, "skipped:", skipped);
await db.$disconnect();
