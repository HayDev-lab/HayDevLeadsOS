/**
 * Meta Lead Ads Integration — Public API
 * 
 * Re-exports all public interfaces for the Meta integration.
 */

export { metaConfig, isMetaConfigured, validateMetaConfig, getGraphApiUrl } from "./meta-config";
export type { MetaConfig } from "./meta-config";

export { encryptToken, decryptToken, clearEncryptionKeyCache } from "./meta-encryption";

export {
  MetaIntegrationError,
  createMetaErrorFromApiResponse,
  isMetaError,
} from "./meta-errors";
export type { MetaErrorType } from "./meta-errors";

export {
  graphGet,
  graphPost,
  graphDelete,
  fetchLeadDetails,
  fetchPageDetails,
  fetchPageLeadForms,
  subscribePageToLeadgen,
  checkPageSubscription,
  unsubscribePageFromLeadgen,
  fetchUserPages,
  debugToken,
} from "./meta-client";
export type { GraphApiResponse, RequestOptions } from "./meta-client";

export {
  verifyWebhookSubscription,
  verifyWebhookSignature,
  parseWebhookPayload,
  processWebhookEvents,
  getWebhookUrl,
} from "./meta-webhooks";
export type {
  WebhookVerificationParams,
  WebhookEntry,
  WebhookChange,
  WebhookPayload,
} from "./meta-webhooks";

export {
  autoMapMetaField,
  normalizeMetaFieldData,
  applyFieldMapping,
  generateSuggestedMappings,
  formatPhoneNumber,
  maskEmail,
  maskPhone,
  COMMON_META_FIELD_NAMES,
  FieldMappingSchema,
} from "./meta-lead-mapper";
export type { LeadOSFieldKey, FieldMapping, FieldMappingConfig } from "./meta-lead-mapper";

export {
  connectMetaAccount,
  getMetaAccessToken,
  getAvailablePages,
  connectPage,
  getPageLeadForms,
  mapFormFields,
  processMetaLead,
  disconnectMeta,
  validateConnection,
} from "./meta-service";
export type {
  MetaConnectionStatus,
  MetaPageConnectionStatus,
  MetaLeadFormStatus,
} from "./meta-service";
