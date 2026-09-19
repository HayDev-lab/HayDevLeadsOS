// DEMO MODE ISOLATION POLICY (v0.19.3 security hotfix).
//
// LEADOS_DEMO=true turns every anonymous visitor into an OWNER of the demo
// organization(s). That is acceptable ONLY while the deployment is a pure
// packaged demo. The moment a real (non-demo) organization exists in the
// same database, demo mode would be a public OWNER session sitting next to
// customer data — an unsafe mixed deployment.
//
// This module is PURE so the boot invariant and tests can evaluate it
// without touching the DB.

export interface DemoIsolationCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Evaluate demo-mode isolation. `nonDemoOrgCount` is the number of
 * organizations with isDemo=false in the database.
 */
export function checkDemoIsolation(nonDemoOrgCount: number): DemoIsolationCheck {
  if (!Number.isInteger(nonDemoOrgCount) || nonDemoOrgCount < 0) {
    return { ok: false, reason: `invalid non-demo organization count: ${nonDemoOrgCount}` };
  }
  if (nonDemoOrgCount > 0) {
    return {
      ok: false,
      reason:
        `LEADOS_DEMO=true but ${nonDemoOrgCount} non-demo organization(s) exist in this database. ` +
        "Demo mode grants anonymous OWNER sessions and must never share a database with customer data. " +
        "Refusing unsafe startup: remove LEADOS_DEMO, or move the demo data to a separate database.",
    };
  }
  return { ok: true };
}
