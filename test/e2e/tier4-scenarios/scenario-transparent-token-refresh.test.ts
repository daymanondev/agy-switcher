import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';
import { isTokenExpired, refreshOAuthToken, ensureFreshPayload } from '../../../src/core/token.ts';

describe('Tier 4 Scenario 3: Transparent Expired Token Renewal Workflow', () => {
  let ctx: TestContext;
  const expiredPayload = {
    token: {
      access_token: 'ya29.stale-token-from-hours-ago',
      refresh_token: '1//refresh-me-transparently',
      token_type: 'Bearer',
      expiry: new Date(Date.now() - 7200 * 1000).toISOString(), // Expired 2h ago
      expires_in: 0,
    },
    auth_method: 'consumer',
    id_token_email: 'coder@gmail.com',
  };

  beforeEach(async () => {
    ctx = await createTestContext();
    const raw = `go-keyring-base64:${Buffer.from(JSON.stringify(expiredPayload)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:dev', raw);
    ctx.keychain.setItem('gemini', 'antigravity', raw);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('Step 1: verify profile in Keychain has an expired access_token', () => {
    assert.equal(isTokenExpired(expiredPayload.token), true);
  });

  it('Step 2: in-memory refresher detects expiration and triggers transparent refresh', async () => {
    const result = await ensureFreshPayload(expiredPayload, 300, {
      tokenUrl: `${ctx.server.getBaseUrl()}/token`,
    });

    assert.equal(result.refreshed, true);
    assert.equal(result.payload.token.access_token, 'ya29.refreshed-access-token');
    assert.equal(isTokenExpired(result.payload.token), false);
  });

  it('Step 3: verify upstream Google OAuth2 endpoint was called with correct grant_type and credentials', async () => {
    ctx.server.requests.length = 0;
    await refreshOAuthToken(expiredPayload.token, {
      tokenUrl: `${ctx.server.getBaseUrl()}/token`,
    });

    assert.equal(ctx.server.requests.length, 1);
    const req = ctx.server.requests[0];
    assert.equal(req.url, '/token');
    assert.equal(req.body.grant_type, 'refresh_token');
    assert.equal(req.body.refresh_token, '1//refresh-me-transparently');
  });

  it('Step 4: execute quota queries using renewed access token', async () => {
    const fresh = await refreshOAuthToken(expiredPayload.token, {
      tokenUrl: `${ctx.server.getBaseUrl()}/token`,
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fresh.access_token}`,
      },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.cloudaicompanionProject);
  });

  it('Step 5: verify CLI ls operates cleanly without prompting user to re-authenticate', async () => {
    const lsRes = await ctx.cli.run(['ls']);
    assert.equal(lsRes.exitCode, 0);
    assert.match(lsRes.stdout, /dev/);
    assert.match(lsRes.stdout, /coder@gmail.com/);
  });
});
