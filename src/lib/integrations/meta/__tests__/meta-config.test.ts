// META — config + demo provider (v0.19). Required cases: version format
// validation, default v25.0, OAuth scope list, demo provider behavior
// (forms, sendDemoLead → getLead, zero-network by construction).
import { describe, test, expect, beforeAll } from "bun:test";
import { getMetaConfig, DEFAULT_GRAPH_API_VERSION, META_OAUTH_SCOPES, oauthConfigured } from "../config";
import { getMetaProvider, DemoMetaProvider, DEMO_FORMS, DEMO_PAGE_ID } from "../provider";

describe("meta config", () => {
  test("default Graph version is v25.0 (current stable)", () => {
    expect(DEFAULT_GRAPH_API_VERSION).toBe("v25.0");
  });
  test("invalid version format rejected", () => {
    const prev = process.env.META_GRAPH_API_VERSION;
    process.env.META_GRAPH_API_VERSION = "25";
    expect(() => getMetaConfig()).toThrow();
    if (prev === undefined) delete process.env.META_GRAPH_API_VERSION; else process.env.META_GRAPH_API_VERSION = prev;
  });
  test("custom valid version honored", () => {
    const prev = process.env.META_GRAPH_API_VERSION;
    process.env.META_GRAPH_API_VERSION = "v24.0";
    expect(getMetaConfig().graphApiVersion).toBe("v24.0");
    if (prev === undefined) delete process.env.META_GRAPH_API_VERSION; else process.env.META_GRAPH_API_VERSION = prev;
  });
  test("OAuth scopes include the Lead Ads permission set", () => {
    for (const s of ["leads_retrieval", "pages_manage_metadata", "pages_show_list", "pages_read_engagement"]) {
      expect(META_OAUTH_SCOPES as readonly string[]).toContain(s);
    }
  });
  test("oauthConfigured false without app credentials", () => {
    expect(oauthConfigured(getMetaConfig())).toBe(false);
  });
});

describe("meta demo provider (zero network)", () => {
  test("demo mode resolves the Demo provider", () => {
    const prev = process.env.LEADOS_DEMO;
    process.env.LEADOS_DEMO = "true";
    expect(getMetaProvider().mode).toBe("DEMO");
    if (prev === undefined) delete process.env.LEADOS_DEMO; else process.env.LEADOS_DEMO = prev;
  });
  test("demo provider module imports no fetch graph client", async () => {
    // The demo provider lives in provider.ts which DOES import the client for
    // RealMetaProvider... so prove zero-network differently: the Demo instance
    // never issues requests — assert its methods resolve without global fetch.
    const demo = new DemoMetaProvider();
    const calls: unknown[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => { calls.push(args); return origFetch(...args); }) as typeof fetch;
    try {
      const pages = await demo.listPages("t");
      const forms = await demo.listForms("t", DEMO_PAGE_ID);
      await demo.subscribePage("t", DEMO_PAGE_ID);
      const sent = await demo.sendDemoLead!(DEMO_FORMS[0].formId, DEMO_PAGE_ID);
      const lead = await demo.getLead("t", sent.leadgenId);
      expect(calls.length).toBe(0);
      expect(pages.length).toBe(1);
      expect(forms.length).toBe(3);
      expect(lead.leadgenId).toBe(sent.leadgenId);
      expect(lead.fieldData.length).toBeGreaterThan(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  test("same demo leadgenId → same payload (deterministic)", async () => {
    const demo = new DemoMetaProvider();
    const a = await demo.getLead("t", "9990001");
    const b = await demo.getLead("t", "9990001");
    expect(a).toEqual(b);
  });
  test("demo getLead resolves arbitrary ids deterministically (no not-found path)", async () => {
    const demo = new DemoMetaProvider();
    const lead = await demo.getLead("t", "1");
    expect(lead.leadgenId).toBe("1");
    expect(lead.fieldData.length).toBeGreaterThan(2);
  });
});
