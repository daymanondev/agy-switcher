import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isTokenExpired,
  getTokenExpiresInSeconds,
  refreshOAuthToken,
  ensureFreshPayload,
  extractOAuthCandidatesFromBinary,
  resetOAuthClientCache,
  GOOGLE_OAUTH_TOKEN_URL,
} from '../../src/core/token.ts';
import { TokenRefreshError } from '../../src/core/errors.ts';
import type { OAuthToken, AntigravityPayload } from '../../src/core/types.ts';

describe('In-Memory Token Refresher', () => {
  const prevId = process.env.AGY_OAUTH_CLIENT_ID;
  const prevSecret = process.env.AGY_OAUTH_CLIENT_SECRET;

  beforeEach(() => {
    resetOAuthClientCache();
    process.env.AGY_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.AGY_OAUTH_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    resetOAuthClientCache();
    if (prevId !== undefined) process.env.AGY_OAUTH_CLIENT_ID = prevId;
    else delete process.env.AGY_OAUTH_CLIENT_ID;
    if (prevSecret !== undefined) process.env.AGY_OAUTH_CLIENT_SECRET = prevSecret;
    else delete process.env.AGY_OAUTH_CLIENT_SECRET;
  });

  describe('isTokenExpired and getTokenExpiresInSeconds', () => {
    it('detects already expired tokens', () => {
      const expiredToken: OAuthToken = {
        access_token: 'old-access',
        token_type: 'Bearer',
        refresh_token: 'refresh-1',
        expiry: new Date(Date.now() - 60_000).toISOString(),
      };

      assert.equal(isTokenExpired(expiredToken), true);
      assert.equal(getTokenExpiresInSeconds(expiredToken), 0);
    });

    it('detects tokens within buffer window as expired', () => {
      const nearExpiryToken: OAuthToken = {
        access_token: 'near-expiry',
        token_type: 'Bearer',
        refresh_token: 'refresh-1',
        expiry: new Date(Date.now() + 120_000).toISOString(),
      };

      assert.equal(isTokenExpired(nearExpiryToken, 300), true);
      assert.ok(getTokenExpiresInSeconds(nearExpiryToken) > 100);
      assert.ok(getTokenExpiresInSeconds(nearExpiryToken) <= 120);
    });

    it('considers tokens beyond buffer window as fresh', () => {
      const freshToken: OAuthToken = {
        access_token: 'fresh',
        token_type: 'Bearer',
        refresh_token: 'refresh-1',
        expiry: new Date(Date.now() + 1_800_000).toISOString(),
      };

      assert.equal(isTokenExpired(freshToken, 300), false);
      assert.ok(getTokenExpiresInSeconds(freshToken) > 1700);
    });

    it('treats tokens with missing or invalid expiry as expired', () => {
      const noExpiry: OAuthToken = {
        access_token: 'no-expiry',
        token_type: 'Bearer',
        refresh_token: 'refresh-1',
      };
      assert.equal(isTokenExpired(noExpiry), true);
      assert.equal(getTokenExpiresInSeconds(noExpiry), 0);

      const invalidExpiry: OAuthToken = {
        access_token: 'invalid',
        token_type: 'Bearer',
        refresh_token: 'refresh-1',
        expiry: 'not-a-date',
      };
      assert.equal(isTokenExpired(invalidExpiry), true);
      assert.equal(getTokenExpiresInSeconds(invalidExpiry), 0);
    });
  });

  describe('refreshOAuthToken', () => {
    const baseToken: OAuthToken = {
      access_token: 'old-access',
      token_type: 'Bearer',
      refresh_token: 'original-refresh-token',
      expiry: new Date(Date.now() - 1000).toISOString(),
    };

    it('refreshes token and preserves existing refresh_token when not rotated', async () => {
      let requestedUrl = '';
      let requestedBody = '';

      const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        requestedUrl = String(input);
        requestedBody = String(init?.body);
        return new Response(
          JSON.stringify({
            access_token: 'new-access-token-123',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const refreshed = await refreshOAuthToken(baseToken, mockFetch);

      assert.equal(requestedUrl, GOOGLE_OAUTH_TOKEN_URL);
      const params = new URLSearchParams(requestedBody);
      assert.equal(params.get('client_id'), 'test-client-id');
      assert.equal(params.get('client_secret'), 'test-client-secret');
      assert.equal(params.get('grant_type'), 'refresh_token');
      assert.equal(params.get('refresh_token'), 'original-refresh-token');

      assert.equal(refreshed.access_token, 'new-access-token-123');
      assert.equal(refreshed.token_type, 'Bearer');
      assert.equal(refreshed.refresh_token, 'original-refresh-token');
      assert.equal(refreshed.expires_in, 3600);
      assert.ok(refreshed.expiry);
    });

    it('updates refresh_token if Google rotates it', async () => {
      const mockFetch = async (): Promise<Response> => {
        return new Response(
          JSON.stringify({
            access_token: 'new-access',
            expires_in: 3600,
            token_type: 'Bearer',
            refresh_token: 'rotated-refresh-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const refreshed = await refreshOAuthToken(baseToken, mockFetch);
      assert.equal(refreshed.refresh_token, 'rotated-refresh-token');
    });

    it('auto-discovers OAuth client credentials from a mock agy binary and caches to external config', async () => {
      delete process.env.AGY_OAUTH_CLIENT_ID;
      delete process.env.AGY_OAUTH_CLIENT_SECRET;

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-oauth-discovery-'));
      try {
        const fakeBinary = path.join(tmpDir, 'agy');
        const externalConfig = path.join(tmpDir, 'oauth.json');
        const syntheticId = '1071006060591-syntheticclientid1234567890.apps.googleusercontent.com';
        const syntheticSecret = ['GOCSPX', '-', 'SyntheticTestSecret123456789'].join('');
        await fs.writeFile(fakeBinary, `padding\0${syntheticId}\0moretext${syntheticSecret}trailing`, 'latin1');

        const extracted = extractOAuthCandidatesFromBinary(fakeBinary);
        assert.equal(extracted.length, 1);
        assert.equal(extracted[0].clientId, syntheticId);
        assert.equal(extracted[0].clientSecret, syntheticSecret);

        let seenClientId = '';
        const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const p = new URLSearchParams(String(init?.body));
          seenClientId = p.get('client_id') ?? '';
          return new Response(
            JSON.stringify({ access_token: 'ok-token', expires_in: 3600, token_type: 'Bearer' }),
            { status: 200 }
          );
        };

        const refreshed = await refreshOAuthToken(baseToken, {
          fetchFn: mockFetch,
          agyBin: fakeBinary,
          oauthConfigPath: externalConfig,
        });
        assert.equal(seenClientId, syntheticId);
        assert.equal(refreshed.access_token, 'ok-token');

        const cachedJson = JSON.parse(await fs.readFile(externalConfig, 'utf8'));
        assert.equal(cachedJson.clientId, syntheticId);
        assert.equal(cachedJson.clientSecret, syntheticSecret);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('throws TokenRefreshError on non-200 Google response', async () => {
      const mockFetch = async (): Promise<Response> => {
        return new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        () => refreshOAuthToken(baseToken, mockFetch),
        (err: unknown) => {
          assert.ok(err instanceof TokenRefreshError);
          assert.equal((err as TokenRefreshError).httpStatus, 400);
          assert.match((err as TokenRefreshError).message, /Token has been expired or revoked/);
          return true;
        }
      );
    });

    it('throws TokenRefreshError on network error', async () => {
      const mockFetch = async (): Promise<Response> => {
        throw new Error('Connection refused');
      };

      await assert.rejects(
        () => refreshOAuthToken(baseToken, mockFetch),
        (err: unknown) => {
          assert.ok(err instanceof TokenRefreshError);
          assert.match((err as TokenRefreshError).message, /Connection refused/);
          return true;
        }
      );
    });

    it('throws TokenRefreshError if token lacks refresh_token', async () => {
      const noRefresh = { access_token: 'abc', token_type: 'Bearer' } as OAuthToken;
      await assert.rejects(() => refreshOAuthToken(noRefresh), TokenRefreshError);
    });
  });

  describe('ensureFreshPayload', () => {
    it('returns existing payload without fetching if token is fresh', async () => {
      let fetchCalled = false;
      const mockFetch = async (): Promise<Response> => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      };

      const freshPayload: AntigravityPayload = {
        token: {
          access_token: 'fresh-access',
          token_type: 'Bearer',
          refresh_token: 'refresh-abc',
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        },
        id_token_email: 'user@example.com',
      };

      const result = await ensureFreshPayload(freshPayload, 300, mockFetch);
      assert.equal(result.refreshed, false);
      assert.equal(fetchCalled, false);
      assert.equal(result.payload.token.access_token, 'fresh-access');
    });

    it('refreshes token if expired and returns updated payload', async () => {
      const mockFetch = async (): Promise<Response> => {
        return new Response(
          JSON.stringify({
            access_token: 'refreshed-access',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 }
        );
      };

      const expiredPayload: AntigravityPayload = {
        token: {
          access_token: 'old-access',
          token_type: 'Bearer',
          refresh_token: 'refresh-abc',
          expiry: new Date(Date.now() - 1000).toISOString(),
        },
        id_token_email: 'user@example.com',
      };

      const result = await ensureFreshPayload(expiredPayload, 300, mockFetch);
      assert.equal(result.refreshed, true);
      assert.equal(result.payload.token.access_token, 'refreshed-access');
      assert.equal(result.payload.id_token_email, 'user@example.com');
    });
  });
});
