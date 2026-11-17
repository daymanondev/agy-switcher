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
