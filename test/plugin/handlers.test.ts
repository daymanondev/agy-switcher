import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import {
  KEYCHAIN_SERVICE,
  PRIMARY_ACCOUNT,
  PROFILE_ACCOUNT_PREFIX,
  ProfileService,
  encodeKeyringPayload,
  type AntigravityPayload,
  type IKeychainService,
} from '../../plugin/server/core/index.ts';
import { CloudCodeClient } from '../../plugin/server/core/client.ts';
import { createPluginHandlers } from '../../plugin/server/handlers.ts';
import serverContribute from '../../plugin/index.server.ts';

class MemoryKeychain implements IKeychainService {
  private readonly items = new Map<string, string>();
  async findGenericPassword(service: string, account: string) {
    return this.items.get(`${service}:${account}`) ?? null;
  }
  async addGenericPassword(service: string, account: string, secret: string) {
    this.items.set(`${service}:${account}`, secret);
  }
  async deleteGenericPassword(service: string, account: string) {
    return this.items.delete(`${service}:${account}`);
  }
  async listAccounts(service: string, prefix = '') {
    const out: string[] = [];
    for (const k of this.items.keys()) {
      const idx = k.indexOf(':');
      if (k.slice(0, idx) === service && k.slice(idx + 1).startsWith(prefix)) {
        out.push(k.slice(idx + 1));
      }
    }
    return out;
  }
}

describe('Paseo Plugin Manifest, Contributions & Handlers', () => {
  let keychain: MemoryKeychain;
  let tmpDir: string;
  let service: ProfileService;
  let client: CloudCodeClient;

  const payloadA: AntigravityPayload = {
    token: {
      access_token: 'ya29.work',
      token_type: 'Bearer',
      refresh_token: '1//work',
      expiry: new Date(Date.now() + 3600_000).toISOString(),
    },
    id_token_email: 'work@company.com',
  };

  const payloadB: AntigravityPayload = {
    token: {
      access_token: 'ya29.personal',
      token_type: 'Bearer',
      refresh_token: '1//personal',
      expiry: new Date(Date.now() + 3600_000).toISOString(),
    },
    id_token_email: 'personal@gmail.com',
  };

  beforeEach(async () => {
    keychain = new MemoryKeychain();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-plugin-test-'));
    service = new ProfileService({
      keychain,
      fallbackPath: path.join(tmpDir, 'jetski-standalone-oauth-token'),
    });

    client = new CloudCodeClient({
      fetchFn: async (input, init) => {
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
          const isPersonal = auth.includes('ya29.personal');
          return new Response(
            JSON.stringify({
              groups: [
                {
                  displayName: 'Claude & GPT',
                  buckets: [
                    {
                      bucketId: '3p-5h',
                      window: '5h',
                      remainingFraction: isPersonal ? 0.95 : 0.4,
                      resetTime: new Date(Date.now() + 3600_000).toISOString(),
                    },
                    {
                      bucketId: '3p-weekly',
                      window: 'weekly',
                      remainingFraction: isPersonal ? 0.9 : 0.6,
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
                  remainingFraction: 0.85,
                  resetTime: new Date(Date.now() + 3600_000).toISOString(),
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response('not found', { status: 404 });
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('manifest matches Paseo plugin schema requirements', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../plugin/paseo-plugin.json'), 'utf8')
    );
    assert.equal(manifest.id, 'agy-switcher');
    assert.ok(manifest.description.length > 0);
    assert.equal(manifest.requirements.paseo, '>=0.13.0');
  });

  it('registers all 5 RPC contracts on server contribute()', () => {
    const registered: string[] = [];
    const cleanup = serverContribute({
      handle(contract: { name: string }) {
        registered.push(contract.name);
      },
    } as never);

    assert.deepEqual(registered, [
      'agy.profiles.list',
      'agy.profiles.switch',
      'agy.profiles.switch_best',
      'agy.profiles.save_current',
      'agy.profiles.remove',
    ]);
    assert.equal(typeof cleanup, 'function');
    cleanup();
  });

  it('registers settings, screen, workspace panel, and command center items on client contribute()', () => {
    const clientEntry = path.resolve(import.meta.dirname, '../../plugin/index.client.tsx');
    const result = buildSync({
      entryPoints: [clientEntry],
      bundle: true,
      format: 'cjs',
      jsx: 'automatic',
      platform: 'neutral',
      target: 'es2020',
      external: ['@getpaseo/plugin', '@getpaseo/plugin/*', 'react', 'react/jsx-runtime', 'react-native', 'zod'],
      write: false,
    });
    const code = result.outputFiles[0].text;
    const mod = { exports: {} as { default?: (c: unknown) => () => void } };
    const hostRequire = createRequire(import.meta.url);
    vm.runInNewContext(code, {
      require: (id: string) => {
        if (id === '@getpaseo/plugin/client' || id === '@getpaseo/plugin/client/ui') {
          return { useRpc: () => async () => ({}), useToast: () => ({ show: () => {}, error: () => {} }), Icon: () => null, ScrollView: () => null, TextInput: () => null };
        }
        if (id === 'react-native') {
          return { ActivityIndicator: () => null, Pressable: () => null, Text: () => null, View: () => null };
        }
        if (id === '@getpaseo/plugin') return hostRequire('@getpaseo/plugin');
        if (id === 'zod') return hostRequire('zod');
        if (id === 'react' || id === 'react/jsx-runtime') return hostRequire(id);
        return hostRequire(id);
      },
      module: mod,
      exports: mod.exports,
      console,
    });

    const contributions: string[] = [];
    const cleanup = mod.exports.default!({
      addSettingsScreen(c: { id: string }) {
        contributions.push(`settings:${c.id}`);
        return () => {};
      },
      addScreen(c: { id: string }) {
        contributions.push(`screen:${c.id}`);
        return () => {};
      },
      addWorkspacePanel(c: { id: string }) {
        contributions.push(`panel:${c.id}`);
        return () => {};
      },
      addCommandCenterItem(c: { id: string }) {
        contributions.push(`cmd:${c.id}`);
        return () => {};
      },
    });

    assert.deepEqual(contributions, [
      'settings:agy-switcher',
      'screen:agy-switcher',
      'panel:agy-switcher-panel',
      'cmd:agy-switcher-open',
      'cmd:agy-switcher-switch-best',
    ]);
    cleanup();
  });

  it('handles list, saveCurrent, switchProfile, switchBest, and remove cleanly', async () => {
    await keychain.addGenericPassword(KEYCHAIN_SERVICE, PRIMARY_ACCOUNT, encodeKeyringPayload(payloadA));
    await keychain.addGenericPassword(
      KEYCHAIN_SERVICE,
      `${PROFILE_ACCOUNT_PREFIX}personal`,
      encodeKeyringPayload(payloadB)
    );

    const handlers = createPluginHandlers({ profileService: service, client });

    const saved = await handlers.saveCurrent({ alias: 'work' });
    assert.equal(saved.ok, true);

    const listed = await handlers.list({ fetchQuota: true });
    assert.equal(listed.ok, true);
    if (!listed.ok) throw new Error('expected ok');
    assert.equal(listed.profiles.length, 2);
    const work = listed.profiles.find((p) => p.alias === 'work');
    const personal = listed.profiles.find((p) => p.alias === 'personal');
    assert.equal(work?.isActive, true);
    assert.equal(personal?.isActive, false);
    assert.equal(personal?.claudeWeekly?.percentage, 90);

    const best = await handlers.switchBest();
    assert.equal(best.ok, true);
    if (!best.ok) throw new Error('expected ok');
    assert.equal(best.activeProfile, 'personal');

    const badSwitch = await handlers.switchProfile({ alias: '' });
    assert.equal(badSwitch.ok, false);

    const removed = await handlers.remove({ alias: 'work' });
    assert.equal(removed.ok, true);
  });
});
