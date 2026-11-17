import readline from 'node:readline';
import type { ProfileListEntry } from './format.ts';
import { formatBucketCell } from './format.ts';

export type PickerResult =
  | { action: 'select'; alias: string }
  | { action: 'best' }
  | { action: 'cancel' };

export interface InteractivePickerOptions {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

/**
 * Renders the interactive selector UI frame for the given profile list and cursor index.
 */
export function renderPickerFrame(entries: ProfileListEntry[], cursor: number): string {
  const lines: string[] = [
    'Select an Antigravity profile:',
    '',
  ];

  entries.forEach((entry, idx) => {
    const pointer = idx === cursor ? '>' : ' ';
    const activeBadge = entry.isActive ? '* active' : '        ';
    const email = entry.email ?? 'unknown';
    const tier = entry.quota?.tierId ?? entry.tier ?? 'unknown';
    const q5h = entry.quota ? formatBucketCell(entry.quota.claude5h) : '-';
    const qWeekly = entry.quota ? formatBucketCell(entry.quota.claudeWeekly) : '-';
    lines.push(
      ` ${pointer} ${entry.alias.padEnd(12)} ${email.padEnd(24)} ${tier.padEnd(12)} 5h:${q5h}  wk:${qWeekly}  ${activeBadge}`
    );
  });

  lines.push('');
  lines.push('  [↑/↓ or j/k] Move   [Enter] Switch   [b] Switch Best   [q/Esc] Cancel');
  return `${lines.join('\n')}\n`;
}

/**
 * Launches an interactive raw-mode terminal picker for choosing a profile.
 */
export async function pickProfileInteractive(
  entries: ProfileListEntry[],
  options?: InteractivePickerOptions
): Promise<PickerResult> {
  const stdin = options?.stdin ?? process.stdin;
  const stdout = options?.stdout ?? process.stdout;

  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Interactive picker requires a TTY terminal');
  }

  if (entries.length === 0) {
    return { action: 'cancel' };
  }

  let cursor = Math.max(
    0,
    entries.findIndex((e) => e.isActive)
  );
  let lastLines = 0;

  const draw = () => {
    if (lastLines > 0) {
      stdout.write(`\x1b[${lastLines}A\x1b[J`);
    }
    const frame = renderPickerFrame(entries, cursor);
    lastLines = frame.split('\n').length - 1;
    stdout.write(frame);
  };

  readline.emitKeypressEvents(stdin);
  const prevRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise<PickerResult>((resolve) => {
    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(Boolean(prevRaw));
      }
      stdin.pause();
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve({ action: 'cancel' });
        return;
      }

      if (key.name === 'q' || key.name === 'escape') {
        cleanup();
        resolve({ action: 'cancel' });
        return;
      }

      if (key.name === 'b') {
        cleanup();
        resolve({ action: 'best' });
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        const chosen = entries[cursor];
        cleanup();
        resolve(chosen ? { action: 'select', alias: chosen.alias } : { action: 'cancel' });
        return;
      }

      if (key.name === 'up' || key.name === 'k') {
        cursor = (cursor - 1 + entries.length) % entries.length;
        draw();
        return;
      }

      if (key.name === 'down' || key.name === 'j') {
        cursor = (cursor + 1) % entries.length;
        draw();
      }
    };

    draw();
    stdin.on('keypress', onKeypress);
  });
}
