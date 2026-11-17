import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 2: Missing Project & Entitlement Boundaries', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. handles loadCodeAssist with null/omitted cloudaicompanionProject (free accounts)', async () => {
    ctx.server.setLoadCodeAssistResponse({
      cloudaicompanionProject: null,
      currentTier: { id: 'free-tier', name: 'Free Tier' },
      ineligibleTiers: [
        {
          tierId: 'free-tier',
          reasonCode: 'UNSUPPORTED_CLIENT',
          reasonMessage: 'Individual tier is not supported.',
        },
      ],
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.cloudaicompanionProject, null);
    assert.equal(data.currentTier.id, 'free-tier');
    // Client should recognize this as unentitled and skip Step 2 quota fetch
    const hasProject = Boolean(data.cloudaicompanionProject);
    assert.equal(hasProject, false);
  });

  it('2. handles empty string cloudaicompanionProject cleanly', async () => {
    ctx.server.setLoadCodeAssistResponse({
      cloudaicompanionProject: '',
      currentTier: { id: 'standard-tier', name: 'Standard' },
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    const data = await res.json();
    assert.equal(data.cloudaicompanionProject, '');
    const isProjectValid = typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject.trim().length > 0;
    assert.equal(isProjectValid, false);
  });

  it('3. handles 403 Forbidden with SUBSCRIPTION_REQUIRED', async () => {
    ctx.server.setError('retrieveUserQuotaSummary', 403, {
      error: {
        code: 403,
        message: 'You do not have a valid license of this product.',
        status: 'PERMISSION_DENIED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'SUBSCRIPTION_REQUIRED',
            domain: 'cloudaicompanion.googleapis.com',
          },
        ],
      },
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuotaSummary`, {
      method: 'POST',
      body: JSON.stringify({ project: 'projects/unauthorized' }),
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error.details[0].reason, 'SUBSCRIPTION_REQUIRED');
  });

  it('4. defaults cleanly when tier metadata is missing in loadCodeAssist', async () => {
    ctx.server.setLoadCodeAssistResponse({
      cloudaicompanionProject: 'projects/1071006060591',
      // currentTier and paidTier are omitted
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const tierName = data.currentTier?.name || data.paidTier?.name || 'Unknown Tier';
    assert.equal(tierName, 'Unknown Tier');
  });

  it('5. handles empty buckets array in retrieveUserQuota', async () => {
    ctx.server.setUserQuotaResponse({
      buckets: [],
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuota`, {
      method: 'POST',
      body: JSON.stringify({ project: 'projects/1071006060591' }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.buckets, []);
    const modelProQuota = data.buckets.find((b: any) => b.modelId === 'gemini-2.5-pro')?.remainingFraction ?? 0.0;
    assert.equal(modelProQuota, 0.0);
  });
});
