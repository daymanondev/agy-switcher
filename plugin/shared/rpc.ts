import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const QuotaBucketViewSchema = z.object({
  bucketId: z.string(),
  displayName: z.string(),
  window: z.string().optional(),
  remainingFraction: z.number(),
  percentage: z.number(),
  resetTime: z.string().optional(),
  humanCountdown: z.string().optional(),
  disabled: z.boolean(),
});

export type QuotaBucketView = z.infer<typeof QuotaBucketViewSchema>;

export const ProfileItemViewSchema = z.object({
  alias: z.string(),
  email: z.string().optional(),
  isActive: z.boolean(),
  isExpired: z.boolean(),
  tier: z.string(),
  tierId: z.string().optional(),
  isPaidTier: z.boolean(),
  isUsable: z.boolean(),
  score: z.number(),
  gemini: QuotaBucketViewSchema.optional(),
  claude5h: QuotaBucketViewSchema.optional(),
  claudeWeekly: QuotaBucketViewSchema.optional(),
  quotaError: z.string().optional(),
  fetchedAt: z.string().optional(),
});

export type ProfileItemView = z.infer<typeof ProfileItemViewSchema>;

export const FailureSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});

export const profilesList = defineRpc({
  name: 'agy.profiles.list',
  input: z.object({
    fetchQuota: z.boolean().optional(),
  }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      activeEmail: z.string().optional(),
      profiles: z.array(ProfileItemViewSchema),
    }),
    FailureSchema,
  ]),
});

export const profilesSwitch = defineRpc({
  name: 'agy.profiles.switch',
  input: z.object({
    alias: z.string(),
  }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      activeProfile: z.string(),
      email: z.string().optional(),
    }),
    FailureSchema,
  ]),
});

export const profilesSwitchBest = defineRpc({
  name: 'agy.profiles.switch_best',
  input: z.object({}),
  output: z.union([
    z.object({
      ok: z.literal(true),
      activeProfile: z.string(),
      email: z.string().optional(),
      score: z.number(),
    }),
    FailureSchema,
  ]),
});

export const profilesSaveCurrent = defineRpc({
  name: 'agy.profiles.save_current',
  input: z.object({
    alias: z.string(),
    force: z.boolean().optional(),
  }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      alias: z.string(),
      email: z.string().optional(),
    }),
    FailureSchema,
  ]),
});

export const profilesRemove = defineRpc({
  name: 'agy.profiles.remove',
  input: z.object({
    alias: z.string(),
  }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      alias: z.string(),
    }),
    FailureSchema,
  ]),
});
