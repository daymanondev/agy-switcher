import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 3: Cross-Feature: CLI & Paseo Plugin State Consistency', () => {
  let ctx: TestContext;
  const payloadWork = {
    token: { access_token: 'ya29.work', refresh_token: '1//work', token_type: 'Bearer' },
    id_token_email: 'work@domain.com',
  };
  const payloadPersonal = {
    token: { access_token: 'ya29.personal', refresh_token: '1//personal', token_type: 'Bearer' },
    id_token_email: 'personal@domain.com',
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

  it('1. CLI switches profile and Paseo plugin RPC list reflects the new active profile', async () => {
    await ctx.cli.run(['use', 'personal']);

    const rpcRes = await ctx.cli.runPluginRpc('agy.profiles.list');
    assert.equal(rpcRes.ok, true);
    const personal = rpcRes.profiles.find((p: any) => p.alias === 'personal');
    const work = rpcRes.profiles.find((p: any) => p.alias === 'work');

    assert.equal(personal.isActive, true);
    assert.equal(work.isActive, false);
  });

  it('2. Paseo plugin switches profile and CLI ls reflects the new active profile', async () => {
    const rpcRes = await ctx.cli.runPluginRpc('agy.profiles.switch', { alias: 'personal' });
    assert.equal(rpcRes.ok, true);

    const lsRes = await ctx.cli.run(['ls']);
    assert.equal(lsRes.exitCode, 0);

    const lines = lsRes.stdout.split('\n');
    const personalLine = lines.find((l) => l.includes('personal'));
    const workLine = lines.find((l) => l.includes('work'));

    assert.ok(personalLine?.includes('* active'));
    assert.ok(!workLine?.includes('* active'));
  });

  it('3. CLI saves new profile and Paseo plugin list includes the new profile', async () => {
    const payloadNew = {
      token: { access_token: 'ya29.new', refresh_token: '1//new', token_type: 'Bearer' },
      id_token_email: 'newbie@domain.com',
    };
    ctx.keychain.setItem('gemini', 'antigravity', `go-keyring-base64:${Buffer.from(JSON.stringify(payloadNew)).toString('base64')}`);

    await ctx.cli.run(['save', 'newbie']);

    const rpcRes = await ctx.cli.runPluginRpc('agy.profiles.list');
    assert.equal(rpcRes.ok, true);
    const newbie = rpcRes.profiles.find((p: any) => p.alias === 'newbie');
    assert.ok(newbie);
    assert.equal(newbie.email, 'newbie@domain.com');
  });

  it('4. CLI removes profile and Paseo plugin list excludes it', async () => {
    await ctx.cli.run(['rm', 'personal']);

    const rpcRes = await ctx.cli.runPluginRpc('agy.profiles.list');
    assert.equal(rpcRes.ok, true);
    const personal = rpcRes.profiles.find((p: any) => p.alias === 'personal');
    assert.equal(personal, undefined);
  });

  it('5. Both CLI and Paseo plugin read the identical active credentials and fallback file', async () => {
    await ctx.cli.runPluginRpc('agy.profiles.switch', { alias: 'personal' });

    const activeKeychain = ctx.keychain.getItem('gemini', 'antigravity');
    const fallbackFile = ctx.fs.readFallback();

    assert.equal(activeKeychain, rawPersonal);
    assert.equal(fallbackFile.id_token_email, 'personal@domain.com');
    assert.equal(fallbackFile.token.access_token, 'ya29.personal');
  });
});
