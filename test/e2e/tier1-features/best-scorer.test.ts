import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

export interface ScorableProfile {
  alias: string;
  f5h: number; // 0.0 to 1.0
  fWeek: number; // 0.0 to 1.0
  fGemini: number; // 0.0 to 1.0
  isPaidTier: boolean;
  resetTime5h?: string;
  resetTimeWeekly?: string;
}

export function computeProfileScore(profile: ScorableProfile): number {
  const w5h = 50.0;
  const wWeek = 30.0;
  const wGemini = 20.0;
  const tBonus = profile.isPaidTier ? 5.0 : 0.0;

  let score = w5h * profile.f5h + wWeek * profile.fWeek + wGemini * profile.fGemini + tBonus;

  // Bottleneck hard gate: <5% immediate 5h capacity deprioritizes heavily
  if (profile.f5h < 0.05) {
    score *= 0.10;
  }

  return score;
}

export function rankProfiles(profiles: ScorableProfile[]): ScorableProfile | null {
  if (profiles.length === 0) return null;

  return [...profiles].sort((a, b) => {
    const scoreA = computeProfileScore(a);
    const scoreB = computeProfileScore(b);

    if (Math.abs(scoreA - scoreB) > 0.01) {
      return scoreB - scoreA;
    }

    // Tie-breaker: earlier reset time on lowest bucket
    const resetA = Date.parse(a.resetTime5h || '2099-01-01T00:00:00Z');
    const resetB = Date.parse(b.resetTime5h || '2099-01-01T00:00:00Z');
    return resetA - resetB;
  })[0];
}

describe('Tier 1: Multi-Factor Best Profile Scorer', () => {
  it('1. highest remaining 5h quota wins when weekly and gemini quotas are equal', () => {
    const profileA: ScorableProfile = {
      alias: 'account-a',
      f5h: 0.90,
      fWeek: 0.50,
      fGemini: 0.80,
      isPaidTier: true,
    };
    const profileB: ScorableProfile = {
      alias: 'account-b',
      f5h: 0.40,
      fWeek: 0.50,
      fGemini: 0.80,
      isPaidTier: true,
    };

    const best = rankProfiles([profileA, profileB]);
    assert.equal(best?.alias, 'account-a');
    assert.ok(computeProfileScore(profileA) > computeProfileScore(profileB));
  });

  it('2. weekly quota acts as tiebreaker when 5h quotas are identical', () => {
    const profileA: ScorableProfile = {
      alias: 'account-high-weekly',
      f5h: 0.80,
      fWeek: 0.90,
      fGemini: 0.70,
      isPaidTier: true,
    };
    const profileB: ScorableProfile = {
      alias: 'account-low-weekly',
      f5h: 0.80,
      fWeek: 0.30,
      fGemini: 0.70,
      isPaidTier: true,
    };

    const best = rankProfiles([profileA, profileB]);
    assert.equal(best?.alias, 'account-high-weekly');
  });

  it('3. applies bottleneck multiplier (0.10) when 5h quota is exhausted (<5%)', () => {
    const depletedProfile: ScorableProfile = {
      alias: 'account-depleted-5h',
      f5h: 0.02, // 2% left
      fWeek: 0.95, // 95% left weekly
      fGemini: 1.0,
      isPaidTier: true,
    };
    const moderateProfile: ScorableProfile = {
      alias: 'account-moderate',
      f5h: 0.40, // 40% left
      fWeek: 0.40,
      fGemini: 0.50,
      isPaidTier: false,
    };

    const scoreDepleted = computeProfileScore(depletedProfile);
    const scoreModerate = computeProfileScore(moderateProfile);

    // Depleted score should be penalised: (50*0.02 + 30*0.95 + 20*1.0 + 5) * 0.10 = ~5.45
    // Moderate score: 50*0.40 + 30*0.40 + 20*0.50 + 0 = 42.0
    assert.ok(scoreDepleted < 10.0);
    assert.ok(scoreModerate > 40.0);

    const best = rankProfiles([depletedProfile, moderateProfile]);
    assert.equal(best?.alias, 'account-moderate');
  });

  it('4. breaks virtual ties using earlier reset timestamp', () => {
    const profileA: ScorableProfile = {
      alias: 'account-later-reset',
      f5h: 0.80,
      fWeek: 0.80,
      fGemini: 0.80,
      isPaidTier: true,
      resetTime5h: '2026-11-16T22:00:00Z',
    };
    const profileB: ScorableProfile = {
      alias: 'account-earlier-reset',
      f5h: 0.80,
      fWeek: 0.80,
      fGemini: 0.80,
      isPaidTier: true,
      resetTime5h: '2026-11-16T19:00:00Z',
    };

    const best = rankProfiles([profileA, profileB]);
    assert.equal(best?.alias, 'account-earlier-reset');
  });

  it('5. selects the single configured profile when only one exists', () => {
    const singleProfile: ScorableProfile = {
      alias: 'solo-account',
      f5h: 0.60,
      fWeek: 0.70,
      fGemini: 0.90,
      isPaidTier: true,
    };

    const best = rankProfiles([singleProfile]);
    assert.equal(best?.alias, 'solo-account');
    assert.equal(rankProfiles([]), null);
  });
});
