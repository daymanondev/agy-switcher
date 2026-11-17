import type {
  OAuthToken,
  LoadCodeAssistResponse,
  RetrieveUserQuotaSummaryResponse,
  RetrieveUserQuotaResponse,
  QuotaFetchResult,
  QuotaBucketInfo,
  ModelQuotaInfo,
} from './types.ts';
import {
  AuthTokenExpiredError,
  SubscriptionRequiredError,
  RateLimitExceededError,
  ServiceUnavailableError,
  NetworkOfflineError,
  CloudCodeApiError,
} from './errors.ts';
import {
  isTokenExpired,
  refreshOAuthToken,
  GOOGLE_OAUTH_TOKEN_URL,
} from './token.ts';

export const DEFAULT_CLOUDCODE_BASE_URL = 'https://daily-cloudcode-pa.googleapis.com';

export interface CloudCodeClientOptions {
  baseUrl?: string;
  tokenUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  token?: OAuthToken;
  onTokenRefresh?: (newToken: OAuthToken) => Promise<void> | void;
}

export class CloudCodeClient {
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private token?: OAuthToken;
  private readonly onTokenRefresh?: (newToken: OAuthToken) => Promise<void> | void;

  constructor(options?: CloudCodeClientOptions) {
    this.baseUrl =
      options?.baseUrl ??
      process.env.AGY_API_BASE_URL ??
      DEFAULT_CLOUDCODE_BASE_URL;
    this.tokenUrl =
      options?.tokenUrl ??
      process.env.AGY_TOKEN_URL ??
      GOOGLE_OAUTH_TOKEN_URL;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options?.timeoutMs ?? 10_000;
    this.token = options?.token;
    this.onTokenRefresh = options?.onTokenRefresh;
  }

  public setToken(token: OAuthToken): void {
    this.token = token;
  }

  public getToken(): OAuthToken | undefined {
    return this.token;
  }

  /**
   * Proactively verifies and refreshes token if expired or near expiry.
   */
  public async ensureFreshToken(): Promise<string> {
    if (!this.token?.access_token) {
      throw new AuthTokenExpiredError('No access token available');
    }

    if (isTokenExpired(this.token, 60)) {
      if (this.token.refresh_token) {
        const refreshed = await refreshOAuthToken(this.token, {
          tokenUrl: this.tokenUrl,
          fetchFn: this.fetchFn,
        });
        this.token = refreshed;
        if (this.onTokenRefresh) {
          await this.onTokenRefresh(refreshed);
        }
      }
    }

    return this.token.access_token;
  }

  /**
   * Internal request dispatcher with 401 single retry, error mapping, and timeout.
   */
  private async request<T>(endpoint: string, body: unknown, isRetry = false): Promise<T> {
    const accessToken = await this.ensureFreshToken();
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        throw new NetworkOfflineError(`Request timed out after ${this.timeoutMs}ms for ${endpoint}`, err);
      }
      throw new NetworkOfflineError(`Network request failed for ${endpoint}: ${err.message}`, err);
    } finally {
      clearTimeout(timer);
    }

    // 401 Unauthorized handling with single refresh retry
    if (response.status === 401) {
      if (!isRetry && this.token?.refresh_token) {
        try {
          const refreshed = await refreshOAuthToken(this.token, {
            tokenUrl: this.tokenUrl,
            fetchFn: this.fetchFn,
          });
          this.token = refreshed;
          if (this.onTokenRefresh) {
            await this.onTokenRefresh(refreshed);
          }
          return await this.request<T>(endpoint, body, true);
        } catch {
          throw new AuthTokenExpiredError('Failed to refresh token after 401 Unauthorized');
        }
      }
      throw new AuthTokenExpiredError('401 Unauthorized from Cloud Code Assist API');
    }

    // Handle non-200 responses
    if (!response.ok) {
      let errorData: any = null;
      let rawText = '';
      try {
        rawText = await response.text();
        errorData = JSON.parse(rawText);
      } catch {
        errorData = { rawText };
      }

      if (response.status === 403) {
        const reason = errorData?.error?.details?.[0]?.reason || 'SUBSCRIPTION_REQUIRED';
        const msg = errorData?.error?.message || 'Subscription required or access denied';
        throw new SubscriptionRequiredError(msg, (body as any)?.project, reason);
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        throw new RateLimitExceededError('Rate limit exceeded (RESOURCE_EXHAUSTED)', retryAfter);
      }

      if (response.status >= 500) {
        throw new ServiceUnavailableError(`Cloud Code service error (HTTP ${response.status})`, response.status);
      }

      throw new CloudCodeApiError(
        errorData?.error?.message || `Cloud Code API failed with HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Calls POST /v1internal:loadCodeAssist
   */
  public async loadCodeAssist(): Promise<LoadCodeAssistResponse> {
    return this.request<LoadCodeAssistResponse>('/v1internal:loadCodeAssist', {
      metadata: {
        ideType: 'ANTIGRAVITY',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
      },
    });
  }

  /**
   * Calls POST /v1internal:retrieveUserQuotaSummary
   */
  public async retrieveUserQuotaSummary(project: string): Promise<RetrieveUserQuotaSummaryResponse> {
    return this.request<RetrieveUserQuotaSummaryResponse>('/v1internal:retrieveUserQuotaSummary', {
      project,
    });
  }

  /**
   * Calls POST /v1internal:retrieveUserQuota
   */
  public async retrieveUserQuota(project: string): Promise<RetrieveUserQuotaResponse> {
    return this.request<RetrieveUserQuotaResponse>('/v1internal:retrieveUserQuota', {
      project,
    });
  }

  /**
   * Full quota orchestration: Step 1 loadCodeAssist -> graceful check -> Step 2 concurrent queries.
   */
  public async fetchAccountQuota(): Promise<QuotaFetchResult> {
    const loadResp = await this.loadCodeAssist();

    const tierInfo = {
      id: loadResp.currentTier?.id || loadResp.paidTier?.id || 'standard-tier',
      name: loadResp.currentTier?.name || loadResp.paidTier?.name || 'Standard Tier',
    };

    const project = loadResp.cloudaicompanionProject;
    if (!project || typeof project !== 'string' || project.trim() === '') {
      return {
        tier: tierInfo,
        project: undefined,
        claude5h: undefined,
        claudeWeekly: undefined,
        gemini: [],
        ineligible: true,
        ineligibleReason:
          loadResp.ineligibleTiers?.[0]?.reasonMessage ||
          'No Cloud AI Companion project provisioned for this account',
      };
    }

    const [summaryResp, quotaResp] = await Promise.all([
      this.retrieveUserQuotaSummary(project),
      this.retrieveUserQuota(project),
    ]);

    // Parse 5h and weekly buckets from summaryResp
    let claude5h: QuotaBucketInfo | undefined;
    let claudeWeekly: QuotaBucketInfo | undefined;

    const summaryBuckets = [
      ...(summaryResp.groups?.flatMap((g) => g.buckets || []) || []),
      ...(summaryResp.buckets || []),
    ];

    for (const bucket of summaryBuckets) {
      if (bucket.window === '5h' || bucket.bucketId === '3p-5h') {
        claude5h = {
          remainingFraction: bucket.remainingFraction ?? 0,
          resetTime: bucket.resetTime ?? null,
        };
      }
      if (bucket.window === 'weekly' || bucket.bucketId === '3p-weekly') {
        claudeWeekly = {
          remainingFraction: bucket.remainingFraction ?? 0,
          resetTime: bucket.resetTime ?? null,
        };
      }
    }

    // Parse Gemini model buckets from quotaResp
    const gemini: ModelQuotaInfo[] = (quotaResp.buckets || []).map((b) => ({
      modelId: b.modelId,
      remainingFraction: b.remainingFraction ?? 0,
      resetTime: b.resetTime ?? null,
    }));

    return {
      tier: tierInfo,
      project,
      claude5h,
      claudeWeekly,
      gemini,
    };
  }
}

/**
 * Standalone convenience function for fetching quota from token or client options.
 */
export async function fetchAccountQuota(
  tokenOrAccessToken: string | OAuthToken,
  refreshTokenOrOptions?: string | CloudCodeClientOptions
): Promise<QuotaFetchResult> {
  let token: OAuthToken;
  let options: CloudCodeClientOptions = {};

  if (typeof tokenOrAccessToken === 'string') {
    const refreshToken = typeof refreshTokenOrOptions === 'string' ? refreshTokenOrOptions : '';
    token = {
      access_token: tokenOrAccessToken,
      token_type: 'Bearer',
      refresh_token: refreshToken,
    };
    if (typeof refreshTokenOrOptions === 'object' && refreshTokenOrOptions !== null) {
      options = refreshTokenOrOptions;
    }
  } else {
    token = tokenOrAccessToken;
    if (typeof refreshTokenOrOptions === 'object' && refreshTokenOrOptions !== null) {
      options = refreshTokenOrOptions;
    }
  }

  const client = new CloudCodeClient({
    ...options,
    token,
  });

  return client.fetchAccountQuota();
}
