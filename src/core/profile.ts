import type {
  AntigravityPayload,
  AntigravityProfile,
  ProfileSummary,
  UnifiedQuotaSummary,
  ProfileWithQuota,
} from './types.ts';
import { AgySwitcherError, ProfileNotFoundError } from './errors.ts';
import {
  type IKeychainService,
  MacKeychainService,
  encodeKeyringPayload,
  parseKeyringPayload,
} from './keychain.ts';
import {
  DEFAULT_FALLBACK_FILE_PATH,
  syncFallbackFile,
} from './fallback.ts';
import {
  isTokenExpired,
  getTokenExpiresInSeconds,
  ensureFreshPayload,
} from './token.ts';
import { CloudCodeClient } from './client.ts';
import { normalizeQuotaData } from './quota.ts';
import { findBestProfile } from './scorer.ts';


export const KEYCHAIN_SERVICE = 'gemini';
export const PRIMARY_ACCOUNT = 'antigravity';
export const PROFILE_ACCOUNT_PREFIX = 'antigravity-profile:';

export interface ProfileServiceOptions {
  keychain?: IKeychainService;
  fallbackPath?: string;
}

export class ProfileService {
  private readonly keychain: IKeychainService;
  private readonly fallbackPath: string;

  constructor(options?: ProfileServiceOptions) {
    this.keychain = options?.keychain ?? new MacKeychainService();
    this.fallbackPath = options?.fallbackPath ?? DEFAULT_FALLBACK_FILE_PATH;
  }

  /**
   * Retrieves currently active profile from primary slot `gemini:antigravity`.
   * Returns null if slot does not exist.
   */
  async getActiveProfile(): Promise<AntigravityProfile | null> {
    const rawSecret = await this.keychain.findGenericPassword(
      KEYCHAIN_SERVICE,
      PRIMARY_ACCOUNT
    );

    if (!rawSecret) {
      return null;
    }

    const payload = parseKeyringPayload(rawSecret);

    return {
      alias: 'active',
      email: payload.id_token_email,
      authMethod: payload.auth_method,
      isActive: true,
      payload,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Saves current active credentials under a profile alias: `gemini:antigravity-profile:<alias>`.
   * Throws if profile already exists unless options.force is true.
   */
  async saveProfile(
    alias: string,
    options?: { force?: boolean }
  ): Promise<AntigravityProfile> {
    const cleanAlias = this.validateAlias(alias);

    const account = `${PROFILE_ACCOUNT_PREFIX}${cleanAlias}`;
    const existing = await this.keychain.findGenericPassword(
      KEYCHAIN_SERVICE,
      account
    );

    if (existing && !options?.force) {
      throw new AgySwitcherError(
        `Profile "${cleanAlias}" already exists. Use --force to overwrite.`
      );
    }

    const activeProfile = await this.getActiveProfile();
    if (!activeProfile) {
      throw new AgySwitcherError(
        'No active profile found in Keychain to save'
      );
    }

    const encoded = encodeKeyringPayload(activeProfile.payload);
    await this.keychain.addGenericPassword(
      KEYCHAIN_SERVICE,
      account,
      encoded,
      true
    );

    return {
      alias: cleanAlias,
      email: activeProfile.payload.id_token_email,
      authMethod: activeProfile.payload.auth_method,
      isActive: true,
      payload: activeProfile.payload,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Saves an explicit payload under a profile alias.
   */
  async saveProfileWithPayload(
    alias: string,
    payload: AntigravityPayload,
    options?: { force?: boolean }
  ): Promise<AntigravityProfile> {
    const cleanAlias = this.validateAlias(alias);

    const account = `${PROFILE_ACCOUNT_PREFIX}${cleanAlias}`;
    const existing = await this.keychain.findGenericPassword(
      KEYCHAIN_SERVICE,
      account
    );

    if (existing && !options?.force) {
      throw new AgySwitcherError(
        `Profile "${cleanAlias}" already exists. Use --force to overwrite.`
      );
    }

    const encoded = encodeKeyringPayload(payload);
    await this.keychain.addGenericPassword(
      KEYCHAIN_SERVICE,
      account,
      encoded,
      true
    );

    const activeProfile = await this.getActiveProfile();
    const isActive =
      activeProfile != null &&
      this.isPayloadMatching(activeProfile.payload, payload);

    return {
      alias: cleanAlias,
      email: payload.id_token_email,
      authMethod: payload.auth_method,
      isActive,
      payload,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Lists all stored profile accounts, flagging active status and expiry metadata.
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    const accounts = await this.keychain.listAccounts(
      KEYCHAIN_SERVICE,
      PROFILE_ACCOUNT_PREFIX
    );

    const activeProfile = await this.getActiveProfile();
    const summaries: ProfileSummary[] = [];

    for (const account of accounts) {
      if (!account.startsWith(PROFILE_ACCOUNT_PREFIX)) {
        continue;
      }

      const alias = account.slice(PROFILE_ACCOUNT_PREFIX.length);
      const secret = await this.keychain.findGenericPassword(
        KEYCHAIN_SERVICE,
        account
      );

      if (!secret) {
        continue;
      }

      try {
        const payload = parseKeyringPayload(secret);
        const isActive =
          activeProfile != null &&
          this.isPayloadMatching(activeProfile.payload, payload);

        summaries.push({
          alias,
          email: payload.id_token_email,
          isActive,
          expiresInSeconds: getTokenExpiresInSeconds(payload.token),
          isExpired: isTokenExpired(payload.token),
        });
      } catch {
        // If an entry is corrupted, still report summary with error status
        summaries.push({
          alias,
          isActive: false,
          isExpired: true,
        });
      }
    }

    // Sort active profile first, then alphabetically by alias
    return summaries.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.alias.localeCompare(b.alias);
    });
  }

  /**
   * Activates a saved profile by copying its credentials into primary slot `gemini:antigravity`
   * and atomically updating fallback file `~/.gemini/jetski-standalone-oauth-token`.
   */
  async useProfile(alias: string): Promise<AntigravityProfile> {
    const cleanAlias = this.validateAlias(alias);

    const account = `${PROFILE_ACCOUNT_PREFIX}${cleanAlias}`;
    const secret = await this.keychain.findGenericPassword(
      KEYCHAIN_SERVICE,
      account
    );

    if (!secret) {
      throw new ProfileNotFoundError(cleanAlias);
    }

    const payload = parseKeyringPayload(secret);

    // Atomically update primary Keychain slot
    await this.keychain.addGenericPassword(
      KEYCHAIN_SERVICE,
      PRIMARY_ACCOUNT,
      encodeKeyringPayload(payload),
      true
    );

    // Synchronize fallback file atomically with mode 0o600
    await syncFallbackFile(payload, this.fallbackPath);

    return {
      alias: cleanAlias,
      email: payload.id_token_email,
      authMethod: payload.auth_method,
      isActive: true,
      payload,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Deletes a profile from `gemini:antigravity-profile:<alias>`.
   */
  async deleteProfile(alias: string): Promise<boolean> {
    const cleanAlias = this.validateAlias(alias);
    const account = `${PROFILE_ACCOUNT_PREFIX}${cleanAlias}`;
    return this.keychain.deleteGenericPassword(KEYCHAIN_SERVICE, account);
  }

  /**
   * Fetches and normalizes quota data for a specific profile alias.
   * Proactively refreshes expired token in Keychain if needed.
   */
  async getProfileQuota(alias: string, client?: CloudCodeClient): Promise<UnifiedQuotaSummary> {
    const cleanAlias = this.validateAlias(alias);
    const account = `${PROFILE_ACCOUNT_PREFIX}${cleanAlias}`;
    const secret = await this.keychain.findGenericPassword(KEYCHAIN_SERVICE, account);

    if (!secret) {
      throw new ProfileNotFoundError(cleanAlias);
    }

    let payload = parseKeyringPayload(secret);

    // Proactively check and refresh token in Keychain if expired
    try {
      const { payload: freshPayload, refreshed } = await ensureFreshPayload(payload, 60);
      if (refreshed) {
        payload = freshPayload;
        await this.keychain.addGenericPassword(
          KEYCHAIN_SERVICE,
          account,
          encodeKeyringPayload(payload),
          true
        );
        const active = await this.getActiveProfile();
        if (active && this.isPayloadMatching(active.payload, payload)) {
          await this.keychain.addGenericPassword(
            KEYCHAIN_SERVICE,
            PRIMARY_ACCOUNT,
            encodeKeyringPayload(payload),
            true
          );
          await syncFallbackFile(payload, this.fallbackPath);
        }
      }
    } catch {
      // If token refresh fails, proceed with existing token; client will handle downstream 401
    }

    const cloudClient =
      client ??
      new CloudCodeClient({
        token: payload.token,
        onTokenRefresh: async (newToken) => {
          payload.token = newToken;
          await this.keychain.addGenericPassword(
            KEYCHAIN_SERVICE,
            account,
            encodeKeyringPayload(payload),
            true
          );
          const active = await this.getActiveProfile();
          if (active && this.isPayloadMatching(active.payload, payload)) {
            await this.keychain.addGenericPassword(
              KEYCHAIN_SERVICE,
              PRIMARY_ACCOUNT,
              encodeKeyringPayload(payload),
              true
            );
            await syncFallbackFile(payload, this.fallbackPath);
          }
        },
      });

    if (client) {
      cloudClient.setToken(payload.token);
    }

    const loadResp = await cloudClient.loadCodeAssist();
    const project = loadResp.cloudaicompanionProject;

    let summaryResp = null;
    let quotaResp = null;

    if (project && typeof project === 'string' && project.trim() !== '') {
      [summaryResp, quotaResp] = await Promise.all([
        cloudClient.retrieveUserQuotaSummary(project).catch(() => null),
        cloudClient.retrieveUserQuota(project).catch(() => null),
      ]);
    }

    return normalizeQuotaData(
      payload.id_token_email || cleanAlias,
      loadResp,
      summaryResp,
      quotaResp
    );
  }

  /**
   * Lists all stored profile accounts enriched with their quota information.
   */
  async listProfilesWithQuota(options?: {
    client?: CloudCodeClient;
  }): Promise<Array<ProfileSummary & { quota?: UnifiedQuotaSummary }>> {
    const summaries = await this.listProfiles();
    const enriched: Array<ProfileSummary & { quota?: UnifiedQuotaSummary }> = [];

    for (const s of summaries) {
      try {
        const quota = await this.getProfileQuota(s.alias, options?.client);
        enriched.push({
          ...s,
          tier: quota.tierDisplayName,
          quota,
        });
      } catch {
        enriched.push({
          ...s,
          quota: undefined,
        });
      }
    }

    return enriched;
  }

  /**
   * Evaluates all stored profiles and determines the best profile based on available quota.
   */
  async getBestProfile(
    client?: CloudCodeClient
  ): Promise<{ profile: AntigravityProfile; quota: UnifiedQuotaSummary } | null> {
    const summariesWithQuota = await this.listProfilesWithQuota({ client });
    if (summariesWithQuota.length === 0) {
      return null;
    }

    const scorableList: ProfileWithQuota[] = summariesWithQuota.map((s) => ({
      alias: s.alias,
      email: s.email,
      isActive: s.isActive,
      quota: s.quota,
    }));

    const bestCandidate = findBestProfile(scorableList);
    if (!bestCandidate || !bestCandidate.quota) {
      return null;
    }

    const account = `${PROFILE_ACCOUNT_PREFIX}${bestCandidate.alias}`;
    const secret = await this.keychain.findGenericPassword(KEYCHAIN_SERVICE, account);
    if (!secret) {
      return null;
    }

    const payload = parseKeyringPayload(secret);
    const profile: AntigravityProfile = {
      alias: bestCandidate.alias,
      email: payload.id_token_email,
      authMethod: payload.auth_method,
      isActive: bestCandidate.isActive,
      payload,
      updatedAt: new Date().toISOString(),
    };

    return {
      profile,
      quota: bestCandidate.quota,
    };
  }

  /**
   * Automatically selects and switches to the best profile with the highest composite quota score.
   */
  async useBestProfile(
    client?: CloudCodeClient
  ): Promise<{ profile: AntigravityProfile; previousAlias?: string; quota: UnifiedQuotaSummary }> {
    const activeProfile = await this.getActiveProfile();
    let previousAlias: string | undefined;

    if (activeProfile) {
      const summaries = await this.listProfiles();
      const matching = summaries.find((s) => s.isActive);
      previousAlias = matching?.alias;
    }

    const best = await this.getBestProfile(client);
    if (!best) {
      throw new AgySwitcherError('No profiles available to select');
    }

    const switchedProfile = await this.useProfile(best.profile.alias);
    return {
      profile: switchedProfile,
      previousAlias,
      quota: best.quota,
    };
  }


  /**
   * Validates alias naming rules.
   */
  private validateAlias(alias: string): string {
    if (!alias || typeof alias !== 'string' || !alias.trim()) {
      throw new AgySwitcherError('Profile alias cannot be empty');
    }
    const clean = alias.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(clean)) {
      throw new AgySwitcherError(
        `Invalid profile alias "${clean}". Only alphanumeric characters, dashes, and underscores are allowed.`
      );
    }
    return clean;
  }

  /**
   * Determines if two payloads represent the same account.
   */
  private isPayloadMatching(a: AntigravityPayload, b: AntigravityPayload): boolean {
    if (a.token.refresh_token && b.token.refresh_token && a.token.refresh_token === b.token.refresh_token) {
      return true;
    }
    if (a.token.access_token && b.token.access_token && a.token.access_token === b.token.access_token) {
      return true;
    }
    if (a.id_token_email && b.id_token_email && a.id_token_email === b.id_token_email) {
      return true;
    }
    return false;
  }
}
