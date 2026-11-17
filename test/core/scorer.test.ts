import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProfileScore,
  getLowestBucketResetTime,
  compareProfiles,
  findBestProfile,
  rankProfiles,
} from '../../src/core/scorer.ts';
import { ProfileService } from '../../src/core/profile.ts';
import { CloudCodeClient } from '../../src/core/client.ts';
import { encodeKeyringPayload, parseKeyringPayload, type IKeychainService } from '../../src/core/keychain.ts';

import type {
  UnifiedQuotaSummary,
  ProfileWithQuota,
  AntigravityPayload,
} from '../../src/core/types.ts';

function createDummyQuota(overrides?: Partial<UnifiedQuotaSummary>): UnifiedQuotaSummary {
  return {
    email: 'user@example.com',
    tierId: 'g1-pro-tier',
    tierDisplayName: 'Google One AI Premium',
    projectId: 'projects/12345',
    fetchedAt: '2026-11-16T12:00:00Z',
    isPaidTier: true,
    isUsable: true,
    claude5h: {
      bucketId: '3p-5h',
      displayName: '5-Hour Limit',
      window: '5h',
      remainingFraction: 0.8,
      percentage: 80,
      resetTime: '2026-11-16T21:00:00Z',
      humanCountdown: '9h 0m',
      disabled: false,
    },
    claudeWeekly: {
      bucketId: '3p-weekly',
      displayName: 'Weekly Limit',
      window: 'weekly',
      remainingFraction: 0.6,
      percentage: 60,
      resetTime: '2026-11-23T00:00:00Z',
      humanCountdown: '6d 12h',
      disabled: false,
    },
    geminiOverall: {
      bucketId: 'gemini-overall',
      displayName: 'Gemini Overall',
      remainingFraction: 0.7,
      percentage: 70,
      disabled: false,
    },
    geminiModels: {},
    overallScore: 0,
    ...overrides,
  };
}

describe('Best Scorer & Ranking Engine (Unit Tests)', () => {
  it('1. calculateProfileScore applies weights and paid tier bonus', () => {
    // 50*0.8 + 30*0.6 + 20*0.7 + 5.0 = 40 + 18 + 14 + 5 = 77.0
    const quotaPaid = createDummyQuota({ isPaidTier: true });
    assert.equal(calculateProfileScore(quotaPaid), 77.0);

    // Free tier: no bonus -> 72.0
    const quotaFree = createDummyQuota({ isPaidTier: false });
    assert.equal(calculateProfileScore(quotaFree), 72.0);
  });

  it('2. calculateProfileScore applies hard bottleneck multiplier (0.10x) when 5h is < 5%', () => {
    const depleted = createDummyQuota({
      claude5h: {
        bucketId: '3p-5h',
        displayName: '5-Hour Limit',
        remainingFraction: 0.02, // 2% left
        percentage: 2,
        disabled: false,
      },
      claudeWeekly: {
        bucketId: '3p-weekly',
        displayName: 'Weekly Limit',
        remainingFraction: 0.95, // 95% left
        percentage: 95,
        disabled: false,
      },
      geminiOverall: {
        bucketId: 'gemini-overall',
        displayName: 'Gemini',
        remainingFraction: 1.0,
        percentage: 100,
        disabled: false,
      },
      isPaidTier: true,
    });

    // Score without penalty: 50*0.02 + 30*0.95 + 20*1.0 + 5.0 = 1.0 + 28.5 + 20.0 + 5.0 = 54.5
    // With 0.10x penalty: 5.45
    assert.equal(calculateProfileScore(depleted), 5.45);
  });

  it('3. calculateProfileScore returns 0 for unusable accounts with missing project', () => {
    const unusable = createDummyQuota({
      isUsable: false,
      projectId: undefined,
    });
    assert.equal(calculateProfileScore(unusable), 0);
    assert.equal(calculateProfileScore(undefined), 0);
  });

  it('4. getLowestBucketResetTime identifies the reset timestamp of the bottleneck bucket', () => {
    const quota5hLowest = createDummyQuota({
      claude5h: {
        bucketId: '3p-5h',
        displayName: '5h',
        remainingFraction: 0.3,
        percentage: 30,
        resetTime: '2026-11-16T15:00:00Z',
        disabled: false,
      },
      claudeWeekly: {
        bucketId: '3p-weekly',
        displayName: 'weekly',
        remainingFraction: 0.8,
        percentage: 80,
        resetTime: '2026-11-23T00:00:00Z',
        disabled: false,
      },
    });
    assert.equal(getLowestBucketResetTime(quota5hLowest), '2026-11-16T15:00:00Z');

    const quotaWeeklyLowest = createDummyQuota({
      claude5h: {
        bucketId: '3p-5h',
        displayName: '5h',
        remainingFraction: 0.9,
        percentage: 90,
        resetTime: '2026-11-16T15:00:00Z',
        disabled: false,
      },
      claudeWeekly: {
        bucketId: '3p-weekly',
        displayName: 'weekly',
        remainingFraction: 0.2,
        percentage: 20,
        resetTime: '2026-11-20T00:00:00Z',
        disabled: false,
      },
    });
    assert.equal(getLowestBucketResetTime(quotaWeeklyLowest), '2026-11-20T00:00:00Z');
  });

  it('5. compareProfiles and findBestProfile sort by score and break virtual ties by reset time', () => {
    // Virtual tie: Profile A (Score = 77.0, reset = 22:00) vs Profile B (Score = 76.5, reset = 18:00)
    // Make 5h bucket the lowest bucket (f5h = 0.5 vs fWeek = 0.8) so 5h resetTime is the bottleneck
    const profileA: ProfileWithQuota = {
      alias: 'profile-a',
      isActive: false,
      quota: createDummyQuota({
        claude5h: {
          bucketId: '3p-5h',
          displayName: '5h',
          remainingFraction: 0.5,
          percentage: 50,
          resetTime: '2026-11-16T22:00:00Z',
          disabled: false,
        },
        claudeWeekly: {
          bucketId: '3p-weekly',
          displayName: 'weekly',
          remainingFraction: 0.8,
          percentage: 80,
          disabled: false,
        },
      }),
    };

    const profileB: ProfileWithQuota = {
      alias: 'profile-b',
      isActive: false,
      quota: createDummyQuota({
        claude5h: {
          bucketId: '3p-5h',
          displayName: '5h',
          remainingFraction: 0.49,
          percentage: 49,
          resetTime: '2026-11-16T18:00:00Z',
          disabled: false,
        },
        claudeWeekly: {
          bucketId: '3p-weekly',
          displayName: 'weekly',
          remainingFraction: 0.8,
          percentage: 80,
          disabled: false,
        },
      }),
    };

    const best = findBestProfile([profileA, profileB]);
    assert.equal(best?.alias, 'profile-b');
  });


  it('6. compareProfiles prefers active profile when scores and reset times are tied', () => {
    const profileA: ProfileWithQuota = {
      alias: 'account-active',
      isActive: true,
      quota: createDummyQuota(),
    };

    const profileB: ProfileWithQuota = {
      alias: 'account-inactive',
      isActive: false,
      quota: createDummyQuota(),
    };

    assert.equal(compareProfiles(profileA, profileB), -1);
    assert.equal(compareProfiles(profileB, profileA), 1);
  });

  it('7. findBestProfile handles edge cases (empty list and single item)', () => {
    assert.equal(findBestProfile([]), null);

    const solo: ProfileWithQuota = {
      alias: 'solo',
      isActive: false,
      quota: createDummyQuota(),
    };
    assert.equal(findBestProfile([solo])?.alias, 'solo');
  });

  it('8. rankProfiles produces sorted and enriched ProfileScoreEntry list', () => {
    const p1: ProfileWithQuota = {
      alias: 'high',
      isActive: false,
      quota: createDummyQuota({ isPaidTier: true }),
    };
    const p2: ProfileWithQuota = {
      alias: 'low',
      isActive: false,
      quota: createDummyQuota({ isPaidTier: false }),
    };

    const ranked = rankProfiles([p2, p1]);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].alias, 'high');
    assert.equal(ranked[1].alias, 'low');
    assert.equal(ranked[0].score, 77.0);
    assert.equal(ranked[1].score, 72.0);
  });

  it('9. ProfileService.getProfileQuota, listProfilesWithQuota, and useBestProfile integration', async () => {
    const storage = new Map<string, string>();

    const mockKeychain: IKeychainService = {
      findGenericPassword: async (service, account) => storage.get(`${service}:${account}`) ?? null,
      addGenericPassword: async (service, account, data) => {
        storage.set(`${service}:${account}`, data);
      },
      deleteGenericPassword: async (service, account) => storage.delete(`${service}:${account}`),
      listAccounts: async (service) => {
        const prefix = `${service}:`;
        return Array.from(storage.keys())
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length));
      },
    };

    const payloadA: AntigravityPayload = {
      token: {
        access_token: 'ya29.token-a',
        refresh_token: '1//refresh-a',
        token_type: 'Bearer',
        expiry: new Date(Date.now() + 3600_000).toISOString(),
      },
      id_token_email: 'accountA@gmail.com',
    };

    const payloadB: AntigravityPayload = {
      token: {
        access_token: 'ya29.token-b',
        refresh_token: '1//refresh-b',
        token_type: 'Bearer',
        expiry: new Date(Date.now() + 3600_000).toISOString(),
      },
      id_token_email: 'accountB@gmail.com',
    };

    // Store in keychain
    storage.set('gemini:antigravity-profile:profile-a', encodeKeyringPayload(payloadA));
    storage.set('gemini:antigravity-profile:profile-b', encodeKeyringPayload(payloadB));
    // Set profile-a as currently active
    storage.set('gemini:antigravity', encodeKeyringPayload(payloadA));

    // Mock CloudCodeClient
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const auth = (init?.headers as Record<string, string>)?.['Authorization'];

      if (url.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'projects/test-project',
            paidTier: { id: 'g1-pro-tier', name: 'Google One AI Premium' },
          }),
          { status: 200 }
        );
      }

      if (url.includes('retrieveUserQuotaSummary')) {
        // Give profile-b more quota than profile-a
        const fraction5h = auth?.includes('token-b') ? 0.90 : 0.20;
        return new Response(
          JSON.stringify({
            groups: [
              {
                buckets: [
                  { bucketId: '3p-5h', window: '5h', remainingFraction: fraction5h },
                  { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.80 },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes('retrieveUserQuota')) {
        return new Response(JSON.stringify({ buckets: [] }), { status: 200 });
      }

      return new Response('Not Found', { status: 404 });
    };

    const client = new CloudCodeClient({ fetchFn: mockFetch });
    const profileService = new ProfileService({
      keychain: mockKeychain,
      fallbackPath: '/tmp/test-jetski-fallback-token',
    });

    // 1. getProfileQuota
    const quotaA = await profileService.getProfileQuota('profile-a', client);
    assert.equal(quotaA.claude5h?.remainingFraction, 0.20);

    const quotaB = await profileService.getProfileQuota('profile-b', client);
    assert.equal(quotaB.claude5h?.remainingFraction, 0.90);

    // 2. listProfilesWithQuota
    const list = await profileService.listProfilesWithQuota({ client });
    assert.equal(list.length, 2);
    assert.ok(list.every((p) => p.quota != null));

    // 3. getBestProfile
    const best = await profileService.getBestProfile(client);
    assert.ok(best);
    assert.equal(best.profile.alias, 'profile-b'); // higher 5h quota wins!

    // 4. useBestProfile
    const switchResult = await profileService.useBestProfile(client);
    assert.equal(switchResult.profile.alias, 'profile-b');
    assert.equal(switchResult.previousAlias, 'profile-a');

    // Verify active slot in keychain was updated to profile-b
    const activeSecret = await mockKeychain.findGenericPassword('gemini', 'antigravity');
    assert.ok(activeSecret);
    const parsedActive = parseKeyringPayload(activeSecret);
    assert.equal(parsedActive.token.refresh_token, '1//refresh-b');
  });
});

