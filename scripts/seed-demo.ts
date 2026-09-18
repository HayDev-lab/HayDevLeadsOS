// DETERMINISTIC DEMO SEED RUNNER (v0.20 closure §6).
//
// Builds the packaged-demo database content from scratch:
//   fresh migrated SQLite → seed() → synthetic demo dataset (no real PII).
//
// Usage:
//   LEADOS_DEMO=true DATABASE_URL=file:./db/custom.db bun run db:seed:demo
//
// Safety: refuses to run against a non-empty database (organizations exist) —
// seed() creates the demo dataset unconditionally and must never touch a
// database with real customer data. For wiping+reseeding the DEV preview DB
// use scripts/reseed-demo.ts instead (dev only).

import { seed } from "@/lib/leados/seed";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  const existingOrgs = await db.organization.count();
  if (existingOrgs > 0) {
    console.error(
      `[seed-demo] refusing to seed a non-empty database (organizations=${existingOrgs}). ` +
        "This script initializes a FRESH database; to reset the dev preview DB use scripts/reseed-demo.ts."
    );
    process.exit(1);
  }
  const result = await seed();
  console.log(`[seed-demo] seeded demo organization orgId=${result.orgId}`);
}

main()
  .catch((error) => {
    console.error("[seed-demo] failed:", error);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
