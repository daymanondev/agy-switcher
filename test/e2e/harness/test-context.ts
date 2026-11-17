import { MockKeychain } from './mock-keychain.ts';
import { MockCloudCodeServer } from './mock-cloudcode-server.ts';
import { MockFs } from './mock-fs.ts';
import { CliRunner } from './cli-runner.ts';

export interface TestContext {
  keychain: MockKeychain;
  server: MockCloudCodeServer;
  fs: MockFs;
  cli: CliRunner;
  reset(): Promise<void>;
  teardown(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const keychain = new MockKeychain();
  const server = new MockCloudCodeServer();
  const serverUrl = await server.start();
  const fs = new MockFs();
  const cli = new CliRunner(keychain, server, fs);

  const origEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    AGY_SECURITY_BIN: process.env.AGY_SECURITY_BIN,
    AGY_MOCK_KEYCHAIN_DB: process.env.AGY_MOCK_KEYCHAIN_DB,
    AGY_API_BASE_URL: process.env.AGY_API_BASE_URL,
    AGY_TOKEN_URL: process.env.AGY_TOKEN_URL,
  };

  process.env.HOME = fs.getHomeDir();
  process.env.AGY_SECURITY_BIN = keychain.getSecurityBinPath();
  process.env.AGY_MOCK_KEYCHAIN_DB = keychain.getDbPath();
  process.env.AGY_API_BASE_URL = serverUrl;
  process.env.AGY_TOKEN_URL = `${serverUrl}/token`;
  process.env.PATH = `${keychain.getBinDir()}:${process.env.PATH || ''}`;

  return {
    keychain,
    server,
    fs,
    cli,
    async reset() {
      keychain.clear();
      server.resetToDefaults();
      fs.removeFallback();
    },
    async teardown() {
      await server.stop();
      keychain.cleanup();
      fs.cleanup();

      // Restore env
      if (origEnv.HOME !== undefined) process.env.HOME = origEnv.HOME;
      else delete process.env.HOME;

      if (origEnv.PATH !== undefined) process.env.PATH = origEnv.PATH;
      else delete process.env.PATH;

      if (origEnv.AGY_SECURITY_BIN !== undefined) process.env.AGY_SECURITY_BIN = origEnv.AGY_SECURITY_BIN;
      else delete process.env.AGY_SECURITY_BIN;

      if (origEnv.AGY_MOCK_KEYCHAIN_DB !== undefined) process.env.AGY_MOCK_KEYCHAIN_DB = origEnv.AGY_MOCK_KEYCHAIN_DB;
      else delete process.env.AGY_MOCK_KEYCHAIN_DB;

      if (origEnv.AGY_API_BASE_URL !== undefined) process.env.AGY_API_BASE_URL = origEnv.AGY_API_BASE_URL;
      else delete process.env.AGY_API_BASE_URL;

      if (origEnv.AGY_TOKEN_URL !== undefined) process.env.AGY_TOKEN_URL = origEnv.AGY_TOKEN_URL;
      else delete process.env.AGY_TOKEN_URL;
    },
  };
}
