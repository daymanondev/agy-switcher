import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 1: Cloud Code Assist Quota API Client', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. loadCodeAssist returns project identifier and subscription tier', async () => {
    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ya29.test-access-token',
      },
      body: JSON.stringify({
        metadata: {
          ideType: 'ANTIGRAVITY',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.cloudaicompanionProject, 'projects/1071006060591');
    assert.equal(data.currentTier.id, 'g1-pro-tier');
    assert.equal(data.paidTier.id, 'g1-pro-tier');
  });

  it('2. retrieveUserQuotaSummary parses 5h and weekly rolling buckets', async () => {
    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuotaSummary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ya29.test-access-token',
      },
      body: JSON.stringify({
        project: 'projects/1071006060591',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const buckets = data.groups[0].buckets;
    const bucket5h = buckets.find((b: any) => b.window === '5h' || b.bucketId === '3p-5h');
    const bucketWeekly = buckets.find((b: any) => b.window === 'weekly' || b.bucketId === '3p-weekly');

    assert.ok(bucket5h);
    assert.equal(bucket5h.remainingFraction, 0.85);
    assert.equal(bucket5h.resetTime, '2026-11-16T21:00:00Z');

    assert.ok(bucketWeekly);
    assert.equal(bucketWeekly.remainingFraction, 0.62);
    assert.equal(bucketWeekly.resetTime, '2026-11-23T00:00:00Z');
  });

  it('3. retrieveUserQuota parses Gemini model buckets', async () => {
    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuota`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ya29.test-access-token',
      },
      body: JSON.stringify({
        project: 'projects/1071006060591',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const buckets = data.buckets;
    const pro = buckets.find((b: any) => b.modelId === 'gemini-2.5-pro');
    const flash = buckets.find((b: any) => b.modelId === 'gemini-2.5-flash');

    assert.ok(pro);
    assert.equal(pro.remainingFraction, 1.0);
    assert.ok(flash);
    assert.equal(flash.remainingFraction, 0.95);
  });

  it('4. executes Step 2 quota queries in parallel and joins responses', async () => {
    const project = 'projects/1071006060591';
    const token = 'ya29.test-access-token';

    const [summaryRes, quotaRes] = await Promise.all([
      fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project }),
      }),
      fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuota`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project }),
      }),
    ]);

    assert.equal(summaryRes.status, 200);
    assert.equal(quotaRes.status, 200);

    const summaryData = await summaryRes.json();
    const quotaData = await quotaRes.json();

    assert.ok(summaryData.groups);
    assert.ok(quotaData.buckets);
    assert.equal(ctx.server.requests.length, 2);
  });

  it('5. gracefully handles missing or empty quota bucket groups', async () => {
    ctx.server.setQuotaSummaryResponse({
      groups: [],
      buckets: [],
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuotaSummary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ya29.test-access-token',
      },
      body: JSON.stringify({ project: 'projects/1071006060591' }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.groups, []);
    // Verify consumer can default empty buckets cleanly without throwing
    const default5h = data.groups?.[0]?.buckets?.[0]?.remainingFraction ?? 0.0;
    assert.equal(default5h, 0.0);
  });
});
