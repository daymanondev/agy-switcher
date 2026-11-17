import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampFraction,
  fractionToPercentage,
  formatCountdown,
  formatModelDisplayName,
  normalizeQuotaData,
} from '../../src/core/quota.ts';
import type {
  LoadCodeAssistResponse,
  RetrieveUserQuotaSummaryResponse,
  RetrieveUserQuotaResponse,
} from '../../src/core/types.ts';

describe('Quota Normalizer & Formatting (Unit Tests)', () => {
  it('1. clampFraction correctly sanitizes boundary values and invalid inputs', () => {
    assert.equal(clampFraction(0.75), 0.75);
    assert.equal(clampFraction(1.000002), 1.0);
    assert.equal(clampFraction(-0.00001), 0.0);
    assert.equal(clampFraction(null), 0.0);
    assert.equal(clampFraction(undefined), 0.0);
    assert.equal(clampFraction(NaN), 0.0);
    assert.equal(clampFraction('0.5' as any), 0.0);
  });

  it('2. fractionToPercentage clamps and rounds correctly to integer 0..100', () => {
    assert.equal(fractionToPercentage(0.854), 85);
    assert.equal(fractionToPercentage(0.856), 86);
    assert.equal(fractionToPercentage(1.0), 100);
    assert.equal(fractionToPercentage(0.0), 0);
    assert.equal(fractionToPercentage(-0.5), 0);
    assert.equal(fractionToPercentage(1.5), 100);
    assert.equal(fractionToPercentage(undefined), 0);
  });

  it('3. formatCountdown formats relative human readable countdowns', () => {
    const baseNow = new Date('2026-11-16T12:00:00Z');

    // Past time -> "ready"
    assert.equal(formatCountdown('2026-11-16T11:59:00Z', baseNow), 'ready');
    assert.equal(formatCountdown(null, baseNow), 'ready');
    assert.equal(formatCountdown('invalid-date', baseNow), 'ready');

    // < 60 minutes -> "Xm"
    assert.equal(formatCountdown('2026-11-16T12:25:00Z', baseNow), '25m');
    assert.equal(formatCountdown('2026-11-16T12:00:30Z', baseNow), '1m');

    // < 24 hours -> "Xh Ym"
    assert.equal(formatCountdown('2026-11-16T14:15:00Z', baseNow), '2h 15m');
    assert.equal(formatCountdown('2026-11-16T21:00:00Z', baseNow), '9h 0m');

    // >= 24 hours -> "Xd Yh"
    assert.equal(formatCountdown('2026-11-19T16:00:00Z', baseNow), '3d 4h');
    assert.equal(formatCountdown('2026-11-23T12:00:00Z', baseNow), '7d 0h');
  });

  it('4. formatModelDisplayName generates clean title strings for known and custom models', () => {
    assert.equal(formatModelDisplayName('gemini-2.5-pro'), 'Gemini 2.5 Pro');
    assert.equal(formatModelDisplayName('gemini-2.5-flash'), 'Gemini 2.5 Flash');
    assert.equal(formatModelDisplayName('gemini-3-flash-preview'), 'Gemini 3 Flash Preview');
    assert.equal(formatModelDisplayName('gemini-3.8-flash-tiered'), 'Gemini 3.8 Flash Tiered');
    assert.equal(formatModelDisplayName('custom-experimental-model'), 'Custom Experimental Model');
  });

  it('5. normalizeQuotaData normalizes full payload for paid Google One tier', () => {
    const fixedNow = new Date('2026-11-16T12:00:00Z');

    const loadResp: LoadCodeAssistResponse = {
      cloudaicompanionProject: 'projects/1071006060591',
      currentTier: { id: 'g1-pro-tier', name: 'Google One AI Premium' },
      paidTier: { id: 'g1-pro-tier', name: 'Google One AI Premium' },
    };

    const quotaSummaryResp: RetrieveUserQuotaSummaryResponse = {
      groups: [
        {
          displayName: 'Claude & Other Models',
          buckets: [
            {
              bucketId: '3p-5h',
              displayName: '5-Hour Limit',
              window: '5h',
              remainingFraction: 0.85,
              resetTime: '2026-11-16T21:00:00Z',
              remainingAmount: 850,
            },
            {
              bucketId: '3p-weekly',
              displayName: 'Weekly Limit',
              window: 'weekly',
              remainingFraction: 0.62,
              resetTime: '2026-11-23T00:00:00Z',
              remainingAmount: 6200,
            },
          ],
        },
      ],
    };

    const userQuotaResp: RetrieveUserQuotaResponse = {
      buckets: [
        { modelId: 'gemini-2.5-pro', remainingFraction: 1.0, resetTime: '2026-11-16T18:00:00Z' },
        { modelId: 'gemini-2.5-flash', remainingFraction: 0.90, resetTime: '2026-11-16T18:00:00Z' },
      ],
    };

    const result = normalizeQuotaData(
      'user@example.com',
      loadResp,
      quotaSummaryResp,
      userQuotaResp,
      fixedNow
    );

    assert.equal(result.email, 'user@example.com');
    assert.equal(result.tierId, 'g1-pro-tier');
    assert.equal(result.tierDisplayName, 'Google One AI Premium');
    assert.equal(result.projectId, 'projects/1071006060591');
    assert.equal(result.isPaidTier, true);
    assert.equal(result.isUsable, true);

    // 5h bucket
    assert.ok(result.claude5h);
    assert.equal(result.claude5h?.remainingFraction, 0.85);
    assert.equal(result.claude5h?.percentage, 85);
    assert.equal(result.claude5h?.humanCountdown, '9h 0m');

    // Weekly bucket
    assert.ok(result.claudeWeekly);
    assert.equal(result.claudeWeekly?.remainingFraction, 0.62);
    assert.equal(result.claudeWeekly?.percentage, 62);
    assert.equal(result.claudeWeekly?.humanCountdown, '6d 12h');

    // Gemini overall
    assert.equal(result.geminiOverall.remainingFraction, 0.95);
    assert.equal(result.geminiOverall.percentage, 95);
    assert.equal(result.geminiOverall.resetTime, '2026-11-16T18:00:00Z');
    assert.equal(result.geminiOverall.humanCountdown, '6h 0m');

    // Gemini models
    assert.equal(result.geminiModels['gemini-2.5-pro'].percentage, 100);
    assert.equal(result.geminiModels['gemini-2.5-flash'].percentage, 90);

    // Score: 50*0.85 + 30*0.62 + 20*0.95 + 5 = 42.5 + 18.6 + 19.0 + 5 = 85.1
    assert.equal(result.overallScore, 85.1);
  });

  it('6. normalizeQuotaData gracefully handles unsupported/free tier without project', () => {
    const loadResp: LoadCodeAssistResponse = {
      cloudaicompanionProject: null,
      currentTier: { id: 'free-tier', name: 'Gemini Code Assist for individuals' },
      ineligibleTiers: [
        {
          tierId: 'free-tier',
          tierName: 'Gemini Code Assist for individuals',
          reasonCode: 'UNSUPPORTED_CLIENT',
          reasonMessage: 'Client unsupported for free tier',
        },
      ],
    };

    const result = normalizeQuotaData('free@example.com', loadResp, null, null);

    assert.equal(result.tierId, 'free-tier');
    assert.equal(result.isPaidTier, false);
    assert.equal(result.isUsable, false);
    assert.equal(result.projectId, undefined);
    assert.equal(result.overallScore, 0);
    assert.ok(result.notes?.some((n) => n.includes('unsupported')));
  });

  it('7. applies bottleneck penalty when 5h quota is severely depleted (< 5%)', () => {
    const loadResp: LoadCodeAssistResponse = {
      cloudaicompanionProject: 'projects/123',
      paidTier: { id: 'g1-pro-tier', name: 'Google One AI Premium' },
    };

    const quotaSummaryResp: RetrieveUserQuotaSummaryResponse = {
      groups: [
        {
          displayName: 'Claude',
          buckets: [
            { bucketId: '3p-5h', window: '5h', remainingFraction: 0.02 }, // 2% left
            { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.90 }, // 90% left
          ],
        },
      ],
    };

    const result = normalizeQuotaData('throttled@example.com', loadResp, quotaSummaryResp, null);

    // Score without penalty: 50*0.02 + 30*0.90 + 20*0.0 + 5.0 = 1.0 + 27.0 + 5.0 = 33.0
    // With 0.10x bottleneck penalty: 3.3
    assert.equal(result.overallScore, 3.3);
    assert.ok(result.notes?.some((n) => n.includes('severely depleted')));
  });

  it('8. handles empty or missing quota groups cleanly', () => {
    const loadResp: LoadCodeAssistResponse = {
      cloudaicompanionProject: 'projects/123',
      currentTier: { id: 'standard-tier', name: 'Gemini Code Assist' },
    };

    const result = normalizeQuotaData('empty@example.com', loadResp, { groups: [] }, { buckets: [] });

    assert.equal(result.claude5h, undefined);
    assert.equal(result.claudeWeekly, undefined);
    assert.equal(result.geminiOverall.remainingFraction, 0.0);
    assert.deepEqual(result.geminiModels, {});
    assert.equal(result.isUsable, false); // No available quota
  });
});
