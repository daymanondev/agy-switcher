import { ProfileService } from '../core/profile.ts';
import { CloudCodeClient } from '../core/client.ts';
import { rankProfiles } from '../core/scorer.ts';
import type { ProfileWithQuota } from '../core/types.ts';
import {
  formatActiveStatus,
  formatHelp,
  formatProfileTable,
  type ProfileListEntry,
} from './format.ts';
import { pickProfileInteractive, type PickerResult } from './picker.ts';

export const CLI_VERSION = '0.1.0';

export interface ParsedCliArgs {
  command?: string;
  positionals: string[];
  flags: {
    help: boolean;
    version: boolean;
    force: boolean;
    json: boolean;
    noQuota: boolean;
    dryRun: boolean;
  };
}

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
}

export interface CliDependencies {
  profileService?: ProfileService;
  client?: CloudCodeClient;
  io?: CliIo;
  picker?: (entries: ProfileListEntry[]) => Promise<PickerResult>;
}

/**
 * Parses CLI argv into command, positional arguments, and typed flags.
 */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags = {
    help: false,
    version: false,
    force: false,
    json: false,
    noQuota: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') flags.help = true;
    else if (arg === '-v' || arg === '--version') flags.version = true;
    else if (arg === '-f' || arg === '--force') flags.force = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--no-quota') flags.noQuota = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else positionals.push(arg);
  }

  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

async function loadListEntries(
  service: ProfileService,
  options: { fetchQuota: boolean; client?: CloudCodeClient }
): Promise<ProfileListEntry[]> {
  const summaries = await service.listProfiles();
  if (!options.fetchQuota) {
    return summaries;
  }

  const fetchOne = async (summary: (typeof summaries)[number]): Promise<ProfileListEntry> => {
    try {
      const quota = await service.getProfileQuota(summary.alias, options.client);
      return {
        ...summary,
        tier: quota.tierDisplayName,
        quota,
      };
    } catch (err) {
      return {
        ...summary,
        quotaError: (err as Error).message,
      };
    }
  };

  // A shared injected client mutates its active token per profile, so keep it sequential;
  // production calls create one isolated CloudCodeClient per profile and run in parallel.
  if (options.client) {
    const entries: ProfileListEntry[] = [];
    for (const summary of summaries) {
      entries.push(await fetchOne(summary));
    }
    return entries;
  }

  return Promise.all(summaries.map(fetchOne));
}

/**
 * Executes an `agy-switcher` CLI invocation and returns the process exit code.
 */
export async function runCli(argv: string[], deps?: CliDependencies): Promise<number> {
  const io: CliIo = deps?.io ?? {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  };

  const parsed = parseCliArgs(argv);

  if (parsed.flags.version) {
    io.stdout(`agy-switcher v${CLI_VERSION}\n`);
    return 0;
  }

  if (parsed.flags.help || (!parsed.command && !io.isTTY)) {
    io.stdout(formatHelp());
    return 0;
  }

  const service = deps?.profileService ?? new ProfileService();
  const client = deps?.client;

  try {
    if (!parsed.command) {
      const entries = await loadListEntries(service, {
        fetchQuota: !parsed.flags.noQuota,
        client,
      });
      if (entries.length === 0) {
        io.stdout(formatProfileTable(entries));
        return 0;
      }

      const pick = deps?.picker ?? ((list) => pickProfileInteractive(list));
      const choice = await pick(entries);
      if (choice.action === 'cancel') {
        return 0;
      }
      if (choice.action === 'best') {
        return runBestCommand(service, client, false, io);
      }
      await service.useProfile(choice.alias);
      io.stdout(`Switched active profile to '${choice.alias}'\n`);
      return 0;
    }

    switch (parsed.command) {
      case 'save': {
        const alias = parsed.positionals[0];
        if (!alias) {
          io.stderr('Error: missing required argument: alias\n');
          return 1;
        }
        try {
          const saved = await service.saveProfile(alias, { force: parsed.flags.force });
          const emailSuffix = saved.email ? ` (${saved.email})` : '';
          io.stdout(`Saved current profile as '${saved.alias}'${emailSuffix}\n`);
          return 0;
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('No active profile found')) {
            io.stderr('Error: No active Antigravity profile found in Keychain to save\n');
            return 1;
          }
          throw err;
        }
      }

      case 'ls':
      case 'list': {
        const entries = await loadListEntries(service, {
          fetchQuota: !parsed.flags.noQuota,
          client,
        });
        if (parsed.flags.json) {
          io.stdout(`${JSON.stringify(entries, null, 2)}\n`);
        } else {
          io.stdout(formatProfileTable(entries));
        }
        return 0;
      }

      case 'use':
      case 'switch': {
        const alias = parsed.positionals[0];
        if (!alias) {
          io.stderr('Error: missing required argument: alias\n');
          return 1;
        }
        await service.useProfile(alias);
        io.stdout(`Switched active profile to '${alias}'\n`);
        return 0;
      }

      case 'best':
        return runBestCommand(service, client, parsed.flags.dryRun, io);

      case 'rm':
      case 'remove': {
        const alias = parsed.positionals[0];
        if (!alias) {
          io.stderr('Error: missing required argument: alias\n');
          return 1;
        }
        const deleted = await service.deleteProfile(alias);
        if (!deleted) {
          io.stderr(`Error: Profile '${alias}' not found in Keychain\n`);
          return 1;
        }
        io.stdout(`Removed profile '${alias}'\n`);
        return 0;
      }

      case 'status': {
        const active = await service.getActiveProfile();
        if (!active) {
          io.stdout(formatActiveStatus(null));
          return 0;
        }
        const profiles = await service.listProfiles();
        const activeSummary = profiles.find((p) => p.isActive);
        let quota;
        if (activeSummary && !parsed.flags.noQuota) {
          quota = await service.getProfileQuota(activeSummary.alias, client).catch(() => undefined);
        }
        if (parsed.flags.json) {
          io.stdout(
            `${JSON.stringify({ email: active.email, alias: activeSummary?.alias, quota }, null, 2)}\n`
          );
        } else {
          io.stdout(formatActiveStatus(active, activeSummary?.alias, quota));
        }
        return 0;
      }

      default:
        io.stderr(`Error: unknown command '${parsed.command}'\n`);
        return 1;
    }
  } catch (err) {
    io.stderr(`Error: ${(err as Error).message}\n`);
    return 1;
  }
}

async function runBestCommand(
  service: ProfileService,
  client: CloudCodeClient | undefined,
  dryRun: boolean,
  io: CliIo
): Promise<number> {
  const entries = await loadListEntries(service, { fetchQuota: true, client });
  if (entries.length === 0) {
    io.stderr('Error: No profiles configured\n');
    return 1;
  }

  const scorable: ProfileWithQuota[] = entries.map((e) => ({
    alias: e.alias,
    email: e.email,
    isActive: e.isActive,
    quota: e.quota,
  }));

  const ranked = rankProfiles(scorable);
  const top = ranked[0];
  if (!top) {
    io.stderr('Error: No profiles available to select\n');
    return 1;
  }

  if (dryRun) {
    io.stdout(`Selected '${top.alias}' as best profile (score: ${top.score.toFixed(1)}) [dry-run]\n`);
    return 0;
  }

  await service.useProfile(top.alias);
  io.stdout(
    `Selected '${top.alias}' as best profile (score: ${top.score.toFixed(1)})\n` +
      `Switched active profile to '${top.alias}'\n`
  );
  return 0;
}
