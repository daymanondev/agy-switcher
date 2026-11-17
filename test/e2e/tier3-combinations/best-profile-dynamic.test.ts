import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 3: Cross-Feature: Dynamic Best Profile Selection & Failover', () => {
  let ctx: TestContext;
  const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
  const payloadAlpha = {
    token: { access_token: 'ya29.token-alpha', refresh_token: '1//alpha', token_type: 'Bearer', expiry: futureExpiry },
    id_token_email: 'alpha@org.com',
  };
  const payloadBeta = {
    token: { access_token: 'ya29.token-beta', refresh_token: '1//beta', token_type: 'Bearer', expiry: futureExpiry },
    id_token_email: 'beta@org.com',
  };
  const payloadGamma = {
    token: { access_token: 'ya29.token-gamma', refresh_token: '1//gamma', token_type: 'Bearer', expiry: futureExpiry },
    id_token_email: 'gamma@org.com',
  };

  const rawAlpha = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadAlpha)).toString('base64')}`;
  const rawBeta = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadBeta)).toString('base64')}`;
  const rawGamma = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadGamma)).toString('base64')}`;

  beforeEach(async () => {
    ctx = await createTestContext();
    ctx.keychain.setItem('gemini', 'antigravity-profile:alpha', rawAlpha);
    ctx.keychain.setItem('gemini', 'antigravity-profile:beta', rawBeta);
    ctx.keychain.setItem('gemini', 'antigravity-profile:gamma', rawGamma);
    ctx.keychain.setItem('gemini', 'antigravity', rawAlpha);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. best command selects profile with highest immediate 5h capacity', async () => {
    // Mock quota summary per token
    ctx.server.setQuotaSummaryResponse((req) => {
      const auth = req.headers.authorization;
      if (auth?.includes('token-alpha')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.30 }, { window: 'weekly', remainingFraction: 0.80 }] }],
        };
      }
      if (auth?.includes('token-beta')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.95 }, { window: 'weekly', remainingFraction: 0.90 }] }],
        };
      }
      return {
        groups: [{ buckets: [{ window: '5h', remainingFraction: 0.50 }, { window: 'weekly', remainingFraction: 0.50 }] }],
      };
    });

    const res = await ctx.cli.run(['best']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Selected 'beta' as best profile/);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity'), rawBeta);
  });

  it('2. failover away from exhausted active profile (<5% in 5h window)', async () => {
    // Alpha is active but depleted to 2%
    ctx.server.setQuotaSummaryResponse((req) => {
      const auth = req.headers.authorization;
      if (auth?.includes('token-alpha')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.02 }, { window: 'weekly', remainingFraction: 0.90 }] }],
        };
      }
      if (auth?.includes('token-gamma')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.70 }, { window: 'weekly', remainingFraction: 0.70 }] }],
        };
      }
      return {
        groups: [{ buckets: [{ window: '5h', remainingFraction: 0.10 }, { window: 'weekly', remainingFraction: 0.20 }] }],
      };
    });

    const res = await ctx.cli.run(['best']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Selected 'gamma' as best profile/);
  });

  it('3. verifies fallback file is updated with selected best profile credentials', async () => {
    await ctx.cli.run(['best']);
    assert.equal(ctx.fs.existsFallback(), true);
    const fallback = ctx.fs.readFallback();
    assert.ok(['alpha@org.com', 'beta@org.com', 'gamma@org.com'].includes(fallback.id_token_email));
  });

  it('4. Paseo plugin RPC agy.profiles.switch_best mirrors CLI best selection', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.switch_best');
    assert.equal(res.ok, true);
    assert.ok(res.activeProfile);
    assert.ok(['alpha', 'beta', 'gamma'].includes(res.activeProfile));
  });

  it('5. single remaining profile is selected when others are removed', async () => {
    await ctx.cli.run(['rm', 'beta']);
    await ctx.cli.run(['rm', 'gamma']);

    const res = await ctx.cli.run(['best']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Selected 'alpha' as best profile/);
  });
});
