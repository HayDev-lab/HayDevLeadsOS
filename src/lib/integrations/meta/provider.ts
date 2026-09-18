// META LEAD ADS — provider boundary (v0.19).
//
//   MetaProvider → RealMetaProvider | DemoMetaProvider
//
// LEADOS_DEMO=true forces the Demo provider: ZERO network calls to
// graph.facebook.com (guaranteed by construction — the demo provider simply
// does not import the network client).
//
// Every consumer (service, worker, routes) resolves the provider through
// getMetaProvider() so demo/real switching is a single seam.

import { getMetaConfig, oauthConfigured, META_OAUTH_SCOPES, type MetaConfig } from "./config";
import { MetaError, META_ERROR_CODE } from "./errors";
import type { MetaLeadField } from "./lead-mapper";

export interface MetaPageRef {
  pageId: string;
  pageName: string;
  accessToken: string; // page-scoped token (real) / demo token (demo)
}

export interface MetaFormRef {
  formId: string;
  formName: string;
  status: "ACTIVE" | "PAUSED";
  questions?: string[]; // question names (for mapping hints)
}

export interface MetaLeadData {
  leadgenId: string;
  formId: string;
  pageId: string;
  createdTime: number;
  fieldData: MetaLeadField[];
}

export interface MetaOAuthTokens {
  accessToken: string;
  expiresAt: number | null; // epoch ms
}

export interface MetaProvider {
  readonly mode: "REAL" | "DEMO";
  /** Exchange the OAuth callback code for a user access token. */
  exchangeCode(code: string, redirectUri: string): Promise<MetaOAuthTokens>;
  /** Pages the connected user can manage (with page tokens). */
  listPages(userAccessToken: string): Promise<MetaPageRef[]>;
  /** Lead-gen forms on a page. */
  listForms(pageAccessToken: string, pageId: string): Promise<MetaFormRef[]>;
  /** Subscribe a page to the leadgen webhook field. */
  subscribePage(pageAccessToken: string, pageId: string): Promise<boolean>;
  /** Unsubscribe (disconnect). Returns the now-current state when supported. */
  unsubscribePage(pageAccessToken: string, pageId: string): Promise<boolean>;
  /** Read the current subscribed_fields state from Meta where supported. */
  getSubscriptionStatus(pageAccessToken: string, pageId: string): Promise<"SUBSCRIBED" | "NOT_SUBSCRIBED" | "ERROR">;
  /** Fetch the FULL lead payload for a leadgen id. */
  getLead(userAccessToken: string, leadgenId: string): Promise<MetaLeadData>;
  /** Send a test lead through the SAME provider contract (demo mode only). */
  sendDemoLead?(formId: string, pageId: string, overrides?: Record<string, string>): Promise<{ leadgenId: string }>;
}

// ---------------------------------------------------------------------------
// REAL provider — the ONLY place raw fetch/graphRequest calls happen.
// ---------------------------------------------------------------------------

import { graphRequest } from "./client";

interface TokenExchangeResponse {
  access_token?: string;
  expires_in?: number;
  error?: unknown;
}
interface PagesResponse {
  data?: Array<{
    id: string;
    name: string;
    access_token: string;
  }>;
}
interface FormsResponse {
  data?: Array<{
    id: string;
    name: string;
    status?: string;
    questions?: Array<{ key?: string; label?: string }>;
  }>;
}
interface LeadResponse {
  id: string;
  form_id?: string;
  page_id?: string;
  created_time?: number;
  field_data?: Array<{ name: string; values: string[] }>;
}
interface SubscribedResponse {
  success?: boolean;
  subscribed_fields?: string[];
}

export class RealMetaProvider implements MetaProvider {
  readonly mode = "REAL" as const;
  private cfg: MetaConfig;

  constructor(cfg?: MetaConfig) {
    this.cfg = cfg ?? getMetaConfig();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<MetaOAuthTokens> {
    if (!oauthConfigured(this.cfg)) {
      throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "OAuth not configured (META_APP_ID / META_APP_SECRET / META_REDIRECT_URI)");
    }
    const { data } = await graphRequest<TokenExchangeResponse>({
      accessToken: "",
      path: "/oauth/access_token",
      params: {
        client_id: this.cfg.appId!,
        client_secret: this.cfg.appSecret!,
        redirect_uri: redirectUri,
        code,
      },
    });
    if (!data?.access_token) throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "OAuth exchange returned no token");
    return { accessToken: data.access_token, expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null };
  }

  async listPages(userAccessToken: string): Promise<MetaPageRef[]> {
    const { data } = await graphRequest<PagesResponse>({
      accessToken: userAccessToken,
      path: "/me/accounts",
      params: { fields: "id,name,access_token", limit: "100" },
    });
    return (data.data ?? []).map((p) => ({ pageId: p.id, pageName: p.name, accessToken: p.access_token }));
  }

  async listForms(pageAccessToken: string, pageId: string): Promise<MetaFormRef[]> {
    const { data } = await graphRequest<FormsResponse>({
      accessToken: pageAccessToken,
      path: `/${pageId}/leadgen_forms`,
      params: { fields: "id,name,status,questions", limit: "100" },
    });
    return (data.data ?? []).map((f) => ({
      formId: f.id,
      formName: f.name ?? f.id,
      status: f.status === "PAUSED" ? "PAUSED" : "ACTIVE",
      questions: (f.questions ?? []).map((q) => q.label ?? q.key ?? "").filter(Boolean),
    }));
  }

  async subscribePage(pageAccessToken: string, pageId: string): Promise<boolean> {
    const { data } = await graphRequest<SubscribedResponse>({
      accessToken: pageAccessToken,
      path: `/${pageId}/subscribed_apps`,
      method: "POST",
      postBody: { subscribed_fields: "leadgen" },
    });
    return Boolean(data?.success);
  }

  async unsubscribePage(pageAccessToken: string, pageId: string): Promise<boolean> {
    const { data } = await graphRequest<SubscribedResponse>({
      accessToken: pageAccessToken,
      path: `/${pageId}/subscribed_apps`,
      method: "DELETE",
    });
    return Boolean(data?.success);
  }

  async getSubscriptionStatus(pageAccessToken: string, pageId: string): Promise<"SUBSCRIBED" | "NOT_SUBSCRIBED" | "ERROR"> {
    try {
      const { data } = await graphRequest<{ data?: Array<{ subscribed_fields?: string[] }> }>({
        accessToken: pageAccessToken,
        path: `/${pageId}/subscribed_apps`,
        params: { fields: "subscribed_fields" },
      });
      const fields = data.data?.[0]?.subscribed_fields ?? [];
      return fields.includes("leadgen") ? "SUBSCRIBED" : "NOT_SUBSCRIBED";
    } catch (e) {
      if (e instanceof MetaError && (e.code === META_ERROR_CODE.META_PERMISSION_ERROR || e.code === META_ERROR_CODE.META_AUTH_ERROR)) {
        return "ERROR";
      }
      return "NOT_SUBSCRIBED";
    }
  }

  async getLead(userAccessToken: string, leadgenId: string): Promise<MetaLeadData> {
    const { data } = await graphRequest<LeadResponse>({
      accessToken: userAccessToken,
      path: `/${leadgenId}`,
      params: { fields: "id,form_id,page_id,created_time,field_data" },
    });
    if (!data?.id || !Array.isArray(data.field_data)) {
      throw new MetaError(META_ERROR_CODE.META_INVALID_RESPONSE, "Lead payload missing field_data");
    }
    return {
      leadgenId: data.id,
      formId: String(data.form_id ?? ""),
      pageId: String(data.page_id ?? ""),
      createdTime: data.created_time ?? Date.now(),
      fieldData: data.field_data,
    };
  }
}

// ---------------------------------------------------------------------------
// DEMO provider — deterministic, ZERO graph.facebook.com calls.
// ---------------------------------------------------------------------------

export const DEMO_PAGE_ID = "1010101010101010";
export const DEMO_PAGE_NAME = "HayDev Demo Meta Page";

export const DEMO_FORMS: Array<{ formId: string; name: string; questions: string[] }> = [
  {
    formId: "2020202020202001",
    name: "Website Development Leads",
    questions: ["full_name", "email", "phone_number", "company_name", "budget"],
  },
  {
    formId: "2020202020202002",
    name: "AI Automation Leads",
    questions: ["full_name", "email", "phone_number", "company_name", "use_case"],
  },
  {
    formId: "2020202020202003",
    name: "ERP/CRM Leads",
    questions: ["full_name", "email", "phone_number", "company_name", "current_system"],
  },
];

const DEMO_USERS = [
  { firstName: "Narek", lastName: "Margaryan", company: "Yerevan Tech Group", domain: "narektech.am" },
  { firstName: "Ani", lastName: "Gevorgyan", company: "Gyumri Logistics", domain: "glogistics.am" },
  { firstName: "Vahagn", lastName: "Sargsyan", company: "Vanadzor Manufacturing", domain: "vmanuf.am" },
  { firstName: "Lilit", lastName: "Hakobyan", company: "Ararat Agro Holding", domain: "araratagro.am" },
];

export class DemoMetaProvider implements MetaProvider {
  readonly mode = "DEMO" as const;

  async exchangeCode(_code: string, _redirectUri: string): Promise<MetaOAuthTokens> {
    return { accessToken: "DEMO-USER-TOKEN", expiresAt: null };
  }

  async listPages(_userAccessToken: string): Promise<MetaPageRef[]> {
    return [{ pageId: DEMO_PAGE_ID, pageName: DEMO_PAGE_NAME, accessToken: "DEMO-PAGE-TOKEN" }];
  }

  async listForms(_pageAccessToken: string, _pageId: string): Promise<MetaFormRef[]> {
    return DEMO_FORMS.map((f) => ({ formId: f.formId, formName: f.name, status: "ACTIVE" as const, questions: f.questions }));
  }

  async subscribePage(_pageAccessToken: string, _pageId: string): Promise<boolean> {
    return true;
  }

  async unsubscribePage(_pageAccessToken: string, _pageId: string): Promise<boolean> {
    return true;
  }

  async getSubscriptionStatus(_pageAccessToken: string, _pageId: string): Promise<"SUBSCRIBED" | "NOT_SUBSCRIBED" | "ERROR"> {
    return "SUBSCRIBED";
  }

  async getLead(_token: string, leadgenId: string): Promise<MetaLeadData> {
    const lead = demoLeadPayload(leadgenId);
    if (!lead) throw new MetaError(META_ERROR_CODE.META_NOT_FOUND, "Demo lead not found");
    return lead;
  }

  async sendDemoLead(formId: string, _pageId: string, overrides?: Record<string, string>): Promise<{ leadgenId: string }> {
    const leadgenId = `30${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 17);
    const payload = demoLeadPayload(leadgenId, formId, overrides);
    if (!payload) throw new MetaError(META_ERROR_CODE.META_NOT_FOUND, "Unknown demo form");
    DEMO_LEAD_STORE.set(leadgenId, payload);
    return { leadgenId };
  }
}

/** In-memory demo lead store (demo provider only — durable rows live in DB). */
const DEMO_LEAD_STORE = new Map<string, MetaLeadData>();

function demoLeadPayload(leadgenId: string, formId?: string, overrides?: Record<string, string>): MetaLeadData | null {
  const cached = DEMO_LEAD_STORE.get(leadgenId);
  if (cached) return cached;
  const seed = Number(leadgenId.slice(-4)) || 1;
  const user = DEMO_USERS[seed % DEMO_USERS.length];
  const form = DEMO_FORMS.find((f) => f.formId === formId) ?? DEMO_FORMS[seed % DEMO_FORMS.length];
  const customKey = form.questions.find((q) => !["full_name", "email", "phone_number", "company_name"].includes(q)) ?? "interest";
  const customAnswers: Record<string, string> = {
    budget: "1.5M AMD",
    use_case: "Automate invoice processing",
    current_system: "Spreadsheets",
    interest: "General consultation",
  };
  const base: MetaLeadData = {
    leadgenId,
    formId: form.formId,
    pageId: DEMO_PAGE_ID,
    createdTime: Date.now(),
    fieldData: [
      { name: "full_name", values: [`${user.firstName} ${user.lastName}`] },
      { name: "email", values: [`${user.firstName.toLowerCase()}@${user.domain}`] },
      { name: "phone_number", values: [`+3749${String(1000000 + seed * 137).slice(0, 7)}`] },
      { name: "company_name", values: [user.company] },
      { name: customKey, values: [customAnswers[customKey] ?? "—"] },
    ],
  };
  if (overrides) {
    base.fieldData = base.fieldData.map((f) => (overrides[f.name] ? { ...f, values: [overrides[f.name]] } : f));
  }
  return base;
}

/** Resolve the provider: demo mode → Demo, else Real. */
export function getMetaProvider(): MetaProvider {
  const cfg = getMetaConfig();
  return cfg.demo ? new DemoMetaProvider() : new RealMetaProvider(cfg);
}

export { META_OAUTH_SCOPES };
