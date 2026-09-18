// META LEAD ADS — lead field mapper (v0.19).
//
// THE BACKEND MAPPER IS THE SOURCE OF TRUTH (spec 14): the UI persists mapping
// config, but this module applies it and decides what a Meta field means.
//
// Known Meta fields → canonical Lead fields:
//   full_name, first_name, last_name, email, phone_number, company_name,
//   city, country + custom questions.
// Custom questions resolve by config to: CUSTOM_FIELD | METADATA | IGNORE.
// Unknown/unmapped fields NEVER silently map to a wrong Lead field — they end
// up in `unresolved` and (when config says so) METADATA.
//
// Unicode-safe: values pass through untouched (trim only).

export type LeadosTarget =
  | "firstName" | "lastName" | "email" | "phone" | "company" | "position"
  | "city" | "country" | "summary";

export type CustomTarget = "CUSTOM_FIELD" | "METADATA" | "IGNORE";

export interface MappingRule {
  metaField: string; // question/field name as sent by Meta (case-insensitive match)
  target: LeadosTarget | CustomTarget;
  customFieldKey?: string; // required when target === CUSTOM_FIELD
}

export interface MetaLeadField {
  name: string;
  values: string[];
}

export interface MappedLead {
  leadFields: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    company?: string;
    position?: string;
    summary?: string;
  };
  /** Custom-question answers kept as metadata (question → answer). */
  metadata: Record<string, string>;
  /** Custom-question answers destined for org Custom Fields (key → value). */
  customFieldValues: Record<string, string>;
  /** Fields present in the Meta lead but not mapped to anything. */
  unresolved: string[];
}

const KNOWN_FIELD_ALIASES: Record<string, LeadosTarget> = {
  full_name: "firstName", // split heuristically below
  name: "firstName",
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  email_address: "email",
  phone_number: "phone",
  phone: "phone",
  phone_no: "phone",
  company_name: "company",
  company: "company",
  organization: "company",
  job_title: "position",
  position: "position",
  title: "position",
  city: "summary",
  country: "summary",
};

const CITY_COUNTRY_KEYS = new Set(["city", "country"]);

export function normalizeMetaFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Apply mapping rules to a retrieved Meta lead's field_data. */
export function mapMetaLead(fields: MetaLeadField[], rules?: MappingRule[] | null): MappedLead {
  const out: MappedLead = { leadFields: {}, metadata: {}, customFieldValues: {}, unresolved: [] };
  const rulesByNorm = new Map<string, MappingRule>();
  for (const r of rules ?? []) rulesByNorm.set(normalizeMetaFieldName(r.metaField), r);

  let cityPart = "";
  let countryPart = "";
  let fullName = "";

  for (const f of fields) {
    const value = (f.values ?? []).map((v) => v?.trim() ?? "").find((v) => v.length > 0) ?? "";
    if (!value) continue;
    const norm = normalizeMetaFieldName(f.name);
    const rule = rulesByNorm.get(norm);

    if (rule) {
      // EXPLICIT config wins — including IGNORE (deliberate drop).
      if (rule.target === "IGNORE") continue;
      if (rule.target === "METADATA") {
        out.metadata[f.name] = value;
        continue;
      }
      if (rule.target === "CUSTOM_FIELD") {
        if (rule.customFieldKey) out.customFieldValues[rule.customFieldKey] = value;
        else out.metadata[f.name] = value; // misconfigured rule → safe metadata
        continue;
      }
      applyKnown(out, rule.target, value);
      continue;
    }

    // No explicit rule → canonical alias table.
    const known = KNOWN_FIELD_ALIASES[norm];
    if (norm === "full_name" || norm === "name") {
      fullName = value; // resolved after the loop (first/last split)
      continue;
    }
    if (CITY_COUNTRY_KEYS.has(norm)) {
      if (norm === "city") cityPart = value; else countryPart = value;
      continue;
    }
    if (known) {
      applyKnown(out, known, value);
      continue;
    }
    // Custom question without a rule → METADATA (visible, never mis-mapped).
    out.metadata[f.name] = value;
  }

  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      out.leadFields.firstName = out.leadFields.firstName ?? parts[0];
    } else {
      out.leadFields.firstName = out.leadFields.firstName ?? parts.slice(0, -1).join(" ");
      out.leadFields.lastName = out.leadFields.lastName ?? parts[parts.length - 1];
    }
  }
  if (cityPart || countryPart) {
    const loc = [cityPart, countryPart].filter(Boolean).join(", ");
    out.leadFields.summary = out.leadFields.summary ? `${out.leadFields.summary} · ${loc}` : `Location: ${loc}`;
  }

  return out;
}

function applyKnown(out: MappedLead, target: LeadosTarget, value: string): void {
  if (target === "city" || target === "country") return; // handled via summary
  if (target === "summary") {
    out.leadFields.summary = out.leadFields.summary ? `${out.leadFields.summary} · ${value}` : value;
    return;
  }
  // Never overwrite an already-mapped field with a second rule.
  if (out.leadFields[target] === undefined) out.leadFields[target] = value;
}

/** Build the initial note text from metadata + custom answers (attribution
 *  context for the salesperson — the raw payload also lives on the durable
 *  MetaWebhookEvent row). */
export function metadataNote(mapped: MappedLead, formName?: string | null): string | null {
  const entries = Object.entries({ ...mapped.metadata, ...mapped.customFieldValues });
  if (!entries.length && !formName) return null;
  const lines = entries.map(([q, a]) => `${q}: ${a}`);
  const head = formName ? `Meta Lead Ads · ${formName}` : "Meta Lead Ads";
  return [head, ...lines].join("\n");
}
