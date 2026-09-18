import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
await db.workerRun.deleteMany({});
await db.workerLease.deleteMany({});
console.log("worker runs + leases reset");
await db.$disconnect();
