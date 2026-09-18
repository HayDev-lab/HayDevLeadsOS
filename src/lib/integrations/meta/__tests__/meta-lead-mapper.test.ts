// META — lead field mapper (v0.19). Required cases: known fields, full_name
// split, custom questions → metadata, explicit rules (CUSTOM_FIELD/IGNORE),
// Unicode values, city/country → summary, no silent wrong mapping.
import { describe, test, expect } from "bun:test";
import { mapMetaLead, metadataNote, type MappingRule } from "../lead-mapper";

describe("meta lead mapper", () => {
  test("known fields map canonically", () => {
    const m = mapMetaLead([
      { name: "first_name", values: ["Narek"] },
      { name: "last_name", values: ["Margaryan"] },
      { name: "email", values: ["narek@demo.am"] },
      { name: "phone_number", values: ["+37499123456"] },
      { name: "company_name", values: ["Demo Co"] },
    ]);
    expect(m.leadFields).toEqual({
      firstName: "Narek", lastName: "Margaryan", email: "narek@demo.am",
      phone: "+37499123456", company: "Demo Co",
    });
    expect(m.metadata).toEqual({});
  });

  test("full_name splits heuristically", () => {
    const m = mapMetaLead([{ name: "full_name", values: ["Ani Gevorgyan"] }]);
    expect(m.leadFields.firstName).toBe("Ani");
    expect(m.leadFields.lastName).toBe("Gevorgyan");
    const single = mapMetaLead([{ name: "full_name", values: ["Vahagn"] }]);
    expect(single.leadFields.firstName).toBe("Vahagn");
    expect(single.leadFields.lastName).toBeUndefined();
  });

  test("custom questions → metadata (never a wrong lead field)", () => {
    const m = mapMetaLead([{ name: "budget", values: ["1.5M AMD"] }]);
    expect(m.leadFields.company).toBeUndefined();
    expect(m.metadata["budget"]).toBe("1.5M AMD");
  });

  test("explicit rules: CUSTOM_FIELD + customFieldKey", () => {
    const rules: MappingRule[] = [{ metaField: "budget", target: "CUSTOM_FIELD", customFieldKey: "budget_range" }];
    const m = mapMetaLead([{ name: "budget", values: ["2M"] }], rules);
    expect(m.customFieldValues["budget_range"]).toBe("2M");
  });

  test("explicit rules: IGNORE drops the field", () => {
    const rules: MappingRule[] = [{ metaField: "budget", target: "IGNORE" }];
    const m = mapMetaLead([{ name: "budget", values: ["2M"] }], rules);
    expect(m.metadata["budget"]).toBeUndefined();
    expect(m.customFieldValues["budget_range"]).toBeUndefined();
  });

  test("explicit rules: METADATA keeps it out of lead fields", () => {
    const rules: MappingRule[] = [{ metaField: "company_name", target: "METADATA" }];
    const m = mapMetaLead([{ name: "company_name", values: ["Acme"] }], rules);
    expect(m.leadFields.company).toBeUndefined();
    expect(m.metadata["company_name"]).toBe("Acme");
  });

  test("unicode values pass through untouched", () => {
    const m = mapMetaLead([
      { name: "first_name", values: ["Արամ"] },
      { name: "use_case", values: ["Автоматизация счетов — մշակում"] },
    ]);
    expect(m.leadFields.firstName).toBe("Արամ");
    expect(m.metadata["use_case"]).toBe("Автоматизация счетов — մշակում");
  });

  test("city + country fold into summary", () => {
    const m = mapMetaLead([
      { name: "city", values: ["Yerevan"] },
      { name: "country", values: ["Armenia"] },
    ]);
    expect(m.leadFields.summary).toContain("Yerevan");
    expect(m.leadFields.summary).toContain("Armenia");
  });

  test("empty values skipped; first rule wins on duplicates", () => {
    const m = mapMetaLead([
      { name: "email", values: ["", "real@x.am"] },
    ]);
    expect(m.leadFields.email).toBe("real@x.am");
  });

  test("metadataNote builds the attribution note", () => {
    const m = mapMetaLead([{ name: "budget", values: ["3M"] }]);
    const note = metadataNote(m, "AI Automation Leads");
    expect(note).toContain("Meta Lead Ads · AI Automation Leads");
    expect(note).toContain("budget: 3M");
    expect(metadataNote({ leadFields: {}, metadata: {}, customFieldValues: {}, unresolved: [] }, null)).toBeNull();
  });
});
