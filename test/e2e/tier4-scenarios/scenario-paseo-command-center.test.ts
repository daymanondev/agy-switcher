import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 4 Scenario 4: Paseo Desktop Command Center 1-Click Best Switch', () => {
  let ctx: TestContext;
  const payloadWork = {
    token: { access_token: 'ya29.work', refresh_token: '1//work', token_type: 'Bearer' },
    id_token_email: 'lead@enterprise.com',
  };
  const payloadPersonal = {
    token: { access_token: 'ya29.personal', refresh_token: '1//personal', token_type: 'Bearer' },
    id_token_email: 'coder@personal.net',
  };

  const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadWork)).toString('base64')}`;
  const rawPersonal = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadPersonal)).toString('base64')}`;

  beforeEach(async () => {
    ctx = await createTestContext();
    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawWork);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawPersonal);
    ctx.keychain.setItem('gemini', 'antigravity', rawWork);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('Step 1: Paseo Desktop lists profiles via agy.profiles.list RPC contract', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.list');
    assert.equal(res.ok, true);
    assert.equal(res.profiles.length, 2);
    assert.equal(res.profiles.find((p: any) => p.alias === 'work').isActive, true);
  });

  it('Step 2: Command Center receives 1-click action "agy-switcher-switch-best"', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.switch_best');
    assert.equal(res.ok, true);
    assert.ok(res.activeProfile);
  });

  it('Step 3: verifies Keychain primary slot gemini:antigravity reflects the chosen profile', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.switch_best');
    assert.equal(res.ok, true);

    const activeRaw = ctx.keychain.getItem('gemini', 'antigravity');
    assert.ok(activeRaw);
    assert.ok(activeRaw.includes('go-keyring-base64:'));
  });

  it('Step 4: verifies fallback token file ~/.gemini/jetski-standalone-oauth-token is synced with 0600 mode', async () => {
    await ctx.cli.runPluginRpc('agy.profiles.switch_best');

    assert.equal(ctx.fs.existsFallback(), true);
    assert.equal(ctx.fs.getFallbackFileMode(), 0o600);
    const content = ctx.fs.readFallback();
    assert.ok(['lead@enterprise.com', 'coder@personal.net'].includes(content.id_token_email));
  });

  it('Step 5: Command Center list query reflects new active profile on next render cycle', async () => {
    await ctx.cli.runPluginRpc('agy.profiles.switch', { alias: 'personal' });

    const listRes = await ctx.cli.runPluginRpc('agy.profiles.list');
    assert.equal(listRes.ok, true);
    const personal = listRes.profiles.find((p: any) => p.alias === 'personal');
    const work = listRes.profiles.find((p: any) => p.alias === 'work');

    assert.equal(personal.isActive, true);
    assert.equal(work.isActive, false);
  });
});
