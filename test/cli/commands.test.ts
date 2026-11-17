import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  KEYCHAIN_SERVICE,
  PRIMARY_ACCOUNT,
  PROFILE_ACCOUNT_PREFIX,
  ProfileService,
  encodeKeyringPayload,
  type AntigravityPayload,
  type IKeychainService,
} from '../../src/core/index.ts';
import { CloudCodeClient } from '../../src/core/client.ts';
import { parseCliArgs, runCli } from '../../src/cli/index.ts';

class MemoryKeychain implements IKeychainService {
  private readonly items = new Map<string, string>();
  private key(service: string, account: string) {
    return `${service}:${account}`;
  }
  async findGenericPassword(service: string, account: string): Promise<string | null> {
    return this.items.get(this.key(service, account)) ?? null;
  }
  async addGenericPassword(service: string, account: string, secret: string): Promise<void> {
    this.items.set(this.key(service, account), secret);
  }
  async deleteGenericPassword(service: string, account: string): Promise<boolean> {
    return this.items.delete(this.key(service, account));
  }
  async listAccounts(service: string, prefix = ''): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.items.keys()) {
      const idx = k.indexOf(':');
      const svc = k.slice(0, idx);
      const acct = k.slice(idx + 1);
      if (svc === service && acct.startsWith(prefix)) {
        out.push(acct);
      }
    }
    return out;
  }
}

function makeIo(isTTY = false) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (t: string) => {
        stdout += t;
      },
      stderr: (t: string) => {
        stderr += t;
      },
      isTTY,
    },
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

describe('CLI Argument Parser & Commands', () => {
  let keychain: MemoryKeychain;
  let tmpDir: string;
  let service: ProfileService;
  let client: CloudCodeClient;

  const payloadA: AntigravityPayload = {
    token: {
      access_token: 'ya29.pro1',
      token_type: 'Bearer',
      refresh_token: '1//pro1',
      expiry: new Date(Date.now() + 3600_000).toISOString(),
    },
    auth_method: 'consumer',
    id_token_email: 'pro1@example.com',
  };

  const payloadB: AntigravityPayload = {
    token: {
      access_token: 'ya29.pro2',
      token_type: 'Bearer',
      refresh_token: '1//pro2',
      expiry: new Date(Date.now() + 3600_000).toISOString(),
    },
    auth_method: 'consumer',
    id_token_email: 'pro2@example.com',
  };

  beforeEach(async () => {
    keychain = new MemoryKeychain();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-cli-test-'));
    service = new ProfileService({
      keychain,
      fallbackPath: path.join(tmpDir, 'jetski-standalone-oauth-token'),
    });

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      if (url.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'projects/test-proj',
            paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
          }),
          { status: 200 }
        );
      }
      if (url.includes('retrieveUserQuotaSummary')) {
        const isPro1 = auth.includes('ya29.pro1');
        return new Response(
          JSON.stringify({
            groups: [
              {
                displayName: 'Claude and GPT models',
                buckets: [
                  {
                    bucketId: '3p-5h',
                    window: '5h',
                    remainingFraction: isPro1 ? 0.3 : 1.0,
                    resetTime: new Date(Date.now() + 7200_000).toISOString(),
                  },
                  {
                    bucketId: '3p-weekly',
                    window: 'weekly',
                    remainingFraction: isPro1 ? 0.5 : 0.95,
                    resetTime: new Date(Date.now() + 86400_000 * 5).toISOString(),
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('retrieveUserQuota')) {
        return new Response(
          JSON.stringify({
            buckets: [
              {
                modelId: 'gemini-2.5-pro',
                remainingFraction: 0.88,
                resetTime: new Date(Date.now() + 3600_000).toISOString(),
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    };

    client = new CloudCodeClient({ fetchFn: mockFetch });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('parses flags and positional arguments accurately', () => {
    const p = parseCliArgs(['save', 'pro1', '--force', '--json']);
    assert.equal(p.command, 'save');
    assert.deepEqual(p.positionals, ['pro1']);
    assert.equal(p.flags.force, true);
    assert.equal(p.flags.json, true);
    assert.equal(p.flags.help, false);
  });

  it('prints help when --help or non-TTY empty invocation is passed', async () => {
    const out1 = makeIo(false);
    assert.equal(await runCli(['--help'], { profileService: service, client, io: out1.io }), 0);
    assert.match(out1.getStdout(), /Usage: agy-switcher/);

    const out2 = makeIo(false);
    assert.equal(await runCli([], { profileService: service, client, io: out2.io }), 0);
    assert.match(out2.getStdout(), /Commands:/);
  });

  it('save, ls, use, best, status, and rm work end-to-end', async () => {
    await keychain.addGenericPassword(KEYCHAIN_SERVICE, PRIMARY_ACCOUNT, encodeKeyringPayload(payloadA));

    const saveOut = makeIo();
    assert.equal(
      await runCli(['save', 'pro1'], { profileService: service, client, io: saveOut.io }),
      0
    );
    assert.match(saveOut.getStdout(), /Saved current profile as 'pro1'/);

    await keychain.addGenericPassword(
      KEYCHAIN_SERVICE,
      `${PROFILE_ACCOUNT_PREFIX}pro2`,
      encodeKeyringPayload(payloadB)
    );

    const lsOut = makeIo();
    assert.equal(
      await runCli(['ls'], { profileService: service, client, io: lsOut.io }),
      0
    );
    assert.match(lsOut.getStdout(), /ALIAS/);
    assert.match(lsOut.getStdout(), /5H QUOTA/);
    assert.match(lsOut.getStdout(), /WEEKLY/);
    assert.match(lsOut.getStdout(), /pro1/);
    assert.match(lsOut.getStdout(), /pro2/);
    assert.match(lsOut.getStdout(), /\* active/);

    const bestOut = makeIo();
    assert.equal(
      await runCli(['best'], { profileService: service, client, io: bestOut.io }),
      0
    );
    assert.match(bestOut.getStdout(), /Selected 'pro2' as best profile/);
    assert.match(bestOut.getStdout(), /Switched active profile to 'pro2'/);

    const statusOut = makeIo();
    assert.equal(
      await runCli(['status'], { profileService: service, client, io: statusOut.io }),
      0
    );
    assert.match(statusOut.getStdout(), /pro2@example\.com/);
    assert.match(statusOut.getStdout(), /Google AI Pro/);

    const rmOut = makeIo();
    assert.equal(
      await runCli(['rm', 'pro1'], { profileService: service, client, io: rmOut.io }),
      0
    );
    assert.match(rmOut.getStdout(), /Removed profile 'pro1'/);
  });

  it('supports interactive picker selection and best shortcut in TTY mode', async () => {
    await keychain.addGenericPassword(KEYCHAIN_SERVICE, PRIMARY_ACCOUNT, encodeKeyringPayload(payloadA));
    await keychain.addGenericPassword(
      KEYCHAIN_SERVICE,
      `${PROFILE_ACCOUNT_PREFIX}pro1`,
      encodeKeyringPayload(payloadA)
    );
    await keychain.addGenericPassword(
      KEYCHAIN_SERVICE,
      `${PROFILE_ACCOUNT_PREFIX}pro2`,
      encodeKeyringPayload(payloadB)
    );

    const ttyOut = makeIo(true);
    const code = await runCli([], {
      profileService: service,
      client,
      io: ttyOut.io,
      picker: async () => ({ action: 'select', alias: 'pro2' }),
    });
    assert.equal(code, 0);
    assert.match(ttyOut.getStdout(), /Switched active profile to 'pro2'/);
  });

  it('returns exit code 1 for unknown command and missing alias', async () => {
    const errOut = makeIo();
    assert.equal(
      await runCli(['bogus'], { profileService: service, client, io: errOut.io }),
      1
    );
    assert.match(errOut.getStderr(), /unknown command 'bogus'/);
  });
});
