import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 1: Paseo Plugin RPC Contracts', () => {
  let ctx: TestContext;
  const payloadWork = {
    token: { access_token: 'ya29.work', refresh_token: '1//work', token_type: 'Bearer' },
    id_token_email: 'work@company.com',
  };
  const payloadPersonal = {
    token: { access_token: 'ya29.personal', refresh_token: '1//personal', token_type: 'Bearer' },
    id_token_email: 'personal@gmail.com',
  };

  beforeEach(async () => {
    ctx = await createTestContext();
    const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadWork)).toString('base64')}`;
    const rawPersonal = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadPersonal)).toString('base64')}`;

    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawWork);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawPersonal);
    ctx.keychain.setItem('gemini', 'antigravity', rawWork);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. agy.profiles.list returns profile list with active indicator', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.list');
    assert.equal(res.ok, true);
    assert.equal(res.profiles.length, 2);

    const work = res.profiles.find((p: any) => p.alias === 'work');
    const personal = res.profiles.find((p: any) => p.alias === 'personal');

    assert.ok(work);
    assert.equal(work.isActive, true);
    assert.equal(work.email, 'work@company.com');

    assert.ok(personal);
    assert.equal(personal.isActive, false);
    assert.equal(personal.email, 'personal@gmail.com');
  });

  it('2. agy.profiles.switch activates target profile and syncs fallback', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.switch', { alias: 'personal' });
    assert.equal(res.ok, true);
    assert.equal(res.activeProfile, 'personal');

    // Verify fallback file was updated
    assert.equal(ctx.fs.existsFallback(), true);
    const fallback = ctx.fs.readFallback();
    assert.equal(fallback.id_token_email, 'personal@gmail.com');
  });

  it('3. agy.profiles.switch_best automatically activates best profile', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.switch_best');
    assert.equal(res.ok, true);
    assert.ok(res.activeProfile);
    assert.ok(['work', 'personal'].includes(res.activeProfile));
  });

  it('4. rejects non-existent profile alias cleanly', async () => {
    const res = await ctx.cli.runPluginRpc('agy.profiles.switch', { alias: 'nonexistent' });
    assert.equal(res.ok, false);
    assert.match(res.error, /Profile 'nonexistent' not found/);
  });

  it('5. enforces schema validation on empty or missing alias parameter', async () => {
    const res1 = await ctx.cli.runPluginRpc('agy.profiles.switch', {});
    assert.equal(res1.ok, false);
    assert.match(res1.error, /Invalid alias/);

    const res2 = await ctx.cli.runPluginRpc('agy.profiles.switch', { alias: '   ' });
    assert.equal(res2.ok, false);
    assert.match(res2.error, /Invalid alias/);
  });
});
