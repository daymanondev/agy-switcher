/**
 * Core type definitions for agy-switcher
 */

export interface OAuthToken {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expiry?: string;
  expires_in?: number;
}

export interface AntigravityPayload {
  token: OAuthToken;
  auth_method?: string;
  id_token_email?: string;
}

export interface AntigravityProfile {
  alias: string;
  email?: string;
  authMethod?: string;
  isActive: boolean;
  payload: AntigravityPayload;
  updatedAt: string;
}

export interface ProfileSummary {
  alias: string;
  email?: string;
  isActive: boolean;
  tier?: string;
  expiresInSeconds?: number;
  isExpired: boolean;
}

export interface GoogleTokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

// ----------------------------------------------------------------------------
// Cloud Code Assist API & Quota Engine Types
// ----------------------------------------------------------------------------

export interface CloudCodeMetadata {
  ideType: string;
  platform: string;
  pluginType: string;
  ideVersion?: string;
  pluginVersion?: string;
  mode?: string;
}

export interface CloudCodeTierInfo {
  id: string;
  name: string;
  description?: string;
  userDefinedCloudaicompanionProject?: boolean;
  isDefault?: boolean;
  usesGcpTos?: boolean;
}

export interface CloudCodeIneligibleTier {
  tierId: string;
  tierName: string;
  reasonCode: string;
  reasonMessage: string;
  validationErrorMessage?: string;
  validationUrlLinkText?: string;
  validationUrl?: string;
}

export interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string | null;
  currentTier?: CloudCodeTierInfo;
  paidTier?: CloudCodeTierInfo;
  allowedTiers?: CloudCodeTierInfo[];
  ineligibleTiers?: CloudCodeIneligibleTier[];
}

export interface RawQuotaSummaryBucket {
  bucketId: string;
  displayName?: string;
  description?: string;
  window?: '5h' | 'weekly' | string;
  remainingFraction?: number;
  remainingAmount?: number;
  disabled?: boolean;
  resetTime?: string;
}


export interface RawQuotaSummaryGroup {
  displayName: string;
  description?: string;
  buckets: RawQuotaSummaryBucket[];
}

export interface RetrieveUserQuotaSummaryResponse {
  groups?: RawQuotaSummaryGroup[];
  buckets?: RawQuotaSummaryBucket[];
}

export interface RawUserQuotaBucket {
  modelId: string;
  tokenType?: string;
  remainingFraction?: number;
  remainingAmount?: number;
  resetTime?: string;
}

export interface RetrieveUserQuotaResponse {
  buckets?: RawUserQuotaBucket[];
}

export interface QuotaBucketInfo {
  remainingFraction: number;
  resetTime: string | null;
}

export interface ModelQuotaInfo extends QuotaBucketInfo {
  modelId: string;
}

export interface QuotaFetchResult {
  tier: { id: string; name: string };
  project?: string;
  claude5h?: QuotaBucketInfo;
  claudeWeekly?: QuotaBucketInfo;
  gemini: ModelQuotaInfo[];
  ineligible?: boolean;
  ineligibleReason?: string;
  error?: string;
}

export interface QuotaBucketSummary {
  bucketId: string;
  displayName: string;
  window?: '5h' | 'weekly' | string;
  remainingFraction: number; // Clamped [0.0, 1.0]
  percentage: number;        // Clamped [0, 100] integer
  resetTime?: string;        // RFC3339 timestamp
  humanCountdown?: string;   // e.g. "ready", "45m", "3h 15m", "6d 14h"
  disabled: boolean;
  tokenType?: string;
  remainingAmount?: number;
}

export interface ModelQuotaSummary extends QuotaBucketSummary {
  modelId: string;
}

export interface UnifiedQuotaSummary {
  email: string;
  tierId: string;
  tierDisplayName: string;
  projectId?: string;
  fetchedAt: string;
  isPaidTier: boolean;
  isUsable: boolean;
  claude5h?: QuotaBucketSummary;
  claudeWeekly?: QuotaBucketSummary;
  geminiOverall: QuotaBucketSummary;
  geminiModels: Record<string, ModelQuotaSummary>;
  overallScore: number;
  notes?: string[];
}

export interface ProfileScoreEntry {
  alias: string;
  email?: string;
  score: number;
  claude5hPct: number;
  claudeWeeklyPct: number;
  geminiPct: number;
  isCurrentlyActive: boolean;
  isPaidTier: boolean;
  lowestResetTime?: string;
  quotaSummary: UnifiedQuotaSummary;
}

export interface ProfileWithQuota {
  alias: string;
  email?: string;
  isActive: boolean;
  quota?: UnifiedQuotaSummary;
}

