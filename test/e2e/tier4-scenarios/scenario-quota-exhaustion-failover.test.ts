import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 4 Scenario 2: Depleted Quota Automatic Failover Workflow', () => {
  let ctx: TestContext;
  const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
  const payloadWork = {
    token: { access_token: 'ya29.work-exhausted', refresh_token: '1//work', token_type: 'Bearer', expiry: futureExpiry },
    id_token_email: 'dev@busywork.com',
  };
  const payloadPersonal = {
    token: { access_token: 'ya29.personal-fresh', refresh_token: '1//personal', token_type: 'Bearer', expiry: futureExpiry },
    id_token_email: 'dev@personal.org',
  };

  const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadWork)).toString('base64')}`;
  const rawPersonal = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadPersonal)).toString('base64')}`;

  beforeEach(async () => {
    ctx = await createTestContext();
    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawWork);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawPersonal);
    // Work is currently active
    ctx.keychain.setItem('gemini', 'antigravity', rawWork);
    ctx.fs.writeFallback(payloadWork, 0o600);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('Step 1: verify initial state has "work" as active account', async () => {
    const active = ctx.fs.readFallback();
    assert.equal(active.id_token_email, 'dev@busywork.com');
  });

  it('Step 2: simulate upstream quota exhaustion for "work" (1% remaining in 5h window)', async () => {
    ctx.server.setQuotaSummaryResponse((req) => {
      const auth = req.headers.authorization;
      if (auth?.includes('work-exhausted')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.01 }, { window: 'weekly', remainingFraction: 0.80 }] }],
        };
      }
      return {
        groups: [{ buckets: [{ window: '5h', remainingFraction: 0.90 }, { window: 'weekly', remainingFraction: 0.90 }] }],
      };
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuotaSummary`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ya29.work-exhausted' },
      body: JSON.stringify({ project: 'projects/1071006060591' }),
    });
    const data = await res.json();
    assert.equal(data.groups[0].buckets[0].remainingFraction, 0.01);
  });

  it('Step 3: invoke "best" command to trigger automated failover', async () => {
    ctx.server.setQuotaSummaryResponse((req) => {
      const auth = req.headers.authorization;
      if (auth?.includes('work-exhausted')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.01 }, { window: 'weekly', remainingFraction: 0.80 }] }],
        };
      }
      return {
        groups: [{ buckets: [{ window: '5h', remainingFraction: 0.90 }, { window: 'weekly', remainingFraction: 0.90 }] }],
      };
    });

    const res = await ctx.cli.run(['best']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Selected 'personal' as best profile/);
  });

  it('Step 4: verify primary Keychain slot switched to "personal" credentials', async () => {
    ctx.server.setQuotaSummaryResponse((req) => {
      const auth = req.headers.authorization;
      if (auth?.includes('work-exhausted')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.01 }, { window: 'weekly', remainingFraction: 0.80 }] }],
        };
      }
      return {
        groups: [{ buckets: [{ window: '5h', remainingFraction: 0.90 }, { window: 'weekly', remainingFraction: 0.90 }] }],
      };
    });

    await ctx.cli.run(['best']);
    const active = ctx.keychain.getItem('gemini', 'antigravity');
    assert.equal(active, rawPersonal);
  });

  it('Step 5: verify fallback token file updated to "personal" with 0600 mode for uninterrupted IDE usage', async () => {
    ctx.server.setQuotaSummaryResponse((req) => {
      const auth = req.headers.authorization;
      if (auth?.includes('work-exhausted')) {
        return {
          groups: [{ buckets: [{ window: '5h', remainingFraction: 0.01 }, { window: 'weekly', remainingFraction: 0.80 }] }],
        };
      }
      return {
        groups: [{ buckets: [{ window: '5h', remainingFraction: 0.90 }, { window: 'weekly', remainingFraction: 0.90 }] }],
      };
    });

    await ctx.cli.run(['best']);
    const fallback = ctx.fs.readFallback();
    assert.equal(fallback.id_token_email, 'dev@personal.org');
    assert.equal(ctx.fs.getFallbackFileMode(), 0o600);
  });
});
