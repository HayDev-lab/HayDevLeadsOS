// v0.17 AUTH BACKFILL — one-time (idempotent) data migration.
//
// 1. OrganizationMember rows for every existing User (user.organizationId is
//    the active-org pointer; the membership becomes the source of truth).
// 2. Role migration: MANAGER / SALES_MANAGER → MEMBER (OWNER/ADMIN/VIEWER keep).
//    User.role is synced to the mapped membership role (legacy cache column).
// 3. Demo isolation: orgs with NO password-bearing users are marked isDemo
//    (the seeded synthetic org). Orgs created via bootstrap always have a
//    password user from birth, so they are never flagged.
// 4. Personal notification preferences: org Setting rows
//    "notification_preferences:<userId>" → UserNotificationPreference rows
//    (inApp + email + telegram per event type), then the old rows are deleted.
// 5. User.locale / User.timezone backfilled from the organization.
//
// Safe to re-run: every step is an upsert / a no-op.

import { PrismaClient } from "@prisma/client";
import {
  DOMAIN_EVENT_TYPES,
  parseNotificationPreferences,
} from "../src/lib/domain-events";
import { parseChannelPreferences } from "../src/lib/leados/delivery/channels";
import { notificationPreferencesSettingKey } from "../src/lib/leados/notification-service";

const db = new PrismaClient();

// Legacy → v0.17 role mapping (spec 7: OWNER / ADMIN / MEMBER, VIEWER optional).
const ROLE_MAP: Record<string, string> = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MEMBER",
  SALES_MANAGER: "MEMBER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

async function main() {
  const users = await db.user.findMany();

  // --- 1 + 2: memberships + role sync --------------------------------------
  let memberships = 0;
  for (const user of users) {
    const mappedRole = ROLE_MAP[user.role] ?? "MEMBER";
    await db.organizationMember.upsert({
      where: {
        organizationId_userId: { organizationId: user.organizationId, userId: user.id },
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        role: mappedRole,
        status: "ACTIVE",
        joinedAt: user.createdAt,
      },
      update: { role: mappedRole, status: "ACTIVE" },
    });
    memberships++;
    if (user.role !== mappedRole) {
      await db.user.update({ where: { id: user.id }, data: { role: mappedRole } });
      console.log(`  role migrated: ${user.email} ${user.role} → ${mappedRole}`);
    }
  }

  // --- 3: demo org flags -----------------------------------------------------
  const orgs = await db.organization.findMany({
    include: { users: { select: { id: true, passwordHash: true } } },
  });
  let demoOrgs = 0;
  for (const org of orgs) {
    const hasRealUser = org.users.some((u) => u.passwordHash != null);
    if (!hasRealUser && !org.isDemo) {
      await db.organization.update({ where: { id: org.id }, data: { isDemo: true } });
      console.log(`  demo org flagged: ${org.name} (${org.slug})`);
      demoOrgs++;
    }
  }

  // --- 5: user locale/timezone from org --------------------------------------
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  for (const user of users) {
    const org = orgById.get(user.organizationId);
    if (!org) continue;
    await db.user.update({
      where: { id: user.id },
      data: { locale: org.locale, timezone: org.timezone },
    });
  }

  // --- 4: notification prefs migration ---------------------------------------
  const prefRows = await db.setting.findMany({
    where: { key: { startsWith: notificationPreferencesSettingKey("") } },
  });
  let migratedPrefs = 0;
  for (const row of prefRows) {
    const userId = row.key.slice(notificationPreferencesSettingKey("").length);
    const types = parseNotificationPreferences(row.value);
    const channels = parseChannelPreferences(row.value);
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      await db.setting.delete({ where: { id: row.id } }); // orphaned row
      continue;
    }
    for (const type of DOMAIN_EVENT_TYPES) {
      await db.userNotificationPreference.upsert({
        where: { userId_eventType: { userId, eventType: type } },
        create: {
          userId,
          eventType: type,
          inApp: types[type],
          email: channels[type]?.email ?? false,
          telegram: channels[type]?.telegram ?? false,
        },
        update: {
          inApp: types[type],
          email: channels[type]?.email ?? false,
          telegram: channels[type]?.telegram ?? false,
        },
      });
      migratedPrefs++;
    }
    await db.setting.delete({ where: { id: row.id } });
    console.log(`  prefs migrated: ${user.email} (${DOMAIN_EVENT_TYPES.length} event types)`);
  }

  console.log(
    `\nBackfill complete: ${memberships} memberships ensured, ${demoOrgs} demo orgs flagged, ${prefRows.length} pref users migrated (${migratedPrefs} rows).`
  );
}

main()
  .catch((e) => {
    console.error("BACKFILL FAILED", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
