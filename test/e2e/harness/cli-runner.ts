import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MacKeychainService } from '../../../plugin/server/core/keychain.ts';
import { ProfileService } from '../../../plugin/server/core/profile.ts';
import { CloudCodeClient } from '../../../plugin/server/core/client.ts';
import { createPluginHandlers } from '../../../plugin/server/handlers.ts';
import type { MockKeychain } from './mock-keychain.ts';
import type { MockCloudCodeServer } from './mock-cloudcode-server.ts';
import type { MockFs } from './mock-fs.ts';

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CliRunner {
  private readonly projectRoot: string;
  private readonly mockKeychain: MockKeychain;
  private readonly mockServer: MockCloudCodeServer;
  private readonly mockFs: MockFs;

  constructor(mockKeychain: MockKeychain, mockServer: MockCloudCodeServer, mockFs: MockFs) {
    this.projectRoot = path.resolve(import.meta.dirname, '../../..');
    this.mockKeychain = mockKeychain;
    this.mockServer = mockServer;
    this.mockFs = mockFs;
  }

  public async run(
    args: string[],
    options?: { env?: NodeJS.ProcessEnv; stdin?: string }
  ): Promise<CliRunResult> {
    const binPath = path.join(this.projectRoot, 'bin', 'agy-switcher.mjs');
    if (!fs.existsSync(binPath)) {
      throw new Error(`Real CLI entrypoint missing at ${binPath}`);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: this.mockFs.getHomeDir(),
      AGY_SECURITY_BIN: this.mockKeychain.getSecurityBinPath(),
      AGY_MOCK_KEYCHAIN_DB: this.mockKeychain.getDbPath(),
      AGY_API_BASE_URL: this.mockServer.getBaseUrl(),
      AGY_TOKEN_URL: `${this.mockServer.getBaseUrl()}/token`,
      AGY_OAUTH_CLIENT_ID: 'test-oauth-client-id',
      AGY_OAUTH_CLIENT_SECRET: 'test-oauth-client-secret',
      PATH: `${this.mockKeychain.getBinDir()}:${process.env.PATH || ''}`,
      ...(options?.env || {}),
    };

    return new Promise<CliRunResult>((resolve) => {
      const proc = spawn(process.execPath, [binPath, ...args], {
        env,
        cwd: this.projectRoot,
      });

      let stdout = '';
      let stderr = '';

      if (options?.stdin) {
        proc.stdin.write(options.stdin);
        proc.stdin.end();
      }

      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
        });
      });

      proc.on('error', (err) => {
        resolve({
          exitCode: 1,
          stdout,
          stderr: err.message,
        });
      });
    });
  }

  public async runPluginRpc(method: string, params?: Record<string, unknown>): Promise<any> {
    const keychain = new MacKeychainService({
      securityBin: this.mockKeychain.getSecurityBinPath(),
    });
    const profileService = new ProfileService({
      keychain,
      fallbackPath: this.mockFs.getFallbackTokenPath(),
    });
    const client = new CloudCodeClient({
      baseUrl: this.mockServer.getBaseUrl(),
      tokenUrl: `${this.mockServer.getBaseUrl()}/token`,
    });
    const handlers = createPluginHandlers({ profileService, client });

    switch (method) {
      case 'agy.profiles.list':
        return handlers.list(params as { fetchQuota?: boolean } | undefined);
      case 'agy.profiles.switch':
        return handlers.switchProfile(params as { alias?: unknown } | undefined);
      case 'agy.profiles.switch_best':
      case 'agy.profiles.switchBest':
        return handlers.switchBest();
      case 'agy.profiles.save_current':
        return handlers.saveCurrent(params as { alias?: unknown; force?: boolean } | undefined);
      case 'agy.profiles.remove':
        return handlers.remove(params as { alias?: unknown } | undefined);
      default:
        return { ok: false, error: `Unknown RPC method '${method}'` };
    }
  }
}
