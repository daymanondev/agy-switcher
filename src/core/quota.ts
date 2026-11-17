import type {
  LoadCodeAssistResponse,
  RetrieveUserQuotaSummaryResponse,
  RetrieveUserQuotaResponse,
  QuotaBucketSummary,
  ModelQuotaSummary,
  UnifiedQuotaSummary,
  RawQuotaSummaryBucket,
} from './types.ts';

/**
 * Clamps floating fraction to [0.0, 1.0].
 * Returns 0.0 for undefined, null, NaN, or negative values.
 */
export function clampFraction(fraction: number | undefined | null): number {
  if (typeof fraction !== 'number' || Number.isNaN(fraction)) {
    return 0.0;
  }
  return Math.max(0.0, Math.min(1.0, fraction));
}

/**
 * Converts fraction [0.0..1.0] to integer percentage [0..100].
 */
export function fractionToPercentage(fraction: number | undefined | null): number {
  const clamped = clampFraction(fraction);
  return Math.max(0, Math.min(100, Math.round(clamped * 100)));
}

/**
 * Formats RFC3339 / ISO 8601 reset timestamp into relative human countdown.
 *
 * Rules:
 * - Delta <= 0 or missing/invalid: "ready"
 * - Delta < 60m: "${Math.ceil(deltaSec / 60)}m"
 * - Delta < 24h: "${Math.floor(deltaSec / 3600)}h ${Math.floor((deltaSec % 3600) / 60)}m"
 * - Delta >= 24h: "${Math.floor(deltaSec / 86400)}d ${Math.floor((deltaSec % 86400) / 3600)}h"
 */
export function formatCountdown(resetTime?: string | null, now: Date = new Date()): string {
  if (!resetTime) {
    return 'ready';
  }
  const resetMs = Date.parse(resetTime);
  if (Number.isNaN(resetMs)) {
    return 'ready';
  }

  const nowMs = now.getTime();
  const deltaSec = Math.floor((resetMs - nowMs) / 1000);

  if (deltaSec <= 0) {
    return 'ready';
  }

  if (deltaSec < 3600) {
    const minutes = Math.ceil(deltaSec / 60);
    return `${minutes}m`;
  }

  if (deltaSec < 86400) {
    const hours = Math.floor(deltaSec / 3600);
    const minutes = Math.floor((deltaSec % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  const days = Math.floor(deltaSec / 86400);
  const hours = Math.floor((deltaSec % 86400) / 3600);
  return `${days}d ${hours}h`;
}

/**
 * Formats user-friendly display name for Gemini model IDs.
 */
export function formatModelDisplayName(modelId: string): string {
  switch (modelId) {
    case 'gemini-2.5-pro':
      return 'Gemini 2.5 Pro';
    case 'gemini-2.5-flash':
      return 'Gemini 2.5 Flash';
    case 'gemini-3-flash-preview':
      return 'Gemini 3 Flash Preview';
    case 'gemini-3.8-flash-tiered':
      return 'Gemini 3.8 Flash Tiered';
    default:
      return modelId
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

/**
 * Converts raw Google Cloud Code Assist responses into a clean, normalized UnifiedQuotaSummary.
 */
export function normalizeQuotaData(
  email: string,
  loadCodeAssistResp: LoadCodeAssistResponse,
  quotaSummaryResp?: RetrieveUserQuotaSummaryResponse | null,
  userQuotaResp?: RetrieveUserQuotaResponse | null,
  now: Date = new Date()
): UnifiedQuotaSummary {
  const notes: string[] = [];

  // 1. Tier Identification
  const paidTierId = loadCodeAssistResp.paidTier?.id;
  const currentTierId = loadCodeAssistResp.currentTier?.id;
  const ineligibleTier = loadCodeAssistResp.ineligibleTiers?.[0];

  const tierId = paidTierId || currentTierId || ineligibleTier?.tierId || 'unknown';
  const tierDisplayName =
    loadCodeAssistResp.paidTier?.name ||
    loadCodeAssistResp.currentTier?.name ||
    ineligibleTier?.tierName ||
    (tierId === 'free-tier' ? 'Free Tier' : 'Unknown Tier');

  const isPaidTier = Boolean(
    paidTierId ||
    (currentTierId && ['g1-pro-tier', 'standard-tier', 'enterprise-tier'].includes(currentTierId))
  );

  const rawProject = loadCodeAssistResp.cloudaicompanionProject;
  const projectId =
    typeof rawProject === 'string' && rawProject.trim().length > 0 ? rawProject.trim() : undefined;

  if (!projectId) {
    notes.push('No Cloud AI Companion project found (unentitled or free tier account)');
  }
  if (ineligibleTier?.reasonMessage) {
    notes.push(ineligibleTier.reasonMessage);
  }

  // 2. Parse 3P Model Buckets (Claude 5h & Weekly)
  let claude5h: QuotaBucketSummary | undefined;
  let claudeWeekly: QuotaBucketSummary | undefined;

  const summaryBuckets: RawQuotaSummaryBucket[] = [];
  if (quotaSummaryResp?.groups && Array.isArray(quotaSummaryResp.groups)) {
    for (const group of quotaSummaryResp.groups) {
      if (group.buckets && Array.isArray(group.buckets)) {
        summaryBuckets.push(...group.buckets);
      }
    }
  }
  if (quotaSummaryResp?.buckets && Array.isArray(quotaSummaryResp.buckets)) {
    summaryBuckets.push(...quotaSummaryResp.buckets);
  }

  const raw5h = summaryBuckets.find((b) => b.window === '5h' || b.bucketId === '3p-5h');
  const rawWeekly = summaryBuckets.find((b) => b.window === 'weekly' || b.bucketId === '3p-weekly');

  if (raw5h) {
    const f5h = clampFraction(raw5h.remainingFraction);
    claude5h = {
      bucketId: raw5h.bucketId || '3p-5h',
      displayName: raw5h.displayName || '5-Hour Limit',
      window: '5h',
      remainingFraction: f5h,
      percentage: fractionToPercentage(f5h),
      resetTime: raw5h.resetTime,
      humanCountdown: formatCountdown(raw5h.resetTime, now),
      disabled: Boolean(raw5h.disabled),
      remainingAmount: raw5h.remainingAmount,
    };
    if (f5h < 0.05) {
      notes.push('5-hour rolling quota severely depleted (< 5% remaining)');
    }
  }

  if (rawWeekly) {
    const fWeek = clampFraction(rawWeekly.remainingFraction);
    claudeWeekly = {
      bucketId: rawWeekly.bucketId || '3p-weekly',
      displayName: rawWeekly.displayName || 'Weekly Limit',
      window: 'weekly',
      remainingFraction: fWeek,
      percentage: fractionToPercentage(fWeek),
      resetTime: rawWeekly.resetTime,
      humanCountdown: formatCountdown(rawWeekly.resetTime, now),
      disabled: Boolean(rawWeekly.disabled),
      remainingAmount: rawWeekly.remainingAmount,
    };
    if (fWeek < 0.05) {
      notes.push('Weekly rolling quota severely depleted (< 5% remaining)');
    }
  }

  // 3. Parse Gemini Model Buckets
  const geminiModels: Record<string, ModelQuotaSummary> = {};
  const rawGeminiBuckets =
    userQuotaResp?.buckets && Array.isArray(userQuotaResp.buckets) ? userQuotaResp.buckets : [];

  let totalGeminiFraction = 0;
  let geminiCount = 0;
  let earliestResetTime: string | undefined;
  let earliestResetMs = Number.MAX_SAFE_INTEGER;

  for (const b of rawGeminiBuckets) {
    if (!b.modelId) continue;
    const fModel = clampFraction(b.remainingFraction);
    const summary: ModelQuotaSummary = {
      modelId: b.modelId,
      bucketId: b.modelId,
      displayName: formatModelDisplayName(b.modelId),
      remainingFraction: fModel,
      percentage: fractionToPercentage(fModel),
      resetTime: b.resetTime,
      humanCountdown: formatCountdown(b.resetTime, now),
      disabled: false,
      tokenType: b.tokenType,
      remainingAmount: b.remainingAmount,
    };

    geminiModels[b.modelId] = summary;
    totalGeminiFraction += fModel;
    geminiCount++;

    if (b.resetTime) {
      const resetMs = Date.parse(b.resetTime);
      if (!Number.isNaN(resetMs) && resetMs < earliestResetMs && resetMs > now.getTime()) {
        earliestResetMs = resetMs;
        earliestResetTime = b.resetTime;
      }
    }
  }

  // Compute Gemini Overall
  const avgGeminiFraction = geminiCount > 0 ? clampFraction(totalGeminiFraction / geminiCount) : 0.0;
  const geminiOverall: QuotaBucketSummary = {
    bucketId: 'gemini-overall',
    displayName: 'Gemini Overall',
    remainingFraction: avgGeminiFraction,
    percentage: fractionToPercentage(avgGeminiFraction),
    resetTime: earliestResetTime,
    humanCountdown: formatCountdown(earliestResetTime, now),
    disabled: geminiCount > 0 && Object.values(geminiModels).every((m) => m.disabled),
  };

  // 4. Usability Assessment
  const hasProject = Boolean(projectId);
  const hasAvailableQuota =
    (claude5h?.remainingFraction ?? 0) > 0 ||
    (claudeWeekly?.remainingFraction ?? 0) > 0 ||
    avgGeminiFraction > 0;
  const isUsable = hasProject && tierId !== 'free-tier' && hasAvailableQuota;

  // 5. Initial Composite Score Calculation
  const f5h = claude5h?.remainingFraction ?? 0.0;
  const fWeek = claudeWeekly?.remainingFraction ?? 0.0;
  const fGemini = avgGeminiFraction;
  const tBonus = isPaidTier ? 5.0 : 0.0;

  let score = 50.0 * f5h + 30.0 * fWeek + 20.0 * fGemini + tBonus;
  if (f5h < 0.05) {
    score *= 0.10;
  }
  if (!isUsable && !projectId) {
    score = 0.0;
  }
  const overallScore = Math.round(score * 100) / 100;

  return {
    email,
    tierId,
    tierDisplayName,
    projectId,
    fetchedAt: now.toISOString(),
    isPaidTier,
    isUsable,
    claude5h,
    claudeWeekly,
    geminiOverall,
    geminiModels,
    overallScore,
    notes: notes.length > 0 ? notes : undefined,
  };
}
