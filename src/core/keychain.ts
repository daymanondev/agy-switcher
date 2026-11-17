import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AntigravityPayload } from './types.ts';
import { KeychainError, TokenParseError } from './errors.ts';

export const KEYRING_PREFIX = 'go-keyring-base64:';

export interface IKeychainService {
  findGenericPassword(service: string, account: string): Promise<string | null>;
  addGenericPassword(service: string, account: string, secret: string, updateExisting?: boolean): Promise<void>;
  deleteGenericPassword(service: string, account: string): Promise<boolean>;
  listAccounts(service: string, prefix?: string): Promise<string[]>;
}

export type ExecFileFunction = (
  file: string,
  args: readonly string[]
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile: ExecFileFunction = promisify(nodeExecFile);

/**
 * Extracts exit code from execFile errors.
 */
function getExitCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const errObj = error as { code?: unknown; status?: unknown };
  if (typeof errObj.code === 'number') {
    return errObj.code;
  }
  if (typeof errObj.status === 'number') {
    return errObj.status;
  }
  return undefined;
}

/**
 * Extracts stderr from execFile errors.
 */
function getStderr(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const errObj = error as { stderr?: unknown };
  if (typeof errObj.stderr === 'string') {
    return errObj.stderr;
  }
  return undefined;
}

/**
 * Parses security dump-keychain stdout to extract accounts belonging to targetService.
 */
export function parseDumpKeychainAccounts(dumpOutput: string, targetService: string, prefix = ''): string[] {
  const accounts: string[] = [];
  const entries = dumpOutput.split(/\n(?=class:\s*)/);

  for (const entry of entries) {
    if (!entry.includes('class: "genp"')) {
      continue;
    }

    // Match service attribute: "svce"<blob>="value" or 0x00000007 <blob>="value"
    // Also matches hex: <blob>=0x<hex>
    const serviceMatch = entry.match(/(?:"svce"|0x00000007)\s*<blob>=(?:"([^"]*)"|0x([0-9a-fA-F]+))/);
    if (!serviceMatch) {
      continue;
    }

    let service = serviceMatch[1];
    if (service === undefined && serviceMatch[2]) {
      service = Buffer.from(serviceMatch[2], 'hex').toString('utf8');
    }

    if (service !== targetService) {
      continue;
    }

    // Match account attribute: "acct"<blob>="value" or 0x00000008 <blob>="value"
    const acctMatch = entry.match(/(?:"acct"|0x00000008)\s*<blob>=(?:"([^"]*)"|0x([0-9a-fA-F]+))/);
    if (!acctMatch) {
      continue;
    }

    let acct = acctMatch[1];
    if (acct === undefined && acctMatch[2]) {
      acct = Buffer.from(acctMatch[2], 'hex').toString('utf8');
    }

    if (acct && acct.startsWith(prefix)) {
      accounts.push(acct);
    }
  }

  return Array.from(new Set(accounts));
}

/**
 * Serializes AntigravityPayload into go-keyring-base64 format.
 */
export function encodeKeyringPayload(payload: AntigravityPayload): string {
  const jsonStr = JSON.stringify(payload);
  const base64Str = Buffer.from(jsonStr, 'utf8').toString('base64');
  return `${KEYRING_PREFIX}${base64Str}`;
}

/**
 * Parses go-keyring-base64 string or plain JSON into AntigravityPayload.
 */
export function parseKeyringPayload(raw: string): AntigravityPayload {
  if (!raw || typeof raw !== 'string') {
    throw new TokenParseError('Empty or invalid payload string', String(raw));
  }

  const trimmed = raw.trim();
  let jsonString = trimmed;

  if (trimmed.startsWith(KEYRING_PREFIX)) {
    const base64Part = trimmed.slice(KEYRING_PREFIX.length);
    try {
      jsonString = Buffer.from(base64Part, 'base64').toString('utf8');
    } catch (err) {
      throw new TokenParseError(`Failed to decode base64 payload: ${(err as Error).message}`, raw);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new TokenParseError(`Failed to parse JSON payload: ${(err as Error).message}`, raw);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new TokenParseError('Payload must be a valid JSON object', raw);
  }

  const payload = parsed as AntigravityPayload;
  if (!payload.token || typeof payload.token !== 'object') {
    throw new TokenParseError('Payload missing token object', raw);
  }

  if (
    typeof payload.token.access_token !== 'string' ||
    typeof payload.token.refresh_token !== 'string'
  ) {
    throw new TokenParseError('Payload token missing access_token or refresh_token', raw);
  }

  return payload;
}

export class MacKeychainService implements IKeychainService {
  private readonly securityBin: string;
  private readonly execFileFn: ExecFileFunction;

  constructor(options?: { securityBin?: string; execFileFn?: ExecFileFunction }) {
    this.securityBin = options?.securityBin ?? '/usr/bin/security';
    this.execFileFn = options?.execFileFn ?? defaultExecFile;
  }

  /**
   * Reads generic password secret using `find-generic-password -w`.
   * Exit code 44 (errSecItemNotFound) cleanly returns null without throwing.
   */
  async findGenericPassword(service: string, account: string): Promise<string | null> {
    const args = ['find-generic-password', '-s', service, '-a', account, '-w'];
    try {
      const { stdout } = await this.execFileFn(this.securityBin, args);
      return stdout.trim();
    } catch (error) {
      const exitCode = getExitCode(error);
      if (exitCode === 44) {
        return null;
      }
      const stderr = getStderr(error);
      const command = `${this.securityBin} ${args.join(' ')}`;
      throw new KeychainError(
        `Failed to find generic password for service="${service}", account="${account}": ${stderr || (error as Error).message}`,
        exitCode,
        stderr,
        command
      );
    }
  }

  /**
   * Writes generic password using `add-generic-password` with `-U` for atomic upsert.
   */
  async addGenericPassword(
    service: string,
    account: string,
    secret: string,
    updateExisting = true
  ): Promise<void> {
    const args = updateExisting
      ? ['add-generic-password', '-U', '-s', service, '-a', account, '-w', secret]
      : ['add-generic-password', '-s', service, '-a', account, '-w', secret];

    try {
      await this.execFileFn(this.securityBin, args);
    } catch (error) {
      const exitCode = getExitCode(error);
      const stderr = getStderr(error);
      const command = `${this.securityBin} ${args.slice(0, -1).join(' ')} <secret-redacted>`;
      throw new KeychainError(
        `Failed to add generic password for service="${service}", account="${account}": ${stderr || (error as Error).message}`,
        exitCode,
        stderr,
        command
      );
    }
  }

  /**
   * Deletes generic password using `delete-generic-password`.
   * Returns true on exit code 0, false on exit code 44.
   */
  async deleteGenericPassword(service: string, account: string): Promise<boolean> {
    const args = ['delete-generic-password', '-s', service, '-a', account];
    try {
      await this.execFileFn(this.securityBin, args);
      return true;
    } catch (error) {
      const exitCode = getExitCode(error);
      if (exitCode === 44) {
        return false;
      }
      const stderr = getStderr(error);
      const command = `${this.securityBin} ${args.join(' ')}`;
      throw new KeychainError(
        `Failed to delete generic password for service="${service}", account="${account}": ${stderr || (error as Error).message}`,
        exitCode,
        stderr,
        command
      );
    }
  }

  /**
   * Scans dump-keychain to find accounts matching service and prefix.
   */
  async listAccounts(service: string, prefix = ''): Promise<string[]> {
    const args = ['dump-keychain'];
    try {
      const { stdout } = await this.execFileFn(this.securityBin, args);
      return parseDumpKeychainAccounts(stdout, service, prefix);
    } catch (error) {
      const exitCode = getExitCode(error);
      const stderr = getStderr(error);
      const command = `${this.securityBin} dump-keychain`;
      throw new KeychainError(
        `Failed to list keychain accounts for service="${service}": ${stderr || (error as Error).message}`,
        exitCode,
        stderr,
        command
      );
    }
  }
}
