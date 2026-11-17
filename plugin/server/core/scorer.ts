import type {
  UnifiedQuotaSummary,
  ProfileScoreEntry,
  ProfileWithQuota,
} from './types.ts';

export const WEIGHT_5H = 50.0;
export const WEIGHT_WEEKLY = 30.0;
export const WEIGHT_GEMINI = 20.0;
export const PAID_TIER_BONUS = 5.0;
export const BOTTLENECK_THRESHOLD = 0.05;
export const BOTTLENECK_PENALTY = 0.10;
export const VIRTUAL_TIE_EPSILON = 2.0;

/**
 * Calculates the multi-factor composite score [0..105] for a UnifiedQuotaSummary.
 *
 * Formula:
 * S(P) = 50.0 * f_5h + 30.0 * f_week + 20.0 * f_gemini + T_bonus
 * If f_5h < 0.05: S(P) = S(P) * 0.10 (Hard Bottleneck Gate)
 */
export function calculateProfileScore(quota?: UnifiedQuotaSummary): number {
  if (!quota) {
    return 0.0;
  }

  // Unusable accounts (no project, free tier, or completely disabled) receive score 0
  if (!quota.isUsable && !quota.projectId) {
    return 0.0;
  }

  const f5h = quota.claude5h?.remainingFraction ?? 0.0;
  const fWeek = quota.claudeWeekly?.remainingFraction ?? 0.0;
  const fGemini = quota.geminiOverall?.remainingFraction ?? 0.0;
  const tBonus = quota.isPaidTier ? PAID_TIER_BONUS : 0.0;

  let score = WEIGHT_5H * f5h + WEIGHT_WEEKLY * fWeek + WEIGHT_GEMINI * fGemini + tBonus;

  // Hard bottleneck gate: <5% immediate 5h capacity deprioritizes heavily
  if (f5h < BOTTLENECK_THRESHOLD) {
    score *= BOTTLENECK_PENALTY;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Identifies the reset timestamp of the profile's lowest bucket.
 */
export function getLowestBucketResetTime(quota?: UnifiedQuotaSummary): string | undefined {
  if (!quota) return undefined;

  const f5h = quota.claude5h?.remainingFraction ?? 1.0;
  const fWeek = quota.claudeWeekly?.remainingFraction ?? 1.0;

  // 5h bucket is primary constraint; if it is <= weekly, its resetTime is the bottleneck
  if (f5h <= fWeek && quota.claude5h?.resetTime) {
    return quota.claude5h.resetTime;
  }

  if (quota.claudeWeekly?.resetTime) {
    return quota.claudeWeekly.resetTime;
  }

  return quota.geminiOverall?.resetTime;
}

/**
 * Compares two profiles using the 4-step tie-breaking protocol:
 * 1. Higher composite score.
 * 2. If |S(A) - S(B)| <= 2.0 (virtual tie), pick earlier reset time on the lowest bucket.
 * 3. If still tied, prefer the currently active profile.
 * 4. Deterministic alphabetical fallback by alias.
 */
export function compareProfiles(a: ProfileWithQuota, b: ProfileWithQuota): number {
  const scoreA = calculateProfileScore(a.quota);
  const scoreB = calculateProfileScore(b.quota);

  // Rule 1: Substantial difference in composite score (> 2.0)
  if (Math.abs(scoreA - scoreB) > VIRTUAL_TIE_EPSILON) {
    return scoreB - scoreA; // Descending: higher score first
  }

  // Rule 2: Virtual tie (|S(A) - S(B)| <= 2.0) -> Earlier reset time on lowest bucket wins
  const resetA = getLowestBucketResetTime(a.quota);
  const resetB = getLowestBucketResetTime(b.quota);

  const timeA = resetA ? Date.parse(resetA) : Number.MAX_SAFE_INTEGER;
  const timeB = resetB ? Date.parse(resetB) : Number.MAX_SAFE_INTEGER;

  if (timeA !== timeB) {
    return timeA - timeB; // Ascending: earlier reset first
  }

  // Rule 3: Prefer currently active profile to avoid unnecessary switching
  if (a.isActive && !b.isActive) return -1;
  if (!a.isActive && b.isActive) return 1;

  // Rule 4: Fallback alphabetical order by alias
  return a.alias.localeCompare(b.alias);
}

/**
 * Evaluates all profiles and selects the best candidate. Returns null if array is empty.
 */
export function findBestProfile(profiles: ProfileWithQuota[]): ProfileWithQuota | null {
  if (!profiles || profiles.length === 0) {
    return null;
  }

  if (profiles.length === 1) {
    return profiles[0];
  }

  const sorted = [...profiles].sort(compareProfiles);
  return sorted[0];
}

/**
 * Enriches and ranks all profiles for display in CLI and Paseo plugin.
 */
export function rankProfiles(profiles: ProfileWithQuota[]): ProfileScoreEntry[] {
  if (!profiles || profiles.length === 0) {
    return [];
  }

  const sorted = [...profiles].sort(compareProfiles);

  return sorted.map((p) => {
    const score = calculateProfileScore(p.quota);
    const claude5hPct = p.quota?.claude5h?.percentage ?? 0;
    const claudeWeeklyPct = p.quota?.claudeWeekly?.percentage ?? 0;
    const geminiPct = p.quota?.geminiOverall?.percentage ?? 0;
    const isPaidTier = Boolean(p.quota?.isPaidTier);
    const lowestResetTime = getLowestBucketResetTime(p.quota);

    return {
      alias: p.alias,
      email: p.email || p.quota?.email,
      score,
      claude5hPct,
      claudeWeeklyPct,
      geminiPct,
      isCurrentlyActive: p.isActive,
      isPaidTier,
      lowestResetTime,
      quotaSummary: p.quota ?? {
        email: p.email || '',
        tierId: 'unknown',
        tierDisplayName: 'Unknown Tier',
        fetchedAt: new Date().toISOString(),
        isPaidTier,
        isUsable: false,
        geminiOverall: {
          bucketId: 'gemini-overall',
          displayName: 'Gemini Overall',
          remainingFraction: 0,
          percentage: 0,
          disabled: true,
        },
        geminiModels: {},
        overallScore: score,
      },
    };
  });
}
