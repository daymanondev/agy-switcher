import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';
import {
  isTokenExpired,
  refreshOAuthToken,
  ensureFreshPayload,
} from '../../../src/core/token.ts';
import { TokenRefreshError } from '../../../src/core/errors.ts';
import type { OAuthToken, AntigravityPayload } from '../../../src/core/types.ts';

describe('Tier 1: In-Memory OAuth2 Token Refresh', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. valid token with future expiry does not trigger refresh', async () => {
    const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
    const payload: AntigravityPayload = {
      token: {
        access_token: 'ya29.current-valid-token',
        token_type: 'Bearer',
        refresh_token: '1//valid-refresh',
        expiry: futureExpiry,
        expires_in: 3600,
      },
      auth_method: 'consumer',
      id_token_email: 'user@example.com',
    };

    assert.equal(isTokenExpired(payload.token), false);

    const result = await ensureFreshPayload(payload, 300, {
      tokenUrl: `${ctx.server.getBaseUrl()}/token`,
    });
    assert.equal(result.refreshed, false);
    assert.equal(result.payload.token.access_token, 'ya29.current-valid-token');
    // Verify no requests were made to server
    assert.equal(ctx.server.requests.length, 0);
  });

  it('2. expired token triggers refresh via mock server endpoint', async () => {
    const pastExpiry = new Date(Date.now() - 3600 * 1000).toISOString();
    const token: OAuthToken = {
      access_token: 'ya29.expired-token',
      token_type: 'Bearer',
      refresh_token: '1//my-refresh-token',
      expiry: pastExpiry,
      expires_in: 0,
    };

    assert.equal(isTokenExpired(token), true);

    const refreshed = await refreshOAuthToken(token, {
      tokenUrl: `${ctx.server.getBaseUrl()}/token`,
    });

    assert.equal(refreshed.access_token, 'ya29.refreshed-access-token');
    assert.ok(Date.parse(refreshed.expiry!) > Date.now());
    assert.equal(ctx.server.requests.length, 1);
    assert.equal(ctx.server.requests[0].body.grant_type, 'refresh_token');
    assert.equal(ctx.server.requests[0].body.refresh_token, '1//my-refresh-token');
  });

  it('3. updates access_token and recalculates expiry timestamp', async () => {
    ctx.server.setTokenRefreshResponse({
      access_token: 'ya29.custom-brand-new-token',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    const token: OAuthToken = {
      access_token: 'old',
      token_type: 'Bearer',
      refresh_token: 'refresh',
      expiry: new Date(Date.now() - 1000).toISOString(),
    };

    const refreshed = await refreshOAuthToken(token, {
      tokenUrl: `${ctx.server.getBaseUrl()}/token`,
    });

    assert.equal(refreshed.access_token, 'ya29.custom-brand-new-token');
    assert.equal(refreshed.expires_in, 7200);
    const approxExpectedExpiry = Date.now() + 7200 * 1000;
    const actualExpiryMs = Date.parse(refreshed.expiry!);
    assert.ok(Math.abs(actualExpiryMs - approxExpectedExpiry) < 5000);
  });

  it('4. retains existing refresh_token when upstream does not rotate it', async () => {
    ctx.server.setTokenRefreshResponse({
      access_token: 'ya29.refreshed-no-rotate',
      expires_in: 3600,
      token_type: 'Bearer',
      // No refresh_token returned by Google
    });

    const token: OAuthToken = {
      access_token: 'old',
      token_type: 'Bearer',
      refresh_token: '1//original-must-persist',
      expiry: new Date(Date.now() - 1000).toISOString(),
    };

    const refreshed = await refreshOAuthToken(token, {
      tokenUrl: `${ctx.server.getBaseUrl()}/token`,
    });

    assert.equal(refreshed.refresh_token, '1//original-must-persist');
  });

  it('5. throws TokenRefreshError on invalid refresh token / HTTP 400', async () => {
    ctx.server.setError('token', 400, {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    });

    const token: OAuthToken = {
      access_token: 'old',
      token_type: 'Bearer',
      refresh_token: '1//revoked-refresh-token',
      expiry: new Date(Date.now() - 1000).toISOString(),
    };

    await assert.rejects(
      () =>
        refreshOAuthToken(token, {
          tokenUrl: `${ctx.server.getBaseUrl()}/token`,
        }),
      (err: unknown) => {
        assert.ok(err instanceof TokenRefreshError);
        assert.equal((err as TokenRefreshError).httpStatus, 400);
        assert.match((err as TokenRefreshError).message, /Token has been expired or revoked/);
        return true;
      }
    );
  });
});
