/**
 * Meta Lead Ads Integration — Field Mapper
 * 
 * Maps Meta form field data to canonical LeadOS lead fields.
 * Supports auto-mapping based on field names and custom mappings.
 */

import { z } from "zod";

/**
 * Standard LeadOS field keys that Meta fields can map to.
 */
export type LeadOSFieldKey =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "company"
  | "position"
  | "city"
  | "country"
  | "custom";

/**
 * Common Meta field names (from standard questions).
 */
export const COMMON_META_FIELD_NAMES: Record<string, string[]> = {
  firstName: ["first_name", "firstname", "first name"],
  lastName: ["last_name", "lastname", "last name"],
  fullName: ["full_name", "fullname", "full name", "name"],
  email: ["email", "email_address", "email address"],
  phone: ["phone", "phone_number", "phone number", "mobile", "mobile_number"],
  company: ["company", "company_name", "company name", "organization"],
  position: ["position", "job_title", "job title", "title"],
  city: ["city", "address_city", "address city"],
  country: ["country", "address_country", "address country"],
};

/**
 * Auto-detect mapping for a Meta field name.
 * Returns the best matching LeadOS field key or null.
 */
export function autoMapMetaField(metaFieldName: string): LeadOSFieldKey | null {
  const normalized = metaFieldName.toLowerCase().replace(/[-_]/g, "_");

  for (const [leadOSKey, variants] of Object.entries(COMMON_META_FIELD_NAMES)) {
    if (variants.includes(normalized)) {
      return leadOSKey as LeadOSFieldKey;
    }
  }

  // Check for partial matches
  for (const [leadOSKey, variants] of Object.entries(COMMON_META_FIELD_NAMES)) {
    for (const variant of variants) {
      if (normalized.includes(variant) || variant.includes(normalized)) {
        return leadOSKey as LeadOSFieldKey;
      }
    }
  }

  return null;
}

/**
 * Field mapping configuration for a Meta form.
 */
export interface FieldMapping {
  metaFieldName: string;
  leadOSField: LeadOSFieldKey;
  isCustom?: boolean; // True if this is a custom question
}

/**
 * Parse Meta field_data array into a normalized map.
 */
export function normalizeMetaFieldData(
  fieldData: Array<{ name: string; values: string[] }> | undefined
): Record<string, string> {
  const result: Record<string, string> = {};

  if (!fieldData) {
    return result;
  }

  for (const field of fieldData) {
    const name = field.name || "";
    const values = field.values || [];

    // Join multiple values with space (for checkboxes, etc.)
    result[name] = values.join(" ");
  }

  return result;
}

/**
 * Apply field mapping to convert Meta data to LeadOS lead fields.
 */
export function applyFieldMapping(
  metaFieldData: Record<string, string>,
  mappings: FieldMapping[]
): {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  city?: string;
  country?: string;
  customFields: Record<string, string>;
} {
  const result: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    company?: string;
    position?: string;
    city?: string;
    country?: string;
    customFields: Record<string, string>;
  } = {
    customFields: {},
  };

  const appliedMappings = new Set<string>();

  for (const mapping of mappings) {
    const metaValue = metaFieldData[mapping.metaFieldName];

    if (metaValue === undefined || metaValue === "") {
      continue; // Skip unmapped fields
    }

    appliedMappings.add(mapping.metaFieldName);

    switch (mapping.leadOSField) {
      case "firstName":
        result.firstName = metaValue;
        break;
      case "lastName":
        result.lastName = metaValue;
        break;
      case "fullName":
        // Split full name if firstName/lastName not provided
        if (!result.firstName && !result.lastName) {
          const parts = metaValue.trim().split(/\s+/);
          if (parts.length >= 2) {
            result.firstName = parts[0];
            result.lastName = parts.slice(1).join(" ");
          } else {
            result.firstName = metaValue;
          }
        }
        break;
      case "email":
        result.email = metaValue;
        break;
      case "phone":
        result.phone = metaValue;
        break;
      case "company":
        result.company = metaValue;
        break;
      case "position":
        result.position = metaValue;
        break;
      case "city":
        result.city = metaValue;
        break;
      case "country":
        result.country = metaValue;
        break;
      case "custom":
      default:
        result.customFields[mapping.metaFieldName] = metaValue;
        break;
    }
  }

  // Store any unmapped fields in customFields
  for (const [metaFieldName, value] of Object.entries(metaFieldData)) {
    if (!appliedMappings.has(metaFieldName) && value) {
      result.customFields[metaFieldName] = value;
    }
  }

  return result;
}

/**
 * Generate suggested mappings for all Meta fields.
 */
export function generateSuggestedMappings(
  metaFieldNames: string[]
): FieldMapping[] {
  return metaFieldNames.map((fieldName) => {
    const autoMapped = autoMapMetaField(fieldName);
    return {
      metaFieldName: fieldName,
      leadOSField: autoMapped || "custom",
      isCustom: !autoMapped,
    };
  });
}

/**
 * Validate field mapping configuration.
 */
export const FieldMappingSchema = z.array(
  z.object({
    metaFieldName: z.string().min(1),
    leadOSField: z.enum([
      "firstName",
      "lastName",
      "fullName",
      "email",
      "phone",
      "company",
      "position",
      "city",
      "country",
      "custom",
    ]),
  })
);

export type FieldMappingConfig = z.infer<typeof FieldMappingSchema>;

/**
 * Format phone number (basic normalization).
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // If starts with 8 and length is 11 (Russian/Armenian format), convert to +7/+374
  if (cleaned.startsWith("8") && cleaned.length === 11) {
    // This is a simplification - proper formatting would need country context
    cleaned = "+7" + cleaned.slice(1);
  }

  // Ensure + prefix if it looks like an international number
  if (cleaned.length > 10 && !cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }

  return cleaned;
}

/**
 * Mask PII for display (during testing/debugging).
 */
export function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return email;

  const [username, domain] = parts;
  const maskedUsername =
    username.charAt(0) + "***" + username.charAt(username.length - 1);

  return `${maskedUsername}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";

  const visible = digits.slice(-2);
  return "***" + visible;
}
