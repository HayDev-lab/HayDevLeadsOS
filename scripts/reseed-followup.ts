// Re-seed helper: wipe the demo org (cascades) so the FOLLOW-UP SLA seed applies.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const org = await db.organization.findUnique({ where: { slug: "haydev-demo" } });
  if (org) {
    await db.organization.delete({ where: { id: org.id } });
    console.log("Deleted org", org.id);
  } else {
    console.log("No demo org found");
  }
}
main().finally(() => db.$disconnect());
