import type {
  AntigravityProfile,
  ProfileSummary,
  QuotaBucketSummary,
  UnifiedQuotaSummary,
} from '../core/types.ts';

export interface ProfileListEntry extends ProfileSummary {
  quota?: UnifiedQuotaSummary;
  quotaError?: string;
}

/**
 * Renders a compact fixed-width ASCII progress bar for a percentage [0..100].
 */
export function formatProgressBar(percentage: number, width = 5): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Formats an ISO timestamp into short local DD/MM HH:mm display.
 */
export function formatLocalResetStamp(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Formats a quota bucket into a compact bar + percentage + reset countdown cell.
 */
export function formatBucketCell(
  bucket?: QuotaBucketSummary,
  options?: { includeStamp?: boolean; fallbackLabel?: string }
): string {
  if (!bucket) {
    return options?.fallbackLabel ?? 'N/A';
  }
  const bar = formatProgressBar(bucket.percentage);
  const pct = `${bucket.percentage}%`;
  const countdown = bucket.humanCountdown ?? 'ready';
  if (countdown === 'ready') {
    return `${bar} ${pct} (ready)`;
  }
  if (options?.includeStamp && bucket.resetTime) {
    const stamp = formatLocalResetStamp(bucket.resetTime);
    if (stamp) {
      return `${bar} ${pct} (${countdown} · ${stamp})`;
    }
  }
  return `${bar} ${pct} (${countdown})`;
}

/**
 * Formats the profile list table including Tier, Gemini, 5h, Weekly, and Active status.
 */
export function formatProfileTable(entries: ProfileListEntry[]): string {
  const rows = entries.map((entry) => {
    const alias = entry.alias;
    const email = entry.email ?? 'unknown';
    const tier = entry.quota?.tierId ?? entry.tier ?? (entry.quotaError ? 'err' : 'unknown');
    const gemini = entry.quota
      ? formatBucketCell(entry.quota.geminiOverall)
      : entry.quotaError
        ? 'unavailable'
        : '-';
    const q5h = entry.quota
      ? formatBucketCell(entry.quota.claude5h)
      : entry.quotaError
        ? 'unavailable'
        : '-';
    const qWeekly = entry.quota
      ? formatBucketCell(entry.quota.claudeWeekly, { includeStamp: true })
      : entry.quotaError
        ? 'unavailable'
        : '-';
    const status = entry.isActive ? '* active' : entry.isExpired ? 'expired' : 'ready';
    return { alias, email, tier, gemini, q5h, qWeekly, status };
  });

  const w = {
    alias: Math.max(12, ...rows.map((r) => r.alias.length + 1)),
    email: Math.max(24, ...rows.map((r) => r.email.length + 1)),
    tier: Math.max(11, ...rows.map((r) => r.tier.length + 1)),
    gemini: Math.max(19, ...rows.map((r) => r.gemini.length + 1)),
    q5h: Math.max(19, ...rows.map((r) => r.q5h.length + 1)),
    qWeekly: Math.max(28, ...rows.map((r) => r.qWeekly.length + 1)),
  };

  const header =
    `${'ALIAS'.padEnd(w.alias)} ` +
    `${'EMAIL'.padEnd(w.email)} ` +
    `${'TIER'.padEnd(w.tier)} ` +
    `${'GEMINI'.padEnd(w.gemini)} ` +
    `${'5H QUOTA'.padEnd(w.q5h)} ` +
    `${'WEEKLY'.padEnd(w.qWeekly)} ` +
    `STATUS`;

  const divider = '-'.repeat(Math.min(130, header.length + 4));
  const lines = [header, divider];

  for (const r of rows) {
    lines.push(
      `${r.alias.padEnd(w.alias)} ` +
        `${r.email.padEnd(w.email)} ` +
        `${r.tier.padEnd(w.tier)} ` +
        `${r.gemini.padEnd(w.gemini)} ` +
        `${r.q5h.padEnd(w.q5h)} ` +
        `${r.qWeekly.padEnd(w.qWeekly)} ` +
        `${r.status}`
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Formats detailed status for the currently active Antigravity session.
 */
export function formatActiveStatus(
  active: AntigravityProfile | null,
  matchedAlias?: string,
  quota?: UnifiedQuotaSummary
): string {
  if (!active) {
    return 'No active Antigravity profile found in Keychain (`gemini:antigravity`).\n';
  }

  const lines = [
    `Active email : ${active.email ?? 'unknown'}`,
    `Saved alias  : ${matchedAlias ?? '(unsaved — run `agy-switcher save <alias>`)'}`,
    `Auth method  : ${active.authMethod ?? 'consumer'}`,
  ];

  if (quota) {
    lines.push(`Tier         : ${quota.tierDisplayName} (${quota.tierId})`);
    lines.push(`Gemini (5h)  : ${formatBucketCell(quota.geminiOverall, { includeStamp: true })}`);
    lines.push(`Claude 5h    : ${formatBucketCell(quota.claude5h, { includeStamp: true })}`);
    lines.push(`Claude Weekly: ${formatBucketCell(quota.claudeWeekly, { includeStamp: true })}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Returns CLI usage instructions.
 */
export function formatHelp(): string {
  return [
    'Usage: agy-switcher [command] [options]',
    '',
    'Commands:',
    '  save <alias> [--force|-f]   Save active Keychain session as a named profile',
    '  ls [--json] [--no-quota]    List saved profiles with tier, 5h & weekly quotas',
    '  use <alias>                 Switch active session to saved profile',
    '  best [--dry-run]            Select and switch to the profile with highest quota',
    '  rm <alias>                  Remove a saved profile from Keychain',
    '  status                      Show active session and live quota summary',
    '  (no command in TTY)         Launch interactive profile picker',
    '',
    'Options:',
    '  -h, --help                  Show this help message',
    '  -v, --version               Show CLI version',
    '',
  ].join('\n');
}
