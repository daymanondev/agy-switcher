import type { ProfileItemView, QuotaBucketView } from '../shared/rpc.ts';
import type { QuotaBucketSummary } from './core/types.ts';
import { ProfileService } from './core/profile.ts';
import { CloudCodeClient } from './core/client.ts';
import { rankProfiles } from './core/scorer.ts';

function toBucketView(bucket?: QuotaBucketSummary): QuotaBucketView | undefined {
  if (!bucket) return undefined;
  return {
    bucketId: bucket.bucketId,
    displayName: bucket.displayName,
    window: bucket.window,
    remainingFraction: bucket.remainingFraction,
    percentage: bucket.percentage,
    resetTime: bucket.resetTime,
    humanCountdown: bucket.humanCountdown,
    disabled: bucket.disabled,
  };
}

export interface PluginHandlersDeps {
  profileService?: ProfileService;
  client?: CloudCodeClient;
}

/**
 * Creates pure RPC handlers backed by `ProfileService` + `CloudCodeClient`.
 * Used by `plugin/index.server.ts` and tested directly by unit & E2E suites.
 */
export function createPluginHandlers(deps?: PluginHandlersDeps) {
  const getService = () => deps?.profileService ?? new ProfileService();

  return {
    async list(input?: { fetchQuota?: boolean }) {
      try {
        const service = getService();
        const fetchQuota = input?.fetchQuota ?? true;
        const [active, summaries] = await Promise.all([
          service.getActiveProfile(),
          service.listProfiles(),
        ]);

        const profiles: ProfileItemView[] = [];
        for (const s of summaries) {
          if (!fetchQuota) {
            profiles.push({
              alias: s.alias,
              email: s.email,
              isActive: s.isActive,
              isExpired: s.isExpired,
              tier: s.tier ?? 'unknown',
              isPaidTier: false,
              isUsable: true,
              score: 0,
            });
            continue;
          }

          try {
            const quota = await service.getProfileQuota(s.alias, deps?.client);
            profiles.push({
              alias: s.alias,
              email: s.email ?? quota.email,
              isActive: s.isActive,
              isExpired: s.isExpired,
              tier: quota.tierDisplayName,
              tierId: quota.tierId,
              isPaidTier: quota.isPaidTier,
              isUsable: quota.isUsable,
              score: quota.overallScore,
              gemini: toBucketView(quota.geminiOverall),
              claude5h: toBucketView(quota.claude5h),
              claudeWeekly: toBucketView(quota.claudeWeekly),
              fetchedAt: quota.fetchedAt,
            });
          } catch (err) {
            profiles.push({
              alias: s.alias,
              email: s.email,
              isActive: s.isActive,
              isExpired: s.isExpired,
              tier: s.tier ?? 'unknown',
              isPaidTier: false,
              isUsable: false,
              score: 0,
              quotaError: (err as Error).message,
            });
          }
        }

        return {
          ok: true as const,
          activeEmail: active?.email,
          profiles,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: (err as Error).message,
        };
      }
    },

    async switchProfile(input?: { alias?: unknown }) {
      if (!input || typeof input.alias !== 'string' || input.alias.trim().length === 0) {
        return {
          ok: false as const,
          error: 'Invalid alias parameter',
        };
      }

      try {
        const service = getService();
        const activated = await service.useProfile(input.alias.trim());
        return {
          ok: true as const,
          activeProfile: activated.alias,
          email: activated.email,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: (err as Error).message,
        };
      }
    },

    async switchBest() {
      try {
        const service = getService();
        const summaries = await service.listProfiles();
        if (summaries.length === 0) {
          return {
            ok: false as const,
            error: 'No profiles available to select',
          };
        }

        const withQuota = await service.listProfilesWithQuota({ client: deps?.client });
        const ranked = rankProfiles(
          withQuota.map((s) => ({
            alias: s.alias,
            email: s.email,
            isActive: s.isActive,
            quota: s.quota,
          }))
        );
        const top = ranked[0];
        if (!top) {
          return {
            ok: false as const,
            error: 'No profiles available to select',
          };
        }

        const switched = await service.useProfile(top.alias);
        return {
          ok: true as const,
          activeProfile: switched.alias,
          email: switched.email,
          score: top.score,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: (err as Error).message,
        };
      }
    },

    async saveCurrent(input?: { alias?: unknown; force?: boolean }) {
      if (!input || typeof input.alias !== 'string' || input.alias.trim().length === 0) {
        return {
          ok: false as const,
          error: 'Invalid alias parameter',
        };
      }

      try {
        const service = getService();
        const saved = await service.saveProfile(input.alias.trim(), { force: input.force });
        return {
          ok: true as const,
          alias: saved.alias,
          email: saved.email,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: (err as Error).message,
        };
      }
    },

    async remove(input?: { alias?: unknown }) {
      if (!input || typeof input.alias !== 'string' || input.alias.trim().length === 0) {
        return {
          ok: false as const,
          error: 'Invalid alias parameter',
        };
      }

      try {
        const service = getService();
        const alias = input.alias.trim();
        const deleted = await service.deleteProfile(alias);
        if (!deleted) {
          return {
            ok: false as const,
            error: `Profile '${alias}' not found in Keychain`,
          };
        }
        return {
          ok: true as const,
          alias,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: (err as Error).message,
        };
      }
    },
  };
}
