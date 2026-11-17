import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  OAuthToken,
  AntigravityPayload,
  GoogleTokenRefreshResponse,
} from './types.ts';
import { TokenRefreshError } from './errors.ts';

export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface RefreshTokenOptions {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  fetchFn?: typeof fetch;
  agyBin?: string;
  oauthConfigPath?: string;
}

let cachedAutoCredentials: OAuthClientCredentials | null = null;

/**
 * Clears the in-memory OAuth client credential cache (primarily for tests).
 */
export function resetOAuthClientCache(): void {
  cachedAutoCredentials = null;
}

/**
 * Returns the external user config path (`~/.config/agy-switcher/oauth.json`), outside any repo.
 */
export function getOAuthConfigPath(): string {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configRoot, 'agy-switcher', 'oauth.json');
}

function readOAuthConfigFile(configPath: string): OAuthClientCredentials | null {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<OAuthClientCredentials>;
    if (
      typeof raw.clientId === 'string' &&
      raw.clientId.trim() &&
      typeof raw.clientSecret === 'string' &&
      raw.clientSecret.trim()
    ) {
      return { clientId: raw.clientId.trim(), clientSecret: raw.clientSecret.trim() };
    }
  } catch {
    // Ignore malformed optional config file
  }
  return null;
}

function writeOAuthConfigFile(configPath: string, creds: OAuthClientCredentials): void {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(creds, null, 2)}\n`, {
      mode: 0o600,
      encoding: 'utf8',
    });
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Best-effort cache write; ignore read-only home errors
  }
}

function findAgyBinaryPath(explicitPath?: string): string | null {
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }
  const envBin = process.env.AGY_BIN;
  if (envBin && fs.existsSync(envBin)) {
    return envBin;
  }

  const candidates: string[] = [];
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'agy'));
  }
  candidates.push(path.join(os.homedir(), '.local', 'bin', 'agy'));
  candidates.push('/usr/local/bin/agy');
  candidates.push('/opt/homebrew/bin/agy');

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue searching
    }
  }
  return null;
}

/**
 * Extracts Google installed-app OAuth client ID & secret candidates from the local `agy` binary.
 * Returns empty array if `agy` is unavailable or contains no matching credentials.
 */
export function extractOAuthCandidatesFromBinary(binaryPath: string): OAuthClientCredentials[] {
  let content: string;
  try {
    content = fs.readFileSync(binaryPath, 'latin1');
  } catch {
    return [];
  }

  const clientIds = Array.from(
    new Set(content.match(/\d{10,15}-[a-z0-9]{20,40}\.apps\.googleusercontent\.com/g) ?? [])
  );
  const clientSecrets = Array.from(
    new Set(content.match(/GOCSPX-[A-Za-z0-9_-]{28}/g) ?? [])
  );

  if (clientIds.length === 0 || clientSecrets.length === 0) {
    return [];
  }

  const pairs: OAuthClientCredentials[] = [];
  const seen = new Set<string>();
  const addPair = (clientId: string, clientSecret: string) => {
    const key = `${clientId}:${clientSecret}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ clientId, clientSecret });
    }
  };

  // Prioritize CloudCode's installed-app client ID (1071006060591-...) paired with matching index first.
  const primaryIdx = clientIds.findIndex((id) => id.startsWith('1071006060591-'));
  if (primaryIdx !== -1 && clientSecrets[primaryIdx]) {
    addPair(clientIds[primaryIdx], clientSecrets[primaryIdx]);
  }

  const minLen = Math.min(clientIds.length, clientSecrets.length);
  for (let i = 0; i < minLen; i++) {
    addPair(clientIds[i], clientSecrets[i]);
  }
  for (const clientId of clientIds) {
    for (const clientSecret of clientSecrets) {
      addPair(clientId, clientSecret);
    }
  }

  return pairs;
}

/**
 * Resolves OAuth client credentials without hardcoding any secret in the repository:
 * 1. Explicit options
 * 2. Environment variables (`AGY_OAUTH_CLIENT_ID`, `AGY_OAUTH_CLIENT_SECRET`)
 * 3. External config (`~/.config/agy-switcher/oauth.json`)
 * 4. Auto-discovery from the locally installed `agy` CLI binary
 */
export function resolveOAuthClientCandidates(
  options: RefreshTokenOptions = {}
): { candidates: OAuthClientCredentials[]; fromAutoDiscovery: boolean; configPath: string } {
  const configPath = options.oauthConfigPath ?? getOAuthConfigPath();

  if (options.clientId && options.clientSecret) {
    return {
      candidates: [{ clientId: options.clientId, clientSecret: options.clientSecret }],
      fromAutoDiscovery: false,
      configPath,
    };
  }

  const envId = process.env.AGY_OAUTH_CLIENT_ID;
  const envSecret = process.env.AGY_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) {
    return {
      candidates: [{ clientId: envId, clientSecret: envSecret }],
      fromAutoDiscovery: false,
      configPath,
    };
  }

  if (cachedAutoCredentials) {
    return { candidates: [cachedAutoCredentials], fromAutoDiscovery: false, configPath };
  }

  const stored = readOAuthConfigFile(configPath);
  if (stored) {
    cachedAutoCredentials = stored;
    return { candidates: [stored], fromAutoDiscovery: false, configPath };
  }

  const agyPath = findAgyBinaryPath(options.agyBin);
  if (agyPath) {
    const candidates = extractOAuthCandidatesFromBinary(agyPath);
    if (candidates.length > 0) {
      return { candidates, fromAutoDiscovery: true, configPath };
    }
  }

  return { candidates: [], fromAutoDiscovery: false, configPath };
}

/**
 * Checks whether an OAuth token is expired or within bufferSeconds of expiring.
 * Defaults to 300 seconds (5 minutes buffer).
 */
export function isTokenExpired(token: OAuthToken, bufferSeconds = 300): boolean {
  if (!token) {
    return true;
  }

  if (token.expiry) {
    const expiryMs = Date.parse(token.expiry);
    if (!Number.isNaN(expiryMs)) {
      const thresholdMs = Date.now() + bufferSeconds * 1000;
      return expiryMs <= thresholdMs;
    }
  }

  return true;
}

/**
 * Calculates remaining seconds until token expiry. Returns 0 if expired.
 */
export function getTokenExpiresInSeconds(token: OAuthToken): number {
  if (!token?.expiry) {
    return 0;
  }
  const expiryMs = Date.parse(token.expiry);
  if (Number.isNaN(expiryMs)) {
    return 0;
  }
  const diffSec = Math.floor((expiryMs - Date.now()) / 1000);
  return Math.max(0, diffSec);
}

/**
 * Performs in-memory token refresh using Google's OAuth2 token endpoint.
 * Preserves existing refresh_token if Google does not return a new one.
 */
export async function refreshOAuthToken(
  token: OAuthToken,
  optionsOrFetch?: RefreshTokenOptions | typeof fetch
): Promise<OAuthToken> {
  if (!token?.refresh_token) {
    throw new TokenRefreshError('Missing refresh_token in token payload');
  }

  let options: RefreshTokenOptions = {};
  if (typeof optionsOrFetch === 'function') {
    options = { fetchFn: optionsOrFetch };
  } else if (optionsOrFetch && typeof optionsOrFetch === 'object') {
    options = optionsOrFetch;
  }

  const { candidates, fromAutoDiscovery, configPath } = resolveOAuthClientCandidates(options);
  if (candidates.length === 0) {
    throw new TokenRefreshError(
      'OAuth client credentials not found. Ensure `agy` CLI is installed, or set AGY_OAUTH_CLIENT_ID and AGY_OAUTH_CLIENT_SECRET.'
    );
  }

  const tokenUrl = options.tokenUrl || process.env.AGY_TOKEN_URL || GOOGLE_OAUTH_TOKEN_URL;
  const fetchFn = options.fetchFn || globalThis.fetch;

  let lastError: TokenRefreshError | null = null;

  for (const creds of candidates) {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    });

    let response: Response;
    try {
      response = await fetchFn(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
    } catch (error) {
      throw new TokenRefreshError(
        `Network error during token refresh: ${(error as Error).message}`,
        undefined,
        error
      );
    }

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        try {
          errorData = await response.text();
        } catch {
          errorData = null;
        }
      }

      let errorCode = '';
      let errorMessage = `HTTP ${response.status}`;
      if (errorData && typeof errorData === 'object') {
        const errObj = errorData as Record<string, unknown>;
        errorCode = typeof errObj.error === 'string' ? errObj.error : '';
        errorMessage = (errObj.error_description as string) || errorCode || errorMessage;
      } else if (typeof errorData === 'string' && errorData.trim()) {
        errorMessage = errorData.trim();
      }

      lastError = new TokenRefreshError(
        `Failed to refresh OAuth2 token: ${errorMessage}`,
        response.status,
        errorData
      );

      // Only continue probing candidates when Google rejects the OAuth client identity itself.
      if (
        fromAutoDiscovery &&
        (errorCode === 'invalid_client' || errorCode === 'unauthorized_client')
      ) {
        continue;
      }

      throw lastError;
    }

    const data = (await response.json()) as GoogleTokenRefreshResponse;
    if (fromAutoDiscovery) {
      cachedAutoCredentials = creds;
      writeOAuthConfigFile(configPath, creds);
    }

    const now = Date.now();
    const expiryDate = new Date(now + data.expires_in * 1000).toISOString();

    return {
      access_token: data.access_token,
      token_type: data.token_type || token.token_type || 'Bearer',
      refresh_token: data.refresh_token || token.refresh_token,
      expiry: expiryDate,
      expires_in: data.expires_in,
    };
  }

  throw lastError ?? new TokenRefreshError('Failed to refresh OAuth2 token');
}

/**
 * Checks payload token freshness; performs in-memory refresh only if expired or expiring soon.
 */
export async function ensureFreshPayload(
  payload: AntigravityPayload,
  bufferSeconds = 300,
  optionsOrFetch?: RefreshTokenOptions | typeof fetch
): Promise<{ payload: AntigravityPayload; refreshed: boolean }> {
  if (!isTokenExpired(payload.token, bufferSeconds)) {
    return { payload, refreshed: false };
  }

  const refreshedToken = await refreshOAuthToken(payload.token, optionsOrFetch);
  const updatedPayload: AntigravityPayload = {
    ...payload,
    token: refreshedToken,
  };

  return { payload: updatedPayload, refreshed: true };
}

/**
 * Refreshes an access token using a refresh token string or OAuthToken object.
 */
export async function refreshAccessToken(
  tokenOrRefreshToken: string | OAuthToken,
  optionsOrFetch?: RefreshTokenOptions | typeof fetch
): Promise<OAuthToken> {
  const token: OAuthToken =
    typeof tokenOrRefreshToken === 'string'
      ? { access_token: '', refresh_token: tokenOrRefreshToken, token_type: 'Bearer' }
      : tokenOrRefreshToken;
  return refreshOAuthToken(token, optionsOrFetch);
}
