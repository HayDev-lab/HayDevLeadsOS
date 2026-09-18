// HAYDEV LEADOS — NOTIFICATION TEMPLATE VAR TESTS (v0.20 §32 repair).
//
// The E2E repair loop found that notif.lead_ingested.message rendered the
// {context} placeholder literally and {name} empty. These tests pin the fix:
// the template var maps (notification-card for in-app, fanout for deliveries)
// must substitute context (channel) and name (leadName).

import { describe, expect, test } from "bun:test";
import { renderNotificationText } from "../src/components/leados/notifications/notification-card";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

/** Minimal t() that substitutes {var} placeholders like the real i18n. */
const t: TFunc = (key, vars) => {
  const dict: Record<string, string> = {
    "notif.lead_ingested.title": "New lead from an external channel",
    "notif.lead_ingested.message": "Lead {name} arrived from the {context} channel",
  };
  const raw = dict[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, v) => String(vars?.[v] ?? `{${v}}`));
};

describe("LEAD_INGESTED notification template vars (§32 repair)", () => {
  test("context + name substitute correctly (no literal placeholders)", () => {
    const n = {
      title: "snapshot title",
      message: "snapshot message",
      templateKey: "notif.lead_ingested.title",
      payload: {
        leadName: "Vahagn Sargsyan",
        context: "Meta Lead Ads · Website Development Leads",
        channel: "meta_lead_ads",
      },
    } as never;
    const { title, message } = renderNotificationText(n, t as never);
    expect(title).toBe("New lead from an external channel");
    expect(message).toBe("Lead Vahagn Sargsyan arrived from the Meta Lead Ads · Website Development Leads channel");
    expect(message).not.toContain("{context}");
    expect(message).not.toContain("{name}");
  });

  test("context falls back to the channel slug when channelContext is absent", () => {
    const n = {
      title: "t",
      message: "m",
      templateKey: "notif.lead_ingested.title",
      payload: { leadName: "Ani", channel: "public_ingest" },
    } as never;
    const { message } = renderNotificationText(n, t as never);
    expect(message).toContain("public_ingest");
    expect(message).not.toContain("{context}");
  });

  test("non-template notifications (no templateKey) return the stored snapshot", () => {
    const n = { title: "plain title", message: "plain message", templateKey: null, payload: {} } as never;
    const { title, message } = renderNotificationText(n, t as never);
    expect(title).toBe("plain title");
    expect(message).toBe("plain message");
  });
});
