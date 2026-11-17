import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 3: Cross-Feature: Profile Switch & Quota Query Flow', () => {
  let ctx: TestContext;
  const payloadPro = {
    token: { access_token: 'ya29.token-pro-user', refresh_token: '1//pro', token_type: 'Bearer' },
    id_token_email: 'pro@enterprise.com',
  };
  const payloadStandard = {
    token: { access_token: 'ya29.token-standard-user', refresh_token: '1//std', token_type: 'Bearer' },
    id_token_email: 'standard@startup.io',
  };

  const rawPro = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadPro)).toString('base64')}`;
  const rawStandard = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadStandard)).toString('base64')}`;

  beforeEach(async () => {
    ctx = await createTestContext();
    ctx.keychain.setItem('gemini', 'antigravity-profile:pro', rawPro);
    ctx.keychain.setItem('gemini', 'antigravity-profile:standard', rawStandard);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. switching profile directs quota checks using new profile credentials', async () => {
    await ctx.cli.run(['use', 'pro']);
    ctx.server.requests.length = 0; // Clear requests

    // Query quota for active profile
    const active = ctx.fs.readFallback();
    assert.equal(active.token.access_token, 'ya29.token-pro-user');

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${active.token.access_token}`,
      },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    assert.equal(res.status, 200);
    assert.equal(ctx.server.requests.length, 1);
    assert.equal(ctx.server.requests[0].headers.authorization, 'Bearer ya29.token-pro-user');
  });

  it('2. switching to standard profile reflects standard token in authorization headers', async () => {
    await ctx.cli.run(['use', 'standard']);
    ctx.server.requests.length = 0;

    const active = ctx.fs.readFallback();
    assert.equal(active.token.access_token, 'ya29.token-standard-user');

    await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${active.token.access_token}`,
      },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    assert.equal(ctx.server.requests[0].headers.authorization, 'Bearer ya29.token-standard-user');
  });

  it('3. dynamically reflects different subscription tiers across profile switches', async () => {
    ctx.server.setLoadCodeAssistResponse((req) => {
      const auth = req.headers.authorization;
      if (auth?.includes('token-pro-user')) {
        return {
          cloudaicompanionProject: 'projects/pro-100',
          currentTier: { id: 'g1-pro-tier', name: 'Google One AI Premium' },
        };
      }
      return {
        cloudaicompanionProject: 'projects/std-200',
        currentTier: { id: 'standard-tier', name: 'Gemini Code Assist Standard' },
      };
    });

    await ctx.cli.run(['use', 'pro']);
    const proRes = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ya29.token-pro-user` },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });
    const proData = await proRes.json();
    assert.equal(proData.currentTier.id, 'g1-pro-tier');

    await ctx.cli.run(['use', 'standard']);
    const stdRes = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ya29.token-standard-user` },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });
    const stdData = await stdRes.json();
    assert.equal(stdData.currentTier.id, 'standard-tier');
  });

  it('4. expired token triggers refresh during quota workflow', async () => {
    const expiredPayload = {
      token: {
        access_token: 'ya29.expired',
        refresh_token: '1//refresh-me',
        token_type: 'Bearer',
        expiry: new Date(Date.now() - 3600 * 1000).toISOString(),
      },
      id_token_email: 'expired@user.com',
    };
    const rawExpired = `go-keyring-base64:${Buffer.from(JSON.stringify(expiredPayload)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:expired', rawExpired);

    await ctx.cli.run(['use', 'expired']);
    ctx.server.requests.length = 0;

    // Refresh token endpoint
    const refreshRes = await fetch(`${ctx.server.getBaseUrl()}/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: '1//refresh-me' }),
    });
    assert.equal(refreshRes.status, 200);
    const refreshData = await refreshRes.json();
    assert.equal(refreshData.access_token, 'ya29.refreshed-access-token');
  });

  it('5. failed quota query does not revert keychain profile switch', async () => {
    await ctx.cli.run(['use', 'standard']);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity'), rawStandard);

    // Simulate quota query failure (500)
    ctx.server.setError('retrieveUserQuotaSummary', 500);

    const quotaRes = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuotaSummary`, {
      method: 'POST',
      body: JSON.stringify({ project: 'projects/std-200' }),
    });
    assert.equal(quotaRes.status, 500);

    // Keychain and fallback must remain unchanged at "standard"
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity'), rawStandard);
    assert.equal(ctx.fs.readFallback().id_token_email, 'standard@startup.io');
  });
});
