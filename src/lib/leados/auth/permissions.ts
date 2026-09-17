// CENTRALIZED PERMISSION MODEL (v0.17 spec 8–10).
//
// Single source of truth: ROLE_PERMISSIONS maps each role to a set of
// permission constants. Application code NEVER hardcodes role checks —
// it asks can(role, PERMISSION.X) or requirePermission(session, ...).
//
// Legacy roles (MANAGER / SALES_MANAGER from pre-v0.17 data) normalize to
// MEMBER, so old rows cannot bypass the new model.

export const ROLES_V017 = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;
export type AuthRole = (typeof ROLES_V017)[keyof typeof ROLES_V017];

const LEGACY_ROLE_MAP: Record<string, AuthRole> = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MANAGER: "MEMBER",
  SALES_MANAGER: "MEMBER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

export function normalizeRole(role: string): AuthRole {
  return LEGACY_ROLE_MAP[role] ?? "MEMBER";
}

export const PERMISSIONS = {
  // leads / pipeline work
  LEAD_READ: "LEAD_READ",
  LEAD_WRITE: "LEAD_WRITE",
  TASK_WRITE: "TASK_WRITE",
  ACTIVITY_WRITE: "ACTIVITY_WRITE",
  PIPELINE_MANAGE: "PIPELINE_MANAGE",
  // automation (spec 44)
  AUTOMATION_READ: "AUTOMATION_READ",
  AUTOMATION_MANAGE: "AUTOMATION_MANAGE",
  AUTOMATION_RETRY: "AUTOMATION_RETRY",
  // integrations (spec 45)
  INTEGRATION_MANAGE: "INTEGRATION_MANAGE",
  DELIVERY_READ: "DELIVERY_READ",
  // team / members (spec 30–36)
  TEAM_READ: "TEAM_READ",
  MEMBER_MANAGE: "MEMBER_MANAGE",
  // settings (spec 47)
  ORG_SETTINGS_MANAGE: "ORG_SETTINGS_MANAGE",
  WORKER_HEALTH_READ: "WORKER_HEALTH_READ",
  AUDIT_READ: "AUDIT_READ",
  // organization
  ORGANIZATION_DELETE: "ORGANIZATION_DELETE",
  ANALYTICS_READ: "ANALYTICS_READ",
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const MEMBER_PERMISSIONS: Permission[] = [
  PERMISSIONS.LEAD_READ,
  PERMISSIONS.LEAD_WRITE,
  PERMISSIONS.TASK_WRITE,
  PERMISSIONS.ACTIVITY_WRITE,
  PERMISSIONS.AUTOMATION_READ,
  PERMISSIONS.TEAM_READ,
  PERMISSIONS.ANALYTICS_READ,
];

const VIEWER_PERMISSIONS: Permission[] = [
  PERMISSIONS.LEAD_READ,
  PERMISSIONS.AUTOMATION_READ,
  PERMISSIONS.TEAM_READ,
  PERMISSIONS.ANALYTICS_READ,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...MEMBER_PERMISSIONS,
  PERMISSIONS.PIPELINE_MANAGE,
  PERMISSIONS.AUTOMATION_MANAGE,
  PERMISSIONS.AUTOMATION_RETRY,
  PERMISSIONS.INTEGRATION_MANAGE,
  PERMISSIONS.DELIVERY_READ,
  PERMISSIONS.MEMBER_MANAGE,
  PERMISSIONS.ORG_SETTINGS_MANAGE,
  PERMISSIONS.WORKER_HEALTH_READ,
  PERMISSIONS.AUDIT_READ,
];

const OWNER_PERMISSIONS: Permission[] = [
  ...ADMIN_PERMISSIONS,
  PERMISSIONS.ORGANIZATION_DELETE,
];

export const ROLE_PERMISSIONS: Record<AuthRole, Permission[]> = {
  OWNER: OWNER_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  MEMBER: MEMBER_PERMISSIONS,
  VIEWER: VIEWER_PERMISSIONS,
};

/** Central permission check — the ONLY way code should ask "may this role do X?". */
export function can(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[normalizeRole(role)];
  return perms != null && perms.includes(permission);
}

export function permissionsForRole(role: string): Permission[] {
  return ROLE_PERMISSIONS[normalizeRole(role)] ?? MEMBER_PERMISSIONS;
}

/**
 * Back-compat shims for pre-v0.17 helpers — now backed by the permission map
 * so legacy call sites inherit the new model automatically.
 */
export function canManageRole(role: string): boolean {
  return can(role, PERMISSIONS.ORG_SETTINGS_MANAGE);
}

export function canMutateRole(role: string): boolean {
  return can(role, PERMISSIONS.LEAD_WRITE);
}
